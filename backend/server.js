const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const { parse: csvParse } = require('csv-parse');
const { Transform, pipeline } = require('stream');
const { promisify } = require('util');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { Storage } = require('@google-cloud/storage');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3001;

// Maximum allowed cell length (default 1,000,000 characters)
const MAX_CELL_LENGTH = parseInt(process.env.MAX_CELL_LENGTH || '1000000', 10);
// Allow diacritics/unicode letters by default (set ALLOW_DIACRITICS=false to disable)
const ALLOW_DIACRITICS = (process.env.ALLOW_DIACRITICS || 'true').toLowerCase() !== 'false';

// Initialize Google Cloud Storage
const projectId = process.env.GCP_PROJECT_ID || 'accupoint-solutions-dev';
const cloudStorage = new Storage({
    projectId
});
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'mike-time-csv-processing';
const bucket = cloudStorage.bucket(BUCKET_NAME);

// Initialize SQLite database for learning system
const dbPath = path.join(__dirname, 'learning_data.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize learning database tables
db.serialize(() => {
    // Override patterns table
    db.run(`CREATE TABLE IF NOT EXISTS override_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_value TEXT NOT NULL,
        suggested_fix TEXT NOT NULL,
        user_override TEXT NOT NULL,
        column_name TEXT,
        column_type TEXT,
        problem_type TEXT,
        character_pattern TEXT,
        language_context TEXT,
        frequency_count INTEGER DEFAULT 1,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Learning insights table for aggregated patterns
    db.run(`CREATE TABLE IF NOT EXISTS learning_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_type TEXT NOT NULL,
        pattern_key TEXT NOT NULL,
        suggested_improvement TEXT NOT NULL,
        confidence_score REAL DEFAULT 0.0,
        usage_count INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pattern_type, pattern_key)
    )`);

    // Character mappings table for individual character replacement rules
    db.run(`CREATE TABLE IF NOT EXISTS character_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_char TEXT NOT NULL,
        to_char TEXT NOT NULL,
        char_type TEXT,
        usage_count INTEGER DEFAULT 1,
        confidence_score REAL DEFAULT 1.0,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_char, to_char)
    )`);

    // Create performance indexes for high-volume processing
    db.run(`CREATE INDEX IF NOT EXISTS idx_learning_insights_type_key ON learning_insights(pattern_type, pattern_key)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_learning_insights_confidence ON learning_insights(confidence_score DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_learning_insights_usage ON learning_insights(usage_count DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_character_mappings_from_char ON character_mappings(from_char)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_character_mappings_usage ON character_mappings(usage_count DESC)`);

    // Whitelisted characters table (user-approved characters)
    db.run(`CREATE TABLE IF NOT EXISTS whitelisted_characters (
        char TEXT PRIMARY KEY,
        description TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Learning database initialized successfully');
});

// In-memory cache of whitelisted characters
const whitelistedCharacters = new Set();
// Load whitelisted characters at startup
db.all(`SELECT char FROM whitelisted_characters`, [], (err, rows) => {
    if (err) {
        console.error('Error loading whitelisted characters:', err);
    } else if (rows && rows.length) {
        rows.forEach(r => whitelistedCharacters.add(r.char));
        console.log(`Loaded ${whitelistedCharacters.size} whitelisted characters`);
    }
});

// Learning Analytics Functions
const learningAnalytics = {
    // Store an override pattern for learning
    storeOverridePattern: (originalValue, suggestedFix, userOverride, context) => {
        return new Promise((resolve, reject) => {
            const {
                columnName = '',
                columnType = '',
                problemType = '',
                characterPattern = '',
                languageContext = ''
            } = context;

            // Extract detailed patterns
            const patterns = extractLearningPatterns(originalValue);

            // Check if this exact pattern exists
            db.get(
                `SELECT id, frequency_count FROM override_patterns 
                 WHERE original_value = ? AND suggested_fix = ? AND user_override = ? 
                 AND column_name = ? AND problem_type = ?`,
                [originalValue, suggestedFix, userOverride, columnName, problemType],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (row) {
                        // Update existing pattern
                        db.run(
                            `UPDATE override_patterns 
                             SET frequency_count = frequency_count + 1, last_seen = CURRENT_TIMESTAMP 
                             WHERE id = ?`,
                            [row.id],
                            (err) => {
                                if (err) reject(err);
                                else resolve({ action: 'updated', id: row.id });
                            }
                        );
                    } else {
                        // Insert new pattern
                        db.run(
                            `INSERT INTO override_patterns 
                             (original_value, suggested_fix, user_override, column_name, column_type, 
                              problem_type, character_pattern, language_context) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                            [originalValue, suggestedFix, userOverride, columnName, columnType,
                                problemType, characterPattern, languageContext],
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                // Store individual character mappings
                                if (patterns.characterMappings.length > 0) {
                                    patterns.characterMappings.forEach(mapping => {
                                        if (mapping.to) {
                                            db.run(
                                                `INSERT OR REPLACE INTO character_mappings 
                                                 (from_char, to_char, char_type, usage_count, last_seen) 
                                                 VALUES (?, ?, ?, COALESCE((SELECT usage_count FROM character_mappings WHERE from_char = ? AND to_char = ?), 0) + 1, CURRENT_TIMESTAMP)`,
                                                [mapping.from, mapping.to, mapping.type, mapping.from, mapping.to],
                                                (err) => {
                                                    if (err) console.error('Error storing character mapping:', err);
                                                }
                                            );
                                        }
                                    });
                                }

                                resolve({ action: 'created', id: this.lastID });
                            }
                        );
                    }
                }
            );
        });
    },

    // Analyze patterns and generate learning insights
    analyzePatterns: () => {
        return new Promise((resolve, reject) => {
            const insights = [];

            // 1. Find exact value matches (full original → full fix)
            db.all(
                `SELECT original_value, user_override, COUNT(*) as count,
                        AVG(frequency_count) as avg_frequency,
                        MAX(column_name) as sample_column
                 FROM override_patterns 
                 GROUP BY original_value, user_override 
                 HAVING count >= 2
                 ORDER BY count DESC, avg_frequency DESC`,
                [],
                (err, exactRows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    exactRows.forEach(row => {
                        insights.push({
                            type: 'exact_value_match',
                            pattern: row.original_value.length > 50 ?
                                row.original_value.substring(0, 47) + '...' :
                                row.original_value,
                            fullPattern: row.original_value,
                            suggestion: row.user_override,
                            confidence: Math.min(row.count * 0.3, 1.0),
                            usage_count: row.count,
                            sample_column: row.sample_column
                        });
                    });

                    // 2. Find character mapping patterns
                    db.all(
                        `SELECT from_char, to_char, char_type, usage_count, confidence_score
                         FROM character_mappings 
                         WHERE usage_count >= 2
                         ORDER BY usage_count DESC, confidence_score DESC`,
                        [],
                        (err, charRows) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            charRows.forEach(row => {
                                insights.push({
                                    type: 'character_mapping',
                                    pattern: `${row.from_char} → ${row.to_char}`,
                                    suggestion: `Replace '${row.from_char}' with '${row.to_char}'`,
                                    confidence: Math.min(row.usage_count * 0.2, 1.0),
                                    usage_count: row.usage_count,
                                    char_type: row.char_type
                                });
                            });

                            // 3. Find character sequence patterns (legacy)
                            db.all(
                                `SELECT character_pattern, COUNT(DISTINCT user_override) as fix_variety,
                                        COUNT(*) as count, GROUP_CONCAT(user_override, ' | ') as fixes
                                 FROM override_patterns 
                                 WHERE character_pattern != '' AND LENGTH(character_pattern) >= 3
                                 GROUP BY character_pattern 
                                 HAVING count >= 2
                                 ORDER BY count DESC`,
                                [],
                                (err, patternRows) => {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    patternRows.forEach(row => {
                                        // Only include if there's consistency in fixes
                                        if (row.fix_variety <= 3) {
                                            // Extract what the characters were replaced with by analyzing the pattern
                                            const originalPattern = row.character_pattern;
                                            const fixes = row.fixes.split(' | ');

                                            // Find the most common replacement pattern
                                            let replacementDescription = "These characters are typically removed or replaced with standard ASCII equivalents";

                                            // Try to determine if they're consistently removed vs replaced
                                            const allFixes = fixes.join(' ');
                                            if (allFixes.toLowerCase().includes('andar') || allFixes.toLowerCase().includes('avenue')) {
                                                replacementDescription = "These characters are typically removed (appear in address/location data)";
                                            }

                                            insights.push({
                                                type: 'character_sequence',
                                                pattern: row.character_pattern,
                                                suggestion: replacementDescription,
                                                confidence: Math.min((row.count / row.fix_variety) * 0.15, 0.7),
                                                usage_count: row.count,
                                                fix_variety: row.fix_variety,
                                                example_contexts: fixes.slice(0, 3) // Show up to 3 examples
                                            });
                                        }
                                    });

                                    // 4. Find column-specific patterns
                                    db.all(
                                        `SELECT column_name, column_type, problem_type, 
                                                COUNT(DISTINCT user_override) as fix_variety,
                                                COUNT(*) as count, AVG(frequency_count) as avg_frequency,
                                                GROUP_CONCAT(user_override, ' | ') as fixes
                                         FROM override_patterns 
                                         WHERE column_name != '' 
                                         GROUP BY column_name, problem_type 
                                         HAVING count >= 2
                                         ORDER BY count DESC`,
                                        [],
                                        (err, columnRows) => {
                                            if (err) {
                                                reject(err);
                                                return;
                                            }

                                            columnRows.forEach(row => {
                                                insights.push({
                                                    type: 'column_specific',
                                                    pattern: `${row.column_name}: ${row.problem_type}`,
                                                    suggestion: row.fixes.split(' | ')[0], // Most common fix
                                                    confidence: Math.min(row.count * 0.15, 0.9),
                                                    usage_count: row.count,
                                                    column_name: row.column_name,
                                                    problem_type: row.problem_type,
                                                    fix_variety: row.fix_variety
                                                });
                                            });

                                            resolve(insights);
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    },

    // Get enhanced suggestions based on learned patterns
    getEnhancedSuggestion: (originalValue, columnName, problemType, defaultSuggestion) => {
        return new Promise((resolve, reject) => {
            // Look for exact matches first
            db.get(
                `SELECT user_override, frequency_count, 
                        (frequency_count * 1.0) as confidence_score
                 FROM override_patterns 
                 WHERE original_value = ? AND column_name = ? AND problem_type = ?
                 ORDER BY frequency_count DESC LIMIT 1`,
                [originalValue, columnName, problemType],
                (err, exactMatch) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (exactMatch && exactMatch.frequency_count >= 2) {
                        resolve({
                            suggestion: exactMatch.user_override,
                            confidence: Math.min(exactMatch.confidence_score * 0.3, 1.0),
                            reason: 'Exact match from user overrides',
                            learned: true
                        });
                        return;
                    }

                    // Look for similar patterns
                    db.all(
                        `SELECT user_override, COUNT(*) as pattern_count,
                                AVG(frequency_count) as avg_frequency
                         FROM override_patterns 
                         WHERE (column_name = ? AND problem_type = ?) 
                            OR (character_pattern LIKE '%' || ? || '%')
                         GROUP BY user_override 
                         ORDER BY pattern_count DESC, avg_frequency DESC 
                         LIMIT 3`,
                        [columnName, problemType, originalValue.substring(0, 10)],
                        (err, similarPatterns) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (similarPatterns.length > 0 && similarPatterns[0].pattern_count >= 2) {
                                resolve({
                                    suggestion: similarPatterns[0].user_override,
                                    confidence: Math.min(similarPatterns[0].pattern_count * 0.1, 0.7),
                                    reason: 'Similar pattern from user overrides',
                                    learned: true,
                                    alternatives: similarPatterns.slice(1).map(p => p.user_override)
                                });
                            } else {
                                resolve({
                                    suggestion: defaultSuggestion,
                                    confidence: 0.5,
                                    reason: 'Default algorithm',
                                    learned: false
                                });
                            }
                        }
                    );
                }
            );
        });
    },

    // Get learning statistics
    getLearningStats: () => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    COUNT(*) as total_patterns,
                    COUNT(DISTINCT column_name) as unique_columns,
                    COUNT(DISTINCT problem_type) as unique_problems,
                    SUM(frequency_count) as total_overrides,
                    AVG(frequency_count) as avg_frequency_per_pattern,
                    MAX(last_seen) as last_learning_date
                 FROM override_patterns`,
                [],
                (err, stats) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    db.all(
                        `SELECT problem_type, COUNT(*) as count 
                         FROM override_patterns 
                         GROUP BY problem_type 
                         ORDER BY count DESC`,
                        [],
                        (err, problemBreakdown) => {
                            if (err) {
                                reject(err);
                                return;
                            }

                            resolve({
                                summary: stats[0],
                                problemBreakdown: problemBreakdown
                            });
                        }
                    );
                }
            );
        });
    }
};

// Memory management
process.on('warning', (warning) => {
    console.log(warning.stack);
});

// Middleware
const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:5176',
        'http://localhost:5177',
        'https://mikeqc.netlify.app'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Add request size logging middleware
app.use((req, res, next) => {
    if (req.headers['content-length']) {
        const sizeMB = (parseInt(req.headers['content-length']) / 1024 / 1024).toFixed(2);
        console.log(`Request to ${req.path}: ${sizeMB}MB`);
    }
    next();
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        fs.ensureDirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.csv', '.xlsx', '.xls'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV, XLSX, and XLS files are allowed'));
        }
    },
    limits: {
        fileSize: 800 * 1024 * 1024 // 800MB limit
    }
});

// In-memory storage for session data - optimized to store only essential data
const sessionData = new Map();

// Helper function to force garbage collection if available
const forceGC = () => {
    if (global.gc) {
        global.gc();
    }
};

// Cleanup function to remove old files and sessions
const cleanupOldSessions = async () => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    for (const [sessionId, session] of sessionData.entries()) {
        const sessionAge = now - parseInt(sessionId);
        if (sessionAge > maxAge) {
            // Remove old file if it still exists
            if (session.filePath && await fs.pathExists(session.filePath)) {
                try {
                    await fs.remove(session.filePath);
                    console.log(`Cleaned up old file: ${session.filePath}`);
                } catch (error) {
                    console.error(`Error cleaning up file ${session.filePath}:`, error);
                }
            }
            // Remove session from memory
            sessionData.delete(sessionId);
            console.log(`Cleaned up old session: ${sessionId}`);
        }
    }

    forceGC(); // Force garbage collection after cleanup
};

// Run cleanup every 6 hours
setInterval(cleanupOldSessions, 6 * 60 * 60 * 1000);

// Excel-style column name generator
const getExcelColumnName = (columnIndex) => {
    let columnName = '';
    while (columnIndex >= 0) {
        columnName = String.fromCharCode(65 + (columnIndex % 26)) + columnName;
        columnIndex = Math.floor(columnIndex / 26) - 1;
    }
    return columnName;
};

// Excel-style cell reference generator
const getExcelCellReference = (rowIndex, columnIndex) => {
    const columnName = getExcelColumnName(columnIndex);
    const rowNumber = rowIndex + 1; // Excel rows are 1-indexed
    return `${columnName}${rowNumber}`;
};

// Comprehensive accent and special character mapping
const createAccentMap = () => {
    const accentMap = new Map();

    // Latin accented characters
    const accentMappings = {
        'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A', 'Æ': 'AE',
        'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'æ': 'ae',
        'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E',
        'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
        'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I',
        'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
        'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'Ø': 'O', 'Œ': 'OE',
        'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'œ': 'oe',
        'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U',
        'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
        'Ý': 'Y', 'Ÿ': 'Y',
        'ý': 'y', 'ÿ': 'y',
        'Ñ': 'N', 'ñ': 'n',
        'Ç': 'C', 'ç': 'c',
        'ß': 'ss',
        // Extended Latin
        'Ā': 'A', 'ā': 'a', 'Ă': 'A', 'ă': 'a', 'Ą': 'A', 'ą': 'a',
        'Ć': 'C', 'ć': 'c', 'Ĉ': 'C', 'ĉ': 'c', 'Ċ': 'C', 'ċ': 'c', 'Č': 'C', 'č': 'c',
        'Ď': 'D', 'ď': 'd', 'Đ': 'D', 'đ': 'd',
        'Ē': 'E', 'ē': 'e', 'Ĕ': 'E', 'ĕ': 'e', 'Ė': 'E', 'ė': 'e', 'Ę': 'E', 'ę': 'e', 'Ě': 'E', 'ě': 'e',
        'Ĝ': 'G', 'ĝ': 'g', 'Ğ': 'G', 'ğ': 'g', 'Ġ': 'G', 'ġ': 'g', 'Ģ': 'G', 'ģ': 'g',
        'Ĥ': 'H', 'ĥ': 'h', 'Ħ': 'H', 'ħ': 'h',
        'Ĩ': 'I', 'ĩ': 'i', 'Ī': 'I', 'ī': 'i', 'Ĭ': 'I', 'ĭ': 'i', 'Į': 'I', 'į': 'i', 'İ': 'I', 'ı': 'i',
        'Ĵ': 'J', 'ĵ': 'j',
        'Ķ': 'K', 'ķ': 'k', 'ĸ': 'k',
        'Ĺ': 'L', 'ĺ': 'l', 'Ļ': 'L', 'ļ': 'l', 'Ľ': 'L', 'ľ': 'l', 'Ŀ': 'L', 'ŀ': 'l', 'Ł': 'L', 'ł': 'l',
        'Ń': 'N', 'ń': 'n', 'Ņ': 'N', 'ņ': 'n', 'Ň': 'N', 'ň': 'n', 'ŉ': 'n', 'Ŋ': 'N', 'ŋ': 'n',
        'Ō': 'O', 'ō': 'o', 'Ŏ': 'O', 'ŏ': 'o', 'Ő': 'O', 'ő': 'o',
        'Ŕ': 'R', 'ŕ': 'r', 'Ŗ': 'R', 'ŗ': 'r', 'Ř': 'R', 'ř': 'r',
        'Ś': 'S', 'ś': 's', 'Ŝ': 'S', 'ŝ': 's', 'Ş': 'S', 'ş': 's', 'Š': 'S', 'š': 's',
        'Ţ': 'T', 'ţ': 't', 'Ť': 'T', 'ť': 't', 'Ŧ': 'T', 'ŧ': 't',
        'Ũ': 'U', 'ũ': 'u', 'Ū': 'U', 'ū': 'u', 'Ŭ': 'U', 'ŭ': 'u', 'Ů': 'U', 'ů': 'u', 'Ű': 'U', 'ű': 'u', 'Ų': 'U', 'ų': 'u',
        'Ŵ': 'W', 'ŵ': 'w',
        'Ŷ': 'Y', 'ŷ': 'y',
        'Ź': 'Z', 'ź': 'z', 'Ż': 'Z', 'ż': 'z', 'Ž': 'Z', 'ž': 'z',
        // Smart quotes and special punctuation
        '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'", '\u2026': '...', '\u2013': '-', '\u2014': '-',
        // Special symbols that should be removed or replaced
        '\u2603': '', '\u20AC': 'EUR', '\u00A3': 'GBP', '\u00A5': 'JPY', '\u00A9': '(c)', '\u00AE': '(r)', '\u2122': 'TM'
    };

    Object.entries(accentMappings).forEach(([accented, base]) => {
        accentMap.set(accented, base);
    });

    return accentMap;
};

const accentMap = createAccentMap();

// Strict character validation - allow letters/numbers and basic punctuation
const isValidCharacter = (char) => {
    const code = char.codePointAt(0);

    // Always block control and zero-width/BOM
    if ((code >= 0x00 && code <= 0x1F) || (code >= 0x7F && code <= 0x9F)) return false;
    if (code === 0x200B || code === 0x200C || code === 0x200D || code === 0xFEFF) return false;

    // Allow if explicitly whitelisted by user
    if (whitelistedCharacters.has(char)) return true;

    // If diacritics allowed, allow remaining characters
    if (ALLOW_DIACRITICS) return true;

    // ASCII-only mode: allow alphanumerics, space, and a curated punctuation set
    if (
        (code >= 48 && code <= 57) || // 0-9
        (code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122) || // a-z
        char === ' '
    ) return true;

    const allowedPunctuation = new Set(['.', ',', ';', ':', '!', '?', '-', '_', '(', ')', '[', ']', '{', '}', '@', '#', '$', '%', '&', '*', '+', '=', '/', '<', '>', '|', '\\', '^', '~', '`', '\'', '"']);
    return allowedPunctuation.has(char);
};

// Find all invalid characters in a string
const findInvalidCharacters = (text) => {
    const invalidChars = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (!isValidCharacter(char)) {
            const replacement = accentMap.get(char) || '';
            invalidChars.push({
                char: char,
                position: i,
                charCode: char.charCodeAt(0),
                replacement: replacement,
                description: getCharacterDescription(char)
            });
        }
    }
    return invalidChars;
};

const getCharacterDescription = (char) => {
    const charCode = char.charCodeAt(0);

    if (accentMap.has(char)) {
        return `Accented character (${char} → ${accentMap.get(char)})`;
    }
    if (charCode >= 0x0000 && charCode <= 0x001F) return 'Control character';
    if (charCode >= 0x007F && charCode <= 0x009F) return 'Extended control character';
    if (charCode === 0xFFFD) return 'Unicode replacement character';
    if (charCode >= 0x00A0 && charCode <= 0x00FF) return 'Latin-1 supplement character';
    if (charCode >= 0x0100 && charCode <= 0x017F) return 'Latin extended character';
    if (charCode >= 0x2000 && charCode <= 0x206F) return 'General punctuation character';
    if (charCode >= 0x2600 && charCode <= 0x26FF) return 'Miscellaneous symbol';
    return 'Invalid character';
};

// Fix invalid characters by replacing with valid equivalents
const fixInvalidCharacters = (text) => {
    let fixedText = text;

    if (!ALLOW_DIACRITICS) {
        // Replace accented characters with base equivalents when diacritics not allowed
        for (const [accented, base] of accentMap.entries()) {
            fixedText = fixedText.replace(new RegExp(accented.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), base);
        }
        // Remove non-ASCII entirely
        fixedText = fixedText.replace(/[^\x00-\x7F]/g, '');
    }

    // Always remove control/zero-width/BOM characters
    fixedText = fixedText.replace(/[\x00-\x1F\x7F-\x9F\u200B\u200C\u200D\uFEFF]/g, '');

    return fixedText.trim();
};

// Enhanced fix suggestion using learning system
const getEnhancedFixSuggestion = async (originalValue, columnName, problemType) => {
    try {
        // Get default suggestion
        let defaultSuggestion = originalValue;

        // Apply character fixes if needed
        if (problemType.includes('Invalid characters')) {
            defaultSuggestion = fixInvalidCharacters(defaultSuggestion);
        }

        // Apply length truncation if needed
        if (problemType.includes('Length exceeds')) {
            defaultSuggestion = truncateText(defaultSuggestion);
        }

        // Get enhanced suggestion from learning system
        const enhancedResult = await learningAnalytics.getEnhancedSuggestion(
            originalValue,
            columnName,
            problemType,
            defaultSuggestion
        );

        return enhancedResult;
    } catch (error) {
        console.error('Error getting enhanced suggestion:', error);
        // Fallback to default logic
        let fallbackSuggestion = originalValue;
        if (problemType.includes('Invalid characters')) {
            fallbackSuggestion = fixInvalidCharacters(fallbackSuggestion);
        }
        if (problemType.includes('Length exceeds')) {
            fallbackSuggestion = truncateText(fallbackSuggestion);
        }

        return {
            suggestion: fallbackSuggestion,
            confidence: 0.5,
            reason: 'Default algorithm (learning system unavailable)',
            learned: false
        };
    }
};

// Extract context for learning
const extractLearningContext = (issue) => {
    const context = {
        columnName: issue.column,
        columnType: detectColumnType(issue.column),
        problemType: issue.problem,
        characterPattern: extractCharacterPattern(issue.originalValue),
        languageContext: detectLanguageContext(issue.originalValue)
    };
    return context;
};

// Detect column type based on name
const detectColumnType = (columnName) => {
    const lowerName = columnName.toLowerCase();
    if (lowerName.includes('name')) return 'name';
    if (lowerName.includes('address')) return 'address';
    if (lowerName.includes('city') || lowerName.includes('state') || lowerName.includes('country')) return 'location';
    if (lowerName.includes('email')) return 'email';
    if (lowerName.includes('phone')) return 'phone';
    if (lowerName.includes('zip') || lowerName.includes('postal')) return 'postal_code';
    return 'general';
};

// Extract multiple types of patterns for learning
const extractLearningPatterns = (text) => {
    const invalidChars = findInvalidCharacters(text);

    return {
        // Character sequence pattern (first 10 invalid characters)
        characterPattern: invalidChars.map(c => c.char).slice(0, 10).join(''),

        // Character types pattern (more general)
        characterTypePattern: invalidChars.slice(0, 10).map(c => {
            if (accentMap.has(c.char)) return 'ACCENT';
            if (c.charCode >= 0x2000 && c.charCode <= 0x206F) return 'PUNCT';
            if (c.charCode >= 0x0000 && c.charCode <= 0x001F) return 'CTRL';
            return 'INVALID';
        }).join(''),

        // Full value pattern (for exact matching)
        fullValuePattern: text,

        // Prefix/suffix patterns (first/last 20 chars for partial matching)
        prefixPattern: text.substring(0, 20),
        suffixPattern: text.length > 20 ? text.substring(text.length - 20) : text,

        // Individual character mappings
        characterMappings: invalidChars.map(c => ({
            from: c.char,
            to: accentMap.get(c.char) || '',
            position: c.position,
            type: c.description
        }))
    };
};

// Legacy function for backward compatibility
const extractCharacterPattern = (text) => {
    const patterns = extractLearningPatterns(text);
    return patterns.characterPattern;
};

// Detect language context
const detectLanguageContext = (text) => {
    // Simple language detection based on character patterns
    if (/[àáâãäåæçèéêëìíîïñòóôõöøùúûüý]/i.test(text)) {
        if (/[ñ]/i.test(text)) return 'spanish';
        if (/[ç]/i.test(text)) return 'french';
        if (/[ø]/i.test(text)) return 'scandinavian';
        return 'romance_language';
    }
    if (/[äöüß]/i.test(text)) return 'german';
    if (/[ąćęłńóśźż]/i.test(text)) return 'polish';
    return 'unknown';
};

const truncateText = (text, maxLength = MAX_CELL_LENGTH) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim();
};

// Enhance suggestions with learned patterns (post-analysis)
const enhanceSuggestionsWithLearning = async (issues) => {
    const enhancedIssues = [];

    console.log(`Enhancing ${issues.length} suggestions with learned patterns...`);

    for (const issue of issues) {
        try {
            const enhancedResult = await getEnhancedFixSuggestion(
                issue.originalValue,
                issue.column,
                issue.problem
            );

            // Use learned suggestion if confidence is high enough
            if (enhancedResult.learned && enhancedResult.confidence > 0.6) {
                enhancedIssues.push({
                    ...issue,
                    suggestedFix: enhancedResult.suggestion,
                    confidence: enhancedResult.confidence,
                    learned: true,
                    reason: enhancedResult.reason
                });
                console.log(`Enhanced: "${issue.originalValue}" → "${enhancedResult.suggestion}" (${enhancedResult.confidence.toFixed(2)} confidence)`);
            } else {
                enhancedIssues.push({
                    ...issue,
                    confidence: 0.5,
                    learned: false,
                    reason: 'Default algorithm'
                });
            }
        } catch (error) {
            console.error('Error enhancing suggestion:', error);
            // Fallback to original suggestion if learning fails
            enhancedIssues.push({
                ...issue,
                confidence: 0.5,
                learned: false,
                reason: 'Default algorithm (learning unavailable)'
            });
        }
    }

    const learnedCount = enhancedIssues.filter(i => i.learned).length;
    console.log(`Enhanced ${learnedCount}/${issues.length} suggestions using learned patterns`);

    return enhancedIssues;
};

// Streaming CSV analysis function
const analyzeCSVStreamMemoryEfficient = (filePath, filename, progressCallback) => {
    return new Promise((resolve, reject) => {
        const issues = [];
        let rowIndex = 0;
        let processedRows = 0;
        let headers = [];
        const batchSize = 1000; // Process in batches for memory efficiency
        let currentBatch = [];

        const processBatch = (batch) => {
            batch.forEach(row => {
                headers.forEach((column, columnIndex) => {
                    const cellValue = row[column];
                    if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
                        const cellStr = String(cellValue);

                        // Check for invalid characters (including accented characters)
                        const invalidChars = findInvalidCharacters(cellStr);
                        const hasInvalidChars = invalidChars.length > 0;

                        // Check for length issues
                        const hasLengthIssues = cellStr.length > MAX_CELL_LENGTH;

                        if (hasInvalidChars || hasLengthIssues) {
                            let problemDescription = [];
                            if (hasInvalidChars) {
                                const charDescriptions = invalidChars.map(c => `'${c.char}' (${c.description})`).slice(0, 3); // Limit to first 3
                                if (invalidChars.length > 3) {
                                    charDescriptions.push(`and ${invalidChars.length - 3} more`);
                                }
                                problemDescription.push(`Invalid characters: ${charDescriptions.join(', ')}`);
                            }
                            if (hasLengthIssues) {
                                problemDescription.push(`Length exceeds ${MAX_CELL_LENGTH} characters (${cellStr.length} chars)`);
                            }

                            // Generate suggested fix
                            let suggestedFix = cellStr;
                            if (hasInvalidChars) {
                                suggestedFix = fixInvalidCharacters(suggestedFix);
                            }
                            if (hasLengthIssues) {
                                suggestedFix = truncateText(suggestedFix);
                            }

                            issues.push({
                                id: `${rowIndex}-${columnIndex}`,
                                cellReference: getExcelCellReference(rowIndex + 1, columnIndex),
                                row: rowIndex + 2,
                                column: column,
                                originalValue: cellStr,
                                suggestedFix: suggestedFix,
                                filename: filename,
                                problem: problemDescription.join('; '),
                                invalidCharacters: invalidChars,
                                hasInvalidChars: hasInvalidChars,
                                hasLengthIssues: hasLengthIssues,
                                fixed: false
                            });
                        }
                    }
                });
                rowIndex++;
            });

            // Update progress
            if (progressCallback) {
                progressCallback(Math.min(95, Math.floor((processedRows / 10000) * 95))); // Estimate progress
            }

            // Clear batch for memory
            batch.length = 0;
        };

        const stream = fs.createReadStream(filePath)
            .pipe(csv())
            .on('headers', (headerList) => {
                headers = headerList;
            })
            .on('data', (data) => {
                currentBatch.push(data);
                processedRows++;

                // Process in batches to manage memory
                if (currentBatch.length >= batchSize) {
                    processBatch(currentBatch);
                    currentBatch = [];

                    // Force garbage collection periodically
                    if (processedRows % 10000 === 0) {
                        forceGC();
                        console.log(`Processed ${processedRows} rows, found ${issues.length} issues so far. Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
                    }
                }
            })
            .on('end', () => {
                // Process remaining batch
                if (currentBatch.length > 0) {
                    processBatch(currentBatch);
                }

                if (progressCallback) {
                    progressCallback(100);
                }

                console.log(`Analysis complete. Processed ${processedRows} rows, found ${issues.length} issues.`);
                forceGC(); // Final cleanup
                resolve({ issues, totalRows: processedRows, headers });
            })
            .on('error', (error) => {
                console.error('Error during CSV analysis:', error);
                reject(error);
            });
    });
};

// Optimized analysis for Excel files (still loads into memory but with better management)
const analyzeData = (data, filename, progressCallback) => {
    const issues = [];
    const totalRows = data.length;
    console.log(`Starting analysis of ${totalRows} rows...`);

    data.forEach((row, rowIndex) => {
        Object.keys(row).forEach((column, columnIndex) => {
            const cellValue = row[column];
            if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
                const cellStr = String(cellValue);

                // Check for invalid characters (including accented characters)
                const invalidChars = findInvalidCharacters(cellStr);
                const hasInvalidChars = invalidChars.length > 0;

                // Check for length issues
                const hasLengthIssues = cellStr.length > MAX_CELL_LENGTH;

                if (hasInvalidChars || hasLengthIssues) {
                    let problemDescription = [];
                    if (hasInvalidChars) {
                        const charDescriptions = invalidChars.map(c => `'${c.char}' (${c.description})`).slice(0, 3); // Limit to first 3
                        if (invalidChars.length > 3) {
                            charDescriptions.push(`and ${invalidChars.length - 3} more`);
                        }
                        problemDescription.push(`Invalid characters: ${charDescriptions.join(', ')}`);
                    }
                    if (hasLengthIssues) {
                        problemDescription.push(`Length exceeds ${MAX_CELL_LENGTH} characters (${cellStr.length} chars)`);
                    }

                    // Generate suggested fix
                    let suggestedFix = cellStr;
                    if (hasInvalidChars) {
                        suggestedFix = fixInvalidCharacters(suggestedFix);
                    }
                    if (hasLengthIssues) {
                        suggestedFix = truncateText(suggestedFix);
                    }

                    issues.push({
                        id: `${rowIndex}-${columnIndex}`,
                        cellReference: getExcelCellReference(rowIndex + 1, columnIndex),
                        row: rowIndex + 2,
                        column: column,
                        originalValue: cellStr,
                        suggestedFix: suggestedFix,
                        filename: filename,
                        problem: problemDescription.join('; '),
                        invalidCharacters: invalidChars,
                        hasInvalidChars: hasInvalidChars,
                        hasLengthIssues: hasLengthIssues,
                        fixed: false
                    });
                }
            }
        });

        // Update progress and manage memory
        if (rowIndex % 1000 === 0) {
            if (progressCallback) {
                progressCallback(Math.floor((rowIndex / totalRows) * 95));
            }
            if (rowIndex % 10000 === 0) {
                forceGC();
                console.log(`Processed ${rowIndex} rows, found ${issues.length} issues so far. Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
            }
        }
    });

    if (progressCallback) {
        progressCallback(100);
    }

    console.log(`Analysis complete. Found ${issues.length} issues.`);
    return issues;
};

const parseExcelFile = (filePath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log('Reading Excel file...');
            const workbook = XLSX.readFile(filePath, { cellText: false, cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            console.log('Converting Excel sheet to JSON...');
            const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

            console.log(`Excel file parsed: ${data.length} rows`);
            resolve(data);
        } catch (error) {
            console.error('Error parsing Excel file:', error);
            reject(error);
        }
    });
};

// Simple row count for CSV without loading into memory
const getCSVRowCount = (filePath) => {
    return new Promise((resolve, reject) => {
        let rowCount = 0;
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', () => rowCount++)
            .on('end', () => resolve(rowCount))
            .on('error', reject);
    });
};

// High-performance file processing from Cloud Storage
const processFileFromStorage = async (filename) => {
    const startTime = Date.now();
    const file = bucket.file(filename);

    console.log(`Starting high-performance processing of: ${filename}`);
    console.log(`Memory before processing: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
        throw new Error(`File ${filename} not found in Cloud Storage`);
    }

    // Get file metadata
    const [metadata] = await file.getMetadata();
    const fileSizeMB = (metadata.size / 1024 / 1024).toFixed(2);
    console.log(`File size: ${fileSizeMB}MB`);

    // Stream processing with parallel analysis
    const issues = [];
    let rowCount = 0;
    let columnCount = 0;
    let headers = [];
    const BATCH_SIZE = 10000; // Process in batches for memory efficiency
    let currentBatch = [];

    return new Promise((resolve, reject) => {
        const csvStream = file.createReadStream()
            .pipe(csvParse({
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true
            }));

        csvStream.on('headers', (headerList) => {
            headers = headerList;
            columnCount = headers.length;
            console.log(`Detected ${columnCount} columns:`, headers.slice(0, 5), columnCount > 5 ? '...' : '');
        });

        csvStream.on('data', (row) => {
            rowCount++;
            currentBatch.push({ row, rowIndex: rowCount });

            // Process batch when it reaches BATCH_SIZE
            if (currentBatch.length >= BATCH_SIZE) {
                const batchIssues = processBatchParallel(currentBatch, headers);
                issues.push(...batchIssues);
                currentBatch = [];

                // Progress logging
                if (rowCount % 50000 === 0) {
                    const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                    console.log(`Processed ${rowCount} rows, found ${issues.length} issues so far. Memory usage: ${memoryUsage}MB`);

                    // Force garbage collection if available
                    if (global.gc) {
                        global.gc();
                    }
                }
            }
        });

        csvStream.on('end', () => {
            // Process remaining batch
            if (currentBatch.length > 0) {
                const batchIssues = processBatchParallel(currentBatch, headers);
                issues.push(...batchIssues);
            }

            const processingTime = Date.now() - startTime;
            console.log(`Analysis complete. Processed ${rowCount} rows, found ${issues.length} issues.`);
            console.log(`Processing time: ${processingTime}ms (${(processingTime / 1000).toFixed(2)}s)`);
            console.log(`Memory after processing: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

            // Optionally clean up the file from Cloud Storage (keep if env set)
            if (!process.env.GCS_KEEP_FILES || process.env.GCS_KEEP_FILES !== 'true') {
                file.delete().catch(err => console.warn('Failed to delete file from storage:', err));
            }

            resolve({
                success: true,
                filename: filename,
                totalRows: rowCount,
                totalColumns: columnCount,
                issues: issues,
                processingTimeMs: processingTime,
                fileSizeMB: parseFloat(fileSizeMB)
            });
        });

        csvStream.on('error', (error) => {
            console.error('Stream processing error:', error);
            reject(error);
        });
    });
};

// Parallel batch processing for maximum performance
const processBatchParallel = (batch, headers) => {
    const batchIssues = [];

    // Process each row in the batch
    for (const { row, rowIndex } of batch) {
        const rowIssues = analyzeRowForIssues(row, headers, rowIndex);
        batchIssues.push(...rowIssues);
    }

    return batchIssues;
};

// High-performance row analysis (optimized version)
const analyzeRowForIssues = (row, headers, rowIndex) => {
    const issues = [];

    for (const [colIndex, header] of headers.entries()) {
        const cellValue = row[header];

        if (cellValue && typeof cellValue === 'string') {
            // Quick checks for common issues
            const trimmedValue = cellValue.trim();

            // Invalid characters check (optimized)
            const invalidChars = getInvalidCharacters(trimmedValue);
            if (invalidChars.length > 0) {
                issues.push({
                    id: `${rowIndex}-${colIndex}`,
                    row: rowIndex,
                    column: header,
                    originalValue: cellValue,
                    suggestedFix: cleanValue(trimmedValue),
                    issues: [`Contains invalid characters: ${invalidChars.map(c => c.char).join(', ')}`],
                    type: 'invalid_characters',
                    severity: 'medium'
                });
            }

            // Length check (quick)
            if (trimmedValue.length > MAX_CELL_LENGTH) {
                issues.push({
                    id: `${rowIndex}-${colIndex}-length`,
                    row: rowIndex,
                    column: header,
                    originalValue: cellValue,
                    suggestedFix: trimmedValue.substring(0, MAX_CELL_LENGTH) + '...',
                    issues: [`Value too long (${trimmedValue.length} characters, max ${MAX_CELL_LENGTH})`],
                    type: 'length_violation',
                    severity: 'low'
                });
            }
        }
    }

    return issues;
};

// Routes

// Get signed URL for direct Cloud Storage upload
app.post('/api/get-upload-url', async (req, res) => {
    try {
        const { filename, contentType } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }

        // Generate unique filename
        const uniqueFilename = `${Date.now()}-${filename}`;
        const file = bucket.file(uniqueFilename);

        // Create signed URL for upload (valid for 1 hour)
        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
            contentType: contentType || 'text/csv',
            extensionHeaders: {
                'x-goog-content-length-range': '0,8589934592' // 0 to 8GB
            }
        });

        // Create a progress session id for the client to poll
        const progressId = Date.now().toString();
        sessionProgress.set(progressId, { percent: 0, log: 'Upload URL issued. Ready to upload to storage.', updatedAt: Date.now() });

        res.json({
            uploadUrl: signedUrl,
            filename: uniqueFilename,
            bucketName: BUCKET_NAME,
            progressId
        });
    } catch (error) {
        console.error('Error generating signed URL:', error);
        res.status(500).json({ error: 'Failed to generate upload URL' });
    }
});

// Process file from Cloud Storage (high-performance)
app.post('/api/process-from-storage', async (req, res) => {
    try {
        const { filename, progressId, allowDiacritics } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }

        const id = progressId || Date.now().toString();
        updateProgress(id, 2, 'Starting processing from storage...');

        console.log(`Processing large file from Cloud Storage: ${filename}`);

        // Decide by extension
        const lower = filename.toLowerCase();
        if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
            const startTime = Date.now();
            const file = bucket.file(filename);
            const [exists] = await file.exists();
            if (!exists) throw new Error(`File ${filename} not found in Cloud Storage`);

            const [metadata] = await file.getMetadata();
            const fileSizeMB = (metadata.size / 1024 / 1024).toFixed(2);
            updateProgress(id, 5, `Excel file size: ${fileSizeMB}MB`);

            const stream = file.createReadStream();
            const result = await analyzeExcelStreamFromReadable(stream, filename, (pct) => updateProgress(id, pct, `Analyzing Excel rows... ${pct}%`));

            const processingTime = Date.now() - startTime;
            if (!process.env.GCS_KEEP_FILES || process.env.GCS_KEEP_FILES !== 'true') {
                file.delete().catch(err => console.warn('Failed to delete file from storage:', err));
            }
            return res.json({
                success: true,
                filename,
                totalRows: result.totalRows,
                totalColumns: result.headers.length,
                issues: await enhanceSuggestionsWithLearning(result.issues),
                processingTimeMs: processingTime,
                fileSizeMB: parseFloat(fileSizeMB),
                progressId: id,
                maxCellLength: MAX_CELL_LENGTH
            });
        }

        // Fallback to CSV streaming path
        updateProgress(id, 3, 'Reading CSV...');
        const prevAllow = ALLOW_DIACRITICS;
        if (typeof allowDiacritics === 'boolean') {
            global.ALLOW_DIACRITICS = allowDiacritics;
        }
        const result = await processFileFromStorage(filename);
        global.ALLOW_DIACRITICS = prevAllow;
        updateProgress(id, 100, 'Analysis complete!');
        res.json({ ...result, progressId: id, maxCellLength: MAX_CELL_LENGTH });
    } catch (error) {
        console.error('Error processing file from storage:', error);
        res.status(500).json({ error: 'Failed to process file from storage' });
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const progressId = (req.body && req.body.progressId) ? String(req.body.progressId) : Date.now().toString();
        updateProgress(progressId, 2, 'Upload received. Starting analysis...');

        const filePath = req.file.path;
        const allowDiacriticsParam = req.body && typeof req.body.allowDiacritics !== 'undefined' ? String(req.body.allowDiacritics).toLowerCase() : undefined;
        const allowDiacritics = allowDiacriticsParam === 'true' || allowDiacriticsParam === '1';
        const fileExtension = path.extname(req.file.originalname).toLowerCase();

        const startTime = Date.now();
        console.log(`Processing file: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`Memory before processing: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

        let analysisResult;
        let totalRows = 0;
        let totalColumns = 0;

        // Parse and analyze based on file type
        console.log('Starting file analysis...');
        const parseStartTime = Date.now();

        if (fileExtension === '.csv') {
            // Use streaming analysis for CSV files with progress
            const sessionIdTemp = Date.now().toString();
            updateProgress(sessionIdTemp, 5, 'Reading CSV headers...');
            const prevAllow = ALLOW_DIACRITICS;
            global.ALLOW_DIACRITICS = typeof allowDiacriticsParam === 'undefined' ? prevAllow : allowDiacritics;
            analysisResult = await analyzeCSVStreamMemoryEfficient(
                filePath,
                req.file.originalname,
                (pct) => updateProgress(sessionIdTemp, pct, `Processing CSV rows... ${pct}%`)
            );
            global.ALLOW_DIACRITICS = prevAllow;
            totalRows = analysisResult.totalRows;
            // Assign real sessionId later; stash progress under temp and move
            req._progressSessionId = sessionIdTemp;
            // Get column count from headers or issues
            if (analysisResult.headers && analysisResult.headers.length > 0) {
                totalColumns = analysisResult.headers.length;
            } else if (analysisResult.issues.length > 0) {
                totalColumns = new Set(analysisResult.issues.map(issue => issue.column)).size;
            } else {
                totalColumns = 0;
            }
        } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
            // Stream for large Excel files to avoid memory blowups
            if (req.file.size > 20 * 1024 * 1024) {
                console.log('Using streaming Excel analysis for large file');
                const sessionIdTemp = Date.now().toString();
                updateProgress(sessionIdTemp, 5, 'Reading Excel workbook...');
                const streamResult = await analyzeExcelStream(
                    filePath,
                    req.file.originalname,
                    (pct) => updateProgress(sessionIdTemp, pct, `Analyzing Excel rows... ${pct}%`)
                );
                req._progressSessionId = sessionIdTemp;
                totalRows = streamResult.totalRows;
                totalColumns = streamResult.headers.length;
                analysisResult = { issues: streamResult.issues, totalRows };
            } else {
                // Existing in-memory path
                const data = await parseExcelFile(filePath);
                if (!data || !Array.isArray(data) || data.length === 0) {
                    throw new Error('Excel file is empty or could not be parsed');
                }
                totalRows = data.length;
                totalColumns = Object.keys(data[0] || {}).length;
                console.log('Starting Excel data analysis...');
                const analysisStartTime = Date.now();
                const issues = analyzeData(data, req.file.originalname);
                const analysisTime = Date.now() - analysisStartTime;
                analysisResult = { issues, totalRows };
                data.length = 0;
                forceGC();
                console.log(`Excel analysis complete in ${analysisTime}ms`);
            }
        } else {
            throw new Error('Unsupported file type');
        }

        const parseTime = Date.now() - parseStartTime;
        console.log(`Analysis complete: ${totalRows} rows, ${totalColumns} columns, ${analysisResult.issues.length} issues found in ${parseTime}ms`);
        console.log(`Memory after processing: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

        // Enhance suggestions with learned patterns
        console.log('Enhancing suggestions with learned patterns...');
        const enhancementStartTime = Date.now();
        const enhancedIssues = await enhanceSuggestionsWithLearning(analysisResult.issues);
        const enhancementTime = Date.now() - enhancementStartTime;
        console.log(`Enhanced suggestions in ${enhancementTime}ms`);

        // Update analysis result with enhanced suggestions
        analysisResult.issues = enhancedIssues;

        // Generate session ID and store minimal data (no original data stored)
        const sessionId = Date.now().toString();
        // Move temp progress (if any) to real sessionId
        if (req._progressSessionId && sessionProgress.has(req._progressSessionId)) {
            const p = sessionProgress.get(req._progressSessionId);
            sessionProgress.set(sessionId, p);
            sessionProgress.delete(req._progressSessionId);
        }
        updateProgress(sessionId, 100, 'Analysis complete!');
        sessionData.set(sessionId, {
            filename: req.file.originalname,
            filePath: filePath, // Keep file path for potential re-processing
            totalRows: totalRows,
            totalColumns: totalColumns,
            issues: analysisResult.issues,
            fixedIssues: [],
            fileExtension: fileExtension,
            uploadTime: new Date().toISOString()
        });

        // DON'T delete the uploaded file immediately - keep it for generating fixed CSV
        // We'll clean it up later with a scheduled cleanup or when session expires

        const totalTime = Date.now() - startTime;
        console.log(`Processing complete in ${totalTime}ms. Found ${analysisResult.issues.length} issues.`);

        // Final memory cleanup
        forceGC();

        res.json({
            sessionId: sessionId,
            filename: req.file.originalname,
            totalRows: totalRows,
            totalColumns: totalColumns,
            issues: analysisResult.issues,
            issueCount: analysisResult.issues.length,
            processingTime: {
                total: totalTime,
                analysis: parseTime
            },
            memoryUsage: {
                heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            maxCellLength: MAX_CELL_LENGTH
        });

    } catch (error) {
        console.error('Error processing file:', error);
        console.log(`Memory during error: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

        // Clean up file on error
        if (req.file && req.file.path) {
            try {
                await fs.remove(req.file.path);
            } catch (cleanupError) {
                console.error('Error cleaning up file:', cleanupError);
            }
        }

        res.status(500).json({
            error: 'Error processing file',
            details: error.message
        });
    }
});

// Fix individual issue
app.post('/api/fix-issue', async (req, res) => {
    try {
        const { sessionId, issueId, overriddenFix } = req.body;

        if (!sessionId || !issueId) {
            return res.status(400).json({ error: 'Session ID and Issue ID are required' });
        }

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Find the issue
        const issue = session.issues.find(issue => issue.id === issueId);
        if (!issue) {
            return res.status(404).json({ error: 'Issue not found' });
        }

        if (issue.fixed) {
            return res.status(400).json({ error: 'Issue already fixed' });
        }

        // Store override in learning system if user provided a different fix
        if (overriddenFix && overriddenFix !== issue.suggestedFix) {
            try {
                const context = extractLearningContext(issue);
                await learningAnalytics.storeOverridePattern(
                    issue.originalValue,
                    issue.suggestedFix,
                    overriddenFix,
                    context
                );
                console.log(`Stored learning pattern: ${issue.originalValue} -> ${overriddenFix}`);
            } catch (learningError) {
                console.error('Error storing learning pattern:', learningError);
                // Continue with fix even if learning storage fails
            }
        }

        // Mark issue as fixed and store the change
        issue.fixed = true;

        const fixedIssue = {
            ...issue,
            // Use overridden fix if provided, otherwise use suggested fix
            suggestedFix: overriddenFix || issue.suggestedFix,
            fixedAt: new Date().toISOString(),
            changeId: `fix-${Date.now()}`,
            wasOverridden: !!overriddenFix
        };

        session.fixedIssues.push(fixedIssue);

        res.json({
            success: true,
            fixedIssue: fixedIssue,
            message: 'Issue fixed successfully'
        });

    } catch (error) {
        console.error('Error fixing issue:', error);
        res.status(500).json({
            error: 'Error fixing issue',
            details: error.message
        });
    }
});

// Mark a character/value as "not an issue" (whitelist)
app.post('/api/not-an-issue', async (req, res) => {
    try {
        const { char, description } = req.body || {};
        if (!char || typeof char !== 'string' || char.length === 0) {
            return res.status(400).json({ error: 'char is required' });
        }

        // Insert into DB (ignore if exists)
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT OR IGNORE INTO whitelisted_characters (char, description) VALUES (?, ?)`,
                [char, description || 'User approved'],
                (err) => (err ? reject(err) : resolve())
            );
        });

        // Update in-memory cache
        whitelistedCharacters.add(char);

        res.json({ success: true, whitelisted: char });
    } catch (error) {
        console.error('Error whitelisting character:', error);
        res.status(500).json({ error: 'Failed to whitelist character' });
    }
});

// Check which issues are new/unseen by the learning system
app.post('/api/check-new-issues', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const newIssueIds = [];

        // Check each issue to see if it's been seen before
        for (const issue of session.issues) {
            try {
                const enhancedResult = await learningAnalytics.getEnhancedSuggestion(
                    issue.originalValue,
                    issue.column,
                    issue.problem,
                    issue.suggestedFix
                );

                // If the result is not learned (confidence is low and no exact/similar patterns), it's new
                if (!enhancedResult.learned || enhancedResult.confidence < 0.3) {
                    newIssueIds.push(issue.id);
                }
            } catch (error) {
                console.error('Error checking if issue is new:', error);
                // If we can't check, assume it's new to be safe
                newIssueIds.push(issue.id);
            }
        }

        res.json({
            success: true,
            newIssueIds: newIssueIds,
            totalIssues: session.issues.length,
            newIssueCount: newIssueIds.length
        });

    } catch (error) {
        console.error('Error checking new issues:', error);
        res.status(500).json({
            error: 'Error checking new issues',
            details: error.message
        });
    }
});

// Fix all issues
app.post('/api/fix-all', (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Find all unfixed issues
        const unfixedIssues = session.issues.filter(issue => !issue.fixed);

        if (unfixedIssues.length === 0) {
            return res.status(400).json({ error: 'No issues to fix' });
        }

        // Fix all issues
        const fixTime = new Date().toISOString();
        const fixedIssuesArray = [];

        unfixedIssues.forEach(issue => {
            issue.fixed = true;
            const fixedIssue = {
                ...issue,
                fixedAt: fixTime,
                changeId: `fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            };
            session.fixedIssues.push(fixedIssue);
            fixedIssuesArray.push(fixedIssue);
        });

        res.json({
            success: true,
            fixedCount: unfixedIssues.length,
            fixedIssues: fixedIssuesArray,
            message: `Fixed ${unfixedIssues.length} issues successfully`
        });

    } catch (error) {
        console.error('Error fixing all issues:', error);
        res.status(500).json({
            error: 'Error fixing all issues',
            details: error.message
        });
    }
});

// Get session data
app.get('/api/session/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId: sessionId,
            filename: session.filename,
            totalRows: session.totalRows,
            totalColumns: session.totalColumns,
            issues: session.issues,
            fixedIssues: session.fixedIssues,
            issueCount: session.issues.length,
            fixedCount: session.fixedIssues.length,
            uploadTime: session.uploadTime
        });

    } catch (error) {
        console.error('Error retrieving session:', error);
        res.status(500).json({
            error: 'Error retrieving session',
            details: error.message
        });
    }
});

// Download issues report (only unfixed issues)
app.get('/api/download-issues/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Filter for only unfixed issues
        const unfixedIssues = session.issues.filter(issue => !issue.fixed);

        // Create CSV content for unfixed issues
        const headers = ['Cell Reference', 'Row', 'Column', 'Problem', 'Original Value', 'Suggested Fix'];
        const csvRows = [headers.join(',')];

        unfixedIssues.forEach(issue => {
            const row = [
                `"${issue.cellReference || `${issue.column}${issue.row}`}"`,
                issue.row,
                `"${issue.column}"`,
                `"${issue.problem}"`,
                `"${issue.originalValue.replace(/"/g, '""')}"`,
                `"${issue.suggestedFix.replace(/"/g, '""')}"`
            ];
            csvRows.push(row.join(','));
        });

        const csvContent = csvRows.join('\n');
        const filename = `${session.filename}_issues_report.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error downloading issues report:', error);
        res.status(500).json({
            error: 'Error generating issues report',
            details: error.message
        });
    }
});

// Download changes log (only fixed issues)
app.get('/api/download-changes/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.fixedIssues.length === 0) {
            return res.status(404).json({ error: 'No changes to download' });
        }

        // Create CSV content for changes
        const headers = ['Cell Reference', 'Row', 'Column', 'Problem', 'Original Value', 'Fixed Value', 'Fixed At'];
        const csvRows = [headers.join(',')];

        session.fixedIssues.forEach(change => {
            const row = [
                `"${change.cellReference || `${change.column}${change.row}`}"`,
                change.row,
                `"${change.column}"`,
                `"${change.problem}"`,
                `"${change.originalValue.replace(/"/g, '""')}"`,
                `"${change.suggestedFix.replace(/"/g, '""')}"`,
                change.fixedAt
            ];
            csvRows.push(row.join(','));
        });

        const csvContent = csvRows.join('\n');
        const filename = `${session.filename}_changes_log.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error downloading changes log:', error);
        res.status(500).json({
            error: 'Error generating changes log',
            details: error.message
        });
    }
});

// Download fixed CSV - original file with all fixes applied
app.get('/api/download-fixed/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Check if original file still exists
        if (!session.filePath || !await fs.pathExists(session.filePath)) {
            return res.status(404).json({ error: 'Original file no longer available' });
        }

        // Create a map of fixes for quick lookup (key: row-column, value: fixed value)
        const fixesMap = new Map();
        session.fixedIssues.forEach(fixedIssue => {
            const key = `${fixedIssue.row - 2}-${fixedIssue.column}`; // Convert Excel row to 0-based data row (header at row 1)
            fixesMap.set(key, fixedIssue.suggestedFix);
        });

        if (session.fileExtension === '.csv') {
            // Handle CSV files
            const results = [];
            let headers = [];
            let rowIndex = 0;

            // Read the original CSV and apply fixes
            await new Promise((resolve, reject) => {
                fs.createReadStream(session.filePath)
                    .pipe(csv())
                    .on('headers', (headerList) => {
                        headers = headerList;
                    })
                    .on('data', (data) => {
                        // Apply fixes to this row
                        const fixedRow = { ...data };
                        headers.forEach((column) => {
                            const key = `${rowIndex}-${column}`;
                            if (fixesMap.has(key)) {
                                fixedRow[column] = fixesMap.get(key);
                            }
                        });
                        results.push(fixedRow);
                        rowIndex++;
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });

            // Convert back to CSV format - preserve original compact format for empty cells
            const csvRows = [headers.map(h => `"${h}"`).join(',')];
            results.forEach(row => {
                const csvRow = headers.map(header => {
                    const value = row[header];
                    // Only quote if value exists and needs quoting (contains comma, quote, or newline)
                    if (value === null || value === undefined || value === '') {
                        return ''; // Empty cell without quotes
                    }
                    const stringValue = String(value);
                    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
                        return `"${stringValue.replace(/"/g, '""')}"`;
                    }
                    return stringValue; // No quotes needed for simple values
                });
                csvRows.push(csvRow.join(','));
            });

            const csvContent = csvRows.join('\n');
            const filename = session.filename.replace(/\.[^/.]+$/, '_FIXED.csv');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(csvContent);

        } else if (session.fileExtension === '.xlsx' || session.fileExtension === '.xls') {
            // Handle Excel files
            const workbook = XLSX.readFile(session.filePath, { cellText: false, cellDates: true });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

            // Apply fixes to the data
            data.forEach((row, rowIndex) => {
                Object.keys(row).forEach((column) => {
                    const key = `${rowIndex}-${column}`;
                    if (fixesMap.has(key)) {
                        row[column] = fixesMap.get(key);
                    }
                });
            });

            // Convert back to CSV format for download - preserve original compact format for empty cells
            const headers = Object.keys(data[0] || {});
            const csvRows = [headers.map(h => `"${h}"`).join(',')];
            data.forEach(row => {
                const csvRow = headers.map(header => {
                    const value = row[header];
                    // Only quote if value exists and needs quoting (contains comma, quote, or newline)
                    if (value === null || value === undefined || value === '') {
                        return ''; // Empty cell without quotes
                    }
                    const stringValue = String(value);
                    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
                        return `"${stringValue.replace(/"/g, '""')}"`;
                    }
                    return stringValue; // No quotes needed for simple values
                });
                csvRows.push(csvRow.join(','));
            });

            const csvContent = csvRows.join('\n');
            const filename = session.filename.replace(/\.[^/.]+$/, '_FIXED.csv');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(csvContent);
        } else {
            throw new Error('Unsupported file type');
        }

    } catch (error) {
        console.error('Error downloading fixed CSV:', error);
        res.status(500).json({
            error: 'Error generating fixed CSV',
            details: error.message
        });
    }
});

// Learning Analytics Endpoints

// Get learning statistics
app.get('/api/learning/stats', async (req, res) => {
    try {
        const stats = await learningAnalytics.getLearningStats();
        res.json({
            success: true,
            ...stats
        });
    } catch (error) {
        console.error('Error getting learning stats:', error);
        res.status(500).json({
            error: 'Error retrieving learning statistics',
            details: error.message
        });
    }
});

// Get learning insights and patterns
app.get('/api/learning/insights', async (req, res) => {
    try {
        const insights = await learningAnalytics.analyzePatterns();
        res.json({
            success: true,
            insights: insights,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting learning insights:', error);
        res.status(500).json({
            error: 'Error retrieving learning insights',
            details: error.message
        });
    }
});

// Get enhanced suggestion for testing
app.post('/api/learning/suggest', async (req, res) => {
    try {
        const { originalValue, columnName, problemType } = req.body;

        if (!originalValue || !columnName || !problemType) {
            return res.status(400).json({
                error: 'originalValue, columnName, and problemType are required'
            });
        }

        const result = await getEnhancedFixSuggestion(originalValue, columnName, problemType);
        res.json({
            success: true,
            originalValue: originalValue,
            ...result
        });
    } catch (error) {
        console.error('Error getting enhanced suggestion:', error);
        res.status(500).json({
            error: 'Error getting enhanced suggestion',
            details: error.message
        });
    }
});

// Export learning data (for backup/analysis)
app.get('/api/learning/export', (req, res) => {
    try {
        db.all(
            `SELECT * FROM override_patterns ORDER BY last_seen DESC LIMIT 1000`,
            [],
            (err, rows) => {
                if (err) {
                    console.error('Error exporting learning data:', err);
                    res.status(500).json({
                        error: 'Error exporting learning data',
                        details: err.message
                    });
                    return;
                }

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename="learning_data_export.json"');
                res.json({
                    export_date: new Date().toISOString(),
                    total_patterns: rows.length,
                    patterns: rows
                });
            }
        );
    } catch (error) {
        console.error('Error exporting learning data:', error);
        res.status(500).json({
            error: 'Error exporting learning data',
            details: error.message
        });
    }
});

// Train suggestions (manual trigger for retraining)
app.post('/api/learning/train', async (req, res) => {
    try {
        console.log('Starting manual training of suggestion algorithm...');

        // Analyze current patterns
        const insights = await learningAnalytics.analyzePatterns();

        // Update learning insights table
        for (const insight of insights) {
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO learning_insights 
					 (pattern_type, pattern_key, suggested_improvement, confidence_score, usage_count, updated_at) 
					 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [insight.type, insight.pattern, insight.suggestion, insight.confidence, insight.usage_count],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        console.log(`Training complete. Updated ${insights.length} insights.`);

        res.json({
            success: true,
            message: 'Training completed successfully',
            insights_updated: insights.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error during training:', error);
        res.status(500).json({
            error: 'Error during training',
            details: error.message
        });
    }
});

// Memory status endpoint for monitoring
app.get('/api/memory-status', (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        activeSessions: sessionData.size
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            console.log(`File upload rejected: File size too large. Limit: 800MB`);
            return res.status(413).json({ error: 'File size too large (max 800MB)' });
        }
    }

    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// In-memory progress tracking per session
const sessionProgress = new Map();
const updateProgress = (sessionId, percent, log) => {
    if (!sessionId) return;
    const clamped = Math.max(0, Math.min(100, Math.floor(percent)));
    sessionProgress.set(sessionId, { percent: clamped, log: log || '', updatedAt: Date.now() });
};

// Periodic cleanup for stale progress entries (older than 24h)
setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, p] of sessionProgress.entries()) {
        if ((p.updatedAt || 0) < cutoff) sessionProgress.delete(id);
    }
}, 60 * 60 * 1000);

app.get('/api/progress/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const p = sessionProgress.get(sessionId) || { percent: 0, log: '' };
    res.json({ sessionId, ...p });
});

// Progress API: start a new progress session
app.post('/api/progress/start', (req, res) => {
    const progressId = Date.now().toString();
    sessionProgress.set(progressId, { percent: 0, log: 'Starting...', updatedAt: Date.now() });
    res.json({ progressId });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
}); 
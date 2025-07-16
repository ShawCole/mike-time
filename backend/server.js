const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const { Transform } = require('stream');

const app = express();
const PORT = process.env.PORT || 3001;

// Memory management
process.on('warning', (warning) => {
    console.log(warning.stack);
});

// Middleware
app.use(cors());
app.use(express.json());

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

// Strict character validation - only allow alphanumeric, space, and basic punctuation
const isValidCharacter = (char) => {
    // Allow A-Z, a-z, 0-9, space, and basic punctuation
    const validPattern = /^[A-Za-z0-9\s\.,;:!?\-_()[\]{}@#$%&*+=/<>|\\^~`'"]*$/;
    return validPattern.test(char);
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

    // Replace accented characters with base equivalents
    for (const [accented, base] of accentMap.entries()) {
        fixedText = fixedText.replace(new RegExp(accented.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), base);
    }

    // Remove any remaining invalid characters
    fixedText = fixedText.replace(/[^\x00-\x7F]/g, ''); // Remove non-ASCII
    fixedText = fixedText.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // Remove control characters

    return fixedText.trim();
};

const truncateText = (text, maxLength = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim();
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
                        const hasLengthIssues = cellStr.length > 100;

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
                                problemDescription.push(`Length exceeds 100 characters (${cellStr.length} chars)`);
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
                                cellReference: getExcelCellReference(rowIndex, columnIndex),
                                row: rowIndex + 1,
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
                const hasLengthIssues = cellStr.length > 100;

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
                        problemDescription.push(`Length exceeds 100 characters (${cellStr.length} chars)`);
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
                        cellReference: getExcelCellReference(rowIndex, columnIndex),
                        row: rowIndex + 1,
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

// Routes
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filePath = req.file.path;
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
            // Use streaming analysis for CSV files
            analysisResult = await analyzeCSVStreamMemoryEfficient(filePath, req.file.originalname);
            totalRows = analysisResult.totalRows;
            // Get column count from headers or issues
            if (analysisResult.headers && analysisResult.headers.length > 0) {
                totalColumns = analysisResult.headers.length;
            } else if (analysisResult.issues.length > 0) {
                totalColumns = new Set(analysisResult.issues.map(issue => issue.column)).size;
            } else {
                totalColumns = 0;
            }
        } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
            // For Excel files, we still need to load into memory but with optimizations
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

            // Clear data from memory immediately after analysis
            data.length = 0;
            forceGC();
            console.log(`Excel analysis complete in ${analysisTime}ms`);
        } else {
            throw new Error('Unsupported file type');
        }

        const parseTime = Date.now() - parseStartTime;
        console.log(`Analysis complete: ${totalRows} rows, ${totalColumns} columns, ${analysisResult.issues.length} issues found in ${parseTime}ms`);
        console.log(`Memory after processing: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

        // Generate session ID and store minimal data (no original data stored)
        const sessionId = Date.now().toString();
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

        // Clean up uploaded file immediately to save disk space
        await fs.remove(filePath);

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
            }
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
app.post('/api/fix-issue', (req, res) => {
    try {
        const { sessionId, issueId } = req.body;

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

        // Mark issue as fixed and store the change
        issue.fixed = true;
        const fixedIssue = {
            ...issue,
            fixedAt: new Date().toISOString(),
            changeId: `fix-${Date.now()}`
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
        unfixedIssues.forEach(issue => {
            issue.fixed = true;
            const fixedIssue = {
                ...issue,
                fixedAt: fixTime,
                changeId: `fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            };
            session.fixedIssues.push(fixedIssue);
        });

        res.json({
            success: true,
            fixedCount: unfixedIssues.length,
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

// Download issues report
app.get('/api/download-issues/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = sessionData.get(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Create CSV content for issues
        const headers = ['Row', 'Column', 'Problem', 'Original Value', 'Suggested Fix'];
        const csvRows = [headers.join(',')];

        session.issues.forEach(issue => {
            const row = [
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

// Download changes log
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
        const headers = ['Row', 'Column', 'Problem', 'Original Value', 'Fixed Value', 'Fixed At'];
        const csvRows = [headers.join(',')];

        session.fixedIssues.forEach(change => {
            const row = [
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
            return res.status(400).json({ error: 'File size too large (max 800MB)' });
        }
    }

    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
}); 
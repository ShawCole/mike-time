import { useState, useEffect, useMemo } from 'react';
import { API_ENDPOINTS } from '../config/api';

const LearningDashboard = ({ lastFilename = '' }) => {
    const [stats, setStats] = useState(null);
    const [insights, setInsights] = useState([]);
    const [loading, setLoading] = useState(false);
    const [training, setTraining] = useState(false);
    const [message, setMessage] = useState('');

    // Patterns listing for Problem Type Distribution drill-down
    const [patterns, setPatterns] = useState([]);
    const [totalPatterns, setTotalPatterns] = useState(0);
    const [pageOffset, setPageOffset] = useState(0);
    const [pageSize, setPageSize] = useState(25);
    const [patternLoading, setPatternLoading] = useState(false);
    const [searchQ, setSearchQ] = useState('');
    const [problemFilter, setProblemFilter] = useState('');

    // Multi-level grid states
    const [gridLevel, setGridLevel] = useState('root'); // 'root' | 'bd' | 'ia' | 'ria' | 'rr'
    const [subCategory, setSubCategory] = useState(null); // e.g., 'Branches', 'Exam', etc.

    // Fetch learning statistics
    const fetchStats = async () => {
        try {
            setLoading(true);
            const response = await fetch(API_ENDPOINTS.learningStats);
            if (response.ok) {
                const data = await response.json();
                setStats(data);
            }
        } catch (error) {
            console.error('Error fetching learning stats:', error);
        } finally {
            setLoading(false);
        }
    };

    // Fetch learning insights
    const fetchInsights = async () => {
        try {
            const response = await fetch(API_ENDPOINTS.learningInsights);
            if (response.ok) {
                const data = await response.json();
                setInsights(data.insights || []);
            }
        } catch (error) {
            console.error('Error fetching learning insights:', error);
        }
    };

    // Manual training trigger
    const triggerTraining = async () => {
        try {
            setTraining(true);
            setMessage('Training in progress...');

            const response = await fetch(API_ENDPOINTS.learningTrain, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                setMessage(`Training completed! Updated ${data.insights_updated} patterns.`);
                fetchStats();
                fetchInsights();
            } else {
                setMessage('Training failed. Please try again.');
            }
        } catch (error) {
            console.error('Error triggering training:', error);
            setMessage('Training failed. Please try again.');
        } finally {
            setTraining(false);
            setTimeout(() => setMessage(''), 5000);
        }
    };

    // Export learning data
    const exportData = () => {
        window.open(API_ENDPOINTS.learningExport, '_blank');
    };

    useEffect(() => {
        fetchStats();
        fetchInsights();
    }, []);

    const fetchPatterns = async ({ offset = pageOffset, limit = pageSize, q = searchQ, problemType = problemFilter } = {}) => {
        try {
            setPatternLoading(true);
            const url = API_ENDPOINTS.learningPatterns({ offset, limit, problemType, q });
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch patterns');
            const data = await res.json();
            if (data && data.success) {
                setPatterns(data.patterns || []);
                setTotalPatterns(data.total || 0);
                setPageOffset(data.offset || 0);
            }
        } catch (e) {
            console.error('Failed to load patterns:', e);
            setPatterns([]);
            setTotalPatterns(0);
        } finally {
            setPatternLoading(false);
        }
    };

    useEffect(() => {
        fetchPatterns({ offset: 0 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // File type categorization helpers (client-side using last filename)
    const fn = useMemo(() => (lastFilename || '').toLowerCase(), [lastFilename]);
    const matchesAny = (arr) => arr.some(s => fn.includes(s));

    const fileType = useMemo(() => {
        if (matchesAny(['broker', 'dealer', 'broker_dealer'])) return 'BD';
        if (matchesAny(['ia_', 'ia_rep'])) return 'IA';
        if (matchesAny(['ria_', 'registered_investment', 'registered_investment_advisor', 'ria_executives'])) return 'RIA';
        if (matchesAny(['registered_rep'])) return 'RR';
        return '';
    }, [fn]);

    // Expand acronyms to full display labels for titles/buttons
    const labelForLevel1 = (code) => {
        switch (code) {
            case 'BD': return 'Broker Dealers';
            case 'IA': return 'Investment Advisors';
            case 'RIA': return 'Registered Investment Advisors';
            case 'RR': return 'Registered Representatives';
            default: return String(code || '');
        }
    };

    const subGridFor = (type) => {
        switch (type) {
            case 'BD': return ['Branches', 'Executives', 'Information', 'Products'];
            case 'IA': return ['Exam', 'Info', 'Prev Employment'];
            case 'RIA': return ['RIA Information', 'RIA Executives'];
            case 'RR': return ['Exam', 'Info', 'Prev Employment'];
            default: return [];
        }
    };

    // Simple client-side filter for demo purposes; later we can add server-side fileType param
    const filteredPatterns = useMemo(() => {
        const q = (searchQ || '').toLowerCase();
        const textOf = (p) => [
            p.problem,
            p.problemText,
            p.description,
            p.problem_type,
            p.problemType
        ].map(v => String(v || '').toLowerCase()).join(' \n ');

        const byProblem = (p) => {
            if (!problemFilter) return true;
            const pt = String(p.problemType || '').toLowerCase();
            if (problemFilter === 'invalid_characters') {
                const txt = textOf(p);
                return pt === 'invalid_characters' || txt.includes('invalid characters');
            }
            if (problemFilter === 'length_violation') {
                const txt = textOf(p);
                return pt === 'length_violation' || txt.includes('length');
            }
            return pt === problemFilter;
        };

        const bySearch = (p) => !q ||
            String(p.problemType || '').toLowerCase().includes(q) ||
            String(p.originalValue || '').toLowerCase().includes(q) ||
            String(p.suggestion || '').toLowerCase().includes(q) ||
            textOf(p).includes(q);

        // Client-side fallback filter to ensure dropdown reflects Problem types even if server ignores it
        return patterns.filter(p => byProblem(p) && bySearch(p));
    }, [patterns, searchQ, problemFilter]);

    if (loading && !stats) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
                <p>Loading learning analytics...</p>
            </div>
        );
    }

    return (
        <div className="report-display">
            {/* Header Section - matching Data Quality Analysis page */}
            <div className="report-header">
                <h2>🧠 Learning Analytics Dashboard</h2>
                <p>Monitor how the system learns from your fix overrides to improve suggestions over time.</p>

                {stats && (
                    <div className="report-stats">
                        <div className="stat-card">
                            <span className="stat-number">{stats.summary?.total_patterns || 0}</span>
                            <span className="stat-label">Learning Patterns</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-number">{stats.summary?.total_overrides || 0}</span>
                            <span className="stat-label">Total Overrides</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-number">{stats.summary?.unique_columns || 0}</span>
                            <span className="stat-label">Unique Columns</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-number">{stats.summary?.unique_problems || 0}</span>
                            <span className="stat-label">Problem Types</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Section */}
            <div className="report-content">
                {/* Message Display */}
                {message && (
                    <div style={{
                        padding: '1rem',
                        marginBottom: '2rem',
                        backgroundColor: training ? '#fff3cd' : '#d4edda',
                        color: training ? '#856404' : '#155724',
                        border: `1px solid ${training ? '#ffeaa7' : '#c3e6cb'}`,
                        borderRadius: '8px'
                    }}>
                        {message}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="report-actions">
                    <button
                        onClick={triggerTraining}
                        disabled={training}
                        className={`btn ${training ? 'btn-secondary' : 'btn-primary'}`}
                    >
                        {training ? '🔄 Training...' : '🚀 Train Model'}
                    </button>

                    <button
                        onClick={exportData}
                        className="btn btn-success"
                    >
                        📥 Export Data
                    </button>

                    <button
                        onClick={() => { fetchStats(); fetchInsights(); }}
                        className="btn btn-secondary"
                    >
                        🔄 Refresh
                    </button>
                </div>

                {/* Problem Type Distribution */}
                {stats && stats.problemBreakdown && stats.problemBreakdown.length > 0 && (
                    <div style={{ marginBottom: '2rem' }}>
                        <h3>Problem Type Distribution</h3>
                        {/* Multi-level grid */}
                        {gridLevel === 'root' && (
                            <div style={{ backgroundColor: '#f8f9fa', padding: '1rem', borderRadius: '8px', border: '1px solid #dee2e6', width: '955px', margin: '0 auto' }}>
                                {/* Header inside the container, just below the top border */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.25rem' }}>All Issues</div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-secondary" title="Download All Issues" onClick={exportData}>⬇️ Download All Issues</button>
                                    </div>
                                </div>
                                {/* Level-0 menu grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                                    {['BD', 'IA', 'RIA', 'RR'].map((t) => (
                                        <button key={t} className="btn btn-secondary btn-tall" style={{ fontSize: '1rem' }} onClick={() => { setGridLevel(t); setSubCategory(null); }}>
                                            {labelForLevel1(t)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {gridLevel !== 'root' && subCategory == null && (
                            <div style={{ backgroundColor: '#f8f9fa', padding: '1rem', borderRadius: '8px', border: '1px solid #dee2e6', width: '955px', margin: '0 auto' }}>
                                {/* Top header row to match level-2 layout */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.25rem' }}>{labelForLevel1(gridLevel)}</div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-secondary" title={`Download All ${gridLevel} Issues`} onClick={exportData}>⬇️ Download All {gridLevel} Issues</button>
                                        <button className="btn btn-link" onClick={() => { setGridLevel('root'); setSubCategory(null); }}>← Back</button>
                                    </div>
                                </div>

                                {/* Level-1 menu grid */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: gridLevel === 'RIA' ? '1fr' : (gridLevel === 'IA' || gridLevel === 'RR' ? 'repeat(2, 1fr)' : 'repeat(2, 1fr)'),
                                    gap: '1rem'
                                }}>
                                    {subGridFor(gridLevel).map((label, idx) => (
                                        <button key={label} className="btn btn-secondary btn-tall" style={{ gridColumn: (gridLevel === 'IA' || gridLevel === 'RR') && idx === 2 ? '1 / span 2' : undefined }} onClick={() => setSubCategory(label)}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {gridLevel !== 'root' && subCategory != null && (
                            <div style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '8px', padding: '1rem', width: '955px', margin: '0 auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.25rem' }}>{labelForLevel1(gridLevel)} • {subCategory}</div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-secondary" title={`Download All ${gridLevel} Issues`} onClick={exportData}>⬇️ Download All {gridLevel} Issues</button>
                                        <button className="btn btn-link" onClick={() => setSubCategory(null)}>← Back</button>
                                    </div>
                                </div>
                                {/* Search and filter */}
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                                    <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search problems…" style={{ flex: 1, padding: '0.5rem' }} />
                                    <select value={problemFilter} onChange={(e) => setProblemFilter(e.target.value)} style={{ padding: '0.5rem' }}>
                                        <option value="">All problems</option>
                                        <option value="invalid_characters">Invalid characters</option>
                                        <option value="length_violation">Length</option>
                                    </select>
                                    <button className="btn btn-primary" onClick={() => fetchPatterns({ offset: 0 })}>Apply</button>
                                </div>
                                {/* Patterns table */}
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', background: '#fff', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ background: '#edf2f7' }}>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Source</th>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Problem</th>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Pattern / Original</th>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Suggestion</th>
                                                <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Usage</th>
                                                <th style={{ padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {patternLoading && (
                                                <tr><td colSpan={6} style={{ padding: '0.75rem', textAlign: 'center', color: '#666' }}>Loading…</td></tr>
                                            )}
                                            {!patternLoading && filteredPatterns.length === 0 && (
                                                <tr><td colSpan={6} style={{ padding: '0.75rem', textAlign: 'center', color: '#666' }}>No patterns found.</td></tr>
                                            )}
                                            {!patternLoading && filteredPatterns.map((p, idx) => (
                                                <tr key={`${p.source}:${p.pattern_id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '0.5rem' }}>{p.source === 'override' ? 'Override' : 'Algo'}</td>
                                                    <td style={{ padding: '0.5rem' }}>{p.problemType}</td>
                                                    <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{p.originalValue}</td>
                                                    <td style={{ padding: '0.5rem' }}>{p.suggestion}</td>
                                                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{p.usageCount || 0}</td>
                                                    <td style={{ padding: '0.5rem' }}>
                                                        <button className="btn btn-warning btn-sm" onClick={async () => {
                                                            const compositeId = `${p.source}:${p.pattern_id}`;
                                                            if (!confirm(`Delete pattern ${compositeId}?`)) return;
                                                            try {
                                                                const resp = await fetch(API_ENDPOINTS.learningDeletePattern(compositeId), { method: 'DELETE' });
                                                                const j = await resp.json();
                                                                if (j && j.success) fetchPatterns({ offset: pageOffset });
                                                            } catch (e) { console.error('Delete failed', e); }
                                                        }}>Delete</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Pagination */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
                                    <div style={{ color: '#666' }}>Total: {totalPatterns}</div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-secondary" disabled={pageOffset === 0} onClick={() => fetchPatterns({ offset: Math.max(0, pageOffset - pageSize) })}>Prev</button>
                                        <button className="btn btn-secondary" disabled={pageOffset + pageSize >= totalPatterns} onClick={() => fetchPatterns({ offset: pageOffset + pageSize })}>Next</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Learning Insights */}
                {insights.length > 0 && (
                    <div style={{ marginBottom: '2rem' }}>
                        <h3>🎯 Learning Insights</h3>
                        <p style={{ color: '#666', marginBottom: '1rem' }}>
                            The system has learned different types of patterns from your overrides:
                        </p>
                        <div style={{
                            display: 'grid',
                            gap: '1rem',
                            backgroundColor: '#f8f9fa',
                            padding: '1rem',
                            borderRadius: '8px',
                            border: '1px solid #dee2e6'
                        }}>
                            {insights.slice(0, 15).map((insight, index) => {
                                const getInsightDisplay = (insight) => {
                                    switch (insight.type) {
                                        case 'exact_value_match':
                                            return {
                                                icon: '🎯',
                                                title: 'EXACT VALUE MATCH',
                                                description: 'When this exact value appears again, use this specific fix',
                                                pattern: insight.pattern,
                                                suggestion: insight.suggestion,
                                                borderColor: '#007bff',
                                                backgroundColor: '#e3f2fd'
                                            };
                                        case 'character_mapping':
                                            return {
                                                icon: '🔄',
                                                title: 'CHARACTER REPLACEMENT',
                                                description: 'Individual character replacement rule',
                                                pattern: insight.pattern,
                                                suggestion: insight.suggestion,
                                                borderColor: '#28a745',
                                                backgroundColor: '#e8f5e8'
                                            };
                                        case 'character_sequence':
                                            return {
                                                icon: '🧩',
                                                title: 'CHARACTER SEQUENCE',
                                                description: 'When this sequence of invalid characters appears anywhere in text',
                                                pattern: `Character sequence: "${insight.pattern}"`,
                                                suggestion: insight.suggestion,
                                                borderColor: '#ffc107',
                                                backgroundColor: '#fff8e1',
                                                showAllFixes: true,
                                                allFixes: insight.example_contexts ? insight.example_contexts.join(' | ') : null
                                            };
                                        case 'column_specific':
                                            return {
                                                icon: '📊',
                                                title: 'COLUMN SPECIFIC',
                                                description: `Pattern learned specifically for "${insight.column_name}" column`,
                                                pattern: insight.problem_type ? insight.problem_type.split(':')[1] || insight.pattern : insight.pattern,
                                                suggestion: `Most common fix: ${insight.suggestion}`,
                                                borderColor: '#6f42c1',
                                                backgroundColor: '#f3e5f5',
                                                columnName: insight.column_name,
                                                problemType: insight.problem_type
                                            };
                                        default:
                                            return {
                                                icon: '❓',
                                                title: insight.type.replace('_', ' ').toUpperCase(),
                                                description: '',
                                                pattern: insight.pattern,
                                                suggestion: insight.suggestion,
                                                borderColor: '#6c757d',
                                                backgroundColor: '#f8f9fa'
                                            };
                                    }
                                };

                                const display = getInsightDisplay(insight);

                                return (
                                    <div key={index} style={{
                                        padding: '1rem',
                                        backgroundColor: display.backgroundColor,
                                        borderRadius: '8px',
                                        borderLeft: `4px solid ${display.borderColor}`,
                                        border: `1px solid ${display.borderColor}20`,
                                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '1.2rem' }}>{display.icon}</span>
                                                <strong style={{ color: '#333' }}>{display.title}</strong>
                                            </div>
                                            <span style={{
                                                backgroundColor: display.borderColor,
                                                color: 'white',
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: '12px',
                                                fontSize: '0.75rem',
                                                fontWeight: 'bold'
                                            }}>
                                                {Math.round(insight.confidence * 100)}% confidence
                                            </span>
                                        </div>

                                        {display.description && (
                                            <p style={{ margin: '0.5rem 0', color: '#666', fontSize: '0.9rem', fontStyle: 'italic' }}>
                                                {display.description}
                                            </p>
                                        )}

                                        <div style={{ margin: '0.5rem 0', color: '#495057' }}>
                                            <strong>Pattern:</strong> {display.pattern}
                                        </div>

                                        <div style={{ margin: '0.5rem 0', color: '#495057' }}>
                                            <strong>Action:</strong> {display.suggestion}
                                            {display.showAllFixes && display.allFixes && (
                                                <div style={{
                                                    marginTop: '0.5rem',
                                                    padding: '0.5rem',
                                                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
                                                    borderRadius: '4px',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    <strong>Examples where "{insight.pattern}" appeared:</strong>
                                                    <div style={{ margin: '0.5rem 0' }}>
                                                        {display.allFixes.split(' | ').map((context, index) => (
                                                            <div key={index} style={{
                                                                margin: '0.35rem 0',
                                                                padding: '0.25rem 0.5rem',
                                                                backgroundColor: 'rgba(255, 193, 7, 0.15)',
                                                                borderRadius: '4px',
                                                                fontSize: '0.8rem',
                                                                fontFamily: 'monospace'
                                                            }}>
                                                                <span style={{ color: '#856404', fontWeight: 'bold' }}>Context {index + 1}:</span>{' '}
                                                                {context.length > 80 ? context.substring(0, 77) + '...' : context}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {insight.fix_variety > 1 && (
                                                        <div style={{ fontSize: '0.75rem', color: '#856404', fontStyle: 'italic' }}>
                                                            💡 This character sequence appears in {insight.fix_variety} different contexts, showing it's a common pattern
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            <span style={{ color: '#6c757d', fontSize: '0.875rem' }}>
                                                Used <strong>{insight.usage_count}</strong> times
                                            </span>
                                            {insight.sample_column && !display.columnName && (
                                                <span style={{ color: '#6c757d', fontSize: '0.875rem' }}>
                                                    Example column: <strong>{insight.sample_column}</strong>
                                                </span>
                                            )}
                                            {display.columnName && (
                                                <span style={{ color: '#6f42c1', fontSize: '0.875rem', fontWeight: 'bold' }}>
                                                    Column: {display.columnName}
                                                </span>
                                            )}
                                            {insight.fix_variety && insight.fix_variety > 1 && (
                                                <span style={{ color: '#856404', fontSize: '0.875rem' }}>
                                                    ⚠️ {insight.fix_variety} different fixes used
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {insights.length > 15 && (
                            <p style={{ color: '#666', marginTop: '1rem', textAlign: 'center' }}>
                                Showing top 15 insights. Total: {insights.length} patterns learned.
                            </p>
                        )}
                    </div>
                )}

                {/* No insights message */}
                {insights.length === 0 && !loading && (
                    <div style={{
                        textAlign: 'center',
                        padding: '3rem',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #dee2e6'
                    }}>
                        <h3 style={{ color: '#6c757d', marginBottom: '1rem' }}>📚 No Learning Insights Yet</h3>
                        <p style={{ color: '#666', marginBottom: '1rem' }}>
                            The system hasn't learned any patterns yet. Start analyzing files and applying overrides to build learning insights.
                        </p>
                    </div>
                )}

                {/* Footer Information */}
                <div style={{
                    textAlign: 'center',
                    color: '#6c757d',
                    fontSize: '0.875rem',
                    marginTop: '2rem',
                    paddingTop: '2rem',
                    borderTop: '1px solid #dee2e6'
                }}>
                    <p>
                        The system automatically learns from your overrides to improve future suggestions.
                        <br />
                        Manual training processes recent patterns and updates the suggestion algorithm.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LearningDashboard; 
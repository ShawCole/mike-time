import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../config/api';

const LearningDashboard = () => {
    const [stats, setStats] = useState(null);
    const [insights, setInsights] = useState([]);
    const [loading, setLoading] = useState(false);
    const [training, setTraining] = useState(false);
    const [message, setMessage] = useState('');

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
                        <div style={{
                            display: 'grid',
                            gap: '0.5rem',
                            backgroundColor: '#f8f9fa',
                            padding: '1rem',
                            borderRadius: '8px',
                            border: '1px solid #dee2e6'
                        }}>
                            {stats.problemBreakdown.map((problem, index) => (
                                <div key={index} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.75rem',
                                    backgroundColor: '#ffffff',
                                    borderRadius: '4px',
                                    border: '1px solid #e9ecef'
                                }}>
                                    <span style={{ fontWeight: '500' }}>{problem.problem_type}</span>
                                    <span style={{
                                        backgroundColor: '#007bff',
                                        color: 'white',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '12px',
                                        fontSize: '0.875rem',
                                        fontWeight: 'bold'
                                    }}>
                                        {problem.count}
                                    </span>
                                </div>
                            ))}
                        </div>
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
import { useState, useMemo } from 'react';
import axios from 'axios';

const ReportDisplay = ({ data, onReset }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(25);
    const [issues, setIssues] = useState(data.issues || []);
    const [changes, setChanges] = useState([]);
    const [isFixingAll, setIsFixingAll] = useState(false);
    const [showChanges, setShowChanges] = useState(false);

    // Filter data based on search term
    const filteredData = useMemo(() => {
        if (showChanges) {
            if (!searchTerm) return changes;
            return changes.filter(change =>
                change.column.toLowerCase().includes(searchTerm.toLowerCase()) ||
                change.originalValue.toLowerCase().includes(searchTerm.toLowerCase()) ||
                change.fixedValue.toLowerCase().includes(searchTerm.toLowerCase()) ||
                change.row.toString().includes(searchTerm) ||
                (change.cellReference && change.cellReference.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        } else {
            if (!searchTerm) return issues.filter(issue => !issue.fixed);
            return issues.filter(issue =>
                !issue.fixed && (
                    issue.column.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    issue.originalValue.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    issue.problem.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    issue.row.toString().includes(searchTerm) ||
                    (issue.cellReference && issue.cellReference.toLowerCase().includes(searchTerm.toLowerCase()))
                )
            );
        }
    }, [issues, changes, searchTerm, showChanges]);

    const handleFixIssue = async (issueId) => {
        try {
            const response = await axios.post('http://localhost:3001/api/fix-issue', {
                sessionId: data.sessionId,
                issueId: issueId
            });

            if (response.data.success) {
                // Update the issue as fixed
                setIssues(prevIssues =>
                    prevIssues.map(issue =>
                        issue.id === issueId ? { ...issue, fixed: true } : issue
                    )
                );

                // Add the change to changes list
                setChanges(prevChanges => [...prevChanges, response.data.fixedIssue]);
            }
        } catch (error) {
            console.error('Error fixing issue:', error);
            alert('Failed to fix issue. Please try again.');
        }
    };

    const handleFixAll = async () => {
        setIsFixingAll(true);
        try {
            const response = await axios.post('http://localhost:3001/api/fix-all', {
                sessionId: data.sessionId
            });

            if (response.data.success) {
                // Mark all issues as fixed
                setIssues(prevIssues =>
                    prevIssues.map(issue => ({ ...issue, fixed: true }))
                );

                // Add all changes
                setChanges(prevChanges => [...prevChanges, ...response.data.fixedIssues || []]);

                // Switch to changes view
                setShowChanges(true);
            }
        } catch (error) {
            console.error('Error fixing all issues:', error);
            alert('Failed to fix all issues. Please try again.');
        } finally {
            setIsFixingAll(false);
        }
    };

    const downloadIssuesReport = async () => {
        try {
            const response = await axios.get(`http://localhost:3001/api/download-issues/${data.sessionId}`, {
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'text/csv' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${data.filename}_issues_report.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error downloading issues report:', error);
            alert('Failed to download issues report. Please try again.');
        }
    };

    const downloadChangesLog = async () => {
        try {
            const response = await axios.get(`http://localhost:3001/api/download-changes/${data.sessionId}`, {
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'text/csv' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${data.filename}_changes_log.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error downloading changes log:', error);
            alert('Failed to download changes log. Please try again.');
        }
    };

    // Paginate filtered data
    const paginatedData = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredData.slice(startIndex, startIndex + pageSize);
    }, [filteredData, currentPage, pageSize]);

    const totalPages = Math.ceil(filteredData.length / pageSize);

    const remainingIssues = issues.filter(issue => !issue.fixed).length;

    const downloadCSV = () => {
        const currentData = showChanges ? changes : filteredData;
        const headers = showChanges
            ? ['Cell Reference', 'Row', 'Column', 'Problem', 'Original Value', 'Fixed Value', 'Fixed At']
            : ['Cell Reference', 'Row', 'Column', 'Problem', 'Original Value', 'Suggested Fix'];

        const csvContent = [
            headers.join(','),
            ...currentData.map(item => {
                if (showChanges) {
                    return [
                        `"${item.cellReference || `${item.column}${item.row}`}"`,
                        item.row,
                        `"${item.column}"`,
                        `"${item.problem || ''}"`,
                        `"${item.originalValue.replace(/"/g, '""')}"`,
                        `"${item.suggestedFix.replace(/"/g, '""')}"`,
                        `"${item.fixedAt || ''}"`
                    ].join(',');
                } else {
                    return [
                        `"${item.cellReference || `${item.column}${item.row}`}"`,
                        item.row,
                        `"${item.column}"`,
                        `"${item.problem}"`,
                        `"${item.originalValue.replace(/"/g, '""')}"`,
                        `"${item.suggestedFix.replace(/"/g, '""')}"`
                    ].join(',');
                }
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');

        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            const filename = showChanges
                ? `${data.filename}_changes_report.csv`
                : `${data.filename}_issues_report.csv`;
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const goToPage = (page) => {
        setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    };

    return (
        <div className="report-display">
            <div className="report-header">
                <h2>🔍 Data Quality Analysis</h2>
                <p><strong>File:</strong> {data.filename}</p>

                <div className="report-stats">
                    <div className="stat-card">
                        <span className="stat-number">{data.totalRows.toLocaleString()}</span>
                        <span className="stat-label">Total Rows</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{data.totalColumns}</span>
                        <span className="stat-label">Total Columns</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{data.issueCount.toLocaleString()}</span>
                        <span className="stat-label">Quality Issues</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{remainingIssues}</span>
                        <span className="stat-label">Remaining Issues</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{changes.length}</span>
                        <span className="stat-label">Fixed Issues</span>
                    </div>
                </div>
            </div>

            <div className="report-content">
                {data.issueCount === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem' }}>
                        <h3 style={{ color: '#48bb78', marginBottom: '1rem' }}>✅ No Data Quality Issues Found!</h3>
                        <p style={{ color: '#666', marginBottom: '2rem' }}>
                            Your data file passed all quality checks. All cells contain valid characters and are within the 100-character limit.
                        </p>
                        <button onClick={onReset} className="btn btn-primary">
                            Analyze Another File
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Action Buttons */}
                        <div className="report-actions">
                            <input
                                type="text"
                                placeholder={showChanges ? "Search changes (cell reference, value, etc.)..." : "Search issues (cell reference, value, problem, etc.)..."}
                                className="search-box"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                            />

                            {!showChanges && remainingIssues > 0 && (
                                <button
                                    onClick={handleFixAll}
                                    className="btn btn-primary"
                                    disabled={isFixingAll}
                                >
                                    {isFixingAll ? '🔄 Fixing All...' : '🛠️ Fix All Issues'}
                                </button>
                            )}

                            <button
                                onClick={() => {
                                    setShowChanges(!showChanges);
                                    setSearchTerm('');
                                    setCurrentPage(1);
                                }}
                                className="btn btn-secondary"
                            >
                                {showChanges ? '📝 Show Issues' : '📋 Show Changes'} ({showChanges ? remainingIssues : changes.length})
                            </button>

                            <button onClick={downloadCSV} className="btn btn-success">
                                📥 Download {showChanges ? 'Changes' : 'Issues'} CSV
                            </button>

                            {!showChanges && (
                                <button onClick={downloadIssuesReport} className="btn btn-success">
                                    📄 Download Issues Report
                                </button>
                            )}

                            {showChanges && changes.length > 0 && (
                                <button onClick={downloadChangesLog} className="btn btn-success">
                                    📋 Download Changes Log
                                </button>
                            )}

                            <button onClick={onReset} className="btn btn-secondary">
                                🔄 Analyze New File
                            </button>
                        </div>

                        {filteredData.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem' }}>
                                <p style={{ color: '#666' }}>
                                    {showChanges ? 'No changes made yet.' : 'No issues match your search criteria.'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div style={{ marginBottom: '1rem', color: '#666' }}>
                                    Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length.toLocaleString()} {showChanges ? 'changes' : 'issues'}
                                    {searchTerm && ` (filtered)`}
                                </div>

                                {/* Issues/Changes Display */}
                                <div className="issues-container">
                                    {paginatedData.map((item, index) => (
                                        showChanges ? (
                                            // Changes Display
                                            <div key={`change-${item.id}-${index}`} className="issue-card change-card">
                                                <div className="issue-header">
                                                    <span className="issue-location">
                                                        Cell {item.cellReference || `${item.column}${item.row}`} • Column: {item.column}
                                                    </span>
                                                    <span className="change-timestamp">
                                                        {item.fixedAt ? new Date(item.fixedAt).toLocaleTimeString() : 'Fixed'}
                                                    </span>
                                                </div>
                                                <div className="change-content">
                                                    <div className="change-before">
                                                        <label>Original:</label>
                                                        <div className="value-display original-value">{item.originalValue}</div>
                                                    </div>
                                                    <div className="change-arrow">→</div>
                                                    <div className="change-after">
                                                        <label>Fixed:</label>
                                                        <div className="value-display fixed-value">{item.suggestedFix}</div>
                                                    </div>
                                                </div>
                                                {item.problem && (
                                                    <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#718096' }}>
                                                        <strong>Issue:</strong> {item.problem}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            // Issues Display
                                            <div key={`issue-${item.id}-${index}`} className="issue-card">
                                                <div className="issue-header">
                                                    <span className="issue-location">
                                                        Cell {item.cellReference || `${item.column}${item.row}`} • Column: {item.column}
                                                    </span>
                                                    <span className="problem-badge">{item.problem}</span>
                                                </div>
                                                <div className="issue-content">
                                                    <div className="value-section">
                                                        <label>Current Value:</label>
                                                        <div className="value-display current-value">{item.originalValue}</div>
                                                    </div>
                                                    <div className="suggested-fix-section">
                                                        <label>Suggested Fix:</label>
                                                        <div className="value-display suggested-value">{item.suggestedFix}</div>
                                                    </div>
                                                    {/* Show character details for invalid character issues */}
                                                    {item.hasInvalidChars && item.invalidCharacters && item.invalidCharacters.length > 0 && (
                                                        <div className="character-details">
                                                            <label>Invalid Characters Found:</label>
                                                            <div className="character-list">
                                                                {item.invalidCharacters.slice(0, 5).map((char, charIndex) => (
                                                                    <span key={charIndex} className="character-badge">
                                                                        "{char.char}" (U+{char.charCode.toString(16).toUpperCase().padStart(4, '0')}) - {char.description}
                                                                        {char.replacement && ` → "${char.replacement}"`}
                                                                    </span>
                                                                ))}
                                                                {item.invalidCharacters.length > 5 && (
                                                                    <span className="character-badge" style={{ background: '#e2e8f0', color: '#4a5568' }}>
                                                                        +{item.invalidCharacters.length - 5} more characters
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Show length details for length issues */}
                                                    {item.hasLengthIssues && (
                                                        <div className="length-details">
                                                            <label>Length Information:</label>
                                                            <div className="length-info">
                                                                <span className="length-badge current-length">
                                                                    Current: {item.originalValue.length} characters
                                                                </span>
                                                                <span className="length-badge max-length">
                                                                    Maximum: 100 characters
                                                                </span>
                                                                <span className="length-badge over-limit">
                                                                    Over limit by: {item.originalValue.length - 100} characters
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="issue-actions">
                                                    <button
                                                        onClick={() => handleFixIssue(item.id)}
                                                        className="btn btn-primary btn-sm"
                                                        disabled={item.fixed}
                                                    >
                                                        {item.fixed ? '✅ Fixed' : '🛠️ Fix This Issue'}
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    ))}
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="pagination">
                                        <button
                                            onClick={() => goToPage(currentPage - 1)}
                                            disabled={currentPage === 1}
                                        >
                                            ← Previous
                                        </button>

                                        <span style={{ margin: '0 1rem', color: '#666' }}>
                                            Page {currentPage} of {totalPages}
                                        </span>

                                        <button
                                            onClick={() => goToPage(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                        >
                                            Next →
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ReportDisplay; 
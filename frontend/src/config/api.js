// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const API_ENDPOINTS = {
    upload: `${API_BASE_URL}/api/upload`,
    getUploadUrl: `${API_BASE_URL}/api/get-upload-url`,
    processFromStorage: `${API_BASE_URL}/api/process-from-storage`,
    progressStart: `${API_BASE_URL}/api/progress/start`,
    fixIssue: `${API_BASE_URL}/api/fix-issue`,
    overrideIssue: `${API_BASE_URL}/api/override-issue`,
    fixIssuesBulk: `${API_BASE_URL}/api/fix-issues-bulk`,
    overrideIssuesBulk: `${API_BASE_URL}/api/override-issues-bulk`,
    fixAll: `${API_BASE_URL}/api/fix-all`,
    checkNewIssues: `${API_BASE_URL}/api/check-new-issues`,
    downloadIssues: (sessionId) => `${API_BASE_URL}/api/download-issues/${sessionId}`,
    downloadChanges: (sessionId) => `${API_BASE_URL}/api/download-changes/${sessionId}`,
    downloadFixed: (sessionId) => `${API_BASE_URL}/api/download-fixed/${sessionId}`,
    getIssuesPage: (sessionId, offset = 0, limit = 20000, onlyUnfixed = true) =>
        `${API_BASE_URL}/api/issues/${sessionId}?offset=${offset}&limit=${limit}&onlyUnfixed=${onlyUnfixed ? 'true' : 'false'}`,
    // Grouped issues and cell refs
    getIssuesGrouped: (sessionId, offset = 0, limit, onlyUnfixed = true) =>
        `${API_BASE_URL}/api/issues-grouped/${sessionId}?offset=${offset}${typeof limit === 'number' ? `&limit=${limit}` : ''}&onlyUnfixed=${onlyUnfixed ? 'true' : 'false'}`,
    getIssueCellRefs: (sessionId, signature, offset = 0, limit) =>
        `${API_BASE_URL}/api/issues/cell-refs?sessionId=${encodeURIComponent(sessionId)}&signature=${encodeURIComponent(signature)}&offset=${offset}${typeof limit === 'number' ? `&limit=${limit}` : ''}`,
    getSessionInfo: (sessionId) => `${API_BASE_URL}/api/session/${sessionId}`,
    health: `${API_BASE_URL}/api/health`,
    // Learning endpoints
    learningStats: `${API_BASE_URL}/api/learning/stats`,
    learningInsights: `${API_BASE_URL}/api/learning/insights`,
    learningSuggest: `${API_BASE_URL}/api/learning/suggest`,
    learningExport: `${API_BASE_URL}/api/learning/export`,
    learningTrain: `${API_BASE_URL}/api/learning/train`,
    // Whitelisting (Not An Issue)
    notAnIssue: `${API_BASE_URL}/api/not-an-issue`,
    notAnIssueBulk: `${API_BASE_URL}/api/not-an-issue-bulk`
};

export default API_BASE_URL; 
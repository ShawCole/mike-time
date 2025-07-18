// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const API_ENDPOINTS = {
    upload: `${API_BASE_URL}/api/upload`,
    getUploadUrl: `${API_BASE_URL}/api/get-upload-url`,
    processFromStorage: `${API_BASE_URL}/api/process-from-storage`,
    fixIssue: `${API_BASE_URL}/api/fix-issue`,
    fixAll: `${API_BASE_URL}/api/fix-all`,
    checkNewIssues: `${API_BASE_URL}/api/check-new-issues`,
    downloadIssues: (sessionId) => `${API_BASE_URL}/api/download-issues/${sessionId}`,
    downloadChanges: (sessionId) => `${API_BASE_URL}/api/download-changes/${sessionId}`,
    downloadFixed: (sessionId) => `${API_BASE_URL}/api/download-fixed/${sessionId}`,
    health: `${API_BASE_URL}/api/health`,
    // Learning endpoints
    learningStats: `${API_BASE_URL}/api/learning/stats`,
    learningInsights: `${API_BASE_URL}/api/learning/insights`,
    learningSuggest: `${API_BASE_URL}/api/learning/suggest`,
    learningExport: `${API_BASE_URL}/api/learning/export`,
    learningTrain: `${API_BASE_URL}/api/learning/train`
};

export default API_BASE_URL; 
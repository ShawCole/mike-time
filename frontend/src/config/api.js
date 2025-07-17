// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const API_ENDPOINTS = {
    upload: `${API_BASE_URL}/api/upload`,
    fixIssue: `${API_BASE_URL}/api/fix-issue`,
    fixAll: `${API_BASE_URL}/api/fix-all`,
    downloadIssues: (sessionId) => `${API_BASE_URL}/api/download-issues/${sessionId}`,
    downloadChanges: (sessionId) => `${API_BASE_URL}/api/download-changes/${sessionId}`,
    health: `${API_BASE_URL}/api/health`
};

export default API_BASE_URL; 
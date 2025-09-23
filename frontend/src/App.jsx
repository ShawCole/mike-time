import { useState, useEffect, useRef } from 'react';
import FileUpload from './components/FileUpload';
import ReportDisplay from './components/ReportDisplay';
import LearningDashboard from './components/LearningDashboard';
import './App.css';
import { API_ENDPOINTS } from './config/api';

function App() {
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('analyzer'); // 'analyzer' or 'learning'
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [currentLogLine, setCurrentLogLine] = useState('');
  const [uploadOverlay, setUploadOverlay] = useState({ visible: false, file: null, stage: '', percent: 0, log: '' });
  const [progressId, setProgressId] = useState(null);
  const progressIntervalRef = useRef(null);



  // Mock log lines for progress simulation
  const mockLogLines = [
    'Initializing file upload...',
    'Validating file format...',
    'Reading file headers...',
    'Starting data analysis...',
    'Scanning for invalid characters...',
    'Checking field lengths...',
    'Processing row batch 1/10...',
    'Processing row batch 2/10...',
    'Processing row batch 3/10...',
    'Processing row batch 4/10...',
    'Processing row batch 5/10...',
    'Processing row batch 6/10...',
    'Processing row batch 7/10...',
    'Processing row batch 8/10...',
    'Processing row batch 9/10...',
    'Processing row batch 10/10...',
    'Analyzing character patterns...',
    'Generating fix suggestions...',
    'Applying learning patterns...',
    'Finalizing analysis report...',
    'Analysis complete!'
  ];

  // Mock progress simulation
  // Poll real server progress
  const startProgressSimulation = (sessionId) => {
    setProgressPercentage(0);
    setCurrentLogLine(mockLogLines[0]);

    let stopped = false;
    const activeId = sessionId;
    let lastPercent = 0;
    // cancel any prior poller immediately
    if (progressIntervalRef.current) {
      clearTimeout(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    const poll = async () => {
      if (stopped || !sessionId) return;
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/progress/${sessionId}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.sessionId && data.sessionId !== activeId) {
            // Ignore stale responses for a previous/other session
            return;
          }
          if (typeof data.percent === 'number') {
            lastPercent = Math.max(lastPercent, data.percent);
            setProgressPercentage(lastPercent);
          }
          if (data.log) setCurrentLogLine(data.log);
          if (data.percent >= 100) {
            stopped = true;
            return;
          }
        }
      } catch (_) {
        // ignore transient errors
      } finally {
        if (!stopped) {
          const nextDelay = 1500 + Math.floor(Math.random() * 700); // 1500–2200ms
          progressIntervalRef.current = setTimeout(poll, nextDelay);
        }
      }
    };

    poll();
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) {
      clearTimeout(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgressPercentage(0);
    setCurrentLogLine('');
  };

  // Start progress polling when loading begins (use progressId tracked separately)
  useEffect(() => {
    if (isLoading && progressId) {
      startProgressSimulation(progressId);
    } else {
      stopProgressSimulation();
    }

    return () => stopProgressSimulation();
  }, [isLoading, progressId]);

  // Ship client errors to backend for diagnosis
  useEffect(() => {
    const onError = (event) => {
      try {
        fetch(`${API_ENDPOINTS.health.replace('/api/health', '')}/api/client-log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            level: 'error',
            message: event?.message || 'window.onerror',
            stack: event?.error?.stack || '',
            meta: { source: event?.filename, line: event?.lineno, col: event?.colno }
          })
        }).catch(() => { });
      } catch (_) { }
    };
    const onRejection = (event) => {
      try {
        fetch(`${API_ENDPOINTS.health.replace('/api/health', '')}/api/client-log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            level: 'error',
            message: 'unhandledrejection',
            stack: event?.reason?.stack || String(event?.reason || ''),
            meta: {}
          })
        }).catch(() => { });
      } catch (_) { }
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const handleFileUpload = (data) => {
    setReportData(data);
    setError(null);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setReportData(null);
  };

  const handleLoadingState = (loading, pid) => {
    setIsLoading(loading);
    if (pid) setProgressId(pid);
  };

  const resetApp = () => {
    setReportData(null);
    setError(null);
    setIsLoading(false);
    stopProgressSimulation();
  };




  return (
    <div className="app">
      <header className="app-header">
        <h1>🔍 Data Quality Analyzer</h1>
        <p>Upload Excel or CSV files to detect and fix invalid characters (accents, symbols) and length violations for database ingestion</p>

        {/* Tab Navigation */}
        <div className="tab-navigation" style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '1rem',
          marginTop: '1rem',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '1rem'
        }}>
          <button
            onClick={() => setActiveTab('analyzer')}
            className={`tab-button ${activeTab === 'analyzer' ? 'active' : ''}`}
            style={{
              padding: '0.5rem 1.5rem',
              border: 'none',
              backgroundColor: activeTab === 'analyzer' ? '#007bff' : 'transparent',
              color: activeTab === 'analyzer' ? 'white' : '#007bff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: activeTab === 'analyzer' ? 'bold' : 'normal'
            }}
          >
            🔍 Analyzer
          </button>
          <button
            onClick={() => setActiveTab('learning')}
            className={`tab-button ${activeTab === 'learning' ? 'active' : ''}`}
            style={{
              padding: '0.5rem 1.5rem',
              border: 'none',
              backgroundColor: activeTab === 'learning' ? '#007bff' : 'transparent',
              color: activeTab === 'learning' ? 'white' : '#007bff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: activeTab === 'learning' ? 'bold' : 'normal'
            }}
          >
            🧠 Learning
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'analyzer' && (
          <>
            {!reportData && (
              <FileUpload
                onUpload={handleFileUpload}
                onError={handleError}
                onLoadingChange={handleLoadingState}
                onStart={(file) => setUploadOverlay({ visible: true, file, stage: 'uploading', percent: 0, log: 'Starting…' })}
                onProgressUpdate={({ stage, percent, log }) => setUploadOverlay((prev) => ({ ...prev, stage, percent, log }))}
                renderOverlayExternally={false}
              />
            )}

            {error && (
              <div className="error-container">
                <h3>❌ Error</h3>
                <p>{error}</p>
                <button onClick={resetApp} className="btn btn-secondary">
                  Try Again
                </button>
              </div>
            )}

            {reportData && !isLoading && (
              <ReportDisplay
                data={reportData}
                onReset={resetApp}
              />
            )}
          </>
        )}

        {activeTab === 'learning' && (
          <LearningDashboard lastFilename={reportData?.filename || ''} />
        )}

        {/* Floating Upload Overlay (driven from FileUpload callbacks or isLoading fallback) */}
        {(uploadOverlay.visible || isLoading) && !reportData && (
          <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.06)', zIndex: 1000 }}>
            <div className="progress-container" style={{ width: 'min(880px, 92vw)', maxWidth: '880px' }}>
              <div className="progress-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  {uploadOverlay.file && (
                    <div style={{ color: '#2d3748', fontWeight: 600 }}>
                      <span>📤 Uploading: </span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', verticalAlign: 'bottom', maxWidth: '48ch' }} title={uploadOverlay.file.name}>
                        {uploadOverlay.file.name}
                      </span>
                      <span> ({(uploadOverlay.file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                    </div>
                  )}
                  <div style={{ color: '#4a5568', marginTop: '0.25rem' }}>{uploadOverlay.log || currentLogLine || 'Starting…'}</div>
                </div>
                <span className="progress-percentage" style={{ marginLeft: '1rem' }}>{Math.round(uploadOverlay.percent || progressPercentage || 1)}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.round(uploadOverlay.percent || progressPercentage || 1)}%`, transition: 'width 0.3s ease' }} />
              </div>
              <div className="progress-steps">
                <div className={`progress-step ${uploadOverlay.stage === 'preparing' ? 'active' : ['uploading', 'processing', 'analyzing'].includes(uploadOverlay.stage) ? 'completed' : ''}`}><span className="step-icon">🚀</span><span className="step-label">Prepare</span></div>
                <div className={`progress-step ${uploadOverlay.stage === 'uploading' || isLoading ? 'active' : uploadOverlay.stage && uploadOverlay.stage !== 'preparing' ? 'completed' : ''}`}><span className="step-icon">📤</span><span className="step-label">Upload</span></div>
                <div className={`progress-step ${uploadOverlay.stage === 'processing' ? 'active' : uploadOverlay.stage === 'analyzing' ? 'completed' : ''}`}><span className="step-icon">⚡</span><span className="step-label">Process</span></div>
                <div className={`progress-step ${uploadOverlay.stage === 'analyzing' ? 'active' : ''}`}><span className="step-icon">🔍</span><span className="step-label">Analyze</span></div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Built with React + Vite | UTF-8 Character & Length Validation | Supports CSV, XLSX, XLS files up to 800MB</p>
      </footer>
    </div>
  );
}

export default App;


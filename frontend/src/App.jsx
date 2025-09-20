import { useState, useEffect, useRef } from 'react';
import FileUpload from './components/FileUpload';
import ReportDisplay from './components/ReportDisplay';
import LearningDashboard from './components/LearningDashboard';
import './App.css';

function App() {
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('analyzer'); // 'analyzer' or 'learning'
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [currentLogLine, setCurrentLogLine] = useState('');
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

    let currentProgress = 0;
    let logIndex = 0;

    progressIntervalRef.current = setInterval(async () => {
      try {
        if (!sessionId) return;
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/progress/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (typeof data.percent === 'number') setProgressPercentage(data.percent);
          if (data.log) setCurrentLogLine(data.log);
          if (data.percent >= 100) {
            clearInterval(progressIntervalRef.current);
          }
        }
      } catch (e) {
        // ignore network blips
      }
    }, 1000);
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgressPercentage(0);
    setCurrentLogLine('');
  };

  // Start progress polling when loading begins
  useEffect(() => {
    if (isLoading && reportData?.progressId) {
      startProgressSimulation(reportData.progressId);
    } else {
      stopProgressSimulation();
    }

    return () => stopProgressSimulation();
  }, [isLoading, reportData?.progressId]);

  const handleFileUpload = (data) => {
    setReportData(data);
    setError(null);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setReportData(null);
  };

  const handleLoadingState = (loading, progressId) => {
    setIsLoading(loading);
    if (progressId) {
      // Ensure we have a progressId to poll before final report arrives
      setReportData(prev => ({ ...(prev || {}), progressId }));
    }
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
            {!reportData && !isLoading && (
              <FileUpload
                onUpload={handleFileUpload}
                onError={handleError}
                onLoadingChange={handleLoadingState}
              />
            )}

            {isLoading && (
              <div className="loading-container">
                <div className="spinner"></div>
                <p>Please wait while we process your file...</p>
                <p style={{ fontSize: '0.875rem', color: '#718096', marginTop: '0.5rem' }}>
                  Large files may take several minutes to analyze
                </p>

                {/* Progress Bar */}
                <div className="progress-bar-container">
                  <div className="progress-bar-header">
                    <span className="progress-label">Analysis Progress</span>
                    <span className="progress-percentage">{progressPercentage}%</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progressPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {/* Current Log Line */}
                <div className="log-display">
                  <div className="log-icon">📋</div>
                  <div className="log-text">{currentLogLine}</div>
                </div>
              </div>
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
          <LearningDashboard />
        )}
      </main>

      <footer className="app-footer">
        <p>Built with React + Vite | UTF-8 Character & Length Validation | Supports CSV, XLSX, XLS files up to 800MB</p>
      </footer>
    </div>
  );
}

export default App;

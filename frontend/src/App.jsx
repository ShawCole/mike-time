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
  const startProgressSimulation = () => {
    setProgressPercentage(0);
    setCurrentLogLine(mockLogLines[0]);

    let currentProgress = 0;
    let logIndex = 0;

    progressIntervalRef.current = setInterval(() => {
      currentProgress += Math.random() * 8 + 2; // Random increment between 2-10

      if (currentProgress >= 100) {
        currentProgress = 100;
        setProgressPercentage(100);
        setCurrentLogLine(mockLogLines[mockLogLines.length - 1]);
        clearInterval(progressIntervalRef.current);
        return;
      }

      setProgressPercentage(Math.floor(currentProgress));

      // Update log line based on progress
      const expectedLogIndex = Math.floor((currentProgress / 100) * (mockLogLines.length - 1));
      if (expectedLogIndex > logIndex && expectedLogIndex < mockLogLines.length) {
        logIndex = expectedLogIndex;
        setCurrentLogLine(mockLogLines[logIndex]);
      }
    }, 800 + Math.random() * 400); // Random interval between 800-1200ms
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgressPercentage(0);
    setCurrentLogLine('');
  };

  // Start progress simulation when loading begins
  useEffect(() => {
    if (isLoading) {
      startProgressSimulation();
    } else {
      stopProgressSimulation();
    }

    return () => stopProgressSimulation();
  }, [isLoading]);

  const handleFileUpload = (data) => {
    setReportData(data);
    setError(null);
  };

  const handleError = (errorMessage) => {
    setError(errorMessage);
    setReportData(null);
  };

  const handleLoadingState = (loading) => {
    setIsLoading(loading);
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

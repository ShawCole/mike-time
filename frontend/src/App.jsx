import { useState } from 'react';
import FileUpload from './components/FileUpload';
import ReportDisplay from './components/ReportDisplay';
import './App.css';

function App() {
  const [reportData, setReportData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

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
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🔍 Data Quality Analyzer</h1>
        <p>Upload Excel or CSV files to detect and fix invalid characters (accents, symbols) and length violations for database ingestion</p>
      </header>

      <main className="app-main">
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
      </main>

      <footer className="app-footer">
        <p>Built with React + Vite | UTF-8 Character & Length Validation | Supports CSV, XLSX, XLS files up to 800MB</p>
      </footer>
    </div>
  );
}

export default App;

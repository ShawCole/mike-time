import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/api';

const FileUpload = ({ onUpload, onError, onLoadingChange, onStart, onProgressUpdate, renderOverlayExternally = true, externalPercent, externalLog }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [displayPercent, setDisplayPercent] = useState(0); // smoothed percent for UI
    const [currentStage, setCurrentStage] = useState(''); // 'uploading', 'processing', 'analyzing'
    const [allowDiacritics, setAllowDiacritics] = useState(() => {
        try {
            const stored = localStorage.getItem('allowDiacritics');
            if (stored === null) return true; // default
            return stored === 'true';
        } catch (_) {
            return true;
        }
    });
    const [uploadLog, setUploadLog] = useState('Initializing file upload...');
    const [lastTick, setLastTick] = useState({ t: 0, loaded: 0 });
    const creepTimerRef = useRef(null);
    const stopCreep = () => { if (creepTimerRef.current) { clearInterval(creepTimerRef.current); creepTimerRef.current = null; } };

    const uploadFile = async (file) => {
        try {
            // Defer progress start to the specific upload path to avoid multiple progress sessions
            setUploadProgress(0);
            setProcessingProgress(0);
            setDisplayPercent(0);

            const fileSizeMB = file.size / (1024 * 1024);
            console.log(`File size: ${fileSizeMB.toFixed(2)}MB`);

            // Use high-performance Cloud Storage upload for files > 32MB
            if (fileSizeMB > 32) {
                await uploadLargeFile(file, fileSizeMB);
            } else {
                await uploadSmallFile(file);
            }

        } catch (error) {
            console.error('Upload error:', error);
            if (error.response && error.response.data && error.response.data.error) {
                onError(error.response.data.error);
            } else if (error.code === 'ECONNABORTED') {
                onError('Upload timeout - file may be too large or connection is slow');
            } else {
                onError('Failed to upload file. Please check your connection and try again.');
            }
        } finally {
            onLoadingChange(false);
            setUploadProgress(0);
            setProcessingProgress(0);
            setCurrentStage('');
        }
    };

    // High-performance upload for large files (>32MB) via Cloud Storage
    const uploadLargeFile = async (file, fileSizeMB) => {
        setCurrentStage('preparing');
        if (onProgressUpdate) onProgressUpdate({ stage: 'preparing', percent: 0, log: 'Preparing high-performance upload…' });
        console.log(`Using high-performance upload for ${fileSizeMB.toFixed(2)}MB file`);

        try {
            // Step 1: Get signed URL for direct Cloud Storage upload
            // Start a single progress session for this upload path
            const p = await axios.post(API_ENDPOINTS.progressStart);
            const activeProgressId = p.data?.progressId;
            onLoadingChange(true, activeProgressId);
            if (onStart) onStart(file);

            const signedUrlResponse = await axios.post(API_ENDPOINTS.getUploadUrl, {
                filename: file.name,
                contentType: file.type || 'text/csv'
            });

            const { uploadUrl, filename } = signedUrlResponse.data;

            // Step 2: Upload directly to Cloud Storage
            setCurrentStage('uploading');
            if (onProgressUpdate) onProgressUpdate({ stage: 'uploading', percent: 0, log: 'Starting upload…' });
            await axios.put(uploadUrl, file, {
                headers: {
                    'Content-Type': file.type || 'text/csv',
                    'x-goog-content-length-range': '0,8589934592'
                },
                timeout: 3600000, // 1 hour timeout for very large files
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round(
                        (progressEvent.loaded * 100) / progressEvent.total
                    );
                    setUploadProgress(percentCompleted);
                    setDisplayPercent((prev) => Math.max(prev, percentCompleted));

                    // Live log with instantaneous rate
                    const now = Date.now();
                    const dt = Math.max(1, now - (lastTick.t || now));
                    const dBytes = Math.max(0, progressEvent.loaded - (lastTick.loaded || 0));
                    const bytesPerSec = (dBytes * 1000) / dt;
                    setLastTick({ t: now, loaded: progressEvent.loaded });
                    const fmt = (b) => {
                        if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
                        if (b >= 1024) return (b / 1024).toFixed(2) + ' KB';
                        return b + ' B';
                    };
                    const logLine = `Uploading ${fmt(progressEvent.loaded)} of ${fmt(progressEvent.total)} (${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s)`;
                    setUploadLog(logLine);
                    if (onProgressUpdate) onProgressUpdate({ stage: 'uploading', percent: percentCompleted, log: logLine });
                }
            });

            // Step 3: Process from Cloud Storage (streaming)
            setCurrentStage('processing');
            setUploadProgress(100);
            setProcessingProgress(5);
            setDisplayPercent(5);
            if (onProgressUpdate) onProgressUpdate({ stage: 'processing', percent: 5, log: 'Streaming to server and processing…' });

            const response = await axios.post(API_ENDPOINTS.processFromStorage, {
                filename: filename,
                progressId: activeProgressId,
                allowDiacritics: !!allowDiacritics,
                ignoreWhitelist: !allowDiacritics ? true : false
            }, { timeout: 3600000 });

            setProcessingProgress(100);
            setDisplayPercent(100);
            stopCreep();

            // Normalize response (ensure issueCount present for UI)
            const normalized = {
                ...response.data,
                issueCount: (typeof response.data?.issueCount === 'number')
                    ? response.data.issueCount
                    : (Array.isArray(response.data?.issues) ? response.data.issues.length : 0),
                // ensure progressId is available for App to poll
                progressId: response.data?.progressId || activeProgressId
            };

            // Small delay to show completion
            setTimeout(() => {
                onUpload(normalized);
            }, 500);
        } catch (err) {
            console.warn('High-performance path unavailable, attempting direct upload fallback...', err?.response?.data || err?.message || err);
            // If signed URL flow fails (likely in local dev without GCP creds), fall back to direct upload
            // Backend direct upload limit is 800MB
            if (fileSizeMB <= 800) {
                await uploadSmallFile(file);
                return;
            }
            // If file exceeds backend limit, surface a clear error
            throw new Error('Cloud upload unavailable and file exceeds 800MB backend limit. Configure GCS or upload a smaller file.');
        }
    };

    // Regular upload for smaller files (<32MB)
    const uploadSmallFile = async (file) => {
        setCurrentStage('uploading');
        if (onStart) onStart(file);
        if (onProgressUpdate) onProgressUpdate({ stage: 'uploading', percent: 0, log: 'Starting upload…' });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('allowDiacritics', String(allowDiacritics));
        formData.append('ignoreWhitelist', String(!allowDiacritics));

        // Ensure progress is tracked under a progress id
        try {
            const p = await axios.post(API_ENDPOINTS.progressStart);
            if (p.data?.progressId) {
                formData.append('progressId', p.data.progressId);
                onLoadingChange(true, p.data.progressId);
            }
        } catch (_) { /* ignore */ }

        const response = await axios.post(API_ENDPOINTS.upload, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            timeout: 600000, // 10 minutes timeout
            onUploadProgress: (progressEvent) => {
                const percentCompleted = Math.round(
                    (progressEvent.loaded * 100) / progressEvent.total
                );
                setUploadProgress(percentCompleted);
                setDisplayPercent((prev) => Math.max(prev, percentCompleted));

                // Live upload log + speed
                const now = Date.now();
                const dt = Math.max(1, now - (lastTick.t || now));
                const dBytes = Math.max(0, progressEvent.loaded - (lastTick.loaded || 0));
                const bytesPerSec = (dBytes * 1000) / dt;
                setLastTick({ t: now, loaded: progressEvent.loaded });
                const fmt = (b) => {
                    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
                    if (b >= 1024) return (b / 1024).toFixed(2) + ' KB';
                    return b + ' B';
                };
                const logLine = `Uploading ${fmt(progressEvent.loaded)} of ${fmt(progressEvent.total)} (${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s)`;
                setUploadLog(logLine);
                if (onProgressUpdate) onProgressUpdate({ stage: 'uploading', percent: percentCompleted, log: logLine });

                if (percentCompleted === 100) {
                    setCurrentStage('processing');
                    setProcessingProgress(5);
                    setDisplayPercent(5);
                    if (onProgressUpdate) onProgressUpdate({ stage: 'processing', percent: 5, log: 'Streaming to server and processing…' });
                }
            }
        });

        setCurrentStage('analyzing');
        setProcessingProgress(100);
        setDisplayPercent(100);
        stopCreep();
        if (onProgressUpdate) onProgressUpdate({ stage: 'analyzing', percent: 100, log: 'Analyzing quality issues…' });

        // Normalize response (ensure issueCount present for UI)
        const normalized = {
            ...response.data,
            issueCount: (typeof response.data?.issueCount === 'number')
                ? response.data.issueCount
                : (Array.isArray(response.data?.issues) ? response.data.issues.length : 0),
            progressId: response.data?.progressId || formData.get('progressId') || undefined
        };

        // Small delay to show completion
        setTimeout(() => {
            onUpload(normalized);
        }, 500);
    };

    const onDrop = useCallback((acceptedFiles, rejectedFiles) => {
        if (rejectedFiles.length > 0) {
            const rejection = rejectedFiles[0];
            if (rejection.errors.some(error => error.code === 'file-too-large')) {
                onError('File is too large. Maximum size is 8GB.');
            } else if (rejection.errors.some(error => error.code === 'file-invalid-type')) {
                onError('Invalid file type. Please upload CSV, XLSX, or XLS files only.');
            } else {
                onError('File upload failed. Please try again.');
            }
            return;
        }

        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            setSelectedFile(file);
            uploadFile(file);
        }
    }, [onError, onLoadingChange, onUpload]);

    const {
        getRootProps,
        getInputProps,
        isDragActive,
        isDragReject
    } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
        },
        maxSize: 8 * 1024 * 1024 * 1024, // 8GB
        multiple: false
    });

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="file-upload">
            <h2 style={{ textAlign: 'center', marginBottom: '2rem', color: '#2d3748' }}>
                Upload File for Data Quality Analysis
            </h2>

            <div
                {...getRootProps()}
                className={`dropzone ${isDragActive ? 'active' : ''} ${isDragReject ? 'reject' : ''}`}
            >
                <input {...getInputProps()} />

                <div className="dropzone-content">
                    {isDragActive && !isDragReject && (
                        <>
                            <h3>📁 Drop your file here</h3>
                            <p>Release to upload your data file</p>
                        </>
                    )}

                    {isDragReject && (
                        <>
                            <h3>❌ Invalid file type</h3>
                            <p>Please upload CSV, XLSX, or XLS files only</p>
                        </>
                    )}

                    {!isDragActive && (
                        <>
                            <h3>📊 Drag & Drop Your File</h3>
                            <p>
                                Drop your CSV, XLSX, or XLS file here, or{' '}
                                <strong style={{ color: '#667eea' }}>click to browse</strong>
                            </p>
                            <p style={{ fontSize: '0.9rem', marginTop: '1rem' }}>
                                Supported formats: .csv, .xlsx, .xls<br />
                                Maximum file size: 8GB
                            </p>
                            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                                🚀 High-performance processing for large files (8GB+ supported)<br />
                                ⚡ Sub-minute processing for files up to 2GB
                            </p>
                        </>
                    )}
                </div>
            </div>

            {selectedFile && !currentStage && (
                <div className="file-info">
                    <h4 style={{ marginBottom: '0.5rem' }}>📁 Selected File:</h4>
                    <p><strong>Name:</strong> {selectedFile.name}</p>
                    <p><strong>Size:</strong> {formatFileSize(selectedFile.size)}</p>
                    <p><strong>Type:</strong> {selectedFile.type || 'Unknown'}</p>
                </div>
            )}

            {/* Progress Bar */}
            {!renderOverlayExternally && currentStage && (
                <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.06)', zIndex: 1000 }}>
                    <div className="progress-container" style={{ width: 'min(880px, 92vw)', maxWidth: '880px' }}>
                        <div className="progress-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ minWidth: 0 }}>
                                {selectedFile && (
                                    <div style={{ color: '#2d3748', fontWeight: 600 }}>
                                        <span>📤 Uploading: </span>
                                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', verticalAlign: 'bottom', maxWidth: '48ch' }} title={selectedFile.name}>
                                            {selectedFile.name}
                                        </span>
                                        <span> ({formatFileSize(selectedFile.size)})</span>
                                    </div>
                                )}
                                <div style={{ color: '#4a5568', marginTop: '0.25rem' }}>
                                    {currentStage === 'preparing' && 'Preparing high-performance upload…'}
                                    {currentStage === 'uploading' && uploadLog}
                                    {(currentStage === 'processing' || currentStage === 'analyzing') && (externalLog || 'Streaming to server and processing…')}
                                </div>
                            </div>
                            <span className="progress-percentage" style={{ marginLeft: '1rem' }}>
                                {`${Math.round(displayPercent)}%`}
                            </span>
                        </div>

                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${Math.round(displayPercent)}%`,
                                    transition: 'width 0.3s ease'
                                }}
                            />
                        </div>

                        <div className="progress-steps">
                            <div className={`progress-step ${currentStage === 'preparing' ? 'active' : ['uploading', 'processing', 'analyzing'].includes(currentStage) ? 'completed' : ''}`}>
                                <span className="step-icon">🚀</span>
                                <span className="step-label">Prepare</span>
                            </div>
                            <div className={`progress-step ${currentStage === 'uploading' ? 'active' : uploadProgress === 100 ? 'completed' : ''}`}>
                                <span className="step-icon">📤</span>
                                <span className="step-label">Upload</span>
                            </div>
                            <div className={`progress-step ${currentStage === 'processing' ? 'active' : processingProgress === 100 ? 'completed' : ''}`}>
                                <span className="step-icon">⚡</span>
                                <span className="step-label">Process</span>
                            </div>
                            <div className={`progress-step ${currentStage === 'analyzing' ? 'active' : ''}`}>
                                <span className="step-icon">🔍</span>
                                <span className="step-label">Analyze</span>
                            </div>
                        </div>

                        {/* Live logs area replaces filename block */}
                        <div className="log-display" style={{ marginTop: '0.75rem' }}>
                            <div className="log-icon">📋</div>
                            <div className="log-text">{(currentStage === 'processing' || currentStage === 'analyzing') ? (externalLog || uploadLog) : uploadLog}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Options */}
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f1f5f9', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input id="allow-diacritics" type="checkbox" checked={allowDiacritics} onChange={(e) => {
                    const v = e.target.checked;
                    setAllowDiacritics(v);
                    try { localStorage.setItem('allowDiacritics', String(v)); } catch (_) { }
                }} />
                <label htmlFor="allow-diacritics" style={{ cursor: 'pointer' }}>
                    Allow diacritics (treat accented letters as valid)
                </label>
            </div>

            <div style={{ marginTop: '2rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
                <h4 style={{ marginBottom: '1rem', color: '#4a5568' }}>🔍 What We Analyze:</h4>
                <ul style={{ color: '#718096', lineHeight: '1.6' }}>
                    <li>🔤 <strong>Character Validation:</strong> Detects invalid characters (only A-Z, a-z, 0-9, space, and basic punctuation allowed). Automatically converts accented characters (é→e, ñ→n, etc.)</li>
                    <li>📏 <strong>Length Validation:</strong> Flags cells exceeding 100 characters in length</li>
                    <li>🛠️ <strong>Automatic Fixes:</strong> Suggests fixes by replacing accented characters with base equivalents, removing invalid characters, and truncating long values</li>
                    <li>📊 <strong>Complete Analysis:</strong> Processes all rows and columns with Excel-style cell references (A1, B52, AA1001), handling files with millions of rows efficiently</li>
                    <li>💾 <strong>Fix & Download:</strong> Apply fixes individually or all at once, then download detailed reports and change logs</li>
                </ul>
            </div>
        </div>
    );
};

export default FileUpload; 
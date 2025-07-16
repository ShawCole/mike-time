import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';

const FileUpload = ({ onUpload, onError, onLoadingChange }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [currentStage, setCurrentStage] = useState(''); // 'uploading', 'processing', 'analyzing'

    const uploadFile = async (file) => {
        try {
            onLoadingChange(true);
            setUploadProgress(0);
            setProcessingProgress(0);
            setCurrentStage('uploading');

            const formData = new FormData();
            formData.append('file', file);

            const response = await axios.post('http://localhost:3001/api/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                timeout: 600000, // 10 minutes timeout for large files
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round(
                        (progressEvent.loaded * 100) / progressEvent.total
                    );
                    setUploadProgress(percentCompleted);

                    if (percentCompleted === 100) {
                        setCurrentStage('processing');
                        setProcessingProgress(10); // Start showing processing progress
                    }
                }
            });

            setCurrentStage('analyzing');
            setProcessingProgress(100);

            // Small delay to show completion
            setTimeout(() => {
                onUpload(response.data);
            }, 500);

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

    const onDrop = useCallback((acceptedFiles, rejectedFiles) => {
        if (rejectedFiles.length > 0) {
            const rejection = rejectedFiles[0];
            if (rejection.errors.some(error => error.code === 'file-too-large')) {
                onError('File is too large. Maximum size is 800MB.');
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
        maxSize: 800 * 1024 * 1024, // 800MB
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
                                Maximum file size: 800MB
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
            {currentStage && (
                <div className="progress-container">
                    <div className="progress-header">
                        <h4 style={{ margin: '0 0 0.5rem 0', color: '#4a5568' }}>
                            {currentStage === 'uploading' && '📤 Uploading File...'}
                            {currentStage === 'processing' && '⚙️ Processing Data...'}
                            {currentStage === 'analyzing' && '🔍 Analyzing Quality Issues...'}
                        </h4>
                        <span className="progress-percentage">
                            {currentStage === 'uploading' ? `${uploadProgress}%` : `${processingProgress}%`}
                        </span>
                    </div>

                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{
                                width: `${currentStage === 'uploading' ? uploadProgress : processingProgress}%`,
                                transition: 'width 0.3s ease'
                            }}
                        />
                    </div>

                    <div className="progress-steps">
                        <div className={`progress-step ${currentStage === 'uploading' ? 'active' : uploadProgress === 100 ? 'completed' : ''}`}>
                            <span className="step-icon">📤</span>
                            <span className="step-label">Upload</span>
                        </div>
                        <div className={`progress-step ${currentStage === 'processing' ? 'active' : processingProgress === 100 ? 'completed' : ''}`}>
                            <span className="step-icon">⚙️</span>
                            <span className="step-label">Process</span>
                        </div>
                        <div className={`progress-step ${currentStage === 'analyzing' ? 'active' : ''}`}>
                            <span className="step-icon">🔍</span>
                            <span className="step-label">Analyze</span>
                        </div>
                    </div>

                    {selectedFile && (
                        <div className="file-details-small">
                            <strong>{selectedFile.name}</strong> ({formatFileSize(selectedFile.size)})
                        </div>
                    )}
                </div>
            )}

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
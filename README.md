# 🔍 Data Quality Analyzer

A full-stack web application for detecting and fixing data quality issues in Excel and CSV files. Built with React + Vite (frontend) and Node.js + Express (backend). Perfect for data preparation before database ingestion.

## ✨ Features

- **📁 Drag & Drop Upload**: Easy file upload with drag and drop support
- **📊 Multi-format Support**: Handles CSV, XLSX, and XLS files up to 800MB
- **🔍 UTF-8 Analysis**: Detects problematic characters including:
  - Control characters (0x00-0x1F, 0x7F-0x9F)
  - Unicode replacement characters (0xFFFD)
  - Non-UTF8 encoding issues
- **📏 Length Validation**: Flags cells exceeding 100 characters in length
- **🛠️ Individual Fixes**: Fix each issue one by one with detailed character/length information
- **⚡ Bulk Fixes**: Fix all issues at once with a single click
- **📈 Comprehensive Reports**: Card-based display showing original values, suggested fixes, character details, and length information
- **🔎 Search & Filter**: Search through issues and changes by row, column, or value
- **📄 Pagination**: Efficient display of large result sets (25 items per page)
- **💾 Multiple Downloads**: Export issue reports, change logs, and fixed files
- **📱 Responsive Design**: Works on desktop and mobile devices
- **📋 Change Tracking**: View all changes made with timestamps and before/after values

## 🏗️ Architecture

```
mike-time/
├── backend/          # Node.js + Express API
│   ├── server.js     # Main server file
│   └── package.json  # Backend dependencies
├── frontend/         # React + Vite client
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── components/
│   │       ├── FileUpload.jsx
│   │       └── ReportDisplay.jsx
│   └── package.json  # Frontend dependencies
└── README.md         # This file
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** or **yarn**

### Installation

1. **Clone or download the project**:
   ```bash
   # If you have git:
   git clone <repository-url>
   cd mike-time
   
   # Or extract if downloaded as ZIP
   ```

2. **Install backend dependencies**:
   ```bash
   cd backend
   npm install
   ```

3. **Install frontend dependencies**:
   ```bash
   cd ../frontend
   npm install
   ```

### 🏃‍♂️ Running the Application

You'll need to run both the backend and frontend servers:

#### Terminal 1 - Backend Server
```bash
cd backend
npm run dev
# Server will start on http://localhost:3001
```

#### Terminal 2 - Frontend Server
```bash
cd frontend
npm run dev
# Frontend will start on http://localhost:5173
```

### 🌐 Access the Application

Open your browser and navigate to: **http://localhost:5173**

The application will automatically connect to the backend API running on port 3001.

## 📊 How to Use

1. **Upload File**: Drag and drop or click to select a CSV, XLSX, or XLS file
2. **Wait for Analysis**: The system will process your file and identify data quality issues (UTF-8 characters and length violations)
3. **Review Issues**: Browse through issues displayed as individual cards showing:
   - Row number and column location
   - Original problematic value
   - Suggested fix
   - Detailed character information (Unicode codes and descriptions) for UTF-8 issues
   - Length information (current vs. maximum) for length violations
4. **Fix Issues**: Choose your approach:
   - **Individual Fixes**: Click "Fix This Issue" on specific problems
   - **Bulk Fix**: Click "Fix All Issues" to resolve everything at once
5. **View Changes**: Toggle to "Show Changes" to see all modifications made with timestamps
6. **Download Results**:
   - Export issue reports as CSV
   - Export change logs as CSV
   - Download the fully fixed file
7. **Analyze More Files**: Click "Analyze New File" to process additional files

## 🔧 Configuration

### Backend Configuration (server.js)

- **Port**: Default 3001, can be changed via `PORT` environment variable
- **File Size Limit**: 800MB maximum upload size
- **Supported Formats**: .csv, .xlsx, .xls
- **Upload Directory**: `backend/uploads/` (automatically created and cleaned)

### Quality Checks

- **UTF-8 Character Validation**: Detects control characters and encoding issues that cause database problems
- **Length Validation**: Maximum 100 characters per cell
- **Processing**: Handles files with millions of rows efficiently

### Frontend Configuration

- **API Endpoint**: `http://localhost:3001/api/upload`
- **Timeout**: 10 minutes for large file uploads
- **Pagination**: 25 issues per page
- **Search**: Real-time filtering across all fields

## 🛠️ Development

### Backend Development
```bash
cd backend
npm run dev  # Uses nodemon for auto-restart
```

### Frontend Development
```bash
cd frontend
npm run dev  # Vite dev server with hot reload
```

### Building for Production

#### Backend
```bash
cd backend
npm start  # Production mode
```

#### Frontend
```bash
cd frontend
npm run build  # Builds to dist/ directory
npm run preview  # Preview production build
```

## 📁 API Endpoints

### POST `/api/upload`
Upload and analyze a data file.

**Request**: 
- Content-Type: `multipart/form-data`
- Body: File field named `file`

**Response**:
```json
{
  "filename": "data.xlsx",
  "totalRows": 1000,
  "totalColumns": 15,
  "issues": [
    {
      "rowNumber": 123,
      "column": "First Name", 
      "value": "J@ne",
      "problem": "Contains unexpected characters"
    }
  ],
  "issueCount": 1
}
```

### GET `/api/health`
Health check endpoint.

**Response**:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 🔍 Quality Analysis Details

The application performs two main types of validation:

### 1. UTF-8 Character Validation
- **Detects**: Control characters, non-UTF8 encoding issues, and Unicode replacement characters
- **Character Ranges Flagged**:
  - Control characters (0x00-0x1F, 0x7F-0x9F)
  - Unicode replacement character (0xFFFD)
  - Characters that cause database ingestion issues
- **Examples of flagged content**: Null characters, tabs, carriage returns, extended ASCII characters
- **Fix Strategy**: Removes or replaces problematic characters with appropriate alternatives

### 2. Length Validation
- **Limit**: 100 characters per cell
- **Flagged**: Any cell content exceeding this limit
- **Fix Strategy**: Truncates content to exactly 100 characters
- **Display**: Long values are truncated in the interface with "..." indicator

## 🚀 Performance Optimization

- **Streaming**: CSV files are processed using streams for memory efficiency
- **Vectorized Operations**: Excel parsing uses efficient XLSX library
- **Pagination**: Frontend displays results in chunks to maintain responsiveness
- **File Cleanup**: Uploaded files are automatically deleted after processing
- **Error Handling**: Comprehensive error handling for various file issues

## 🐛 Troubleshooting

### Common Issues

1. **"Cannot connect to backend"**
   - Ensure backend server is running on port 3001
   - Check for port conflicts

2. **"File upload failed"**
   - Verify file format (CSV, XLSX, XLS only)
   - Check file size (max 800MB)
   - Ensure file is not corrupted

3. **"Empty file or parsing error"**
   - Verify file contains data
   - Check for proper CSV formatting
   - Ensure Excel files are not password-protected

4. **Slow performance with large files**
   - This is normal for files with millions of rows
   - Consider breaking large files into smaller chunks

### Port Configuration

If ports 3001 or 5173 are already in use:

**Backend**:
```bash
PORT=3002 npm run dev
```

**Frontend**: Update `vite.config.js` or use different port:
```bash
npm run dev -- --port 5174
```

## 📈 Scalability Considerations

For production use with very large files:
- Consider implementing background job processing
- Add Redis for session management
- Implement file chunking for uploads
- Add database storage for analysis history
- Consider using Python pandas via child processes for even better performance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and test thoroughly
4. Submit a pull request

## 📄 License

This project is open source. Feel free to use and modify as needed.

## 🆘 Support

For issues or questions:
1. Check the troubleshooting section above
2. Verify all dependencies are installed correctly
3. Ensure both servers are running
4. Check browser console for frontend errors
5. Check terminal output for backend errors

---

**Built with ❤️ using React, Vite, Node.js, and Express** 
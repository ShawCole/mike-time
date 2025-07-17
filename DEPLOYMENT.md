# Google Cloud Deployment Guide

This guide will help you deploy your Mike Time CSV Data Quality Analyzer to Google Cloud Platform.

## Prerequisites

1. **Google Cloud CLI installed**
   ```bash
   # Install gcloud CLI (if not already installed)
   curl https://sdk.cloud.google.com | bash
   exec -l $SHELL
   ```

2. **Authenticate with Google Cloud**
   ```bash
   gcloud auth login
   gcloud auth configure-docker
   ```

3. **Create a Google Cloud Project** (if you don't have one)
   ```bash
   gcloud projects create your-project-id
   gcloud config set project your-project-id
   ```

4. **Enable required APIs**
   ```bash
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable run.googleapis.com
   ```

## Backend Deployment (Google Cloud Run)

### Step 1: Configure the deployment script

1. Edit `backend/deploy-gcp.sh` and update the `PROJECT_ID`:
   ```bash
   PROJECT_ID="your-actual-project-id"  # Replace with your project ID
   ```

### Step 2: Deploy the backend

```bash
cd backend
./deploy-gcp.sh
```

This script will:
- Build a Docker image
- Push it to Google Container Registry
- Deploy to Cloud Run with optimized memory settings (8GB)
- Output the backend URL

### Step 3: Note the backend URL

After deployment, you'll see output like:
```
✅ Deployment complete!
🔗 Backend URL: https://mike-time-backend-xyz-uc.a.run.app
```

**Save this URL - you'll need it for the frontend!**

## Frontend Deployment (Netlify)

### Step 1: Update production environment

1. Edit `frontend/.env.production` and replace the URL:
   ```
   VITE_API_URL=https://your-actual-backend-url.run.app
   ```

### Step 2: Commit and push changes

```bash
git add .
git commit -m "Update production API URL"
git push origin main
```

### Step 3: Redeploy on Netlify

Your Netlify site will automatically redeploy with the new backend URL.

## Verification

1. **Check backend health**:
   ```bash
   curl https://your-backend-url.run.app/api/health
   ```
   Should return: `{"status":"OK","timestamp":"..."}`

2. **Test the full application**:
   - Visit your Netlify URL
   - Upload a CSV file
   - Verify the analysis works

## Cost Optimization

Google Cloud Run pricing:
- **Free tier**: 2 million requests/month, 400,000 GB-seconds
- **Pay-per-use**: Only charged when requests are being processed
- **Memory**: 8GB allocated (may cost ~$0.50-2.00/month for moderate usage)

## Troubleshooting

### Backend Issues

1. **Check logs**:
   ```bash
   gcloud logs tail mike-time-backend --region=us-central1
   ```

2. **Update deployment**:
   ```bash
   cd backend
   ./deploy-gcp.sh
   ```

### Frontend Issues

1. **Check environment variables** in Netlify dashboard
2. **Verify API URL** is correct and accessible
3. **Check browser console** for CORS or network errors

### Memory Issues

If you encounter memory issues with large files:

1. **Increase memory allocation**:
   ```bash
   gcloud run services update mike-time-backend \
     --memory 16Gi \
     --region us-central1
   ```

2. **Monitor performance**:
   ```bash
   gcloud monitoring dashboards list
   ```

## Security

- Backend allows unauthenticated requests (suitable for this use case)
- Consider adding authentication for production use
- CORS is configured for cross-origin requests

## Environment Variables

### Backend (.env for local development)
```
PORT=3001
NODE_ENV=development
```

### Frontend
- **Development**: `VITE_API_URL=http://localhost:3001`
- **Production**: `VITE_API_URL=https://your-backend-url.run.app`

## Support

If you encounter issues:
1. Check the logs using the commands above
2. Verify all environment variables are set correctly
3. Ensure APIs are enabled in Google Cloud Console
4. Check that your project has billing enabled (required for Cloud Run) 
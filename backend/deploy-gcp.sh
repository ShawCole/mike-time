#!/bin/bash

# Configuration
PROJECT_ID="accupoint-solutions-dev"
SERVICE_NAME="mike-time-backend"
REGION="us-central1"
IMAGE_NAME="us-central1-docker.pkg.dev/${PROJECT_ID}/mike-time-repo/${SERVICE_NAME}"

echo "🚀 Deploying to Google Cloud Run..."

# Create Cloud Storage bucket if it doesn't exist
echo "📦 Setting up Cloud Storage bucket..."
BUCKET_NAME="mike-time-csv-processing"
if ! gsutil ls -b gs://${BUCKET_NAME} &>/dev/null; then
    echo "Creating bucket gs://${BUCKET_NAME}..."
    gsutil mb -p ${PROJECT_ID} -c STANDARD -l ${REGION} gs://${BUCKET_NAME}
    
    # Set up CORS for direct uploads
    echo '[{"origin":["https://mikeqc.netlify.app","http://localhost:5173","http://localhost:5174","http://localhost:5175","http://localhost:5176"],"method":["GET","POST","PUT","DELETE","OPTIONS"],"responseHeader":["Content-Type","Authorization"],"maxAgeSeconds":3600}]' > cors.json
    gsutil cors set cors.json gs://${BUCKET_NAME}
    rm cors.json
    
    echo "✅ Bucket created and configured"
else
    echo "✅ Bucket already exists"
fi

# Build and push the Docker image
echo "📦 Building Docker image..."
gcloud builds submit --tag ${IMAGE_NAME} .

# Deploy to Cloud Run with maximum performance
echo "🌐 Deploying to Cloud Run with high-performance configuration..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 32Gi \
  --cpu 8 \
  --max-instances 20 \
  --min-instances 1 \
  --port 8080 \
  --timeout 3600 \
  --concurrency 5 \
  --execution-environment gen2 \
  --cpu-boost \
  --set-env-vars NODE_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID}

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')

echo "✅ Deployment complete!"
echo "🔗 Backend URL: ${SERVICE_URL}"
echo ""
echo "Next steps:"
echo "1. Update your frontend environment variables:"
echo "   VITE_API_URL=${SERVICE_URL}"
echo "2. Redeploy your frontend with the new API URL" 
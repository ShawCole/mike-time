#!/bin/bash

# Configuration
PROJECT_ID="your-project-id"
SERVICE_NAME="mike-time-backend"
REGION="us-central1"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🚀 Deploying to Google Cloud Run..."

# Build and push the Docker image
echo "📦 Building Docker image..."
gcloud builds submit --tag ${IMAGE_NAME} .

# Deploy to Cloud Run
echo "🌐 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 8Gi \
  --cpu 4 \
  --max-instances 10 \
  --port 8080 \
  --set-env-vars NODE_ENV=production

# Get the service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --format='value(status.url)')

echo "✅ Deployment complete!"
echo "🔗 Backend URL: ${SERVICE_URL}"
echo ""
echo "Next steps:"
echo "1. Update your frontend environment variables:"
echo "   VITE_API_URL=${SERVICE_URL}"
echo "2. Redeploy your frontend with the new API URL" 
#!/bin/bash
# Deploy Delivery app to Google Cloud Run
#
# Prerequisites:
#   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Run: gcloud auth login
#   3. Run: gcloud config set project delivery-worksheet-app
#
# First-time setup (run once):
#   ./deploy.sh setup
#
# Deploy:
#   ./deploy.sh

set -e

PROJECT_ID="delivery-worksheet-app"
REGION="us-east1"
SERVICE_NAME="delivery-app"
SECRET_NAME="firebase-service-account"

if [ "$1" = "setup" ]; then
    echo "=== First-time setup ==="

    # Enable required APIs
    echo "Enabling Cloud Run, Cloud Build, and Secret Manager APIs..."
    gcloud services enable \
        run.googleapis.com \
        cloudbuild.googleapis.com \
        secretmanager.googleapis.com \
        --project=$PROJECT_ID

    # Store Firebase service account JSON in Secret Manager
    echo "Storing Firebase credentials in Secret Manager..."
    gcloud secrets create $SECRET_NAME \
        --replication-policy="automatic" \
        --project=$PROJECT_ID 2>/dev/null || echo "Secret already exists"

    gcloud secrets versions add $SECRET_NAME \
        --data-file=firebase-service-account.json \
        --project=$PROJECT_ID

    # Grant Cloud Run access to the secret
    PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
    gcloud secrets add-iam-policy-binding $SECRET_NAME \
        --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor" \
        --project=$PROJECT_ID

    echo ""
    echo "=== Setup complete! Now run: ./deploy.sh ==="
    exit 0
fi

echo "=== Deploying to Cloud Run ==="

# Build and deploy in one step (Cloud Build handles the Docker build)
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --set-secrets="/secrets/firebase-service-account.json=${SECRET_NAME}:latest" \
    --set-env-vars="FIREBASE_CREDENTIALS=/secrets/firebase-service-account.json" \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=3 \
    --timeout=60

echo ""
echo "=== Deploy complete! ==="
gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format="value(status.url)"

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
INGEST_KEY_SECRET="delivery-ingest-api-key"

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

    # Ingest API key (used by IT to POST the daily CSV to /ingest)
    if gcloud secrets describe $INGEST_KEY_SECRET --project=$PROJECT_ID >/dev/null 2>&1; then
        echo "Ingest API key secret already exists — leaving it alone."
    else
        echo ""
        echo "=== Ingest API key setup ==="
        echo -n "Enter the API key IT will send in the X-API-Key header: "
        read -r INGEST_API_KEY_VALUE
        gcloud secrets create $INGEST_KEY_SECRET \
            --replication-policy="automatic" \
            --project=$PROJECT_ID
        printf '%s' "$INGEST_API_KEY_VALUE" | gcloud secrets versions add $INGEST_KEY_SECRET \
            --data-file=- \
            --project=$PROJECT_ID
    fi

    gcloud secrets add-iam-policy-binding $INGEST_KEY_SECRET \
        --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor" \
        --project=$PROJECT_ID

    echo ""
    echo "=== Setup complete! Now run: ./deploy.sh ==="
    exit 0
fi

echo "=== Deploying to Cloud Run ==="

COMMIT_HASH=$(git rev-parse --short HEAD)
echo "Commit: $COMMIT_HASH"

# Build and deploy in one step (Cloud Build handles the Docker build)
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --set-secrets="/secrets/firebase-service-account.json=${SECRET_NAME}:latest,INGEST_API_KEY=${INGEST_KEY_SECRET}:latest" \
    --set-env-vars="FIREBASE_CREDENTIALS=/secrets/firebase-service-account.json,COMMIT_HASH=$COMMIT_HASH" \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=3 \
    --timeout=60

echo ""
echo "=== Deploy complete! ==="
gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format="value(status.url)"

# Delivery App

## Versioning
- Increment version number with every commit
- Update in 2 places: `index.html` cache bust params (`?v=X.XX` on CSS and JS links), and `VERSION_HISTORY` array in `app.js`
- Show version number to user after commit so they can compare deployed vs local
- Format: v1.XX (minor increments)

## Dev Server
- `python3 -m uvicorn delivery.api.app:create_app --factory --host 0.0.0.0 --port 8000 --reload`
- Check for stale processes on port 8000 before starting

## Deploy
- `./deploy.sh` deploys to Google Cloud Run
- Service URL: https://delivery-app-481756503401.us-east1.run.app
- Python 3.9 warnings are expected, deploy still works

## Key Files
- `delivery/static/index.html` - Main HTML (single page app)
- `delivery/static/app.js` - All client-side logic
- `delivery/static/styles.css` - All styles
- `delivery/api/routes/` - FastAPI route handlers
- `delivery/services/delivery_service.py` - Business logic + Firestore persistence

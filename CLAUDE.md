# Delivery App

## Versioning
- Display format: `v1.41 · abc1234` (version · commit hash) shown in `#app-version`
- **Only bump the version number when explicitly requested** — not on every commit
- On version bump: add entry to `VERSION_HISTORY` array in `app.js` only
- Cache busters in `index.html` use `?v=__COMMIT__` — injected server-side at serve time, no manual updates needed
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

"""
FastAPI application factory.
"""

import logging
import os
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse

from delivery.api.routes import deliveries, items, checkin, storage, notes, daily_logs

logger = logging.getLogger(__name__)


def create_app(use_firebase: bool = True) -> FastAPI:
    """
    Create and configure the FastAPI application.

    Args:
        use_firebase: Whether to connect to Firebase for persistence.
                      Set False for testing without Firebase credentials.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Initialize services on startup."""
        if use_firebase:
            try:
                from delivery.firebase_client import (
                    get_firestore_client,
                    get_storage_bucket,
                )
                from delivery.services.delivery_service import DeliveryService
                from delivery.services.firebase_storage import FirebaseStorageService

                db = get_firestore_client()
                bucket = get_storage_bucket()

                from delivery.services.daily_log_service import DailyLogService

                app.state.delivery_service = DeliveryService(firestore_client=db)
                app.state.storage_service = FirebaseStorageService(bucket)
                app.state.daily_log_service = DailyLogService(
                    firestore_client=db, storage_bucket=bucket
                )
                logger.info("Firebase services initialized successfully")
            except Exception as e:
                logger.warning(f"Firebase init failed, using in-memory: {e}")
                from delivery.services.delivery_service import DeliveryService
                from delivery.services.daily_log_service import DailyLogService
                app.state.delivery_service = DeliveryService()
                app.state.storage_service = None
                app.state.daily_log_service = DailyLogService()
        else:
            from delivery.services.delivery_service import DeliveryService
            from delivery.services.daily_log_service import DailyLogService
            app.state.delivery_service = DeliveryService()
            app.state.storage_service = None
            app.state.daily_log_service = DailyLogService()

        yield

    app = FastAPI(
        title="Delivery Worksheet API",
        description=(
            "API for parsing produce delivery worksheets and managing "
            "the check-in/receiving workflow. Designed for iPad use."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS - allow iPad web app to connect
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(deliveries.router, prefix="/api/v1", tags=["deliveries"])
    app.include_router(items.router, prefix="/api/v1", tags=["items"])
    app.include_router(checkin.router, prefix="/api/v1", tags=["checkin"])
    app.include_router(storage.router, prefix="/api/v1", tags=["storage"])
    app.include_router(notes.router, prefix="/api/v1", tags=["notes"])
    app.include_router(daily_logs.router, prefix="/api/v1", tags=["daily-logs"])

    # Resolve commit hash once at startup
    def _get_commit_hash() -> str:
        if h := os.environ.get("COMMIT_HASH"):
            return h
        try:
            return subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                stderr=subprocess.DEVNULL,
            ).strip().decode()
        except Exception:
            return "dev"

    commit_hash = _get_commit_hash()

    # Serve static files for the web UI (no-cache during development)
    static_dir = Path(__file__).parent.parent / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

        @app.middleware("http")
        async def no_cache_static(request, call_next):
            response = await call_next(request)
            if request.url.path.startswith("/static") or request.url.path == "/":
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return response

        @app.get("/")
        async def serve_index():
            html = (static_dir / "index.html").read_text()
            html = html.replace("__COMMIT__", commit_hash)
            return HTMLResponse(content=html)

    @app.get("/api/commit")
    async def get_commit():
        return {"hash": commit_hash}

    @app.get("/health")
    async def health_check():
        return {
            "status": "ok",
            "firebase": use_firebase,
        }

    return app


# Create the app instance for uvicorn
app = create_app()

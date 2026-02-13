"""
FastAPI application factory.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from delivery.api.routes import deliveries, items, checkin, storage

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

                app.state.delivery_service = DeliveryService(firestore_client=db)
                app.state.storage_service = FirebaseStorageService(bucket)
                logger.info("Firebase services initialized successfully")
            except Exception as e:
                logger.warning(f"Firebase init failed, using in-memory: {e}")
                from delivery.services.delivery_service import DeliveryService
                app.state.delivery_service = DeliveryService()
                app.state.storage_service = None
        else:
            from delivery.services.delivery_service import DeliveryService
            app.state.delivery_service = DeliveryService()
            app.state.storage_service = None

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

    # Serve static files for the web UI
    static_dir = Path(__file__).parent.parent / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

        @app.get("/")
        async def serve_index():
            return FileResponse(str(static_dir / "index.html"))

    @app.get("/health")
    async def health_check():
        return {
            "status": "ok",
            "firebase": use_firebase,
        }

    return app


# Create the app instance for uvicorn
app = create_app()

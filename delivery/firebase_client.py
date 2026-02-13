"""
Firebase Admin SDK initialization.

Provides configured Firebase app, Firestore client, and Storage bucket.
"""

import os
from pathlib import Path
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore, storage

from delivery.config import FIREBASE_CREDENTIALS_PATH, FIREBASE_STORAGE_BUCKET

_app: Optional[firebase_admin.App] = None


def get_firebase_app() -> firebase_admin.App:
    """Get or initialize the Firebase app."""
    global _app
    if _app is not None:
        return _app

    cred_path = FIREBASE_CREDENTIALS_PATH
    if not Path(cred_path).exists():
        raise FileNotFoundError(
            f"Firebase credentials not found at: {cred_path}\n"
            f"Set FIREBASE_CREDENTIALS env var or place "
            f"firebase-service-account.json in the project root."
        )

    cred = credentials.Certificate(cred_path)
    _app = firebase_admin.initialize_app(cred, {
        'storageBucket': FIREBASE_STORAGE_BUCKET,
    })
    return _app


def get_firestore_client():
    """Get a Firestore client."""
    get_firebase_app()
    return firestore.client()


def get_storage_bucket():
    """Get a Firebase Storage bucket."""
    get_firebase_app()
    return storage.bucket()

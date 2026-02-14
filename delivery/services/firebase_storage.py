"""
Firebase Storage service for listing and downloading delivery files.
"""

import json
import os
from pathlib import Path
from typing import List, Optional
from datetime import datetime

from delivery.config import STORAGE_INCOMING, STORAGE_PROCESSED, TEMP_DIR
from delivery.models import StorageFile


class FirebaseStorageService:
    """Service for interacting with Firebase Storage delivery files."""

    def __init__(self, bucket):
        self.bucket = bucket

    def list_incoming_files(self) -> List[StorageFile]:
        """List PDF/CSV files in the incoming folder."""
        blobs = self.bucket.list_blobs(prefix=STORAGE_INCOMING + "/")
        files = []
        for blob in blobs:
            # Skip the directory itself
            if blob.name.endswith('/'):
                continue
            # Only include PDF and CSV files
            name = blob.name.split('/')[-1]
            if not (name.lower().endswith('.pdf') or name.lower().endswith('.csv')):
                continue
            files.append(StorageFile(
                name=name,
                path=blob.name,
                size=blob.size,
                updated=blob.updated,
                content_type=blob.content_type,
            ))
        return sorted(files, key=lambda f: f.updated or datetime.min, reverse=True)

    def download_file(self, firebase_path: str) -> str:
        """
        Download a file from Firebase Storage to local temp directory.

        Returns the local file path.
        """
        blob = self.bucket.blob(firebase_path)
        if not blob.exists():
            raise FileNotFoundError(f"File not found in Firebase Storage: {firebase_path}")

        filename = firebase_path.split('/')[-1]
        local_path = TEMP_DIR / filename

        blob.download_to_filename(str(local_path))
        return str(local_path)

    def move_to_processed(self, firebase_path: str) -> str:
        """
        Move a file from incoming to processed folder.

        Returns the new path.
        """
        filename = firebase_path.split('/')[-1]
        new_path = STORAGE_PROCESSED + "/" + filename

        source_blob = self.bucket.blob(firebase_path)
        self.bucket.copy_blob(source_blob, self.bucket, new_path)
        source_blob.delete()

        return new_path

    def get_latest_file(self) -> Optional[StorageFile]:
        """Get the most recently uploaded file in incoming."""
        files = self.list_incoming_files()
        return files[0] if files else None

    def upload_exception_report(self, delivery_id: str, report_data: dict) -> str:
        """
        Upload an exception report JSON file to Firebase Storage.

        Returns the storage path.
        """
        path = f"delivery-files/reports/{delivery_id}/exception_report.json"
        blob = self.bucket.blob(path)
        blob.upload_from_string(
            json.dumps(report_data, indent=2, default=str),
            content_type="application/json",
        )
        return path

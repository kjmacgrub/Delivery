"""
Daily Log service: assembles and stores daily snapshots combining
delivery exceptions, processing data, and notes from both apps.

Stored in Firestore collection 'dailyLogs' with 7-day retention.
"""

import base64
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Dict

from delivery.models import Delivery, ReceivedStatus


class DailyLogService:
    """Manages daily log snapshots in Firestore."""

    COLLECTION = "dailyLogs"
    STORAGE_PREFIX = "daily-logs"

    def __init__(self, firestore_client=None, storage_bucket=None):
        self._db = firestore_client
        self._bucket = storage_bucket

    @property
    def _use_firestore(self) -> bool:
        return self._db is not None

    # ---- Snapshot: Delivery Data ----

    def snapshot_delivery(self, delivery: Delivery) -> dict:
        """
        Snapshot delivery data into a daily log entry.
        Creates or updates the log for the delivery's date.
        """
        if not self._use_firestore or not delivery.delivery_date:
            return {}

        date_key = delivery.delivery_date.isoformat()
        log_ref = self._db.collection(self.COLLECTION).document(date_key)

        # Build exception, pull, and O/S lists
        exceptions = []
        pulls = []
        oos_items = []
        total_items = 0
        total_cases_expected = 0
        total_cases_received = 0
        total_items_received = 0

        for supplier in delivery.suppliers:
            for item in supplier.items:
                total_items += 1
                total_cases_expected += item.quantity_expected

                if item.quantity_received is not None:
                    total_items_received += 1
                    total_cases_received += item.quantity_received

                if item.received_status not in (ReceivedStatus.PENDING, ReceivedStatus.OK):
                    exceptions.append({
                        "supplierName": supplier.supplier_name,
                        "rawDescription": item.raw_description,
                        "quantityExpected": item.quantity_expected,
                        "quantityReceived": item.quantity_received,
                        "receivedStatus": item.received_status.value if item.received_status else None,
                        "receivedNotes": item.received_notes,
                        "checkedInAt": item.checked_in_at.isoformat() if item.checked_in_at else None,
                    })

                if item.pull_quantity and item.pull_quantity > 0:
                    pulls.append({
                        "supplierName": supplier.supplier_name,
                        "rawDescription": item.raw_description,
                        "pullQuantity": item.pull_quantity,
                        "pullConfirmed": item.pull_confirmed,
                        "pullSubmitted": item.pull_submitted,
                    })

                if item.received_notes and "O/S" in item.received_notes:
                    oos_items.append({
                        "supplierName": supplier.supplier_name,
                        "rawDescription": item.raw_description,
                        "quantityExpected": item.quantity_expected,
                    })

        metadata = {
            "date": date_key,
            "dayOfWeek": delivery.day_of_week,
            "deliveryId": delivery.id,
            "sourceFilename": delivery.source_filename,
            "snapshotAt": datetime.now(timezone.utc).isoformat(),
            "totalItemsExpected": total_items,
            "totalCasesExpected": total_cases_expected,
            "totalItemsReceived": total_items_received,
            "totalCasesReceived": total_cases_received,
            "status": "complete" if delivery.status.value == "COMPLETED" else "partial",
        }

        # Write metadata
        log_ref.set(metadata, merge=True)

        # Write subcollections
        for i, exc in enumerate(exceptions):
            log_ref.collection("exceptions").document(f"exc-{i}").set(exc)

        for i, pull in enumerate(pulls):
            log_ref.collection("pulls").document(f"pull-{i}").set(pull)

        for i, oos in enumerate(oos_items):
            log_ref.collection("outOfStock").document(f"oos-{i}").set(oos)

        return metadata

    # ---- Snapshot: Processing Data ----

    def snapshot_processing(self, date_key: str, data: dict) -> dict:
        """
        Snapshot produce processing data into the daily log.

        data = {
            "completedItems": [{ "sku", "itemName", "cases", "completedAt", ... }],
            "timingEvents": { "sku": [{ "totalTime", "cases", "timePerCase" }] },
            "notes": { "itemNotes": {...}, "freeformNotes": {...} },
            "photos": { "sku": "base64data" }  -- optional
        }
        """
        if not self._use_firestore:
            return {}

        log_ref = self._db.collection(self.COLLECTION).document(date_key)

        # Ensure metadata exists
        doc = log_ref.get()
        if not doc.exists:
            log_ref.set({
                "date": date_key,
                "snapshotAt": datetime.now(timezone.utc).isoformat(),
                "status": "partial",
            })

        # Update processing counts in metadata
        completed = data.get("completedItems", [])
        total_cases_processed = sum(item.get("cases", 0) for item in completed)
        log_ref.update({
            "totalItemsProcessed": len(completed),
            "totalCasesProcessed": total_cases_processed,
            "processingSnapshotAt": datetime.now(timezone.utc).isoformat(),
        })

        # Write processing subcollection
        timing_events = data.get("timingEvents", {})
        photos = data.get("photos", {})

        for item in completed:
            sku = item.get("sku", "")
            if not sku:
                continue

            # Get timing for this SKU
            sku_timing = timing_events.get(sku, [])
            total_time = None
            time_per_case = None
            if sku_timing:
                last_event = sku_timing[-1] if isinstance(sku_timing, list) else sku_timing
                total_time = last_event.get("totalTime")
                time_per_case = last_event.get("timePerCase")

            # Upload photo if provided
            photo_url = None
            if sku in photos and photos[sku] and self._bucket:
                photo_url = self._upload_photo(date_key, sku, photos[sku])

            proc_doc = {
                "itemName": item.get("itemName", item.get("name", "")),
                "cases": item.get("cases", 0),
                "completedAt": item.get("completedAt"),
                "totalTime": total_time,
                "timePerCase": time_per_case,
                "photoUrl": photo_url,
                "carryover": item.get("carryover", False),
            }
            log_ref.collection("processing").document(sku).set(proc_doc)

        # Write notes
        notes_data = data.get("notes", {})
        item_notes = notes_data.get("itemNotes", {})
        freeform_notes = notes_data.get("freeformNotes", {})

        for item_id, note in item_notes.items():
            log_ref.collection("notes").document(f"item-{item_id}").set({
                "type": "item",
                "source": "produce-processor",
                "itemName": note.get("itemName"),
                "itemSku": item_id,
                "text": note.get("text", ""),
                "createdAt": note.get("updatedAt", datetime.now(timezone.utc).isoformat()),
            })

        for note_id, note in freeform_notes.items():
            log_ref.collection("notes").document(f"free-{note_id}").set({
                "type": "freeform",
                "source": "produce-processor",
                "itemName": None,
                "itemSku": None,
                "text": note.get("text", ""),
                "createdAt": note.get("createdAt", datetime.now(timezone.utc).isoformat()),
            })

        return {"itemsProcessed": len(completed), "casesProcessed": total_cases_processed}

    # ---- Add a single note ----

    def add_note(self, date_key: str, note_data: dict) -> dict:
        """Add a single note to the daily log."""
        if not self._use_firestore:
            return {}

        log_ref = self._db.collection(self.COLLECTION).document(date_key)

        # Ensure log doc exists
        doc = log_ref.get()
        if not doc.exists:
            log_ref.set({
                "date": date_key,
                "snapshotAt": datetime.now(timezone.utc).isoformat(),
                "status": "partial",
            })

        note_id = f"{note_data.get('type', 'note')}-{str(uuid.uuid4())[:8]}"
        note_doc = {
            "type": note_data.get("type", "freeform"),
            "source": note_data.get("source", "unknown"),
            "itemName": note_data.get("itemName"),
            "itemSku": note_data.get("itemSku"),
            "text": note_data.get("text", ""),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        log_ref.collection("notes").document(note_id).set(note_doc)
        return {"noteId": note_id, **note_doc}

    # ---- Read ----

    def list_logs(self, days: int = 7) -> list:
        """List available daily logs with summary info."""
        if not self._use_firestore:
            return []

        cutoff = (date.today() - timedelta(days=days)).isoformat()
        docs = (
            self._db.collection(self.COLLECTION)
            .where("date", ">=", cutoff)
            .order_by("date", direction="DESCENDING")
            .stream()
        )

        logs = []
        for doc in docs:
            data = doc.to_dict()
            # Count subcollections
            exc_count = len(list(doc.reference.collection("exceptions").stream()))
            note_count = len(list(doc.reference.collection("notes").stream()))
            proc_count = len(list(doc.reference.collection("processing").stream()))
            pull_count = len(list(doc.reference.collection("pulls").stream()))

            logs.append({
                "date": data.get("date"),
                "dayOfWeek": data.get("dayOfWeek", ""),
                "status": data.get("status", "partial"),
                "snapshotAt": data.get("snapshotAt"),
                "totalItemsExpected": data.get("totalItemsExpected", 0),
                "totalCasesExpected": data.get("totalCasesExpected", 0),
                "totalItemsProcessed": data.get("totalItemsProcessed", 0),
                "totalCasesProcessed": data.get("totalCasesProcessed", 0),
                "exceptionCount": exc_count,
                "noteCount": note_count,
                "processingCount": proc_count,
                "pullCount": pull_count,
            })

        return logs

    def get_log(self, date_key: str) -> Optional[dict]:
        """Get full daily log for a date, including all subcollections."""
        if not self._use_firestore:
            return None

        log_ref = self._db.collection(self.COLLECTION).document(date_key)
        doc = log_ref.get()
        if not doc.exists:
            return None

        data = doc.to_dict()

        # Load subcollections
        data["exceptions"] = [d.to_dict() for d in log_ref.collection("exceptions").stream()]
        data["pulls"] = [d.to_dict() for d in log_ref.collection("pulls").stream()]
        data["processing"] = [d.to_dict() for d in log_ref.collection("processing").stream()]
        data["notes"] = [d.to_dict() for d in log_ref.collection("notes").stream()]
        data["outOfStock"] = [d.to_dict() for d in log_ref.collection("outOfStock").stream()]

        return data

    def get_log_section(self, date_key: str, section: str) -> Optional[list]:
        """Get a single subcollection from a daily log."""
        if not self._use_firestore:
            return None

        valid_sections = {"exceptions", "pulls", "processing", "notes", "outOfStock"}
        if section not in valid_sections:
            return None

        log_ref = self._db.collection(self.COLLECTION).document(date_key)
        doc = log_ref.get()
        if not doc.exists:
            return None

        return [d.to_dict() for d in log_ref.collection(section).stream()]

    def search_logs(self, query: str, days: int = 7) -> list:
        """Search across all recent daily logs for items matching a query string.

        Returns a list of matches grouped by date, each with the section
        type (exception, pull, processing, note, outOfStock) and item data.
        """
        if not self._use_firestore or not query:
            return []

        q = query.lower()
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        docs = (
            self._db.collection(self.COLLECTION)
            .where("date", ">=", cutoff)
            .order_by("date", direction="DESCENDING")
            .stream()
        )

        results = []
        for doc in docs:
            meta = doc.to_dict()
            date_key = meta.get("date", doc.id)
            day_of_week = meta.get("dayOfWeek", "")
            ref = doc.reference

            day_hits = []

            # Search name-bearing subcollections
            for sub, name_field in [
                ("exceptions", "rawDescription"),
                ("pulls", "rawDescription"),
                ("processing", "itemName"),
                ("outOfStock", "rawDescription"),
            ]:
                for sub_doc in ref.collection(sub).stream():
                    d = sub_doc.to_dict()
                    name_val = (d.get(name_field) or "").lower()
                    supplier_val = (d.get("supplierName") or "").lower()
                    if q in name_val or q in supplier_val:
                        day_hits.append({"section": sub, **d})

            # Search notes by itemName or text
            for sub_doc in ref.collection("notes").stream():
                d = sub_doc.to_dict()
                item_name = (d.get("itemName") or "").lower()
                text = (d.get("text") or "").lower()
                if q in item_name or q in text:
                    day_hits.append({"section": "notes", **d})

            if day_hits:
                results.append({
                    "date": date_key,
                    "dayOfWeek": day_of_week,
                    "hits": day_hits,
                })

        return results

    # ---- Cleanup ----

    def cleanup_old_logs(self, retention_days: int = 7) -> int:
        """Delete daily logs older than retention_days. Returns count deleted."""
        if not self._use_firestore:
            return 0

        cutoff = (date.today() - timedelta(days=retention_days)).isoformat()
        old_docs = (
            self._db.collection(self.COLLECTION)
            .where("date", "<", cutoff)
            .stream()
        )

        deleted = 0
        for doc in old_docs:
            date_key = doc.id
            # Delete subcollections first
            for sub in ("exceptions", "pulls", "processing", "notes", "outOfStock"):
                for sub_doc in doc.reference.collection(sub).stream():
                    sub_doc.reference.delete()

            # Delete photos from Storage
            if self._bucket:
                self._delete_photos(date_key)

            # Delete the log document
            doc.reference.delete()
            deleted += 1

        return deleted

    # ---- Photo helpers ----

    def _upload_photo(self, date_key: str, sku: str, base64_data: str) -> Optional[str]:
        """Upload a base64 photo to Storage, return public URL."""
        if not self._bucket:
            return None

        try:
            # Strip data URI prefix if present
            if "," in base64_data:
                base64_data = base64_data.split(",", 1)[1]

            image_bytes = base64.b64decode(base64_data)
            blob_path = f"{self.STORAGE_PREFIX}/{date_key}/{sku}.jpg"
            blob = self._bucket.blob(blob_path)
            blob.upload_from_string(image_bytes, content_type="image/jpeg")
            blob.make_public()
            return blob.public_url
        except Exception:
            return None

    def _delete_photos(self, date_key: str):
        """Delete all photos for a date from Storage."""
        if not self._bucket:
            return

        prefix = f"{self.STORAGE_PREFIX}/{date_key}/"
        blobs = self._bucket.list_blobs(prefix=prefix)
        for blob in blobs:
            try:
                blob.delete()
            except Exception:
                pass

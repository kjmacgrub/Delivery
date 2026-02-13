"""
Delivery service: orchestrates parsing, storage, and check-in workflows.

Supports both in-memory (for testing) and Firestore (for production) persistence.
"""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from delivery.parser.pdf_parser import PDFWorksheetParser
from delivery.parser.product_parser import ProductDescriptionParser
from delivery.models import (
    Delivery, DeliveryStatus, DeliverySummary,
    SupplierEntry, SupplierStatus,
    LineItem, ReceivedStatus,
    LineItemCheckIn,
)


class DeliveryService:
    """
    Business logic for delivery worksheet operations.

    Handles:
    - Parsing PDF/CSV files into structured data
    - Storing parsed data in Firestore (or in-memory fallback)
    - Check-in workflow for receiving
    """

    COLLECTION = "deliveries"

    def __init__(self, firestore_client=None):
        self.pdf_parser = PDFWorksheetParser()
        self._db = firestore_client
        # In-memory cache
        self._cache: dict = {}

    @property
    def _use_firestore(self) -> bool:
        return self._db is not None

    # ---- Persistence helpers ----

    def _save_delivery(self, delivery: Delivery):
        """Save delivery to Firestore and cache."""
        self._cache[delivery.id] = delivery
        if self._use_firestore:
            doc_ref = self._db.collection(self.COLLECTION).document(delivery.id)
            doc_ref.set(self._delivery_to_dict(delivery))

    def _load_delivery(self, delivery_id: str) -> Optional[Delivery]:
        """Load delivery from cache or Firestore."""
        if delivery_id in self._cache:
            return self._cache[delivery_id]
        if self._use_firestore:
            doc = self._db.collection(self.COLLECTION).document(delivery_id).get()
            if doc.exists:
                delivery = self._dict_to_delivery(doc.to_dict())
                self._cache[delivery_id] = delivery
                return delivery
        return None

    def _delivery_to_dict(self, delivery: Delivery) -> dict:
        """Convert Delivery model to Firestore-compatible dict."""
        d = delivery.model_dump(mode="json")
        # Firestore doesn't support date objects directly in all SDKs;
        # model_dump(mode="json") converts to ISO strings which work fine.
        return d

    def _dict_to_delivery(self, data: dict) -> Delivery:
        """Convert Firestore dict back to Delivery model."""
        return Delivery.model_validate(data)

    # ---- Core operations ----

    def parse_local_file(self, file_path: str) -> Delivery:
        """
        Parse a local PDF file and store the result.

        Returns the created Delivery object.
        """
        path = Path(file_path)

        # Choose parser based on file extension
        if path.suffix.lower() == '.pdf':
            raw = self.pdf_parser.parse(file_path)
        elif path.suffix.lower() == '.csv':
            raise NotImplementedError("CSV parser not yet implemented")
        else:
            raise ValueError(f"Unsupported file type: {path.suffix}")

        # Convert raw dict to model objects
        delivery = self._raw_to_delivery(raw)
        delivery.source_filename = path.name
        delivery.parsed_at = datetime.utcnow()

        # Persist
        self._save_delivery(delivery)
        return delivery

    def get_delivery(self, delivery_id: str) -> Optional[Delivery]:
        """Get a delivery by ID."""
        return self._load_delivery(delivery_id)

    def list_deliveries(self) -> List[DeliverySummary]:
        """List all deliveries as summaries."""
        deliveries = {}

        # Load from Firestore if available
        if self._use_firestore:
            docs = self._db.collection(self.COLLECTION).stream()
            for doc in docs:
                data = doc.to_dict()
                delivery = self._dict_to_delivery(data)
                self._cache[delivery.id] = delivery
                deliveries[delivery.id] = delivery
        else:
            deliveries = self._cache

        summaries = []
        for d in deliveries.values():
            total_items = sum(len(s.items) for s in d.suppliers)
            checked_in = sum(
                1 for s in d.suppliers
                for it in s.items
                if it.received_status != ReceivedStatus.PENDING
            )
            summaries.append(DeliverySummary(
                id=d.id,
                day_of_week=d.day_of_week,
                delivery_date=d.delivery_date,
                total_cases_expected=d.total_cases_expected,
                source_filename=d.source_filename,
                status=d.status,
                parsed_at=d.parsed_at,
                supplier_count=len(d.suppliers),
                item_count=total_items,
                checked_in_count=checked_in,
            ))
        return sorted(summaries, key=lambda s: s.parsed_at or datetime.min, reverse=True)

    def check_in_item(
        self, delivery_id: str, supplier_idx: int,
        item_idx: int, check_in: LineItemCheckIn
    ) -> Optional[LineItem]:
        """
        Check in a single line item.

        Args:
            delivery_id: The delivery ID
            supplier_idx: Index of the supplier block (0-based)
            item_idx: Index of the item within the supplier (0-based)
            check_in: The check-in data
        """
        delivery = self._load_delivery(delivery_id)
        if not delivery:
            return None

        if supplier_idx >= len(delivery.suppliers):
            return None

        supplier = delivery.suppliers[supplier_idx]
        if item_idx >= len(supplier.items):
            return None

        item = supplier.items[item_idx]
        item.quantity_received = check_in.quantity_received
        item.received_status = check_in.received_status
        item.received_notes = check_in.received_notes
        item.checked_in_at = datetime.utcnow()

        # Update supplier status
        all_checked = all(
            it.received_status != ReceivedStatus.PENDING
            for it in supplier.items
        )
        if all_checked:
            supplier.status = SupplierStatus.COMPLETE
        else:
            supplier.status = SupplierStatus.CHECKED_IN

        # Update delivery status
        all_suppliers_done = all(
            s.status == SupplierStatus.COMPLETE
            for s in delivery.suppliers
        )
        if all_suppliers_done:
            delivery.status = DeliveryStatus.COMPLETED
        else:
            delivery.status = DeliveryStatus.IN_PROGRESS

        # Persist changes
        self._save_delivery(delivery)
        return item

    def delete_delivery(self, delivery_id: str) -> bool:
        """Delete a delivery."""
        if delivery_id in self._cache:
            del self._cache[delivery_id]
        if self._use_firestore:
            self._db.collection(self.COLLECTION).document(delivery_id).delete()
            return True
        return True

    def _raw_to_delivery(self, raw: dict) -> Delivery:
        """Convert raw parser output dict to Delivery model."""
        header = raw['header']
        delivery_id = str(uuid.uuid4())[:8]

        suppliers = []
        for sb in raw['supplier_blocks']:
            supplier_id = str(uuid.uuid4())[:8]
            items = []
            for it in sb['items']:
                item_id = str(uuid.uuid4())[:8]
                items.append(LineItem(
                    id=item_id,
                    supplier_entry_id=supplier_id,
                    quantity_expected=it['quantity_expected'],
                    category=it['category'],
                    raw_description=it['raw_description'],
                    product_type=it.get('product_type', ''),
                    variety=it.get('variety'),
                    size_packaging=it.get('size_packaging'),
                    organic_status=it.get('organic_status'),
                    brand=it.get('brand'),
                    plu_code=it.get('plu_code'),
                    special_notes=it.get('special_notes'),
                    needs_processing=it.get('needs_processing', False),
                    pull_for_floor=it.get('pull_for_floor', False),
                    line_sequence=it.get('line_sequence', 0),
                ))

            suppliers.append(SupplierEntry(
                id=supplier_id,
                delivery_id=delivery_id,
                supplier_name=sb['supplier_name'],
                expected_cases=sb['expected_cases'],
                block_sequence=sb['block_sequence'],
                items=items,
            ))

        from datetime import date as date_type
        delivery_date = None
        if header.get('delivery_date'):
            dd = header['delivery_date']
            if isinstance(dd, str):
                delivery_date = date_type.fromisoformat(dd)
            else:
                delivery_date = dd

        return Delivery(
            id=delivery_id,
            day_of_week=header.get('day_of_week', ''),
            delivery_date=delivery_date,
            day_number=header.get('day_number'),
            week_number=header.get('week_number'),
            total_cases_expected=header.get('total_cases_expected', 0),
            source_filename=raw.get('source_filename', ''),
            suppliers=suppliers,
        )

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
    ExceptionReport, ExceptionItem,
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
    REPORTS_COLLECTION = "delivery_reports"

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

        # Check for existing non-completed delivery on the same date
        if delivery.delivery_date:
            existing = self.list_deliveries()
            for d in existing:
                if (d.delivery_date == delivery.delivery_date
                        and d.status != DeliveryStatus.COMPLETED):
                    raise ValueError(
                        f"Delivery already in progress for {delivery.day_of_week} "
                        f"{delivery.delivery_date}"
                    )

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
        if check_in.pull_confirmed is not None:
            item.pull_confirmed = check_in.pull_confirmed

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

    def toggle_pull_confirmed(
        self, delivery_id: str, supplier_idx: int, item_idx: int
    ) -> Optional[LineItem]:
        """Toggle pull_confirmed on a single item without affecting received status."""
        delivery = self._load_delivery(delivery_id)
        if not delivery:
            return None
        if supplier_idx >= len(delivery.suppliers):
            return None
        supplier = delivery.suppliers[supplier_idx]
        if item_idx >= len(supplier.items):
            return None

        item = supplier.items[item_idx]
        item.pull_confirmed = not item.pull_confirmed
        self._save_delivery(delivery)
        return item

    def check_in_all_ok(
        self, delivery_id: str, supplier_idx: int
    ) -> int:
        """
        Bulk check-in: mark all pending items in a supplier as received OK.
        Saves to Firestore only once at the end.

        Returns the number of items updated.
        """
        delivery = self._load_delivery(delivery_id)
        if not delivery:
            return 0

        if supplier_idx >= len(delivery.suppliers):
            return 0

        supplier = delivery.suppliers[supplier_idx]
        count = 0
        for item in supplier.items:
            if item.received_status == ReceivedStatus.PENDING:
                item.quantity_received = item.quantity_expected
                item.received_status = ReceivedStatus.OK
                item.checked_in_at = datetime.utcnow()
                count += 1

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

        # Single Firestore write
        self._save_delivery(delivery)
        return count

    def unreceive_all(
        self, delivery_id: str, supplier_idx: int
    ) -> int:
        """
        Bulk unreceive: reset all received items in a supplier back to pending.
        Saves to Firestore only once at the end.

        Returns the number of items updated.
        """
        delivery = self._load_delivery(delivery_id)
        if not delivery:
            return 0

        if supplier_idx >= len(delivery.suppliers):
            return 0

        supplier = delivery.suppliers[supplier_idx]
        count = 0
        for item in supplier.items:
            if item.received_status != ReceivedStatus.PENDING:
                item.quantity_received = None
                item.received_status = ReceivedStatus.PENDING
                item.received_notes = None
                item.checked_in_at = None
                count += 1

        # Update supplier status
        supplier.status = SupplierStatus.PENDING

        # Update delivery status
        all_suppliers_done = all(
            s.status == SupplierStatus.COMPLETE
            for s in delivery.suppliers
        )
        if all_suppliers_done:
            delivery.status = DeliveryStatus.COMPLETED
        elif any(
            s.status != SupplierStatus.PENDING
            for s in delivery.suppliers
        ):
            delivery.status = DeliveryStatus.IN_PROGRESS
        else:
            delivery.status = DeliveryStatus.PARSED

        # Single Firestore write
        self._save_delivery(delivery)
        return count

    def unreceive_item(
        self, delivery_id: str, supplier_idx: int, item_idx: int
    ) -> Optional[LineItem]:
        """
        Unreceive a single line item: reset it back to pending.

        Returns the updated item, or None if not found.
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
        item.quantity_received = None
        item.received_status = ReceivedStatus.PENDING
        item.received_notes = None
        item.checked_in_at = None
        item.pull_confirmed = False

        # Update supplier status
        all_checked = all(
            it.received_status != ReceivedStatus.PENDING
            for it in supplier.items
        )
        any_checked = any(
            it.received_status != ReceivedStatus.PENDING
            for it in supplier.items
        )
        if all_checked:
            supplier.status = SupplierStatus.COMPLETE
        elif any_checked:
            supplier.status = SupplierStatus.CHECKED_IN
        else:
            supplier.status = SupplierStatus.PENDING

        # Update delivery status
        all_suppliers_done = all(
            s.status == SupplierStatus.COMPLETE
            for s in delivery.suppliers
        )
        if all_suppliers_done:
            delivery.status = DeliveryStatus.COMPLETED
        elif any(
            s.status != SupplierStatus.PENDING
            for s in delivery.suppliers
        ):
            delivery.status = DeliveryStatus.IN_PROGRESS
        else:
            delivery.status = DeliveryStatus.PARSED

        self._save_delivery(delivery)
        return item

    def complete_delivery(self, delivery_id: str) -> Optional[ExceptionReport]:
        """
        Mark delivery as complete and generate an exception report.

        Validates all items are checked in, then creates a report
        of items with discrepancies (short, over, return).
        """
        delivery = self._load_delivery(delivery_id)
        if not delivery:
            return None

        # Validate: all items must be non-pending
        for supplier in delivery.suppliers:
            for item in supplier.items:
                if item.received_status == ReceivedStatus.PENDING:
                    raise ValueError(
                        f"Cannot complete: item '{item.raw_description}' "
                        f"in {supplier.supplier_name} is still pending"
                    )

        # Build exception list
        exceptions = []
        total_items = 0
        for supplier in delivery.suppliers:
            for item in supplier.items:
                total_items += 1
                if item.received_status != ReceivedStatus.OK:
                    exceptions.append(ExceptionItem(
                        supplier_name=supplier.supplier_name,
                        raw_description=item.raw_description,
                        quantity_expected=item.quantity_expected,
                        quantity_received=item.quantity_received,
                        received_status=item.received_status,
                        received_notes=item.received_notes,
                    ))

        report_id = str(uuid.uuid4())[:8]
        report = ExceptionReport(
            id=report_id,
            delivery_id=delivery_id,
            delivery_date=delivery.delivery_date,
            day_of_week=delivery.day_of_week,
            source_filename=delivery.source_filename,
            completed_at=datetime.utcnow(),
            total_items=total_items,
            total_exceptions=len(exceptions),
            exception_items=exceptions,
        )

        # Save report to Firestore
        if self._use_firestore:
            doc_ref = self._db.collection(self.REPORTS_COLLECTION).document(report_id)
            doc_ref.set(report.model_dump(mode="json"))

        # Update delivery status
        delivery.status = DeliveryStatus.COMPLETED
        self._save_delivery(delivery)

        return report

    def delete_delivery(self, delivery_id: str) -> bool:
        """Delete a delivery and any associated exception reports."""
        if delivery_id in self._cache:
            del self._cache[delivery_id]
        if self._use_firestore:
            self._db.collection(self.COLLECTION).document(delivery_id).delete()
            # Clean up any exception reports for this delivery
            reports = self._db.collection(self.REPORTS_COLLECTION).where(
                "delivery_id", "==", delivery_id
            ).stream()
            for report_doc in reports:
                report_doc.reference.delete()
            return True
        return True

    def list_reports(self) -> list:
        """List all exception reports, newest first."""
        if not self._use_firestore:
            return []
        docs = self._db.collection(self.REPORTS_COLLECTION).order_by(
            "completed_at", direction="DESCENDING"
        ).stream()
        reports = []
        for doc in docs:
            reports.append(doc.to_dict())
        return reports

    def delete_report(self, report_id: str) -> bool:
        """Delete a single exception report."""
        if not self._use_firestore:
            return False
        self._db.collection(self.REPORTS_COLLECTION).document(report_id).delete()
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
                    pull_quantity=it.get('pull_quantity'),
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

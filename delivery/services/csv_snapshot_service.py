"""
CSV snapshot service.

When a v2 CSV is consumed, the parsed items are persisted to a
`delivery_csv_snapshots/{YYYY-MM-DD}` Firestore document. This snapshot is the
immutable "original" against which the in-process check (CSV_IMPORT_POLICY.md
§5) diffs the current delivery state.

Doc shape:
    delivery_csv_snapshots/2026-05-25
        delivery_date: "2026-05-25"
        source_filename: "delivery_mon-2026-05-25.csv"
        source_path: "delivery-files/incoming-v2/delivery_mon-2026-05-25.csv"
        generated_at: "2026-05-24T13:49:00" | null
        format_version: 1
        consumed_at: "2026-05-25T05:12:33Z"
        items: { "<item_id>": { ...csv columns... }, ... }
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from delivery.models import Delivery, ReceivedStatus, SupplierStatus


log = logging.getLogger(__name__)

COLLECTION = "delivery_csv_snapshots"

# CSV columns persisted into the snapshot's items map.
_SNAPSHOT_FIELDS = [
    "item_id", "item_name", "supplier", "department", "category", "plu_code",
    "growing_method", "quantity_expected", "unit", "case_size", "bin_size",
    "basement_location", "floor_location", "pull_quantity",
    "high_count_day1", "high_count_day2", "high_count_day3",
    "processing_instructions",
]


class CSVSnapshotService:
    """Read/write/diff for the per-date CSV snapshot."""

    def __init__(self, firestore_client=None):
        self._db = firestore_client

    # ---- Persistence ----

    def write_snapshot(self, parsed_csv: dict, source_path: str) -> dict:
        """Persist a parsed CSV as the snapshot for its delivery date.

        Overwrites any existing snapshot for the same date — the most recently
        consumed CSV is always the source of truth.
        """
        header = parsed_csv["header"]
        delivery_date = header["delivery_date"]
        if not delivery_date:
            raise ValueError("Cannot snapshot a CSV with no delivery_date")

        items_by_id = {}
        for block in parsed_csv["supplier_blocks"]:
            for raw in block["items"]:
                item_id = (raw.get("item_id") or "").strip()
                if not item_id:
                    log.warning(
                        "Snapshot skipping item with empty item_id: %s",
                        raw.get("raw_description"),
                    )
                    continue
                items_by_id[item_id] = {k: raw.get(k) for k in _SNAPSHOT_FIELDS}

        meta = parsed_csv.get("csv_metadata", {})
        doc = {
            "delivery_date": delivery_date,
            "source_filename": parsed_csv.get("source_filename", ""),
            "source_path": source_path,
            "generated_at": meta.get("generated_at"),
            "format_version": meta.get("format_version"),
            "consumed_at": datetime.now(timezone.utc).isoformat(),
            "items": items_by_id,
        }

        if self._db is not None:
            self._db.collection(COLLECTION).document(delivery_date).set(doc)
        return doc

    def read_snapshot(self, delivery_date: str) -> Optional[dict]:
        """Load the snapshot for a date, or None if absent."""
        if self._db is None:
            return None
        doc = self._db.collection(COLLECTION).document(delivery_date).get()
        return doc.to_dict() if doc.exists else None

    # ---- In-process diff (CSV_IMPORT_POLICY.md §5) ----

    def is_in_process(self, delivery: Delivery, snapshot: Optional[dict]) -> dict:
        """Determine whether `delivery` has deviated from its CSV snapshot.

        Returns {in_process: bool, reasons: [str, ...]}.

        "Any deviation" check, in order of cheapness:
        1. App-only fields on items (received_status, quantity_received,
           received_notes, checked_in_at, pull_submitted, pull_confirmed) at
           non-default values.
        2. Supplier statuses past PENDING.
        3. Delivery-level notes.
        4. Item adds/deletes vs. snapshot (set diff on item_ids).
        5. Per-item field drift vs. snapshot (quantity_expected, raw_description,
           plu_code, needs_processing, pull_quantity, category).

        If `snapshot` is None, only steps 1-3 run — steps 4-5 require it.
        """
        reasons: list[str] = []

        # 1. App-only fields on items
        for s in delivery.suppliers:
            for it in s.items:
                if it.received_status != ReceivedStatus.PENDING:
                    reasons.append(f"item {it.id} received_status={it.received_status.value}")
                if it.quantity_received is not None:
                    reasons.append(f"item {it.id} has quantity_received")
                if it.received_notes:
                    reasons.append(f"item {it.id} has received_notes")
                if it.checked_in_at is not None:
                    reasons.append(f"item {it.id} checked_in_at set")
                if it.pull_submitted:
                    reasons.append(f"item {it.id} pull_submitted")
                if it.pull_confirmed:
                    reasons.append(f"item {it.id} pull_confirmed")
                if reasons:
                    return {"in_process": True, "reasons": reasons[:5]}

        # 2. Supplier status
        for s in delivery.suppliers:
            if s.status != SupplierStatus.PENDING:
                reasons.append(f"supplier {s.supplier_name} status={s.status.value}")
                return {"in_process": True, "reasons": reasons}

        # 3. Delivery-level notes
        if delivery.notes:
            return {"in_process": True, "reasons": ["delivery.notes set"]}

        # 4-5: require snapshot
        if snapshot is None:
            return {"in_process": False, "reasons": []}

        snapshot_items: dict = snapshot.get("items") or {}
        current_ids = {it.id for s in delivery.suppliers for it in s.items if it.id}
        snapshot_ids = set(snapshot_items.keys())

        added = current_ids - snapshot_ids
        removed = snapshot_ids - current_ids
        if added:
            return {"in_process": True, "reasons": [f"items added: {sorted(added)[:5]}"]}
        if removed:
            return {"in_process": True, "reasons": [f"items removed: {sorted(removed)[:5]}"]}

        # 5. Per-item field drift
        for s in delivery.suppliers:
            for it in s.items:
                snap = snapshot_items.get(it.id)
                if not snap:
                    continue
                drift = _item_drift(it, snap)
                if drift:
                    return {"in_process": True, "reasons": [f"item {it.id} drifted: {drift}"]}

        return {"in_process": False, "reasons": []}


def _item_drift(item, snap: dict) -> list[str]:
    """Return a list of field names that differ between a LineItem and its snapshot."""
    fields_changed = []

    # quantity_expected
    snap_qty = snap.get("quantity_expected")
    if snap_qty is not None and float(snap_qty) != float(item.quantity_expected):
        fields_changed.append("quantity_expected")

    # raw_description ←→ item_name
    if (snap.get("item_name") or "") != (item.raw_description or ""):
        fields_changed.append("raw_description")

    # plu_code
    if (snap.get("plu_code") or None) != (item.plu_code or None):
        fields_changed.append("plu_code")

    # needs_processing derived from processing_instructions
    snap_needs = bool((snap.get("processing_instructions") or "").strip())
    if snap_needs != bool(item.needs_processing):
        fields_changed.append("needs_processing")

    # pull_quantity (snapshot stores int from CSV; LineItem.pull_quantity may be None)
    snap_pull = snap.get("pull_quantity")
    snap_pull_norm = int(snap_pull) if snap_pull else 0
    cur_pull = int(item.pull_quantity) if item.pull_quantity else 0
    if snap_pull_norm != cur_pull:
        fields_changed.append("pull_quantity")

    # category ←→ department
    if (snap.get("department") or "") != (item.category or ""):
        fields_changed.append("category")

    return fields_changed

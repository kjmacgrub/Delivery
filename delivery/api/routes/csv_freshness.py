"""
CSV freshness endpoint — implements the on-visit decision tree from
CSV_IMPORT_POLICY.md §7. Returns an `action` the client should take plus
the context (current CSV in incoming-v2, currently loaded delivery).
"""

import logging
from datetime import date as date_type, datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from delivery.models import DeliveryStatus, ReceivedStatus, SupplierStatus
from delivery.services.csv_picker import pick_current_csv


router = APIRouter()
log = logging.getLogger(__name__)


class ConsumeRequest(BaseModel):
    source_path: str


class BulkReceiveRequest(BaseModel):
    delivery_id: str


@router.get("/csv-freshness")
def csv_freshness(request: Request) -> dict:
    """Compare the latest CSV in incoming-v2/ against the currently loaded delivery.

    Response shape:
        {
          "action": "load-silent" | "prompt" | "noop" | "no-csv",
          "csv":    {path, filename, delivery_date, generated_at, version} | null,
          "loaded": {delivery_id, delivery_date, status, in_process, in_process_reasons,
                     item_count, open_item_count} | null,
          "reason": <human-readable string explaining the action>
        }
    """
    storage = request.app.state.storage_service
    delivery_service = request.app.state.delivery_service
    if storage is None or delivery_service is None:
        raise HTTPException(status_code=503, detail="Storage or delivery service not configured")

    csv_candidate = pick_current_csv(storage.bucket)
    csv_info = _candidate_to_dict(csv_candidate) if csv_candidate else None

    loaded_delivery, loaded_info = _resolve_loaded(delivery_service)

    if csv_candidate is None:
        return {
            "action": "no-csv",
            "csv": None,
            "loaded": loaded_info,
            "reason": "No CSV found in incoming-v2/",
        }

    csv_date: date_type = csv_candidate.delivery_date

    if loaded_delivery is None or loaded_delivery.delivery_date is None:
        return {
            "action": "load-silent",
            "csv": csv_info,
            "loaded": loaded_info,
            "reason": "No delivery currently loaded",
        }

    loaded_date: date_type = loaded_delivery.delivery_date

    if csv_date == loaded_date:
        return {
            "action": "noop",
            "csv": csv_info,
            "loaded": loaded_info,
            "reason": "CSV date matches currently loaded date",
        }

    if csv_date < loaded_date:
        return {
            "action": "noop",
            "csv": csv_info,
            "loaded": loaded_info,
            "reason": "CSV date is older than currently loaded date",
        }

    # csv_date > loaded_date — check in-process
    snapshot = delivery_service.snapshot_service.read_snapshot(loaded_date.isoformat())
    diff = delivery_service.snapshot_service.is_in_process(loaded_delivery, snapshot)
    loaded_info = {**loaded_info, "in_process": diff["in_process"], "in_process_reasons": diff["reasons"]}

    if diff["in_process"]:
        return {
            "action": "prompt",
            "csv": csv_info,
            "loaded": loaded_info,
            "reason": "Newer CSV available; current day is in process",
        }

    return {
        "action": "load-silent",
        "csv": csv_info,
        "loaded": loaded_info,
        "reason": "Newer CSV available; current day has no edits",
    }


@router.post("/csv-consume")
def csv_consume(request: Request, body: ConsumeRequest) -> dict:
    """Download and load the CSV at `source_path` as a new Delivery.

    Caller is expected to have checked freshness first (and, for in-process
    days, performed the bulk-mark via §8). This endpoint just downloads,
    parses, persists the Delivery, and writes the CSV snapshot.
    """
    storage = request.app.state.storage_service
    delivery_service = request.app.state.delivery_service
    if storage is None or delivery_service is None:
        raise HTTPException(status_code=503, detail="Storage or delivery service not configured")

    if not body.source_path.startswith("delivery-files/incoming-v2/"):
        raise HTTPException(status_code=400, detail="source_path must be under incoming-v2/")

    try:
        local_path = storage.download_file(body.source_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"CSV not found: {body.source_path}")

    try:
        delivery = delivery_service.consume_csv(local_path, source_path=body.source_path)
    except Exception as e:
        log.exception("consume_csv failed for %s", body.source_path)
        raise HTTPException(status_code=500, detail=f"Failed to consume CSV: {e}")

    return {
        "delivery_id": delivery.id,
        "delivery_date": delivery.delivery_date.isoformat() if delivery.delivery_date else None,
        "item_count": sum(len(s.items) for s in delivery.suppliers),
        "source_path": body.source_path,
    }


@router.post("/csv-bulk-receive")
def csv_bulk_receive(request: Request, body: BulkReceiveRequest) -> dict:
    """Mark all remaining PENDING items as received OK, archive, and complete.

    CSV_IMPORT_POLICY.md §8 "Mark all received & load new worksheet" step.
    Archive happens BEFORE the mutation per §9 — if the archive write fails,
    nothing else runs and the caller is expected to keep the modal open.
    """
    delivery_service = request.app.state.delivery_service
    log_service = getattr(request.app.state, "daily_log_service", None)
    if delivery_service is None:
        raise HTTPException(status_code=503, detail="Delivery service not configured")

    delivery = delivery_service.get_delivery(body.delivery_id)
    if delivery is None:
        raise HTTPException(status_code=404, detail=f"Delivery not found: {body.delivery_id}")

    # §9: archive first.
    if log_service is not None:
        try:
            log_service.snapshot_delivery(delivery)
        except Exception as e:
            log.exception("Archive failed before bulk-receive on %s", body.delivery_id)
            raise HTTPException(status_code=500, detail=f"Archive failed: {e}")

    # Bulk-mark remaining PENDING items.
    now = datetime.now(timezone.utc)
    marked = 0
    for supplier in delivery.suppliers:
        for it in supplier.items:
            if it.received_status == ReceivedStatus.PENDING:
                it.received_status = ReceivedStatus.OK
                it.quantity_received = int(it.quantity_expected)
                it.checked_in_at = now
                marked += 1
        supplier.status = SupplierStatus.COMPLETE

    delivery.status = DeliveryStatus.COMPLETED
    if not delivery.completed_at:
        delivery.completed_at = now
    delivery_service._save_delivery(delivery)

    return {
        "delivery_id": delivery.id,
        "delivery_date": delivery.delivery_date.isoformat() if delivery.delivery_date else None,
        "items_marked": marked,
        "archived": log_service is not None,
    }


def _candidate_to_dict(c) -> dict:
    return {
        "path": c.path,
        "filename": c.filename,
        "delivery_date": c.delivery_date.isoformat(),
        "generated_at": c.generated_at.isoformat() if c.generated_at else None,
        "version": c.version,
    }


def _resolve_loaded(delivery_service) -> tuple:
    """Find the most recent delivery (any status) and compute item counts.

    Returns (Delivery|None, info_dict|None).
    """
    summaries = delivery_service.list_deliveries()
    # list_deliveries() already sorts by parsed_at desc — but for "loaded date"
    # we want the highest delivery_date. Pick that instead.
    dated = [s for s in summaries if s.delivery_date is not None]
    if not dated:
        return None, None
    dated.sort(key=lambda s: s.delivery_date, reverse=True)
    summary = dated[0]
    delivery = delivery_service.get_delivery(summary.id)
    if delivery is None:
        return None, None

    open_count = sum(
        1 for s in delivery.suppliers for it in s.items
        if it.received_status == ReceivedStatus.PENDING
    )
    return delivery, {
        "delivery_id": delivery.id,
        "delivery_date": delivery.delivery_date.isoformat() if delivery.delivery_date else None,
        "status": delivery.status.value,
        "in_process": None,  # filled in by caller when needed
        "in_process_reasons": [],
        "item_count": summary.item_count,
        "open_item_count": open_count,
    }

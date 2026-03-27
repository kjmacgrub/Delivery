"""
Daily Log endpoints: snapshot, read, and cleanup of daily reports
combining delivery exceptions and produce processing data.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List, Dict

router = APIRouter()


def _get_service(request: Request):
    return request.app.state.delivery_service


def _get_log_service(request: Request):
    return request.app.state.daily_log_service


# ---- Request models ----

class ProcessingSnapshotRequest(BaseModel):
    completedItems: List[dict] = []
    timingEvents: Dict[str, list] = {}
    notes: dict = {}
    photos: Dict[str, str] = {}


class NoteRequest(BaseModel):
    type: str = "freeform"  # "item" | "freeform" | "delivery"
    source: str = "unknown"  # "produce-processor" | "delivery"
    itemName: Optional[str] = None
    itemSku: Optional[str] = None
    text: str


# ---- Snapshot endpoints ----

@router.post("/daily-logs/{date_key}/snapshot-delivery")
async def snapshot_delivery(date_key: str, request: Request):
    """
    Snapshot current delivery data into the daily log.
    Finds the delivery matching the given date and captures
    exceptions, pulls, O/S items, and metadata.
    """
    service = _get_service(request)
    log_service = _get_log_service(request)

    # Find delivery for this date
    deliveries = service.list_deliveries()
    target = None
    for summary in deliveries:
        delivery = service.get_delivery(summary.id)
        if delivery and delivery.delivery_date and delivery.delivery_date.isoformat() == date_key:
            target = delivery
            break

    if not target:
        raise HTTPException(status_code=404, detail=f"No delivery found for date {date_key}")

    metadata = log_service.snapshot_delivery(target)
    return {"status": "ok", "metadata": metadata}


@router.post("/daily-logs/{date_key}/snapshot-processing")
async def snapshot_processing(date_key: str, body: ProcessingSnapshotRequest, request: Request):
    """
    Snapshot produce processing data into the daily log.
    Called by produce-processor app at end of day or during reckoning.
    """
    log_service = _get_log_service(request)
    result = log_service.snapshot_processing(date_key, body.model_dump())
    return {"status": "ok", **result}


@router.post("/daily-logs/{date_key}/notes")
async def add_note(date_key: str, body: NoteRequest, request: Request):
    """Add a single note to the daily log. Either app can call this."""
    log_service = _get_log_service(request)
    result = log_service.add_note(date_key, body.model_dump())
    return {"status": "ok", "note": result}


# ---- Read endpoints ----

@router.get("/daily-logs")
async def list_logs(request: Request):
    """List available daily logs with summary counts. Last 7 days."""
    log_service = _get_log_service(request)
    logs = log_service.list_logs()
    return {"logs": logs, "total": len(logs)}


@router.get("/daily-logs/search")
async def search_logs(q: str, request: Request):
    """Search across all recent daily logs for items matching a query.

    Returns matches grouped by date with section type and item details.
    Example: /daily-logs/search?q=asparagus
    """
    log_service = _get_log_service(request)
    results = log_service.search_logs(q)
    total_hits = sum(len(r["hits"]) for r in results)
    return {"query": q, "results": results, "totalHits": total_hits}


@router.get("/daily-logs/{date_key}")
async def get_log(date_key: str, request: Request):
    """Get full daily log for a date including all sections."""
    log_service = _get_log_service(request)
    log = log_service.get_log(date_key)
    if not log:
        raise HTTPException(status_code=404, detail=f"No log found for {date_key}")
    return log


@router.get("/daily-logs/{date_key}/{section}")
async def get_log_section(date_key: str, section: str, request: Request):
    """Get a single section of a daily log (exceptions, pulls, processing, notes, outOfStock)."""
    log_service = _get_log_service(request)
    data = log_service.get_log_section(date_key, section)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Section '{section}' not found for {date_key}")
    return {"items": data, "total": len(data)}


# ---- Cleanup ----

@router.delete("/daily-logs/cleanup")
async def cleanup_old_logs(request: Request):
    """Delete daily logs older than 7 days, including photos."""
    log_service = _get_log_service(request)
    deleted = log_service.cleanup_old_logs()
    return {"status": "ok", "deleted": deleted}

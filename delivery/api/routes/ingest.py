"""
Ingest endpoint for the IT-supplied combined CSV.

POST /ingest
  - Header: X-API-Key: <INGEST_API_KEY>
  - Body: multipart/form-data with field "file" (CSV)
  - Response: { "status": "ok", "path": "delivery-files/incoming-v2/<filename>", "size": N }

Sanity check: file must be non-empty UTF-8 and contain a `DELIVERY_WORKSHEET_V<n>`
marker within the first 500 bytes. Full schema validation happens at parse time.

Files that fail the sanity check are kept in delivery-files/rejected/ (prefixed
with the UTC receive time) so they can be inspected, and the 422 response says so.

IT's second nightly file (full-store inventory, extra `type` column, same
preamble) is routed to delivery-files/incoming-inventory/ instead, so the
worksheet picker never considers it. The response carries "kind": "inventory".

An upload whose filename already exists in incoming-v2/ never overwrites the
earlier file: it is stored as `<filename>__<UTC receive time>` instead. The CSV
picker chooses by preamble (delivery date, then generation time), not filename,
so both files remain candidates.
"""

import logging
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile

from delivery.config import STORAGE_INCOMING_INVENTORY, STORAGE_INCOMING_V2, STORAGE_REJECTED
from delivery.parser.csv_parser import is_inventory_file

log = logging.getLogger(__name__)
router = APIRouter()

_API_KEY = os.environ.get("INGEST_API_KEY")
_MARKER_RE = re.compile(r"DELIVERY_WORKSHEET_V\d+")


def _authenticate(api_key: str) -> None:
    if not _API_KEY:
        raise HTTPException(status_code=503, detail="Ingest API not configured")
    if api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _safe_name(filename: str) -> str:
    name = (filename or "upload").split("/")[-1].split("\\")[-1]
    return name or "upload"


def _reject(storage, filename: str, content: bytes, reason: str) -> None:
    """Keep the rejected upload for inspection, then raise 422."""
    name = _safe_name(filename)
    kept = f"{_utc_stamp()}_{name}"
    try:
        path = storage.upload_file(
            kept, content, "application/octet-stream", prefix=STORAGE_REJECTED
        )
    except Exception as e:  # noqa: BLE001 — never mask the 422 with a storage error
        log.warning("ingest: could not save rejected upload %s — %s", name, e)
        path = None
    log.warning(
        "ingest: rejected %s (%d bytes): %s%s",
        name, len(content), reason, f" — kept at {path}" if path else "",
    )
    detail = reason
    if path:
        detail += f". File kept for inspection at {path}"
    raise HTTPException(status_code=422, detail=detail)


@router.post("/ingest")
async def ingest(
    request: Request,
    file: UploadFile = File(...),
    x_api_key: str = Header(...),
):
    _authenticate(x_api_key)

    storage = request.app.state.storage_service
    if storage is None:
        raise HTTPException(status_code=503, detail="Storage not configured")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Empty file")

    try:
        head = content[:500].decode("utf-8")
    except UnicodeDecodeError:
        _reject(storage, file.filename, content, "File is not valid UTF-8")

    if not _MARKER_RE.search(head):
        _reject(
            storage, file.filename, content,
            "File missing DELIVERY_WORKSHEET_V<n> marker in preamble",
        )

    # The data header sits on line 6, well inside the first 2 KB.
    if is_inventory_file(content[:2048].decode("utf-8", errors="replace")):
        prefix, kind = STORAGE_INCOMING_INVENTORY, "inventory"
    else:
        prefix, kind = STORAGE_INCOMING_V2, "worksheet"

    name = _safe_name(file.filename)
    if storage.file_exists(f"{prefix}/{name}"):
        # Same filename as an earlier upload — keep both.
        name = f"{name}__{_utc_stamp()}"
        log.info("ingest: filename already present, storing as %s", name)

    path = storage.upload_file(name, content, "text/csv", prefix=prefix)
    log.info("ingest: stored %s file at %s (%d bytes)", kind, path, len(content))
    return {"status": "ok", "kind": kind, "path": path, "size": len(content)}

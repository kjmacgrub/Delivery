"""
Ingest endpoint for the IT-supplied combined CSV.

POST /ingest
  - Header: X-API-Key: <INGEST_API_KEY>
  - Body: multipart/form-data with field "file" (CSV)
  - Response: { "status": "ok", "path": "delivery-files/incoming/<filename>", "size": N }

Sanity check: file must be non-empty UTF-8 and contain a `DELIVERY_WORKSHEET_V<n>`
marker within the first 500 bytes. Full schema validation happens at parse time.
"""

import os
import re

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile

router = APIRouter()

_API_KEY = os.environ.get("INGEST_API_KEY")
_MARKER_RE = re.compile(r"DELIVERY_WORKSHEET_V\d+")


def _authenticate(api_key: str) -> None:
    if not _API_KEY:
        raise HTTPException(status_code=503, detail="Ingest API not configured")
    if api_key != _API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


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
        raise HTTPException(status_code=422, detail="File is not valid UTF-8")

    if not _MARKER_RE.search(head):
        raise HTTPException(
            status_code=422,
            detail="File missing DELIVERY_WORKSHEET_V<n> marker in preamble",
        )

    path = storage.upload_file(file.filename, content, "text/csv")
    return {"status": "ok", "path": path, "size": len(content)}

"""
Firebase Storage endpoints for managing delivery worksheet files.
"""

import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, UploadFile, File

from delivery.schemas import ParseResponse, StorageFilesResponse

router = APIRouter()


def _get_storage(request: Request):
    svc = request.app.state.storage_service
    if svc is None:
        raise HTTPException(
            status_code=503,
            detail="Firebase Storage not configured",
        )
    return svc


def _get_delivery_service(request: Request):
    return request.app.state.delivery_service


@router.post("/storage/upload")
async def upload_delivery_file(request: Request, file: UploadFile = File(...)):
    """Upload a delivery file to Firebase Storage incoming folder."""
    storage = _get_storage(request)
    content = await file.read()
    content_type = file.content_type or "application/octet-stream"
    path = storage.upload_file(file.filename, content, content_type)
    return {"path": path, "filename": file.filename}


@router.get("/storage/files", response_model=StorageFilesResponse)
async def list_incoming_files(request: Request):
    """List PDF/CSV files in the Firebase Storage incoming folder."""
    storage = _get_storage(request)
    files = storage.list_incoming_files()
    return StorageFilesResponse(
        files=files,
        total=len(files),
    )


@router.post("/storage/files/{file_name}/parse", response_model=ParseResponse)
async def parse_storage_file(file_name: str, request: Request):
    """
    Download a file from Firebase Storage and parse it.

    This is the primary workflow:
    1. Download from Firebase Storage incoming folder
    2. Parse the PDF/CSV
    3. Store results in Firestore
    4. Move the file to the processed folder
    """
    from delivery.config import STORAGE_INCOMING

    storage = _get_storage(request)
    delivery_service = _get_delivery_service(request)

    firebase_path = f"{STORAGE_INCOMING}/{file_name}"

    try:
        # Download from Firebase Storage
        local_path = storage.download_file(firebase_path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"File not found in Storage: {file_name}",
        )

    try:
        # Parse the file
        delivery = delivery_service.parse_local_file(local_path)
        delivery.firebase_path = firebase_path
    except ValueError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Parse error: {str(e)}",
        )

    # TODO: re-enable move_to_processed after development
    # try:
    #     storage.move_to_processed(firebase_path)
    # except Exception:
    #     pass

    total_items = sum(len(s.items) for s in delivery.suppliers)
    return ParseResponse(
        delivery_id=delivery.id,
        message=f"Successfully parsed {file_name} from Firebase Storage",
        supplier_count=len(delivery.suppliers),
        item_count=total_items,
    )


@router.get("/storage/latest")
async def get_latest_file(request: Request):
    """Get the most recently uploaded file in the incoming folder."""
    storage = _get_storage(request)
    latest = storage.get_latest_file()
    if not latest:
        return {"message": "No files in incoming folder", "file": None}
    return {"file": latest}


@router.get("/high-counts/dates")
async def list_high_count_dates(request: Request):
    """List all dates that have stored high count data."""
    db = request.app.state.delivery_service._db
    if not db:
        return {"dates": []}
    docs = db.collection('high_counts').stream()
    return {"dates": [doc.id for doc in docs]}


@router.get("/high-counts/{date_str}")
async def get_high_count(date_str: str, request: Request):
    """Get high count forecast data for a specific date."""
    db = request.app.state.delivery_service._db
    if not db:
        return {"date": date_str, "items": {}}
    doc = db.collection('high_counts').document(date_str).get()
    if not doc.exists:
        return {"date": date_str, "items": {}}
    data = doc.to_dict()
    return {"date": date_str, "items": data.get("items", {})}


@router.post("/storage/files/{file_name}/parse-inventory")
async def parse_inventory_file(file_name: str, request: Request):
    """
    Download an inventory worksheet CSV from Firebase Storage,
    parse name→location mappings, and save to Firestore inventory/latest.
    """
    import re
    from datetime import datetime
    from delivery.config import STORAGE_INCOMING
    from delivery.parser.inventory_parser import parse_inventory

    storage = _get_storage(request)
    firebase_path = f"{STORAGE_INCOMING}/{file_name}"

    try:
        local_path = storage.download_file(firebase_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found in Storage: {file_name}")

    try:
        items = parse_inventory(local_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {str(e)}")

    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', file_name)
    date_str = date_match.group(1) if date_match else datetime.utcnow().strftime('%Y-%m-%d')

    db = request.app.state.delivery_service._db
    if db:
        db.collection('inventory').document('latest').set({
            'date': date_str,
            'source_filename': file_name,
            'parsed_at': datetime.utcnow().isoformat(),
            'items': items,
        })

    return {
        'date': date_str,
        'source_filename': file_name,
        'item_count': len(items),
    }


@router.get("/inventory/latest")
async def get_inventory_latest(request: Request):
    """Get the most recently imported inventory worksheet."""
    db = request.app.state.delivery_service._db
    if not db:
        return {"items": {}, "date": None}
    doc = db.collection('inventory').document('latest').get()
    if not doc.exists:
        return {"items": {}, "date": None}
    data = doc.to_dict()
    return {"items": data.get("items", {}), "date": data.get("date")}


@router.post("/storage/files/{file_name}/parse-high-count")
async def parse_high_count_file(file_name: str, request: Request):
    """
    Download a High Count Basement List PDF from Firebase Storage,
    parse the 3-day forecast, and save to Firestore high_counts collection.
    """
    import re
    from datetime import datetime
    from delivery.config import STORAGE_INCOMING
    from delivery.parser.high_count_parser import parse_high_count

    storage = _get_storage(request)
    firebase_path = f"{STORAGE_INCOMING}/{file_name}"

    try:
        local_path = storage.download_file(firebase_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found in Storage: {file_name}")

    try:
        items = parse_high_count(local_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {str(e)}")

    # Extract date from filename (e.g., "basement_high_count_fri_2026-02-27.pdf")
    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', file_name)
    date_str = date_match.group(1) if date_match else datetime.utcnow().strftime('%Y-%m-%d')

    # Save to Firestore
    db = request.app.state.delivery_service._db
    if db:
        db.collection('high_counts').document(date_str).set({
            'date': date_str,
            'source_filename': file_name,
            'parsed_at': datetime.utcnow().isoformat(),
            'items': items,
        })

    nonzero = sum(1 for v in items.values() if v['sat'] or v['sun'] or v['mon'])
    return {
        'date': date_str,
        'source_filename': file_name,
        'item_count': len(items),
        'nonzero_count': nonzero,
    }


@router.get("/local/downloads-scan")
async def scan_downloads():
    """
    Scan the local ~/Downloads folder for delivery-related files.
    Returns the most recent match per file type.
    Only useful when running locally — returns empty results on Cloud Run.
    """
    from datetime import timezone

    downloads = Path.home() / "Downloads"
    if not downloads.exists():
        return {"delivery": None, "highcount": None, "inventory": None}

    patterns = {
        "delivery": lambda n: ("delivery" in n and "worksheet" in n) and (n.endswith(".pdf") or n.endswith(".csv")),
        "highcount": lambda n: "high_count" in n and (n.endswith(".pdf") or n.endswith(".csv")),
        "inventory": lambda n: "inventory" in n and n.endswith(".csv"),
    }

    import re
    from datetime import datetime

    result = {}
    for type_key, matcher in patterns.items():
        candidates = []
        try:
            for entry in downloads.iterdir():
                if entry.is_file() and matcher(entry.name.lower()):
                    mtime = entry.stat().st_mtime
                    candidates.append({"name": entry.name, "mtime": mtime})
        except PermissionError:
            pass
        if candidates:
            best = max(candidates, key=lambda x: x["mtime"])
            dt = datetime.fromtimestamp(best["mtime"], tz=timezone.utc)
            # Extract delivery date from filename (e.g. "delivery_worksheet_fri_2026-03-13.pdf")
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', best["name"])
            delivery_date = date_match.group(1) if date_match else None
            result[type_key] = {
                "name": best["name"],
                "modified": dt.isoformat(),
                "delivery_date": delivery_date,
            }
        else:
            result[type_key] = None

    return result

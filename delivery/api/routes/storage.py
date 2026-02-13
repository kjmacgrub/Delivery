"""
Firebase Storage endpoints for managing delivery worksheet files.
"""

from fastapi import APIRouter, HTTPException, Request

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
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Parse error: {str(e)}",
        )

    try:
        # Move to processed folder
        storage.move_to_processed(firebase_path)
    except Exception as e:
        # Non-fatal: file is already parsed
        pass

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

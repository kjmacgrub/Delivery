"""
Delivery CRUD and parsing endpoints.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from delivery.models import Delivery, DeliverySummary
from delivery.schemas import (
    ParseRequest, ParseResponse,
    DeliveryListResponse, DeliveryDetailResponse,
)

router = APIRouter()


def _get_service(request: Request):
    return request.app.state.delivery_service


@router.get("/deliveries", response_model=DeliveryListResponse)
async def list_deliveries(request: Request):
    """List all parsed deliveries."""
    service = _get_service(request)
    summaries = service.list_deliveries()
    return DeliveryListResponse(deliveries=summaries, total=len(summaries))


@router.get("/deliveries/{delivery_id}")
async def get_delivery(delivery_id: str, request: Request):
    """Get a delivery with all suppliers and items."""
    service = _get_service(request)
    delivery = service.get_delivery(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return delivery


@router.post("/deliveries/parse", response_model=ParseResponse)
async def parse_local_file(
    request: Request,
    file_path: str = Query(..., description="Path to local PDF file"),
):
    """
    Parse a local PDF file and store the results.

    This endpoint is for development/testing. In production,
    files will be fetched from Firebase Storage.
    """
    service = _get_service(request)
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    try:
        delivery = service.parse_local_file(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {str(e)}")

    total_items = sum(len(s.items) for s in delivery.suppliers)
    return ParseResponse(
        delivery_id=delivery.id,
        message=f"Successfully parsed {delivery.source_filename}",
        supplier_count=len(delivery.suppliers),
        item_count=total_items,
    )


@router.delete("/deliveries/{delivery_id}")
async def delete_delivery(delivery_id: str, request: Request):
    """Delete a delivery."""
    service = _get_service(request)
    delivery = service.get_delivery(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    service.delete_delivery(delivery_id)
    return {"message": f"Delivery {delivery_id} deleted"}

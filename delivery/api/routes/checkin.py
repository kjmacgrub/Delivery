"""
Check-in workflow endpoints for receiving deliveries.
"""

from fastapi import APIRouter, HTTPException, Request

from delivery.models import LineItemCheckIn
from delivery.schemas import CheckInResponse, CompleteDeliveryResponse

router = APIRouter()


def _get_service(request: Request):
    return request.app.state.delivery_service


@router.patch(
    "/deliveries/{delivery_id}/suppliers/{supplier_idx}/items/{item_idx}/checkin",
    response_model=CheckInResponse,
)
async def check_in_item(
    delivery_id: str,
    supplier_idx: int,
    item_idx: int,
    check_in: LineItemCheckIn,
    request: Request,
):
    """
    Check in a single line item during receiving.

    The iPad app calls this for each item as it's verified.
    """
    service = _get_service(request)
    item = service.check_in_item(delivery_id, supplier_idx, item_idx, check_in)
    if not item:
        raise HTTPException(
            status_code=404,
            detail="Item not found. Check delivery_id, supplier_idx, and item_idx.",
        )

    return CheckInResponse(
        message=f"Checked in: {item.raw_description}",
        items_updated=1,
    )


@router.patch(
    "/deliveries/{delivery_id}/suppliers/{supplier_idx}/items/{item_idx}/pull-confirm",
    response_model=CheckInResponse,
)
async def toggle_pull_confirmed(
    delivery_id: str,
    supplier_idx: int,
    item_idx: int,
    request: Request,
):
    """Toggle pull_confirmed on an item without changing its received status."""
    service = _get_service(request)
    item = service.toggle_pull_confirmed(delivery_id, supplier_idx, item_idx)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")
    return CheckInResponse(
        message=f"Pull {'confirmed' if item.pull_confirmed else 'unconfirmed'}: {item.raw_description}",
        items_updated=1,
    )


@router.patch(
    "/deliveries/{delivery_id}/suppliers/{supplier_idx}/checkin-all-ok",
    response_model=CheckInResponse,
)
async def check_in_all_ok(delivery_id: str, supplier_idx: int, request: Request):
    """
    Bulk check-in: mark all items in a supplier block as received OK.

    Convenience endpoint for when an entire supplier delivery is correct.
    Uses a single Firestore write for performance.
    """
    service = _get_service(request)
    count = service.check_in_all_ok(delivery_id, supplier_idx)
    if count == 0:
        delivery = service.get_delivery(delivery_id)
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        if supplier_idx >= len(delivery.suppliers):
            raise HTTPException(status_code=404, detail="Supplier not found")

    delivery = service.get_delivery(delivery_id)
    supplier_name = delivery.suppliers[supplier_idx].supplier_name

    return CheckInResponse(
        message=f"All {count} items for {supplier_name} marked as OK",
        items_updated=count,
    )


@router.patch(
    "/deliveries/{delivery_id}/suppliers/{supplier_idx}/unreceive-all",
    response_model=CheckInResponse,
)
async def unreceive_all(delivery_id: str, supplier_idx: int, request: Request):
    """
    Bulk unreceive: reset all received items in a supplier back to pending.

    Uses a single Firestore write for performance.
    """
    service = _get_service(request)
    count = service.unreceive_all(delivery_id, supplier_idx)
    if count == 0:
        delivery = service.get_delivery(delivery_id)
        if not delivery:
            raise HTTPException(status_code=404, detail="Delivery not found")
        if supplier_idx >= len(delivery.suppliers):
            raise HTTPException(status_code=404, detail="Supplier not found")

    delivery = service.get_delivery(delivery_id)
    supplier_name = delivery.suppliers[supplier_idx].supplier_name

    return CheckInResponse(
        message=f"All {count} items for {supplier_name} reset to pending",
        items_updated=count,
    )


@router.post(
    "/deliveries/{delivery_id}/complete",
    response_model=CompleteDeliveryResponse,
)
async def complete_delivery(delivery_id: str, request: Request):
    """
    Complete a delivery: validate all items checked in, generate
    exception report, store in Firestore and Firebase Storage.
    """
    service = _get_service(request)

    try:
        report = service.complete_delivery(delivery_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not report:
        raise HTTPException(status_code=404, detail="Delivery not found")

    # Also upload to Firebase Storage for archival
    storage_service = getattr(request.app.state, 'storage_service', None)
    if storage_service:
        try:
            storage_service.upload_exception_report(
                delivery_id,
                report.model_dump(mode="json"),
            )
        except Exception:
            pass  # Non-fatal: Firestore is the primary store

    return CompleteDeliveryResponse(
        message="Delivery completed successfully",
        report_id=report.id,
        total_exceptions=report.total_exceptions,
    )

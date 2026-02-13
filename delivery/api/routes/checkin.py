"""
Check-in workflow endpoints for receiving deliveries.
"""

from fastapi import APIRouter, HTTPException, Request

from delivery.models import LineItemCheckIn
from delivery.schemas import CheckInResponse

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
    "/deliveries/{delivery_id}/suppliers/{supplier_idx}/checkin-all-ok",
    response_model=CheckInResponse,
)
async def check_in_all_ok(delivery_id: str, supplier_idx: int, request: Request):
    """
    Bulk check-in: mark all items in a supplier block as received OK.

    Convenience endpoint for when an entire supplier delivery is correct.
    """
    service = _get_service(request)
    delivery = service.get_delivery(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    if supplier_idx >= len(delivery.suppliers):
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier = delivery.suppliers[supplier_idx]
    count = 0
    for i, item in enumerate(supplier.items):
        check_in_data = LineItemCheckIn(
            quantity_received=item.quantity_expected,
            received_status="ok",
        )
        service.check_in_item(delivery_id, supplier_idx, i, check_in_data)
        count += 1

    return CheckInResponse(
        message=f"All {count} items for {supplier.supplier_name} marked as OK",
        items_updated=count,
    )

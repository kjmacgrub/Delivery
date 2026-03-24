"""
Line item query endpoints.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query, Request

from delivery.models import LineItem

router = APIRouter()


def _get_service(request: Request):
    return request.app.state.delivery_service


@router.get("/deliveries/{delivery_id}/items")
async def list_items(
    delivery_id: str,
    request: Request,
    needs_processing: Optional[bool] = Query(None),
    pull_for_floor: Optional[bool] = Query(None),
    category: Optional[str] = Query(None),
    supplier_name: Optional[str] = Query(None),
):
    """
    List line items for a delivery, with optional filters.
    """
    service = _get_service(request)
    delivery = service.get_delivery(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")

    items = []
    for supplier in delivery.suppliers:
        if supplier_name and supplier.supplier_name != supplier_name:
            continue
        for item in supplier.items:
            if needs_processing is not None and item.needs_processing != needs_processing:
                continue
            if pull_for_floor is not None and item.pull_for_floor != pull_for_floor:
                continue
            if category and item.category != category:
                continue
            items.append({
                "supplier_name": supplier.supplier_name,
                "supplier_block_sequence": supplier.block_sequence,
                **item.model_dump(),
            })

    return {"items": items, "total": len(items)}


@router.get("/oos-items")
async def get_oos_items(request: Request):
    """Return item descriptions marked Out of Stock from the most recent delivery."""
    service = _get_service(request)
    summaries = service.list_deliveries()
    if not summaries:
        return {"oos": []}

    # Most recent delivery first
    latest = sorted(summaries, key=lambda s: s.delivery_date or "", reverse=True)[0]
    delivery = service.get_delivery(latest.id)
    if not delivery:
        return {"oos": []}

    oos = []
    for supplier in delivery.suppliers:
        for item in supplier.items:
            if item.received_notes and "O/S" in item.received_notes:
                oos.append(item.raw_description.lower().strip())
    return {"oos": oos}

"""
Grocery (non-produce) deliveries, read from IT's full-store file.

GET /api/v1/grocery-deliveries/current
  - The current file in delivery-files/incoming-inventory/ (same pick rule as
    the worksheet), with every produce row dropped and the rest grouped by
    supplier in the worksheet shape. 404 when the folder is empty.
  - ?include_items=true adds each supplier's item rows; by default only the
    per-supplier totals ship, since the Monitor lists suppliers.

The file is ~300 KB and changes once a day, so the parsed result is cached
in-process and only re-read when the blob's path or `updated` time changes.
"""

import logging
import threading

from fastapi import APIRouter, HTTPException, Request

from delivery.parser.csv_parser import CSVWorksheetParser, non_produce_copy
from delivery.services.csv_picker import pick_current_inventory_csv

router = APIRouter()
log = logging.getLogger(__name__)

_cache_lock = threading.Lock()
_cache_key: tuple = ()
_cache_value: dict = {}


def _parse_grocery(text: str, filename: str) -> dict:
    """Worksheet-shaped parse of the non-produce rows."""
    return CSVWorksheetParser().parse_string(non_produce_copy(text), source_filename=filename)


@router.get("/grocery-deliveries/current")
def grocery_deliveries_current(request: Request, include_items: bool = False) -> dict:
    global _cache_key, _cache_value
    storage = request.app.state.storage_service
    if storage is None:
        raise HTTPException(status_code=503, detail="Storage not configured")

    candidate = pick_current_inventory_csv(storage.bucket)
    if candidate is None:
        raise HTTPException(status_code=404, detail="No file in incoming-inventory/")

    key = (candidate.path, candidate.updated.isoformat() if candidate.updated else "")
    with _cache_lock:
        if key != _cache_key:
            text = storage.bucket.blob(candidate.path).download_as_text()
            _cache_value = _parse_grocery(text, candidate.filename)
            _cache_key = key
            log.info("grocery: parsed %s (%d suppliers)", candidate.path,
                     len(_cache_value["supplier_blocks"]))
        parsed = _cache_value

    suppliers = []
    for block in parsed["supplier_blocks"]:
        entry = {
            "supplier_name": block["supplier_name"],
            "expected_cases": block["expected_cases"],
            "item_count": len(block["items"]),
        }
        if include_items:
            entry["items"] = block["items"]
        suppliers.append(entry)

    return {
        "path": candidate.path,
        "filename": candidate.filename,
        "delivery_date": candidate.delivery_date.isoformat(),
        "generated_at": candidate.generated_at.isoformat() if candidate.generated_at else None,
        "supplier_count": len(suppliers),
        "item_count": sum(s["item_count"] for s in suppliers),
        "total_cases_expected": parsed["header"]["total_cases_expected"],
        "suppliers": suppliers,
    }

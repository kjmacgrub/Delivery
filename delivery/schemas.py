"""
Pydantic schemas for API request/response validation.

Thin wrappers around the models for specific API use cases.
"""

from typing import Optional, List
from pydantic import BaseModel

from delivery.models import (
    Delivery,
    DeliverySummary,
    SupplierEntry,
    LineItem,
    LineItemCheckIn,
    StorageFile,
)


class ParseRequest(BaseModel):
    """Request to parse a specific file from Firebase Storage."""
    filename: Optional[str] = None  # If None, parse latest file


class ParseResponse(BaseModel):
    """Response after parsing a delivery worksheet."""
    delivery_id: str
    message: str
    supplier_count: int
    item_count: int


class DeliveryListResponse(BaseModel):
    """Response for listing deliveries."""
    deliveries: List[DeliverySummary]
    total: int


class DeliveryDetailResponse(BaseModel):
    """Full delivery detail response."""
    delivery: Delivery


class StorageFilesResponse(BaseModel):
    """Response listing files in Firebase Storage."""
    files: List[StorageFile]
    total: int


class CheckInResponse(BaseModel):
    """Response after checking in item(s)."""
    message: str
    items_updated: int

"""
Pydantic data models for delivery worksheets.

These models define the data structures used throughout the app:
- Parser output
- API request/response bodies
- Firestore document schemas
"""

from datetime import date, datetime
from typing import Optional, List
from enum import Enum
from pydantic import BaseModel, Field


class Category(str, Enum):
    CITRUS = "CITRUS"
    FRUIT = "FRUIT"
    VEG = "VEG"
    APPLES = "APPLES"
    NUTS = "NUTS"
    FLOWERS = "FLOWERS"


class OrganicStatus(str, Enum):
    ORGANIC = "organic"
    IPM = "ipm"
    PESTICIDE_FREE = "pesticide free"
    CONVENTIONAL = "conventional"
    BIODYNAMIC = "biodynamic"


class ReceivedStatus(str, Enum):
    PENDING = "pending"
    OK = "ok"
    SHORT = "short"
    OVER = "over"
    DAMAGED = "damaged"
    MISSING = "missing"


class DeliveryStatus(str, Enum):
    PARSED = "parsed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class SupplierStatus(str, Enum):
    PENDING = "pending"
    CHECKED_IN = "checked_in"
    COMPLETE = "complete"


# ---- Line Items ----

class LineItemBase(BaseModel):
    """Core line item fields from parsing."""
    quantity_expected: int = Field(ge=0)
    category: str
    raw_description: str
    product_type: str = ""
    variety: Optional[str] = None
    size_packaging: Optional[str] = None
    organic_status: Optional[str] = None
    brand: Optional[str] = None
    plu_code: Optional[str] = None
    special_notes: Optional[str] = None
    needs_processing: bool = False
    pull_for_floor: bool = False
    line_sequence: int = 0


class LineItem(LineItemBase):
    """Full line item with check-in fields."""
    id: str = ""
    supplier_entry_id: str = ""
    quantity_received: Optional[int] = None
    received_status: ReceivedStatus = ReceivedStatus.PENDING
    received_notes: Optional[str] = None
    checked_in_at: Optional[datetime] = None


class LineItemCheckIn(BaseModel):
    """Request body for checking in a single line item."""
    quantity_received: int = Field(ge=0)
    received_status: ReceivedStatus
    received_notes: Optional[str] = None


# ---- Supplier Entries ----

class SupplierEntryBase(BaseModel):
    """Core supplier entry fields."""
    supplier_name: str
    expected_cases: int
    block_sequence: int


class SupplierEntry(SupplierEntryBase):
    """Full supplier entry with items and status."""
    id: str = ""
    delivery_id: str = ""
    status: SupplierStatus = SupplierStatus.PENDING
    items: List[LineItem] = Field(default_factory=list)


# ---- Deliveries ----

class DeliveryHeaderModel(BaseModel):
    """Delivery header metadata."""
    day_of_week: str
    delivery_date: Optional[date] = None
    day_number: Optional[int] = None
    week_number: Optional[int] = None
    total_cases_expected: int = 0


class DeliveryBase(BaseModel):
    """Core delivery fields."""
    day_of_week: str
    delivery_date: Optional[date] = None
    day_number: Optional[int] = None
    week_number: Optional[int] = None
    total_cases_expected: int = 0
    source_filename: str = ""
    firebase_path: Optional[str] = None


class Delivery(DeliveryBase):
    """Full delivery with suppliers and status."""
    id: str = ""
    parsed_at: Optional[datetime] = None
    status: DeliveryStatus = DeliveryStatus.PARSED
    notes: Optional[str] = None
    suppliers: List[SupplierEntry] = Field(default_factory=list)


# ---- API Response Models ----

class DeliverySummary(BaseModel):
    """Compact delivery summary for list views."""
    id: str
    day_of_week: str
    delivery_date: Optional[date]
    total_cases_expected: int
    source_filename: str
    status: DeliveryStatus
    parsed_at: Optional[datetime]
    supplier_count: int
    item_count: int
    checked_in_count: int


class SupplierCheckInRequest(BaseModel):
    """Bulk check-in request for all items in a supplier block."""
    items: List[LineItemCheckIn]


# ---- Storage File Models ----

class StorageFile(BaseModel):
    """Represents a file in Firebase Storage."""
    name: str
    path: str
    size: Optional[int] = None
    updated: Optional[datetime] = None
    content_type: Optional[str] = None

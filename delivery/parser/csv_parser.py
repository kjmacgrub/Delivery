"""
V2 combined CSV parser.

Parses the IT-supplied combined CSV per NEW_CSV_FORMAT.md. Output matches the
PDFWorksheetParser shape ({header, source_filename, supplier_blocks}) so
delivery_service can consume either format without branching, plus a
csv_metadata block with format version, generation timestamp, and warnings.
"""

import csv
import io
import re
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from delivery.parser.base import WorksheetParser


SUPPORTED_VERSIONS = {1}

_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
_MARKER_RE = re.compile(r"^DELIVERY_WORKSHEET_V(\d+)\s*$")
_GENERATED_RE = re.compile(r"\(generated\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\)")

EXPECTED_COLUMNS = [
    "item_id", "item_name", "supplier", "department", "category", "plu_code",
    "growing_method", "quantity_expected", "unit", "case_size", "bin_size",
    "basement_location", "floor_location", "pull_quantity",
    "high_count_day1", "high_count_day2", "high_count_day3",
    "processing_instructions",
]


class CSVParseError(Exception):
    """Raised when a v2 CSV fails preamble or schema validation."""


def read_preamble(text: str) -> dict:
    """
    Parse lines 1-5 only. Fast path for the CSV picker — doesn't read data rows.

    Returns {delivery_date: date, generated_at: datetime|None, version: int}.
    Raises CSVParseError if marker missing, version unsupported, or date absent.
    """
    lines = text.splitlines()
    if len(lines) < 5:
        raise CSVParseError("File too short — preamble requires at least 5 lines")

    marker_line = lines[3].strip()
    m = _MARKER_RE.match(marker_line)
    if not m:
        raise CSVParseError(
            f"Line 4 missing DELIVERY_WORKSHEET_V<n> marker (got: {marker_line!r})"
        )
    version = int(m.group(1))
    if version not in SUPPORTED_VERSIONS:
        raise CSVParseError(
            f"Unsupported format version V{version} — supported: {sorted(SUPPORTED_VERSIONS)}"
        )

    date_match = _DATE_RE.search(lines[0])
    if not date_match:
        raise CSVParseError(f"Line 1 missing ISO date (got: {lines[0]!r})")
    delivery_date = date.fromisoformat(date_match.group(1))

    gen_ts: Optional[datetime] = None
    gen_match = _GENERATED_RE.search(lines[1])
    if gen_match:
        try:
            gen_ts = datetime.fromisoformat(
                f"{gen_match.group(1)}T{gen_match.group(2)}"
            )
        except ValueError:
            gen_ts = None

    return {
        "delivery_date": delivery_date,
        "generated_at": gen_ts,
        "version": version,
    }


class CSVWorksheetParser(WorksheetParser):
    """Parse the combined IT-supplied CSV into the worksheet shape."""

    def validate(self, file_path: str) -> bool:
        return file_path.lower().endswith(".csv")

    def parse(self, file_path: str) -> dict:
        path = Path(file_path)
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return self.parse_string(content, source_filename=path.name)

    def parse_string(self, content: str, source_filename: str = "") -> dict:
        lines = content.splitlines()
        if len(lines) < 7:
            raise CSVParseError(
                "File too short — expected at least 7 lines (6-line preamble + header)"
            )

        pre = read_preamble(content)
        delivery_date: date = pre["delivery_date"]
        gen_ts: Optional[datetime] = pre["generated_at"]
        version: int = pre["version"]

        warnings = []
        if source_filename:
            fname_date_match = _DATE_RE.search(source_filename)
            if fname_date_match and fname_date_match.group(1) != delivery_date.isoformat():
                warnings.append(
                    f"Filename date {fname_date_match.group(1)!r} differs from "
                    f"line-1 date {delivery_date.isoformat()!r} — trusting line 1"
                )

        rows = list(csv.DictReader(io.StringIO("\n".join(lines[5:]))))
        if rows:
            missing = set(EXPECTED_COLUMNS) - set(rows[0].keys())
            if missing:
                raise CSVParseError(f"CSV missing required columns: {sorted(missing)}")

        items_by_supplier: dict[str, list] = {}
        for line_seq, row in enumerate(rows):
            supplier = (row.get("supplier") or "").strip() or "(unknown)"
            items_by_supplier.setdefault(supplier, []).append(_row_to_item(row, line_seq))

        supplier_blocks = []
        for block_idx, supplier in enumerate(sorted(items_by_supplier.keys())):
            items = items_by_supplier[supplier]
            expected = sum(it["quantity_expected"] for it in items)
            expected = int(expected) if float(expected).is_integer() else expected
            supplier_blocks.append({
                "supplier_name": supplier,
                "expected_cases": expected,
                "block_sequence": block_idx,
                "items": items,
            })

        total = sum(b["expected_cases"] for b in supplier_blocks)
        total = int(total) if float(total).is_integer() else total

        return {
            "header": {
                "day_of_week": delivery_date.strftime("%A"),
                "delivery_date": delivery_date.isoformat(),
                "day_number": delivery_date.timetuple().tm_yday,
                "week_number": delivery_date.isocalendar().week,
                "total_cases_expected": total,
            },
            "source_filename": source_filename,
            "supplier_blocks": supplier_blocks,
            "csv_metadata": {
                "format_version": version,
                "generated_at": gen_ts.isoformat() if gen_ts else None,
                "warnings": warnings,
            },
        }


def _row_to_item(row: dict, line_seq: int) -> dict:
    qty = _safe_float(row.get("quantity_expected"))
    qty_out: float | int = int(qty) if qty.is_integer() else qty

    pull_qty = _safe_int(row.get("pull_quantity"))
    basement = (row.get("basement_location") or "").strip()
    if basement == "N":
        basement = ""

    name = (row.get("item_name") or "").strip()
    instructions = (row.get("processing_instructions") or "").strip()

    return {
        "item_id": (row.get("item_id") or "").strip(),
        "quantity_expected": qty_out,
        "category": (row.get("department") or "").strip(),
        "raw_description": name,
        "product_type": name,
        "variety": None,
        "size_packaging": None,
        "organic_status": None,
        "brand": None,
        "plu_code": (row.get("plu_code") or "").strip() or None,
        "special_notes": None,
        "needs_processing": bool(instructions),
        "pull_for_floor": pull_qty > 0,
        "pull_quantity": pull_qty if pull_qty > 0 else None,
        "line_sequence": line_seq,
        "growing_method": (row.get("growing_method") or "").strip() or None,
        "unit": (row.get("unit") or "").strip() or None,
        "case_size": (row.get("case_size") or "").strip() or None,
        "bin_size": (row.get("bin_size") or "").strip() or None,
        "basement_location": basement or None,
        "floor_location": (row.get("floor_location") or "").strip() or None,
        "csv_category": (row.get("category") or "").strip() or None,
        "high_count_day1": _safe_int(row.get("high_count_day1")),
        "high_count_day2": _safe_int(row.get("high_count_day2")),
        "high_count_day3": _safe_int(row.get("high_count_day3")),
        "processing_instructions": instructions or None,
    }


def _safe_int(value: Optional[str]) -> int:
    if value is None:
        return 0
    s = str(value).strip()
    if not s:
        return 0
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s))
        except ValueError:
            return 0


def _safe_float(value: Optional[str]) -> float:
    if value is None:
        return 0.0
    s = str(value).strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

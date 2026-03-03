"""
PDF delivery worksheet parser using pdfplumber.

Handles multi-column layout by cropping each column and using
extract_text() for clean line-by-line extraction. Detects shading
(processing needed) and bold (pull for floor) using character-level
and rectangle data from the PDF.
"""

import re
from pathlib import Path
from typing import List, Optional, Tuple, Set
from dataclasses import dataclass, field
from datetime import date

import pdfplumber

from delivery.parser.base import WorksheetParser
from delivery.parser.product_parser import ProductDescriptionParser, ParsedProduct
from delivery.config import KNOWN_SUPPLIERS, PRODUCT_CATEGORIES, DAYS_OF_WEEK


@dataclass
class LineItem:
    """A single line item from the delivery worksheet."""
    quantity_expected: int
    category: str
    raw_description: str
    parsed: Optional[ParsedProduct] = None
    needs_processing: bool = False
    pull_for_floor: bool = False
    pull_quantity: Optional[int] = None
    line_sequence: int = 0


@dataclass
class SupplierBlock:
    """A supplier section from the delivery worksheet."""
    supplier_name: str
    expected_cases: int
    block_sequence: int
    items: List[LineItem] = field(default_factory=list)


@dataclass
class DeliveryHeader:
    """Header metadata from the delivery worksheet."""
    day_of_week: str = ""
    delivery_date: Optional[date] = None
    day_number: Optional[int] = None
    week_number: Optional[int] = None
    total_cases_expected: int = 0


@dataclass
class DeliveryWorksheet:
    """Complete parsed delivery worksheet."""
    header: DeliveryHeader = field(default_factory=DeliveryHeader)
    supplier_blocks: List[SupplierBlock] = field(default_factory=list)
    source_filename: str = ""


class PDFWorksheetParser(WorksheetParser):
    """
    Parse delivery worksheet PDFs using pdfplumber.

    Strategy: crop each column, use extract_text() for clean text,
    then map lines back to character data for bold/shading detection.
    """

    # Column boundaries (x-coordinates) for the 3-column layout
    COLUMN_BOUNDARIES = [
        (0, 207),     # Column 1
        (207, 400),   # Column 2
        (400, 612),   # Column 3
    ]

    HEADER_Y_MAX = 90
    FOOTER_Y_MIN = 970

    # Line item pattern: "12 FRUIT Raspberries- red organic"
    CATEGORY_PATTERN = re.compile(
        r'^(\d+)\s+(' + '|'.join(PRODUCT_CATEGORIES) + r')\s+(.+)$'
    )

    # Floor-pull pattern: "0 1 * VEG Beets- bunch various organic"
    # or "3 6 * FLOWERS Flowers-lancaster bouquet"
    FLOOR_PULL_PATTERN = re.compile(
        r'^(\d+)\s+(\d+)\s*\*\s*(' + '|'.join(PRODUCT_CATEGORIES) + r')\s+(.+)$'
    )

    # Also handle: "3 6 * FLOWERS" where the item starts with "*"
    FLOOR_PULL_ALT = re.compile(
        r'^\*\s*(' + '|'.join(PRODUCT_CATEGORIES) + r')\s+(.+)$'
    )

    # Header patterns
    DATE_PATTERN = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})')
    DAY_PATTERN = re.compile(r'Day\s+(\d+)')
    WEEK_PATTERN = re.compile(r'Week\s+(\d+)')

    def __init__(self):
        self.product_parser = ProductDescriptionParser()

    def validate(self, file_path: str) -> bool:
        return file_path.lower().endswith('.pdf')

    def parse(self, file_path: str) -> dict:
        """Parse a delivery worksheet PDF into structured data."""
        path = Path(file_path)
        worksheet = DeliveryWorksheet(source_filename=path.name)

        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                if page_num == 0:
                    worksheet.header = self._parse_header(page)

                # Pre-compute formatting maps for the whole page
                bold_ys = self._find_bold_y_positions(page)
                shaded_ys = self._find_shaded_y_positions(page)

                # Parse each column
                blocks = self._parse_page(page, page_num, bold_ys, shaded_ys)
                worksheet.supplier_blocks.extend(blocks)

        # Merge duplicate supplier blocks (same supplier spanning columns/pages)
        worksheet.supplier_blocks = self._merge_supplier_blocks(worksheet.supplier_blocks)

        # Renumber block sequences globally
        for i, block in enumerate(worksheet.supplier_blocks):
            block.block_sequence = i + 1

        return self._to_dict(worksheet)

    # ---- Header parsing ----

    def _parse_header(self, page) -> DeliveryHeader:
        header = DeliveryHeader()
        crop = page.crop((0, 0, page.width, self.HEADER_Y_MAX))
        text = crop.extract_text() or ""

        for day in DAYS_OF_WEEK:
            if day in text:
                header.day_of_week = day
                break

        m = self.DATE_PATTERN.search(text)
        if m:
            header.delivery_date = date(int(m.group(3)), int(m.group(1)), int(m.group(2)))

        m = self.DAY_PATTERN.search(text)
        if m:
            header.day_number = int(m.group(1))

        m = self.WEEK_PATTERN.search(text)
        if m:
            header.week_number = int(m.group(1))

        numbers = re.findall(r'\d[\d,]+', text)
        if numbers:
            header.total_cases_expected = max(int(n.replace(',', '')) for n in numbers)

        return header

    # ---- Formatting detection ----

    def _find_bold_y_positions(self, page) -> Set[int]:
        """Return set of rounded y-positions that contain bold characters."""
        bold_ys = set()
        for char in page.chars:
            if 'Bold' in char.get('fontname', ''):
                bold_ys.add(round(char['top']))
        return bold_ys

    def _find_shaded_y_positions(self, page) -> Set[int]:
        """Return set of y-positions covered by gray shading rectangles."""
        shaded_ys = set()
        for rect in page.rects:
            fill = rect.get('non_stroking_color')
            if not fill or not isinstance(fill, tuple) or len(fill) < 3:
                continue
            if not (0.7 <= fill[0] <= 0.9 and 0.7 <= fill[1] <= 0.9):
                continue
            # Skip full-page background rects
            if rect['x1'] - rect['x0'] > 500:
                continue
            for y in range(round(rect['top']), round(rect['bottom']) + 1):
                shaded_ys.add(y)
        return shaded_ys

    def _is_bold(self, y: float, bold_ys: Set[int]) -> bool:
        yr = round(y)
        return any(abs(yr - by) <= 2 for by in bold_ys)

    def _is_shaded(self, y: float, shaded_ys: Set[int]) -> bool:
        yr = round(y)
        return any(abs(yr - sy) <= 2 for sy in shaded_ys)

    # ---- Page / column parsing ----

    def _parse_page(
        self, page, page_num: int,
        bold_ys: Set[int], shaded_ys: Set[int]
    ) -> List[SupplierBlock]:
        all_blocks = []
        y_min = self.HEADER_Y_MAX if page_num == 0 else 5
        y_max = self.FOOTER_Y_MIN

        for x_min, x_max in self.COLUMN_BOUNDARIES:
            try:
                col = page.crop((x_min, y_min, x_max, y_max))
            except Exception:
                continue

            text = col.extract_text(x_tolerance=3, y_tolerance=3)
            if not text:
                continue

            # Get word positions so we can map lines to y-coords
            words = col.extract_words(x_tolerance=3, y_tolerance=3)

            # Map each text line to its y-position (page-absolute)
            line_ys = self._map_lines_to_y(text, words, y_min)

            # Annotate each line with formatting
            annotated = []
            for line in text.split('\n'):
                line = line.strip()
                if not line:
                    continue

                abs_y = line_ys.get(id(line))
                # Fallback: pop from ordered list
                if abs_y is None:
                    abs_y = line_ys.get(line)

                is_b = self._is_bold(abs_y, bold_ys) if abs_y else False
                is_s = self._is_shaded(abs_y, shaded_ys) if abs_y else False

                annotated.append({
                    'text': line,
                    'is_bold': is_b,
                    'has_shading': is_s,
                    'has_asterisk': '*' in line,
                })

            blocks = self._parse_lines_to_blocks(annotated)
            all_blocks.extend(blocks)

        return all_blocks

    def _map_lines_to_y(self, text: str, words: list, y_offset: float) -> dict:
        """
        Map text lines to page-absolute y-coordinates.

        Strategy: for each line, find its first word in the word list
        and use that word's y-position (plus the crop offset).
        """
        mapping = {}
        lines = text.split('\n')
        word_idx = 0

        for line in lines:
            line_stripped = line.strip()
            if not line_stripped:
                continue

            first_word = line_stripped.split()[0]

            # Scan forward in words list to find a match
            found = False
            search_start = word_idx
            for i in range(search_start, len(words)):
                w = words[i]
                if w['text'] == first_word or (
                    len(first_word) >= 2 and w['text'].startswith(first_word[:2])
                ):
                    abs_y = w['top'] + y_offset
                    mapping[line_stripped] = abs_y
                    word_idx = i + 1
                    found = True
                    break

            if not found:
                # Try a broader search from beginning
                for i, w in enumerate(words):
                    if w['text'] == first_word:
                        mapping[line_stripped] = w['top'] + y_offset
                        break

        return mapping

    # ---- Block / line item parsing ----

    def _parse_lines_to_blocks(self, lines: List[dict]) -> List[SupplierBlock]:
        """Parse annotated lines into supplier blocks with line items."""
        blocks = []
        current_block = None
        line_seq = 0

        for line_info in lines:
            text = line_info['text']

            # Skip header/footer noise
            if self._is_noise(text):
                continue

            # Supplier header?
            supplier = self._match_supplier(text)
            if supplier:
                name, cases = supplier
                current_block = SupplierBlock(
                    supplier_name=name,
                    expected_cases=cases,
                    block_sequence=0,
                )
                blocks.append(current_block)
                line_seq = 0
                continue

            if current_block is None:
                continue

            # Floor-pull pattern: "3 6 * FLOWERS Flowers-lancaster bouquet"
            # group(1) = cases expected (3), group(2) = pull quantity (6)
            fm = self.FLOOR_PULL_PATTERN.match(text)
            if fm:
                qty = int(fm.group(1))
                pull_qty = int(fm.group(2))
                cat = fm.group(3)
                desc = fm.group(4).strip()
                parsed = self.product_parser.parse(desc)
                line_seq += 1
                current_block.items.append(LineItem(
                    quantity_expected=qty, category=cat,
                    raw_description=desc, parsed=parsed,
                    needs_processing=line_info.get('has_shading', False),
                    pull_for_floor=True, pull_quantity=pull_qty,
                    line_sequence=line_seq,
                ))
                continue

            # Standard line item — also try to recover mangled "10 VEGItem" lines
            # where PDF dropped the space between category code and description
            fixed_text = self.CATEGORY_CONCAT_FIX.sub(r'\1\2 \3', text)
            im = self.CATEGORY_PATTERN.match(fixed_text)
            if im:
                text = fixed_text
            if im:
                qty = int(im.group(1))
                cat = im.group(2)
                desc = im.group(3).strip()
                parsed = self.product_parser.parse(desc)
                line_seq += 1
                current_block.items.append(LineItem(
                    quantity_expected=qty, category=cat,
                    raw_description=desc, parsed=parsed,
                    needs_processing=line_info.get('has_shading', False),
                    pull_for_floor=(
                        line_info.get('is_bold', False) or
                        line_info.get('has_asterisk', False)
                    ),
                    line_sequence=line_seq,
                ))
                continue

            # Continuation line (wraps from previous item)
            # But skip if it looks like noise that slipped through
            cleaned = text.strip()
            if current_block.items and cleaned:
                # Skip continuation if it's just "Total" or a bare number
                if re.match(r'^(Total|[\d,]+\s*Total|Total\s+[\d,]+)$', cleaned, re.I):
                    continue
                prev = current_block.items[-1]
                prev.raw_description += " " + cleaned
                prev.parsed = self.product_parser.parse(prev.raw_description)

        return blocks

    def _merge_supplier_blocks(self, blocks: List[SupplierBlock]) -> List[SupplierBlock]:
        """
        Merge consecutive blocks with the same supplier name.

        When a supplier's items span multiple columns or pages, they appear
        as separate blocks with the same name. This merges them into one block,
        combining their items and using the cases count from the first occurrence.
        """
        if not blocks:
            return blocks

        merged = []
        seen = {}  # supplier_name -> index in merged list

        for block in blocks:
            if block.supplier_name in seen:
                # Merge items into existing block
                existing = merged[seen[block.supplier_name]]
                # Re-sequence the appended items
                base_seq = max((it.line_sequence for it in existing.items), default=0)
                for item in block.items:
                    item.line_sequence = base_seq + item.line_sequence
                existing.items.extend(block.items)
            else:
                # First occurrence of this supplier
                seen[block.supplier_name] = len(merged)
                merged.append(block)

        return merged

    def _is_noise(self, text: str) -> bool:
        """Return True if line is header/footer noise."""
        t = text.strip()
        if not t:
            return True
        for day in DAYS_OF_WEEK:
            if t == day:
                return True
            if t.startswith(day) and self.DATE_PATTERN.search(t):
                return True
        if re.match(r'^\d{1,2}/\d{1,2}/\d{4}$', t):
            return True
        if re.search(r'Day\s+\d+\s+Week\s+\d+', t):
            return True
        if 'Delivery List' in t:
            return True
        if 'Shaded = processing' in t:
            return True
        if '* Bold = pull' in t:
            return True
        if re.match(r'^Total\s+cases', t, re.I):
            return True
        if re.match(r'^[\d,]+\s*Total\s*$', t):
            return True
        if re.match(r'^[\d,]+$', t):
            return True
        # "Total 2,223" or "2,223 Total"
        if re.match(r'^Total\s+[\d,]+$', t, re.I):
            return True
        return False

    # Pattern: "Supplier Name 123" — text ending with a case count
    SUPPLIER_HEADER_PATTERN = re.compile(
        r'^([A-Z][A-Za-z\'\.\-\&\/\, ]+?)\s+(\d+)\s*$'
    )

    # Pattern to recover mangled category lines where PDF dropped a space:
    # e.g. "10 VEGBrussels" → "10 VEG Brussels"
    CATEGORY_CONCAT_FIX = re.compile(
        r'^(\d+\s+)(' + '|'.join(PRODUCT_CATEGORIES) + r')([A-Z])'
    )

    def _match_supplier(self, text: str) -> Optional[Tuple[str, int]]:
        """
        Auto-detect supplier header lines.

        Supplier headers are lines like "Hepworth Farms 76" — they start
        with a capitalized name (not a number or category keyword) and end
        with a case count. Item lines start with a number, so they won't match.
        """
        t = text.strip()
        if not t:
            return None

        # Item lines start with a digit — not a supplier header
        if t[0].isdigit():
            return None

        # Lines starting with * are floor-pull items
        if t.startswith('*'):
            return None

        m = self.SUPPLIER_HEADER_PATTERN.match(t)
        if not m:
            return None

        name = m.group(1).strip()
        cases = int(m.group(2))

        # Reject if the "name" is a known noise phrase
        if name.lower() in ('total', 'total cases', 'day', 'week'):
            return None

        # Reject very short names (likely parsing artifacts or product codes like "PLU")
        if len(name) < 4:
            return None

        # Reject all-caps short names (product codes, not suppliers)
        if name == name.upper() and len(name.split()) == 1:
            return None

        return name, cases

    # ---- Serialization ----

    def _to_dict(self, ws: DeliveryWorksheet) -> dict:
        h = ws.header
        return {
            'header': {
                'day_of_week': h.day_of_week,
                'delivery_date': h.delivery_date.isoformat() if h.delivery_date else None,
                'day_number': h.day_number,
                'week_number': h.week_number,
                'total_cases_expected': h.total_cases_expected,
            },
            'source_filename': ws.source_filename,
            'supplier_blocks': [
                {
                    'supplier_name': b.supplier_name,
                    'expected_cases': b.expected_cases,
                    'block_sequence': b.block_sequence,
                    'items': [
                        {
                            'quantity_expected': it.quantity_expected,
                            'category': it.category,
                            'raw_description': it.raw_description,
                            'product_type': it.parsed.product_type if it.parsed else '',
                            'variety': it.parsed.variety if it.parsed else None,
                            'size_packaging': it.parsed.size_packaging if it.parsed else None,
                            'organic_status': it.parsed.organic_status if it.parsed else None,
                            'brand': it.parsed.brand if it.parsed else None,
                            'plu_code': it.parsed.plu_code if it.parsed else None,
                            'special_notes': it.parsed.special_notes if it.parsed else None,
                            'needs_processing': it.needs_processing,
                            'pull_for_floor': it.pull_for_floor,
                            'pull_quantity': it.pull_quantity,
                            'line_sequence': it.line_sequence,
                        }
                        for it in b.items
                    ],
                }
                for b in ws.supplier_blocks
            ],
        }

"""
Multi-pass product description parser.

Parses complex produce descriptions like:
  "Spinach-organic girl/olivia baby 16oz organic"
  "Apple- Calville blanc d'hiver heirloom ipm PLU 5283"
  "Peppers-thai chile HOT (25 cent minimum)"

into structured fields: product_type, variety, size_packaging,
organic_status, brand, plu_code, special_notes.

Strategy: Extract known patterns greedily in priority order,
leaving the "core product" as whatever remains.
"""

import re
from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class ParsedProduct:
    """Result of parsing a product description string."""
    raw_description: str
    product_type: str = ""
    variety: Optional[str] = None
    size_packaging: Optional[str] = None
    organic_status: Optional[str] = None
    brand: Optional[str] = None
    plu_code: Optional[str] = None
    special_notes: Optional[str] = None


class ProductDescriptionParser:
    """
    Multi-pass parser for produce product descriptions.

    Each pass extracts a specific class of token and removes it
    from the remaining text. The order of passes matters:
    1. Parenthetical notes (unambiguous delimiters)
    2. PLU codes (specific numeric patterns)
    3. Known brands (finite list, must run before organic check
       because "organic girl" contains "organic")
    4. Size/packaging (numeric + unit patterns)
    5. Organic/growing status
    6. Split remainder into product_type + variety
    """

    # Known brands - ordered longest first for greedy matching
    # These must be checked BEFORE organic status because some
    # brands contain "organic" (e.g., "organic girl")
    BRANDS = sorted([
        "organic girl/olivia",
        "organic girl",
        "aerofarms",
        "gotham greens",
        "pete's greens",
        "FROGHOLLOW",
        "Frog Hollow",
        "untill",
        "sunset",
        "element farms",
        "satur farms",
        "remembrance farm",
        "fresh meadow",
        "perfect foods",
        "blue heron",
        "earthbound",
        "queen's greens",
        "Little Leaf",
        "little leaf",
        "Suncoast",
        "suncoast",
    ], key=len, reverse=True)  # Longest first for greedy match

    # Known special note phrases to extract from descriptions
    SPECIAL_NOTE_PHRASES = [
        "star sticker",
        "star label",
        "red twistie",
        "red twisty",
        "Red Twisty",
        "Red Twistie",
        "blank label",
        "no label",
        "label",
        "for cooking",
    ]

    # Organic / growing method keywords
    GROWING_METHODS = [
        "pesticide free",
        "conventional",
        "biodynamic",
        "organic",
        "ipm",
        "IPM",
    ]

    # Compile regex patterns once

    # PLU patterns: "PLU 5283", "#3107", "plu 4901", "or 3283", bare "94593"
    PLU_EXPLICIT = re.compile(
        r'\b(?:PLU|plu|#)\s*(\d{4,5})\b'
    )
    PLU_OR_PATTERN = re.compile(
        r'\bor\s+(\d{4,5})\b'
    )
    # Bare PLU at end of string (4-5 digits, typically starting with 3,4,9)
    PLU_BARE_TRAILING = re.compile(
        r'\b(\d{4,5})\s*$'
    )

    # Size/packaging patterns
    SIZE_PATTERNS = [
        # "5# bags", "1# bags" (check before generic oz/lb)
        re.compile(r'\b(\d+#\s*bags?)\b', re.I),
        # "3lb bag", "5lb bags"
        re.compile(r'\b(\d+\s*lb\s*bags?)\b', re.I),
        # "12oz bags"
        re.compile(r'\b(\d+oz\s*bags?)\b', re.I),
        # ".75oz", "5oz", "16oz" - with optional leading dot for decimals
        re.compile(r'(?:^|(?<=\s))(\.?\d+(?:\.\d+)?\s*oz)\b', re.I),
        # "5lb", "3lb" standalone (after lb bags to avoid partial match)
        re.compile(r'\b(\d+\s*lb)\b', re.I),
    ]

    # Packaging type keywords (standalone)
    PACKAGING_KEYWORDS = [
        "pint", "quart", "cups", "cup",
        "bunch", "loose", "bags", "bag",
        "head", "tote",
    ]

    # Parenthetical content: (orange label), (25 cent minimum), (12 oz), (Tango)
    PAREN_PATTERN = re.compile(r'\(([^)]+)\)')

    def parse(self, description: str) -> ParsedProduct:
        """
        Parse a product description into structured fields.

        Args:
            description: Raw product description text, e.g.
                "Lemons.-meyer star sticker"

        Returns:
            ParsedProduct with all extracted fields.
        """
        result = ParsedProduct(raw_description=description)
        remaining = description.strip()

        # Pass 1: Extract parenthetical notes
        remaining, notes = self._extract_parenthetical_notes(remaining)

        # Pass 2: Extract PLU codes
        remaining, plu = self._extract_plu(remaining)

        # Pass 3: Extract known brands (before organic status!)
        remaining, brand = self._extract_brand(remaining)

        # Pass 4: Extract size/packaging
        remaining, size = self._extract_size(remaining)

        # Pass 5: Extract organic/growing status
        remaining, organic = self._extract_organic_status(remaining)

        # Pass 5.5: Extract known special note phrases
        remaining, extra_notes = self._extract_special_notes(remaining)
        if extra_notes:
            if notes:
                notes = notes + "; " + extra_notes
            else:
                notes = extra_notes

        # Pass 6: Split remainder into product_type and variety
        product_type, variety = self._extract_product_and_variety(remaining)

        # Assemble result
        result.product_type = product_type
        result.variety = variety if variety else None
        result.size_packaging = size if size else None
        result.organic_status = organic if organic else None
        result.brand = brand if brand else None
        result.plu_code = plu if plu else None
        result.special_notes = notes if notes else None

        return result

    def _extract_parenthetical_notes(self, text: str) -> tuple:
        """
        Extract parenthetical content like (orange label), (25 cent minimum).

        Some parenthetical content is actually size info like (12 oz) or
        variety info like (Tango) - we capture it all as notes and let
        downstream processing handle it.
        """
        notes_parts = []
        matches = self.PAREN_PATTERN.findall(text)
        for match in matches:
            notes_parts.append(match.strip())
        cleaned = self.PAREN_PATTERN.sub('', text).strip()
        # Clean up double spaces
        cleaned = re.sub(r'\s{2,}', ' ', cleaned)
        return cleaned, "; ".join(notes_parts) if notes_parts else ""

    def _extract_plu(self, text: str) -> tuple:
        """Extract PLU codes from various formats."""
        plu_codes = []

        # Explicit PLU: "PLU 5283", "#3107"
        for match in self.PLU_EXPLICIT.finditer(text):
            plu_codes.append(match.group(1))
        text = self.PLU_EXPLICIT.sub('', text)

        # "or 3283" pattern (PLU alternative)
        for match in self.PLU_OR_PATTERN.finditer(text):
            plu_codes.append(match.group(1))
        text = self.PLU_OR_PATTERN.sub('', text)

        # Bare trailing number that looks like a PLU (4-5 digits)
        if not plu_codes:
            match = self.PLU_BARE_TRAILING.search(text)
            if match:
                num = match.group(1)
                # Only treat as PLU if it looks like one (starts with 3,4,9
                # or is 5 digits starting with 9)
                if (len(num) == 4 and num[0] in '349') or \
                   (len(num) == 5 and num[0] == '9'):
                    plu_codes.append(num)
                    text = text[:match.start()].strip()

        cleaned = re.sub(r'\s{2,}', ' ', text).strip()
        return cleaned, ", ".join(plu_codes) if plu_codes else ""

    def _extract_brand(self, text: str) -> tuple:
        """
        Extract known brand names from the description.

        Must run before organic status extraction because brands like
        "organic girl" contain the word "organic".
        """
        found_brand = ""
        text_lower = text.lower()

        for brand in self.BRANDS:
            brand_lower = brand.lower()
            idx = text_lower.find(brand_lower)
            if idx != -1:
                found_brand = brand
                # Remove brand from text
                text = text[:idx] + text[idx + len(brand):]
                text_lower = text.lower()
                break  # Only extract first/primary brand

        cleaned = re.sub(r'\s{2,}', ' ', text).strip()
        return cleaned, found_brand

    # Standalone packaging keywords that appear as standalone tokens
    # (not as part of a variety name). Only extracted when they appear
    # at word boundaries and are likely packaging indicators.
    PACKAGING_STANDALONE = re.compile(
        r'\b(BUNCH|pint|quart)\b', re.I
    )

    def _extract_size(self, text: str) -> tuple:
        """Extract size and packaging information."""
        sizes = []

        # Try each size regex pattern
        for pattern in self.SIZE_PATTERNS:
            match = pattern.search(text)
            if match:
                sizes.append(match.group(1))
                text = text[:match.start()] + text[match.end():]

        # Check for standalone packaging keywords (BUNCH, pint, quart)
        match = self.PACKAGING_STANDALONE.search(text)
        if match:
            sizes.append(match.group(1).lower())
            text = text[:match.start()] + text[match.end():]

        cleaned = re.sub(r'\s{2,}', ' ', text).strip()
        size_str = " ".join(sizes) if sizes else ""
        return cleaned, size_str

    def _extract_organic_status(self, text: str) -> tuple:
        """
        Extract organic/growing method status.

        Handles: organic, ipm, IPM, pesticide free, conventional, biodynamic.
        """
        found_status = ""

        for method in self.GROWING_METHODS:
            # Use word boundary matching (case-insensitive for most)
            pattern = re.compile(
                r'\b' + re.escape(method) + r'\b',
                re.I if method.lower() != 'ipm' else 0
            )
            if pattern.search(text):
                found_status = method.lower()
                text = pattern.sub('', text, count=0)  # Remove ALL occurrences
                break  # Take the first (most specific) match

        cleaned = re.sub(r'\s{2,}', ' ', text).strip()
        return cleaned, found_status

    def _extract_special_notes(self, text: str) -> tuple:
        """
        Extract known special note phrases like 'star sticker', 'red twistie'.
        """
        found_notes = []

        for phrase in self.SPECIAL_NOTE_PHRASES:
            pattern = re.compile(r'\b' + re.escape(phrase) + r'\b', re.I)
            if pattern.search(text):
                found_notes.append(phrase)
                text = pattern.sub('', text)

        cleaned = re.sub(r'\s{2,}', ' ', text).strip()
        return cleaned, "; ".join(found_notes) if found_notes else ""

    def _extract_product_and_variety(self, text: str) -> tuple:
        """
        Split remaining text into product_type and variety.

        The separator is typically '-' (hyphen), sometimes with dots around it:
          "Lemons- organic" -> ("Lemons", "")
          "Lemons.-meyer star sticker" -> ("Lemons", "meyer star sticker")
          "Micro greens- spicy/wasabi" -> ("Micro greens", "spicy/wasabi")
          "Brussels sprouts - loose" -> ("Brussels sprouts", "loose")
        """
        text = text.strip()

        # Remove trailing dots and whitespace
        text = text.rstrip('. ')

        # Split on first hyphen (with optional dots/spaces around it)
        # Pattern: optional dots, optional spaces, hyphen, optional dots, optional spaces
        match = re.match(
            r'^(.*?)[\.\s]*-[\.\s]*(.*?)$',
            text
        )

        if match:
            product_type = match.group(1).strip().rstrip('.')
            variety = match.group(2).strip().rstrip('.')

            # Clean up variety - remove leading/trailing whitespace and dots
            variety = variety.strip('. ')

            return product_type, variety if variety else None

        # No hyphen found - entire text is the product type
        return text.strip().rstrip('.'), None

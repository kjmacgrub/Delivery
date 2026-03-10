"""
High Count Basement List PDF parser.

Parses the 3-day forecast (Sat/Sun/Mon) for high-case-count items.
Returns a flat dict keyed by lowercase item name: { name: { sat, sun, mon } }
"""

import re
from pathlib import Path

import pdfplumber

# Vendor codes that appear in the high count list
_VENDOR_CODES = ('FOR', 'BAL', 'LAN', 'ACE', 'ELI', 'BLM')

# Pattern: optional *, case count, optional vendor code, item name, sat, sun, mon
_ITEM_PATTERN = re.compile(
    r'^(\*\s*)?'
    r'(\d+(?:\.\d+)?)\s+'
    r'(?:(' + '|'.join(_VENDOR_CODES) + r')\s+)?'
    r'(.+?)\s+'
    r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$'
)

# Section header lines like "Cases G1 Sat Sun Mon NEW ↓"
_SECTION_HEADER = re.compile(r'^Cases\s+[A-Z]\d', re.IGNORECASE)

# Noise patterns to skip
_NOISE = [
    re.compile(r'^High Count', re.IGNORECASE),
    re.compile(r'^\d{1,2}/\d{1,2}/\d{2,4}$'),
    re.compile(r'^(Friday|Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday)\s*$', re.IGNORECASE),
    re.compile(r'^Day\s+\d+\s+Week\s+\d+', re.IGNORECASE),
    re.compile(r'^Order cases', re.IGNORECASE),
    re.compile(r'^shaded\s*=', re.IGNORECASE),
    re.compile(r'^\*\s*bold\s*=', re.IGNORECASE),
    re.compile(r'^2/\d+/\d+$'),
]


def _is_noise(line: str) -> bool:
    t = line.strip()
    if not t:
        return True
    if _SECTION_HEADER.match(t):
        return True
    for pat in _NOISE:
        if pat.search(t):
            return True
    return False


def parse_high_count(file_path: str) -> dict:
    """
    Parse a High Count Basement List PDF.

    Returns:
        dict: { lowercase_item_name: { sat: float, sun: float, mon: float } }
    """
    items = {}

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            mid = page.width / 2

            for x0, x1 in [(0, mid), (mid, page.width)]:
                col = page.crop((x0, 0, x1, page.height))
                text = col.extract_text(x_tolerance=3, y_tolerance=3)
                if not text:
                    continue

                for line in text.split('\n'):
                    line = line.strip()
                    if _is_noise(line):
                        continue

                    m = _ITEM_PATTERN.match(line)
                    if not m:
                        continue

                    # groups: 1=asterisk, 2=count, 3=vendor, 4=name, 5=sat, 6=sun, 7=mon
                    name = m.group(4).strip()
                    sat = float(m.group(5))
                    sun = float(m.group(6))
                    mon = float(m.group(7))

                    key = name.lower()
                    items[key] = {'sat': sat, 'sun': sun, 'mon': mon}

    return items

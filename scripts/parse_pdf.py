#!/usr/bin/env python3
"""
CLI script to parse a delivery worksheet PDF and output structured JSON.

Usage:
    python scripts/parse_pdf.py <path-to-pdf>
    python scripts/parse_pdf.py tests/fixtures/sample_delivery.pdf
"""

import sys
import json
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from delivery.parser.pdf_parser import PDFWorksheetParser


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/parse_pdf.py <path-to-pdf>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not Path(pdf_path).exists():
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)

    parser = PDFWorksheetParser()

    if not parser.validate(pdf_path):
        print(f"Error: Not a PDF file: {pdf_path}")
        sys.exit(1)

    print(f"Parsing: {pdf_path}")
    print("=" * 60)

    result = parser.parse(pdf_path)

    # Print summary
    header = result['header']
    blocks = result['supplier_blocks']

    print(f"\n--- HEADER ---")
    print(f"Day:        {header['day_of_week']}")
    print(f"Date:       {header['delivery_date']}")
    print(f"Day #:      {header['day_number']}")
    print(f"Week #:     {header['week_number']}")
    print(f"Total Cases: {header['total_cases_expected']}")

    print(f"\n--- SUPPLIERS ({len(blocks)}) ---")
    total_items = 0
    for block in blocks:
        item_count = len(block['items'])
        total_items += item_count
        print(f"  {block['block_sequence']:2d}. {block['supplier_name']:<35s} "
              f"cases={block['expected_cases']:4d}  items={item_count}")

    print(f"\n--- TOTAL ITEMS: {total_items} ---")

    # Print sample items from each supplier
    print(f"\n--- SAMPLE ITEMS ---")
    for block in blocks:
        print(f"\n  [{block['supplier_name']}]")
        for item in block['items'][:5]:  # First 5 items per supplier
            pt = item.get('product_type') or ''
            var = item.get('variety') or ''
            org = item.get('organic_status') or ''
            brand = item.get('brand') or ''
            print(f"    {item['quantity_expected']:3d} {item['category']:<7s} "
                  f"{pt:<25s} "
                  f"var={var:<20s} "
                  f"org={org:<15s} "
                  f"brand={brand}")
        if len(block['items']) > 5:
            print(f"    ... and {len(block['items']) - 5} more items")

    # Print items with special flags
    print(f"\n--- ITEMS NEEDING PROCESSING (shaded) ---")
    for block in blocks:
        for item in block['items']:
            if item['needs_processing']:
                print(f"  [{block['supplier_name']}] "
                      f"{item['quantity_expected']} {item['raw_description']}")

    print(f"\n--- ITEMS FOR FLOOR PULL (bold/*) ---")
    for block in blocks:
        for item in block['items']:
            if item['pull_for_floor']:
                print(f"  [{block['supplier_name']}] "
                      f"{item['quantity_expected']} {item['raw_description']}")

    # Optionally output full JSON
    if '--json' in sys.argv:
        print(f"\n--- FULL JSON ---")
        print(json.dumps(result, indent=2, default=str))


if __name__ == '__main__':
    main()

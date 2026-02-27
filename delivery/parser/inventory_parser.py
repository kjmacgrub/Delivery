"""
Inventory worksheet CSV parser.
Returns a name→location mapping for all produce items.
"""

import csv


def parse_inventory(file_path: str) -> dict:
    """
    Parse an inventory worksheet CSV file.

    The file has 5 metadata rows before the actual CSV header.
    Returns { lowercase_name: { name, basement_location, floor_location } }
    """
    items = {}
    with open(file_path, newline='', encoding='utf-8') as f:
        # Skip 5 metadata rows before the CSV header
        for _ in range(5):
            f.readline()
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('name', '').strip()
            basement = row.get('basement location', '').strip()
            floor = row.get('floor location', '').strip()
            if not name:
                continue
            items[' '.join(name.lower().split())] = {
                'name': name,
                'basement_location': basement,
                'floor_location': floor,
            }
    return items

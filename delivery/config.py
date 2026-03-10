"""Application configuration and constants."""

import os
from pathlib import Path

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
TEMP_DIR = DATA_DIR / "temp"

# Ensure temp directory exists
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# Firebase configuration
FIREBASE_CREDENTIALS_PATH = os.environ.get(
    "FIREBASE_CREDENTIALS",
    str(PROJECT_ROOT / "firebase-service-account.json"),
)
FIREBASE_STORAGE_BUCKET = os.environ.get(
    "FIREBASE_STORAGE_BUCKET",
    "delivery-worksheet-app.firebasestorage.app",
)

# Firebase Storage paths
STORAGE_INCOMING = "delivery-files/incoming"
STORAGE_PROCESSED = "delivery-files/processed"

# Known supplier names (used for supplier block detection in PDF)
# This list should be kept in sync with actual suppliers
KNOWN_SUPPLIERS = [
    "Ace Natural Produce",
    "Baldor",
    "Blue Moon Acres",
    "D'Artagnan Inc. - Produce",
    "D'Artagnan Inc.",
    "Eli and Ali LLC",
    "Finger Lakes Farms",
    "Flowering Sun Ecology Center",
    "Four Seasons Produce",
    "Gotham Greens",
    "Hepworth Farms",
    "Jedda",
    "Lancaster Farm Fresh Coop",
    "Myers Produce",
    "R.L. Irwin Mushrooms",
    "Ravioli Store",
    "Regional Access",
    "Row By Row Farm",
    "Southeast Asian Produce",
    "Wilklow Orchards",
]

# Product categories found in delivery worksheets
PRODUCT_CATEGORIES = [
    "CITRUS",
    "FRUIT",
    "VEG",
    "APPLES",
    "NUTS",
    "FLOWERS",
    "PLANTS",
]

# Known brands that appear embedded in product descriptions
KNOWN_BRANDS = [
    "organic girl/olivia",
    "organic girl",
    "olivia",
    "aerofarms",
    "gotham greens",
    "pete's greens",
    "FROGHOLLOW",
    "Frog Hollow",
    "untill",
    "sunset",
    "element farms",
    "blue moon",
    "lancaster",
    "satur farms",
    "remembrance farm",
    "fresh meadow",
    "perfect foods",
    "blue heron",
    "earthbound",
    "queen's greens",
    "little leaf",
    "Little Leaf",
]

# Days of week for header parsing
DAYS_OF_WEEK = [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
]

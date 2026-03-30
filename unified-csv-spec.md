# Unified CSV Export Specification

**Purpose:** Replace three separate file imports (delivery worksheet PDF, inventory location CSV, high-count forecast PDF) and one SBS import (master item list CSV) with a single daily CSV export.

**Audience:** IT / data team — please design one CSV file matching this spec.

---

## File Details

- **Format:** CSV, UTF-8, with header row
- **Frequency:** Daily (one file per delivery day)
- **Filename convention:** `delivery-YYYY-MM-DD.csv` (e.g., `delivery-2026-03-30.csv`)
- **Grain:** One row per item per supplier per delivery date

---

## Required Columns

| # | Column Name | Type | Example | Used By | Notes |
|---|------------|------|---------|---------|-------|
| 1 | `delivery_date` | Date (YYYY-MM-DD) | `2026-03-30` | Delivery | Date the delivery arrives |
| 2 | `day_of_week` | String | `Monday` | Delivery | Day name |
| 3 | `day_number` | Integer | `5` | Delivery | Day number in cycle |
| 4 | `week_number` | Integer | `3` | Delivery | Week number in cycle |
| 5 | `supplier_name` | String | `Hepworth Farms` | Delivery | Supplier / vendor name |
| 6 | `supplier_cases` | Integer | `76` | Delivery | Total cases expected from this supplier |
| 7 | `item_name` | String | `Raspberries` | Both | Product name (no variety/size — just the base name) |
| 8 | `variety` | String | `red organic` | Delivery | Variety, cultivar, or descriptor |
| 9 | `quantity_expected` | Integer | `12` | Delivery | Cases expected for this line item |
| 10 | `category` | String | `FRUIT` | Both | One of: `FRUIT`, `VEG`, `HERB`, `FLOWERS`, `DAIRY`, `OTHER` |
| 11 | `organic_status` | String | `organic` | Delivery | One of: `organic`, `conventional`, `ipm`, `biodynamic`, `pesticide free` |
| 12 | `size_packaging` | String | `16oz` | Delivery | Pack size (e.g., `5lb bags`, `pint`, `16oz`) |
| 13 | `brand` | String | `Organic Girl` | Delivery | Brand name, if applicable; blank otherwise |
| 14 | `plu_code` | String | `5283` | Delivery | PLU code (4-5 digits); blank if none |
| 15 | `needs_processing` | Boolean | `TRUE` | Delivery | Item requires produce processing (was shaded gray in old PDF) |
| 16 | `pull_for_floor` | Boolean | `TRUE` | Delivery | Item should be pulled to floor (was bold/asterisk in old PDF) |
| 17 | `pull_quantity` | Integer | `6` | Delivery | Suggested pull qty; blank if not a floor pull |
| 18 | `basement_location` | String | `Basement Aisle 3` | Delivery | Storage location in basement |
| 19 | `floor_location` | String | `Floor Zone A` | Delivery | Display location on floor |
| 20 | `high_count_sat` | Decimal | `23.5` | Delivery | Forecast cases — Saturday (next 3 days) |
| 21 | `high_count_sun` | Decimal | `18.0` | Delivery | Forecast cases — Sunday |
| 22 | `high_count_mon` | Decimal | `25.5` | Delivery | Forecast cases — Monday |
| 23 | `item_id` | String | `SKU-4821` | SBS | Unique item identifier from POS/inventory system |
| 24 | `case_size` | Integer | `12` | SBS | Units per case |
| 25 | `avg_daily_units` | Decimal | `8.5` | SBS | Average daily units sold (rolling) |
| 26 | `send_by` | String | `case` | SBS | Fulfillment unit: `case` or `unit` |
| 27 | `storage_area` | String | `Cooler 2` | SBS | Back-stock storage area (for SBS pull lists) |
| 28 | `special_notes` | String | `star sticker, no label` | Delivery | Any handling/labeling notes |

---

## Column Details & Rules

**Blanks:** Leave blank (not "N/A" or "null") when a value doesn't apply.

**Booleans:** Use `TRUE` / `FALSE` (uppercase).

**High-count columns (20-22):** These are the 3-day forward forecast. The column headers are labeled Sat/Sun/Mon as an example — the actual day names should match the 3-day window starting from the delivery date. If this is hard to make dynamic, fixed column names (`high_count_day1`, `high_count_day2`, `high_count_day3`) are fine.

**Delivery totals:** `supplier_cases` (col 6) is the total for that supplier across all its rows. It will be the same value on every row for a given supplier+date. We use it for display; the per-item breakdown is in `quantity_expected`.

**SBS columns (23-27):** These are catalog/master-list fields. They'll be the same for a given `item_id` regardless of supplier or date. Include them on every row so we don't need a separate file.

**Location columns (18-19):** From the current inventory worksheet. Same value for a given item regardless of supplier.

---

## What This Replaces

| Old File | Format | Old Fields | Now Covered By Columns |
|----------|--------|-----------|----------------------|
| Delivery Worksheet | PDF (3-col) | supplier, qty, category, description, bold/shading flags | 1-17, 28 |
| Inventory Worksheet | CSV | name, basement location, floor location | 7, 18-19 |
| High Count Basement List | PDF (2-col) | item name, sat/sun/mon forecasts | 7, 20-22 |
| SBS Master Item List | CSV | item_id, name, case_size, storage, avg_daily, category, send_by | 7, 10, 23-27 |

---

## Sample Rows

```csv
delivery_date,day_of_week,day_number,week_number,supplier_name,supplier_cases,item_name,variety,quantity_expected,category,organic_status,size_packaging,brand,plu_code,needs_processing,pull_for_floor,pull_quantity,basement_location,floor_location,high_count_sat,high_count_sun,high_count_mon,item_id,case_size,avg_daily_units,send_by,storage_area,special_notes
2026-03-30,Monday,5,3,Hepworth Farms,76,Raspberries,red organic,12,FRUIT,organic,6oz,,4244,FALSE,TRUE,6,Basement Aisle 3,Floor Zone A,23.5,18.0,25.5,SKU-4821,12,8.5,case,Cooler 2,star sticker
2026-03-30,Monday,5,3,Hepworth Farms,76,Spinach,baby,8,VEG,organic,5oz,Organic Girl,5283,TRUE,FALSE,,Basement Aisle 1,Floor Zone B,15.0,12.0,14.5,SKU-1102,6,12.3,case,Cooler 1,
2026-03-30,Monday,5,3,Lancaster Farm,42,Beets,golden,5,VEG,conventional,,,FALSE,TRUE,3,Basement Aisle 2,,,,SKU-3301,8,2.1,case,Dry Storage,no label
```

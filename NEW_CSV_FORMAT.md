# New Combined CSV Format — Transition Plan

Replaces the four current daily files:
1. `delivery_<dow>_<date>_worksheet.pdf`
2. `basement_high_count_<dow>_<date>.pdf`
3. `inventory-worksheet-produce-<date>.csv`
4. `<date>_<dow>_produce-processing_*.pdf` (produce-processor)

One CSV feeds both the Delivery app and the produce-processor.

Sample: `~/Downloads/ken_csv_for_4-22.csv` (first draft from IT, 2026-04-21).

## Current CSV columns

```
item id, name, supplier, quantity_expected, category, department,
plu_code, growing_method, basement_location, floor_location,
bin_size, case_size, pull_quantity,
high_count_day1, high_count_day2, high_count_day3,
processing_instructions
```

## Asks for IT

1. **Filename format**: `delivery_<dow>_<YYYY-MM-DD>.csv` (e.g. `delivery_wed_2026-04-22.csv`).
2. **Line-1 marker**: replace `test` with a stable identifier like `DELIVERY_WORKSHEET_V1`; app will validate content against it.
3. **Add a `unit` column** (each / lb / oz / bunch / …) so `case_size` is interpretable.
4. **`processing_instructions` format**: strict `<digit> - <text>` when populated; blank when no processing needed; plain text without digit is acceptable and handled as "unknown priority."
5. **Confirm `high_count_day1/2/3`** is a rolling 3-business-day window starting the day after delivery.
6. **Confirm `item id`** is stable and unique across time and across suppliers (treat as catalog key).
7. **Rollout**: single CSV fully replaces all four old files. Uploaded to one bucket and consumed by both apps. Bucket choice TBD.

## App-side decisions (no IT input needed)

| Area | Decision |
|---|---|
| Header metadata | Parse date from filename; derive day-of-week, Day/Week (Julian), and total cases from rows |
| Category grouping | Use `department` column; auto-extend enum on new values; keep `category` stored but hidden |
| Fractional `quantity_expected` | Accept floats; display as-is |
| `growing_method = HYDRO` | New `OrganicStatus` value with its own UI treatment |
| `basement_location = 'N'` | Treat as blank (no basement location) |
| Supplier totals | Sum `quantity_expected` per supplier |
| Supplier order | Alphabetical |
| Floor-pull flag | `pull_quantity > 0` ⇒ `pull_for_floor = true` |
| PLU | Trust column; retire text-based PLU extraction from `name` |
| Description parser | Retire entirely — `name` stays as a single raw string (brand/size/special-notes no longer tracked separately) |
| `item id` | Adopt as canonical Firestore document key |
| Row order | Do not trust; re-group and re-sort by supplier before display |
| `bin_size` / `case_size` | Store for future use (`case_size` = units/case, `bin_size` = shelf capacity); not displayed yet |

## Produce-processor specifics

Source column: `processing_instructions`. Format `<digit>-space-dash-space-<text>`:

| Digit | Task label |
|---|---|
| `0` | Process on ground floor |
| `1` | Top Priority |
| `2` | Next Priority |
| `3` | Not Refrigerated |
| `4` | Do by belt or other area |
| `U` or missing prefix | Unknown priority (still needs processing) |

Blank `processing_instructions` ⇒ item does not need processing.

`notes` and `check in notes` are app-side fields only, not supplied by the CSV.

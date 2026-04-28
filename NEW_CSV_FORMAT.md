# New Combined CSV Format — Transition Plan

Replaces the four current daily files:
1. `delivery_<dow>_<date>_worksheet.pdf`
2. `basement_high_count_<dow>_<date>.pdf`
3. `inventory-worksheet-produce-<date>.csv`
4. `<date>_<dow>_produce-processing_*.pdf` (produce-processor)

One CSV feeds both the Delivery app and the produce-processor.

Sample: `~/Downloads/delivery_mon-2026-04-27.csv` (current IT draft).

## File structure

Six-row preamble (two blank rows around the version marker), then column header + data rows:

```
Line 1: delivery_Mon-2026-04-27        ← delivery-date carrier
Line 2: (generated 2026-04-26 13:49)   ← generation timestamp
Line 3: (blank)
Line 4: DELIVERY_WORKSHEET_V1          ← format/version marker
Line 5: (blank)
Line 6: item_id,item_name,supplier,department,category,plu_code,growing_method,quantity_expected,unit,case_size,bin_size,basement_location,floor_location,pull_quantity,high_count_day1,high_count_day2,high_count_day3,processing_instructions
Line 7+: data rows
```

### Line 1 — delivery date

Filename-style string containing the delivery date in ISO form. Parse with `\d{4}-\d{2}-\d{2}`. Authoritative source for delivery date if the filename gets renamed or mangled.

### Line 2 — generation timestamp

Format `(generated YYYY-MM-DD HH:MM)`. **Audit/diagnostic only** — tells a human which generation of the file they're looking at when re-sends happen. Not used for selection logic: Cloud Storage's own last-modified time decides "which file is newest" when filenames collide, and same-day re-sends with the same filename overwrite the prior version anyway.

### Line 3 — blank

### Line 4 — format/version marker

`DELIVERY_WORKSHEET_V<n>`. Bumped to `V2` when the schema changes. The app rejects files whose line 4 doesn't start with a known marker.

### Line 5 — blank

### Line 6 — column header

```
item_id, item_name, supplier, department, category, plu_code, growing_method,
quantity_expected, unit, case_size, bin_size,
basement_location, floor_location,
pull_quantity,
high_count_day1, high_count_day2, high_count_day3,
processing_instructions
```

### App validation on load

1. Line 4 starts with a known `DELIVERY_WORKSHEET_V<n>` → else reject.
2. Line 1 contains a parseable ISO date → else reject.
3. Date from line 1 matches date extracted from the filename → else warn, trust line 1.
4. Line 2 parses as a generation timestamp → else warn (informational, not blocking).

## Filename

`delivery_<dow>-<YYYY-MM-DD>.csv` (e.g. `delivery_mon-2026-04-27.csv`). Day-of-week may be any case (`mon`, `Mon`); separator between dow and date is a hyphen.

## High-count window

`high_count_day1/2/3` is a rolling 3-**calendar**-day window starting the day after delivery (e.g. Monday delivery → day1=Tue, day2=Wed, day3=Thu; Sunday delivery → day1=Mon, day2=Tue, day3=Wed). Non-business days are **not** skipped — Sunday deliveries do happen. All-zero values are normal and just mean orders haven't been placed that far in advance yet.

## `item_id` semantics

`item_id` is the store's internal catalog ID. It never changes for a given product, and is shared across suppliers when they carry the same SKU (e.g. `1000050` = "Carrots-loose orange organic" whether sourced from Four Seasons or Myers). Safe to use as the canonical Firestore document key.

## Rollout

Single CSV fully replaces all four legacy files. **Hard cutover — no overlap period.**

- **Bucket**: the Delivery Firebase Storage bucket (same one currently used by `delivery-files/incoming/`). Both apps will read from there. Exact path within the bucket TBD.
- **Trigger**: IT begins uploading to the agreed-upon path only when we ask. On that same day, both apps are switched to read from the new path.
- The four legacy files are currently user-generated (not produced by IT), so we control the cutover end-to-end without coordination risk.

## App-side decisions (no IT input needed)

| Area | Decision |
|---|---|
| Header metadata | Parse date from line 1 (fallback: filename); derive day-of-week, Day/Week (Julian), and total cases from rows |
| Category grouping | Use `department` column; auto-extend enum on new values; keep `category` stored but hidden |
| Fractional `quantity_expected` | Accept floats; display as-is |
| `growing_method` values | Open-ended — accept any value IT sends (`ORG`, `CONV`, `HYDRO`, `IPM`, …). Auto-extend the enum and assign a default UI treatment for unknown values; promote to first-class styling as needed. |
| `basement_location = 'N'` | Treat as blank (no basement location) |
| Supplier totals | Sum `quantity_expected` per supplier |
| Supplier order | Alphabetical |
| Floor-pull flag | `pull_quantity > 0` ⇒ `pull_for_floor = true` |
| PLU | Trust column; retire text-based PLU extraction from `name` |
| Description parser | Retire entirely — `name` stays as a single raw string (brand/size/special-notes no longer tracked separately) |
| `item_id` | Adopt as canonical Firestore document key |
| Row order | Do not trust; re-group and re-sort by supplier before display |
| `bin_size` / `case_size` | Store for future use (`case_size` = units/case, `bin_size` = shelf capacity); not displayed yet |

## Produce-processor specifics

Source column: `processing_instructions`. Free text typed by a human, so parsing is best-effort:

**Priority extraction.** If the value starts with a single digit followed by a space, hyphen (`-`), en/em dash (`–`/`—`), or underscore (`_`), that digit is the priority. Strip the digit and the separator; the remaining text is the instruction. If no leading-digit-plus-separator pattern is found, the whole value is the instruction with no priority.

Regex: `^(\d)[ \-_–—]\s*(.*)$` → group 1 = priority, group 2 = instruction.

**Priority legend (app-controlled):**

| Digit | Task label |
|---|---|
| `0` | Process on ground floor |
| `1` | Top Priority |
| `2` | Next Priority |
| `3` | Not Refrigerated |
| `4` | Do by belt or other area |
| (none) | No priority |

Blank `processing_instructions` ⇒ item does not need processing.

`notes` and `check in notes` are app-side fields only, not supplied by the CSV.

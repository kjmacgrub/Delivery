# Unified CSV

**Purpose:** Replace four separate file exports (delivery worksheet PDF, inventory location CSV, high-count forecast PDF, and the produce processing report CSV) with a single daily CSV export.

Generate after midnight for a delivery date. For every order line item on that day, include the following fields. 

---

## Fields

`item_id`, `item_name`, `supplier_name`, `quantity_expected`, `category`, `department`, `plu_code`, `growing_method`, `basement_location`, `floor_location`, `bin_size`, `case_size`

**Calculated on source report:**

`pull_quantity`, `high_count_day1`, `high_count_day2`, `high_count_day3` — calculated on the Delivery Worksheet

`processing_instruction` — from the Produce Processing Report

---

## Source Reports

1. Delivery Worksheet - https://inventory.intranet.psfc.coop/produce_basement/YYYY-MM-DD/
2. Inventory Worksheet - https://inventory.intranet.psfc.coop/inventory_worksheet/YYYY-MM-DD/produce/0/basement/csv/
3. High Count Basement List - https://inventory.intranet.psfc.coop/produce_basement/YYYY-MM-DD/
4. Produce Processing Report (the csv version) - https://inventory.intranet.psfc.coop/produce_basement/YYYY-MM-DD/

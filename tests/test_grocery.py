"""GET /grocery-deliveries/current: non-produce rows of the full-store file, by supplier."""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from delivery.api.routes import grocery as grocery_mod
from tests.test_csv_picker import FakeBlob, FakeBucket

HEADER = ",".join([
    "item_id", "item_name", "supplier", "department", "category", "plu_code",
    "growing_method", "quantity_expected", "unit", "case_size", "bin_size",
    "basement_location", "floor_location", "pull_quantity",
    "high_count_day1", "high_count_day2", "high_count_day3",
    "processing_instructions", "type",
])


def row(item_id, name, supplier, dept, qty, kind):
    return f"{item_id},{name},{supplier},{dept},CAT,1,CONV,{qty},unit(s),1,1,,,0,0,0,0,,{kind}"


FULL = "\n".join([
    "\ufeffdelivery_Tue-2026-10-27", "(generated 2026-10-27 03:31)", " ",
    "DELIVERY_WORKSHEET_V1", '""', HEADER,
    row(1, "Apple", "Jedda", "VEG", "2.00", "produce"),
    row(2, "Chicken", "Four Seasons - Chicken", "CHICKEN", "3.00", "inventory"),
    row(3, '"Beans, black"', "UNFI GROCERY", "FOOD", "1.50", "inventory"),
    row(4, "Rice", "UNFI GROCERY", "FOOD", "2.00", "inventory"),
    "",
]).encode("utf-8")


class FakeStorage:
    def __init__(self, bucket):
        self.bucket = bucket


class DownloadableBlob(FakeBlob):
    def download_as_text(self):
        return self._c.decode("utf-8")


def make_client(blobs):
    grocery_mod._cache_key = ()
    app = FastAPI()
    app.include_router(grocery_mod.router, prefix="/api/v1")
    bucket = FakeBucket(blobs)
    bucket.blob = lambda name: next(b for b in blobs if b.name == name)
    app.state.storage_service = FakeStorage(bucket)
    return TestClient(app)


def test_groups_non_produce_rows_by_supplier():
    t = datetime(2026, 10, 27, 7, 31, tzinfo=timezone.utc)
    c = make_client([DownloadableBlob("delivery-files/incoming-inventory/delivery_Tue-2026-10-27", FULL, t)])
    r = c.get("/api/v1/grocery-deliveries/current")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["delivery_date"] == "2026-10-27"
    assert body["supplier_count"] == 2
    assert body["item_count"] == 3
    assert body["total_cases_expected"] == 6.5
    assert [s["supplier_name"] for s in body["suppliers"]] == ["Four Seasons - Chicken", "UNFI GROCERY"]
    assert body["suppliers"][1] == {"supplier_name": "UNFI GROCERY", "expected_cases": 3.5, "item_count": 2}
    # Items only on request.
    r = c.get("/api/v1/grocery-deliveries/current", params={"include_items": "true"})
    names = [it["raw_description"] for it in r.json()["suppliers"][1]["items"]]
    assert names == ["Beans, black", "Rice"]


def test_404_when_folder_empty():
    c = make_client([])
    assert c.get("/api/v1/grocery-deliveries/current").status_code == 404


def test_newest_file_wins_and_cache_refreshes():
    t = datetime(2026, 10, 27, 7, 31, tzinfo=timezone.utc)
    old = FULL.replace(b"2026-10-27", b"2026-10-26")
    c = make_client([
        DownloadableBlob("delivery-files/incoming-inventory/delivery_Mon-2026-10-26", old, t),
        DownloadableBlob("delivery-files/incoming-inventory/delivery_Tue-2026-10-27", FULL, t),
    ])
    assert c.get("/api/v1/grocery-deliveries/current").json()["delivery_date"] == "2026-10-27"

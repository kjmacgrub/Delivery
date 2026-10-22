"""CSV picker: the inventory file (extra `type` column) is never a candidate."""

from datetime import datetime, timezone

from delivery.services import csv_picker

PRE = "﻿delivery_Thu-2026-10-22\n(generated 2026-10-22 {gen})\n \nDELIVERY_WORKSHEET_V1\n\"\"\n"
WORKSHEET = (PRE.format(gen="03:30") + "item_id,item_name\n1,Apple\n").encode()
INVENTORY = (PRE.format(gen="14:25") + "item_id,item_name,type\n9,Sponge,inventory\n1,Apple,produce\n").encode()
PRODUCE_TYPED = (PRE.format(gen="03:31") + "item_id,item_name,type\n1,Apple,produce\n2,Kale,produce\n").encode()


class FakeBlob:
    def __init__(self, name, content, updated):
        self.name, self._c, self.updated = name, content, updated

    def download_as_bytes(self, start=0, end=None):
        return self._c[start:(end + 1) if end is not None else None]


class FakeBucket:
    def __init__(self, blobs):
        self._blobs = blobs

    def list_blobs(self, prefix):
        return [b for b in self._blobs if b.name.startswith(prefix)]


def test_inventory_file_is_skipped_even_when_newer():
    t = datetime(2026, 10, 22, 7, 30, tzinfo=timezone.utc)
    bucket = FakeBucket([
        FakeBlob("delivery-files/incoming-v2/delivery_Thu-2026-10-22", WORKSHEET, t),
        FakeBlob("delivery-files/incoming-v2/delivery_Thu-2026-10-22__20261022T182547Z", INVENTORY,
                 t.replace(hour=18)),
    ])
    pick = csv_picker.pick_current_csv(bucket)
    assert pick is not None
    assert pick.filename == "delivery_Thu-2026-10-22"
    assert pick.generated_at == datetime(2026, 10, 22, 3, 30)


def test_only_inventory_file_means_no_candidate():
    t = datetime(2026, 10, 22, 18, 25, tzinfo=timezone.utc)
    bucket = FakeBucket([FakeBlob("delivery-files/incoming-v2/x", INVENTORY, t)])
    assert csv_picker.pick_current_csv(bucket) is None


def test_produce_file_with_type_column_is_picked():
    t = datetime(2026, 10, 23, 7, 30, tzinfo=timezone.utc)
    bucket = FakeBucket([
        FakeBlob("delivery-files/incoming-v2/delivery_Fri-2026-10-23", PRODUCE_TYPED, t),
    ])
    pick = csv_picker.pick_current_csv(bucket)
    assert pick is not None and pick.filename == "delivery_Fri-2026-10-23"

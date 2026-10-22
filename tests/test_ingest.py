"""Tests for POST /ingest: sanity check, rejected-file capture, no-overwrite."""

import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from delivery.api.routes import ingest as ingest_mod
from delivery.config import STORAGE_INCOMING_V2, STORAGE_REJECTED

GOOD = (
    "﻿delivery_Fri-2026-10-23\n(generated 2026-10-23 03:30)\n \n"
    "DELIVERY_WORKSHEET_V1\n\"\"\nitem_id,item_name\n1,Apple\n"
).encode("utf-8")


class FakeStorage:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.uploads = []  # (path, content, content_type)

    def upload_file(self, filename, content, content_type, prefix):
        path = f"{prefix}/{filename}"
        self.uploads.append((path, content, content_type))
        self.existing.add(path)
        return path

    def file_exists(self, path):
        return path in self.existing


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(ingest_mod, "_API_KEY", "secret")
    app = FastAPI()
    app.include_router(ingest_mod.router)
    app.state.storage_service = FakeStorage()
    return TestClient(app), app.state.storage_service


def post(client, content, name="delivery_Fri-2026-10-23", key="secret"):
    return client.post(
        "/ingest",
        files={"file": (name, io.BytesIO(content), "text/csv")},
        headers={"X-API-Key": key},
    )


def test_good_file_stored_in_incoming_v2(client):
    c, store = client
    r = post(c, GOOD)
    assert r.status_code == 200, r.text
    assert r.json()["path"] == f"{STORAGE_INCOMING_V2}/delivery_Fri-2026-10-23"
    assert [p for p, _, _ in store.uploads] == [f"{STORAGE_INCOMING_V2}/delivery_Fri-2026-10-23"]


def test_bad_key_rejected(client):
    c, store = client
    assert post(c, GOOD, key="nope").status_code == 401
    assert store.uploads == []


def test_missing_marker_is_kept_in_rejected(client):
    c, store = client
    body = b"item_id,item_name\n1,Apple\n"
    r = post(c, body, name="produce_extra.csv")
    assert r.status_code == 422
    assert len(store.uploads) == 1
    path, content, ctype = store.uploads[0]
    assert path.startswith(f"{STORAGE_REJECTED}/")
    assert path.endswith("_produce_extra.csv")
    assert content == body
    assert path in r.json()["detail"]


def test_non_utf8_is_kept_in_rejected(client):
    c, store = client
    body = "DELIVERY_WORKSHEET_V1\n".encode("utf-16")
    r = post(c, body, name="extra.csv")
    assert r.status_code == 422
    assert "UTF-8" in r.json()["detail"]
    assert store.uploads[0][0].startswith(f"{STORAGE_REJECTED}/")


def test_empty_file_not_kept(client):
    c, store = client
    assert post(c, b"").status_code == 422
    assert store.uploads == []


def test_same_filename_does_not_overwrite(client):
    c, store = client
    assert post(c, GOOD).status_code == 200
    second = GOOD.replace(b"1,Apple", b"2,Pear")
    r = post(c, second)
    assert r.status_code == 200
    paths = [p for p, _, _ in store.uploads]
    assert paths[0] == f"{STORAGE_INCOMING_V2}/delivery_Fri-2026-10-23"
    assert paths[1].startswith(f"{STORAGE_INCOMING_V2}/delivery_Fri-2026-10-23__")
    assert paths[1] != paths[0]
    assert store.uploads[0][1] == GOOD
    assert store.uploads[1][1] == second


INVENTORY = (
    "﻿delivery_Fri-2026-10-23\n(generated 2026-10-23 03:33)\n \n"
    "DELIVERY_WORKSHEET_V1\n\"\"\nitem_id,item_name,type\n1,Apple,produce\n2,Sponge,inventory\n"
).encode("utf-8")


def test_inventory_file_routed_to_its_own_folder(client):
    from delivery.config import STORAGE_INCOMING_INVENTORY
    c, store = client
    r = post(c, INVENTORY)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "inventory"
    assert r.json()["path"] == f"{STORAGE_INCOMING_INVENTORY}/delivery_Fri-2026-10-23"
    # Worksheet with the same name still lands in incoming-v2, untouched by the above.
    r2 = post(c, GOOD)
    assert r2.json()["kind"] == "worksheet"
    assert r2.json()["path"] == f"{STORAGE_INCOMING_V2}/delivery_Fri-2026-10-23"


PRODUCE_WITH_TYPE = (
    "\ufeffdelivery_Fri-2026-10-23\n(generated 2026-10-23 03:30)\n \n"
    "DELIVERY_WORKSHEET_V1\n\"\"\nitem_id,item_name,type\n1,Apple,produce\n2,Kale,produce\n"
).encode("utf-8")


def test_produce_file_with_type_column_is_still_a_worksheet(client):
    c, store = client
    r = post(c, PRODUCE_WITH_TYPE)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "worksheet"
    assert r.json()["path"] == f"{STORAGE_INCOMING_V2}/delivery_Fri-2026-10-23"

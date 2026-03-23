"""
Item notes API routes.

Notes are keyed by item description and persist across deliveries.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()

COLLECTION = "item_notes"


def _get_db(request: Request):
    svc = request.app.state.delivery_service
    return svc._db if svc._use_firestore else None


def _note_key(description: str) -> str:
    """Sanitize item description for use as Firestore document ID."""
    return description.lower().strip().replace("/", "_")


class NoteBody(BaseModel):
    item_description: str
    note: str


@router.get("/item-notes")
async def get_all_notes(request: Request):
    """Return all item notes as {key: {description, note}}."""
    db = _get_db(request)
    if not db:
        return {"notes": {}}
    docs = db.collection(COLLECTION).stream()
    notes = {}
    for doc in docs:
        data = doc.to_dict()
        notes[doc.id] = {
            "description": data.get("description", ""),
            "note": data.get("note", ""),
        }
    return {"notes": notes}


@router.put("/item-notes")
async def save_note(request: Request, body: NoteBody):
    """Create or update a note for an item."""
    db = _get_db(request)
    key = _note_key(body.item_description)
    data = {
        "description": body.item_description,
        "note": body.note,
    }
    if db:
        db.collection(COLLECTION).document(key).set(data)
    return {"key": key, **data}


@router.delete("/item-notes/{note_key}")
async def delete_note(request: Request, note_key: str):
    """Delete a note."""
    db = _get_db(request)
    if db:
        db.collection(COLLECTION).document(note_key).delete()
    return {"deleted": note_key}

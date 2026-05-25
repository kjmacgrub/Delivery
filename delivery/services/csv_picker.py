"""
CSV picker — selects the current v2 CSV from delivery-files/incoming-v2/.

Selection rule (CSV_IMPORT_POLICY.md §4):
1. Latest line-1 ISO date wins.
2. Tiebreak by line-2 generation timestamp (newer wins).
3. Final tiebreak: Cloud Storage `updated` time.

Only the first ~1KB of each blob is read for the picker decision. Full parse
happens only on the winning file when the caller actually loads it.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

from delivery.config import STORAGE_INCOMING_V2
from delivery.parser.csv_parser import CSVParseError, read_preamble


log = logging.getLogger(__name__)

PREAMBLE_BYTES = 1024


@dataclass
class CSVCandidate:
    path: str
    filename: str
    delivery_date: date
    generated_at: Optional[datetime]
    version: int
    updated: Optional[datetime]


def pick_current_csv(bucket) -> Optional[CSVCandidate]:
    """List incoming-v2/, return the file that wins per CSV_IMPORT_POLICY.md §4.

    Returns None if the folder has no parseable v2 CSV.
    """
    candidates: list[CSVCandidate] = []
    for blob in bucket.list_blobs(prefix=STORAGE_INCOMING_V2 + "/"):
        if blob.name.endswith("/"):
            continue
        # Don't filter by extension — IT sometimes uploads without .csv.
        # The DELIVERY_WORKSHEET_V<n> marker in the preamble is the real format check.
        try:
            head = blob.download_as_bytes(start=0, end=PREAMBLE_BYTES - 1)
            pre = read_preamble(head.decode("utf-8", errors="replace"))
        except CSVParseError as e:
            log.warning("CSV picker: skipping %s — %s", blob.name, e)
            continue
        except Exception as e:  # noqa: BLE001 — log and skip, picker should never crash
            log.warning("CSV picker: failed to read %s — %s", blob.name, e)
            continue
        candidates.append(CSVCandidate(
            path=blob.name,
            filename=blob.name.split("/")[-1],
            delivery_date=pre["delivery_date"],
            generated_at=pre["generated_at"],
            version=pre["version"],
            updated=blob.updated,
        ))

    if not candidates:
        return None

    def sort_key(c: CSVCandidate) -> tuple:
        gen_ts = c.generated_at.timestamp() if c.generated_at else 0.0
        upd_ts = c.updated.timestamp() if c.updated else 0.0
        return (c.delivery_date.toordinal(), gen_ts, upd_ts)

    candidates.sort(key=sort_key, reverse=True)
    return candidates[0]

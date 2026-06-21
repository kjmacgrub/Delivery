# CSV Import Policy

How the Delivery app and the produce-processor decide when to load a new combined CSV vs. preserve in-process work. Companion to [`NEW_CSV_FORMAT.md`](./NEW_CSV_FORMAT.md), which defines the file itself.

Applies to both apps. Each app makes its decision independently using its own state — there is no cross-app handshake.

## 1. Authoritative date

The "delivery date" of a CSV is the ISO date parsed from **line 1** of the file (per `NEW_CSV_FORMAT.md`). Not the filename, not Cloud Storage's `updated` timestamp, not the line-2 generation timestamp.

## 2. Source of truth

Both apps read directly from the Delivery project's Cloud Storage bucket, path `delivery-files/incoming-v2/`. The produce-processor reads cross-bucket (it lives in its own Firebase project for everything else, but the CSV is shared and lives only in the Delivery bucket).

The single CSV is the single source of truth for both apps.

## 3. "Currently loaded date" — where it lives per app

| App | Stored at |
|---|---|
| Delivery | Firestore — the most recent worksheet's `delivery_date` field |
| Produce-processor | Firebase Realtime Database — `pdfDate` |

Both are server-side and shared across devices, so two browsers will agree on what day is "currently loaded."

## 4. Picking "the" CSV for today

When more than one file sits in `delivery-files/incoming-v2/`:

1. Read line 1 of each candidate; pick the file with the **latest** ISO date.
2. If multiple files share that date (IT re-sent with a different filename), tiebreak by **line 2** — the `(generated YYYY-MM-DD HH:MM)` timestamp. Newer wins.
3. If line 2 is missing or unparseable on a tied file, fall back to Cloud Storage's `updated` time.

Re-sends with the *same* filename overwrite in storage, so they don't produce ties.

## 5. "In process" — definition

A loaded day is **in process** if any field on any item has been modified from the original CSV-as-loaded snapshot. That includes:

- Any item marked done / received
- Any quantity, note, or other field edited
- Items manually added or removed
- Any check-in note

The check is "does current state deviate from the original snapshot," not "did the user click something." A typed-then-deleted note that returns the field to its original value is **not** in-process.

Implementation hint: when a CSV is consumed, store the parsed rows as an immutable "original snapshot" alongside the working state. The in-process check is a structural diff against that snapshot.

## 6. Trigger

The freshness check runs on **URL visit and page refresh only**. No background polling.

If a warehouse user has the page open from 5am and IT uploads at 6:30am, no prompt appears until the page is refreshed. This is acceptable — the warehouse workflow naturally involves refreshes, and polling adds complexity for little gain.

## 7. On-visit decision tree

On every page load, each app:

1. List files in `delivery-files/incoming-v2/`. Pick the right one per §4.
2. If no CSV exists, fall back per §10 (PDFs → empty).
3. Parse line 1 → `csvDate`. Read the app's currently-loaded date → `loadedDate`.
4. Branch:
   - **`loadedDate` is empty** → load `csvDate` silently.
   - **`csvDate > loadedDate`**:
     - If `loadedDate` is **not in process** → load `csvDate` silently, archive the empty/untouched prior day (no-op if it was empty).
     - If `loadedDate` **is in process** and `loadedDate` **is older than today** → the loaded day is stale (left open from a prior day). Archive it *as-is* (unreceived items stay unreceived) and load `csvDate` silently. Do **not** mark the stale day's items received. (Server action `load-archive`; endpoint `POST /csv-archive-complete`.)
     - If `loadedDate` **is in process** and `loadedDate` **is today** → keep the loaded day; ignore the new CSV (server action `prompt`). Today's active work is never auto-replaced.
   - **`csvDate == loadedDate`**:
     - If `csvDate` matches `loadedDate` but the file content differs from the loaded snapshot (same-day re-send by IT) → out of scope for v1. Treat as no-op. Document as a known limitation; revisit if it happens in practice.
   - **`csvDate < loadedDate`** → no-op. (Shouldn't happen unless IT uploads a backdated file.)

## 8. Bulk-action prompt UX

Modal, blocking, on page load. Names the date and the item count. Per-app copy:

**Delivery:**
> A new worksheet is available for **Mon, May 25, 2026**.
> The current worksheet (**Sun, May 24, 2026**) has **87 items**, **62** still unreceived.
> Mark all remaining items as received and load the new worksheet?
>
> [Cancel] [Mark all received & load new worksheet]

**Produce-processor:**
> A new processing file is available for **Mon, May 25, 2026**.
> The current file (**Sun, May 24, 2026**) has **42 items**, **15** still unprocessed.
> What should happen to the unprocessed items?
>
> [Cancel] [Reckon item-by-item] [Mark all done & load new file]

Behavior:

- **Cancel** dismisses the modal. The new CSV is not loaded; the in-process day stays. Prompt re-appears on next page load.
- **Mark all done & load new file** (Delivery and processor):
  1. Archive the current day's state to its daily log (Delivery already does this for completed days — extend to bulk-close case).
  2. Bulk-mark the remaining items.
  3. Load the new CSV.
  4. Show a brief "Yesterday's worksheet archived — [view log]" toast for ~10 seconds, in case of mis-click.
- **Reckon item-by-item** (processor only): hand off to the existing reckoning flow (`pendingLoad` → `finishReckoning` in `produce-processor/src/App.jsx`). For each unfinished item, the user picks **carry over** (with an editable case count) or **mark done**. Carried items are re-inserted into the new day with `carryover: true` and sort to the top. Same archive-before-mutation guarantee as §9.

No double-confirm. The single modal with the explicit item count is the friction.

Delivery does not get the reckoning option in v1. If "carry over unreceived items to tomorrow" becomes useful for Delivery, we can add it later — but the warehouse workflow today is "every item is received the day it arrives," so there's no demand for it.

## 9. Archive before bulk-mark

The archive happens *before* the bulk-mark mutation, not after. If the archive write fails, the bulk-mark is aborted and the modal stays open — better to leave the user in the old state than to lose data.

## 10. Transition fallback (CSV → PDFs → nothing)

Priority order on page load:

1. CSV available in `incoming-v2/` for today's date → use it.
2. No CSV, but the legacy PDFs are present → fall back to the existing PDF pipeline.
3. Neither → empty state, no error.

This contradicts `NEW_CSV_FORMAT.md`'s "hard cutover, no overlap" line. The intent is still a hard cutover, but with a short safety net during the first days of CSV use so we can hand-generate PDFs if the CSV pipeline misbehaves. The PDF code path stays in place but is not actively developed.

Sunset criteria: after N consecutive days of successful CSV-only operation (suggest N=14), delete the PDF code path entirely.

## 11. `/ingest` — unchanged

The existing `POST /ingest` endpoint (header-authenticated, marker-validated, writes to `incoming-v2/`) stays as-is. It does not need to dedupe, reject duplicates, or be aware of in-process state. All "which file is current" logic lives in the apps' read path (§4).

## 12. Out of scope for v1

- **Same-date re-send with content drift.** If IT re-uploads a file for a date that's already loaded and in process, the new content is ignored. We'll revisit if this becomes a real pain point.
- **Manual "force reload" button.** Not needed for v1 — the cancel/confirm cycle on the prompt covers it.
- **Undo of a bulk-mark.** The toast linking to the archived log is the recovery path. A true undo would need to restore working state from the archive, which we can build if needed.
- **Cross-app coordination.** Delivery's bulk-mark and processor's bulk-mark are independent. Both apps may prompt the same morning; closing the prompt in one has no effect on the other.

## 13. Open items needing decisions

None blocking implementation. The contradictions with `NEW_CSV_FORMAT.md` (the "hard cutover" line) and the same-date-redrift behavior (§12) should be noted in `NEW_CSV_FORMAT.md` or this doc should be the prevailing source — pick one.

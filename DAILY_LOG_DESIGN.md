# Daily Log — Shared Report Design

## Overview

A unified daily log that captures the full picture of each delivery day: what was expected, what was received (exceptions), what was processed (timing, photos, notes), and what was pulled for the floor. Both the Delivery app and Produce Processor contribute data; both apps can browse historical logs.

Logs persist for 7 days, then auto-clean.

## Infrastructure

| App | Firebase Project | Current Storage |
|-----|-----------------|-----------------|
| Delivery | `delivery-worksheet-app` | Firestore: `deliveries`, `delivery_reports`, `item_notes` |
| Produce Processor | `process-6d2dc` | RTDB: `/items`, `/completedItems`, `/completionPhotos`, `/notes`, `/timingEvents` |

**Decision: Firestore in `delivery-worksheet-app` is the hub for daily logs.**

Rationale:
- Delivery app already owns the Firestore backend + API
- Firestore supports date-range queries natively
- Delivery API is already called by produce-processor (O/S endpoint)
- Adding endpoints to the existing API is simpler than cross-project Firebase access

**Completion photos move to Firebase Storage in `delivery-worksheet-app`** at snapshot time, referenced by URL in the log. This avoids base64 bloat in Firestore docs and puts all persistent data in one project.

## Firestore Schema

```
dailyLogs/{YYYY-MM-DD}/
│
├── metadata
│   ├── date: string (YYYY-MM-DD)
│   ├── dayOfWeek: string
│   ├── deliveryId: string (ref to deliveries collection)
│   ├── sourceFilename: string
│   ├── snapshotAt: datetime
│   ├── totalItemsExpected: int
│   ├── totalCasesExpected: int
│   ├── totalItemsReceived: int
│   ├── totalCasesReceived: int
│   ├── totalItemsProcessed: int
│   ├── totalCasesProcessed: int
│   └── status: "partial" | "complete"
│
├── exceptions (subcollection)
│   └── {itemId}/
│       ├── supplierName: string
│       ├── rawDescription: string
│       ├── quantityExpected: int
│       ├── quantityReceived: int | null
│       ├── receivedStatus: "SHORT" | "OVER" | "RETURN"
│       ├── receivedNotes: string | null
│       └── checkedInAt: datetime | null
│
├── pulls (subcollection)
│   └── {itemId}/
│       ├── supplierName: string
│       ├── rawDescription: string
│       ├── pullQuantity: int
│       ├── pullConfirmed: bool
│       └── pullSubmitted: bool
│
├── processing (subcollection)
│   └── {sku}/
│       ├── itemName: string
│       ├── cases: int
│       ├── completedAt: datetime | null
│       ├── totalTime: float (seconds) | null
│       ├── timePerCase: float (seconds) | null
│       ├── photoUrl: string | null (Storage URL)
│       └── carryover: bool
│
├── notes (subcollection)
│   └── {noteId}/
│       ├── type: "item" | "freeform" | "delivery"
│       ├── source: "produce-processor" | "delivery"
│       ├── itemName: string | null (null for freeform)
│       ├── itemSku: string | null
│       ├── text: string
│       └── createdAt: datetime
│
└── outOfStock (subcollection)
    └── {itemId}/
        ├── supplierName: string
        ├── rawDescription: string
        └── quantityExpected: int
```

## Firebase Storage (Photos)

```
daily-logs/{YYYY-MM-DD}/{sku}.jpg
```

Photos are copied from produce-processor's RTDB (base64) to delivery-worksheet-app's Storage as JPEGs at snapshot time. The `photoUrl` field in the processing subcollection stores the download URL.

## API Endpoints (Delivery App)

### Write (called by each app)

```
POST /api/v1/daily-logs/{date}/snapshot-delivery
```
Called when delivery is completed (or manually). Copies current delivery data into the daily log: exceptions, pulls, O/S items, metadata.

```
POST /api/v1/daily-logs/{date}/snapshot-processing
Content-Type: application/json
{
  "completedItems": [...],
  "timingEvents": {...},
  "notes": { "itemNotes": {...}, "freeformNotes": {...} },
  "photos": { "sku": "base64data", ... }
}
```
Called by produce-processor at end of day (or on demand). Receives processing data, writes to log, uploads photos to Storage.

```
POST /api/v1/daily-logs/{date}/notes
Content-Type: application/json
{
  "type": "item" | "freeform" | "delivery",
  "source": "produce-processor" | "delivery",
  "itemName": "optional",
  "itemSku": "optional",
  "text": "the note"
}
```
Either app can post notes throughout the day (doesn't require a full snapshot).

### Read (used by both apps)

```
GET /api/v1/daily-logs
```
Returns list of available dates with summary counts (exceptions, notes, items processed). Last 7 days.

```
GET /api/v1/daily-logs/{date}
```
Returns full log for a date: metadata + all subcollections.

```
GET /api/v1/daily-logs/{date}/exceptions
GET /api/v1/daily-logs/{date}/processing
GET /api/v1/daily-logs/{date}/notes
GET /api/v1/daily-logs/{date}/pulls
```
Individual sections if the full log is too heavy.

### Cleanup

```
DELETE /api/v1/daily-logs/cleanup
```
Called on schedule or at startup. Removes logs older than 7 days, including Storage photos.

## Data Flow

### During the Day (Progressive)

```
Delivery App                          Firestore
    │                                     │
    ├── Item checked in ──────────────────┤ (live in deliveries collection, as today)
    ├── Exception noted ──────────────────┤
    ├── Pull confirmed ───────────────────┤
    │                                     │
Produce Processor                     Firebase RTDB
    │                                     │
    ├── Item completed ───────────────────┤ (live in RTDB, as today)
    ├── Note added ───────────────────────┤
    ├── Photo taken ──────────────────────┤
```

Both apps continue to work exactly as they do now during the day. No changes to the live workflow.

### End of Day (Snapshot)

```
Delivery App                          Firestore dailyLogs
    │                                     │
    ├── POST /snapshot-delivery ──────────┤ exceptions, pulls, O/S, metadata
    │                                     │
Produce Processor                         │
    │                                     │
    ├── POST /snapshot-processing ────────┤ completed items, timing, notes
    │   (includes base64 photos)          │
    │                                 Firebase Storage
    │                                     │
    │                              daily-logs/{date}/{sku}.jpg
```

### Browsing History (Either App)

```
Any App                               Firestore dailyLogs
    │                                     │
    ├── GET /daily-logs ──────────────────┤ date list with summaries
    ├── GET /daily-logs/{date} ───────────┤ full combined report
```

## Snapshot Trigger Options

1. **Manual button** in each app ("Save today's log") — simplest, most control
2. **Auto on delivery complete** — delivery snapshot fires when `POST /complete` is called
3. **Auto on produce day-change** — processing snapshot fires during the reckoning flow (before clearing)
4. **Scheduled** — Cloud Run cron job at midnight, pulls from both sources

**Recommendation: Option 3 + 2, with manual fallback.**
- Delivery snapshot fires automatically when the delivery is marked complete
- Processing snapshot fires automatically during reckoning (new day data arriving)
- Both apps also have a manual "Save to log" button for ad-hoc snapshots
- This means the snapshot captures the state right before the data would be cleared

## Build Order

### Phase 1: Firestore Schema + API
1. Add `dailyLogs` collection handling to delivery service
2. Add `/api/v1/daily-logs/*` endpoints
3. Add 7-day cleanup logic
4. Add photo upload to Storage helper

### Phase 2: Delivery App Integration
5. Auto-snapshot on delivery complete
6. Manual "Save log" button
7. "History" view in delivery app UI

### Phase 3: Produce Processor Integration
8. Snapshot call during reckoning flow (before clear)
9. Manual "Save log" button
10. "History" view in produce-processor UI
11. Photo migration: base64 → Storage upload at snapshot time

### Phase 4: Shared Report View
12. Combined report view accessible from both apps
13. Date picker → exceptions + processing + notes + photos in one view

## Migration Notes

- Instruction videos (`produce-videos/{sku}.webm`) stay in `process-6d2dc` Storage — they're persistent reference material, not daily
- Historical timing averages (`/historicalTimes/{sku}`) stay in RTDB — they're running averages, not daily
- Item notes in Firestore (`item_notes` collection) are persistent per-item notes in the delivery app — separate from daily log notes
- The daily wipe flow doesn't change — it just gains a "snapshot first" step

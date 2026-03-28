"""
Daily Log endpoints: snapshot, read, and cleanup of daily reports
combining delivery exceptions and produce processing data.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Optional, List, Dict

router = APIRouter()


def _get_service(request: Request):
    return request.app.state.delivery_service


def _get_log_service(request: Request):
    return request.app.state.daily_log_service


# ---- Request models ----

class ProcessingSnapshotRequest(BaseModel):
    completedItems: List[dict] = []
    timingEvents: Dict[str, list] = {}
    notes: dict = {}
    photos: Dict[str, str] = {}


class NoteRequest(BaseModel):
    type: str = "freeform"  # "item" | "freeform" | "delivery"
    source: str = "unknown"  # "produce-processor" | "delivery"
    itemName: Optional[str] = None
    itemSku: Optional[str] = None
    text: str


# ---- Snapshot endpoints ----

@router.post("/daily-logs/{date_key}/snapshot-delivery")
async def snapshot_delivery(date_key: str, request: Request):
    """
    Snapshot current delivery data into the daily log.
    Finds the delivery matching the given date and captures
    exceptions, pulls, O/S items, and metadata.
    """
    service = _get_service(request)
    log_service = _get_log_service(request)

    # Find delivery for this date
    deliveries = service.list_deliveries()
    target = None
    for summary in deliveries:
        delivery = service.get_delivery(summary.id)
        if delivery and delivery.delivery_date and delivery.delivery_date.isoformat() == date_key:
            target = delivery
            break

    if not target:
        raise HTTPException(status_code=404, detail=f"No delivery found for date {date_key}")

    metadata = log_service.snapshot_delivery(target)
    return {"status": "ok", "metadata": metadata}


@router.post("/daily-logs/{date_key}/snapshot-processing")
async def snapshot_processing(date_key: str, body: ProcessingSnapshotRequest, request: Request):
    """
    Snapshot produce processing data into the daily log.
    Called by produce-processor app at end of day or during reckoning.
    """
    log_service = _get_log_service(request)
    result = log_service.snapshot_processing(date_key, body.model_dump())
    return {"status": "ok", **result}


@router.post("/daily-logs/{date_key}/notes")
async def add_note(date_key: str, body: NoteRequest, request: Request):
    """Add a single note to the daily log. Either app can call this."""
    log_service = _get_log_service(request)
    result = log_service.add_note(date_key, body.model_dump())
    return {"status": "ok", "note": result}


# ---- Read endpoints ----

@router.get("/daily-logs")
async def list_logs(request: Request):
    """List available daily logs with summary counts. Last 7 days."""
    log_service = _get_log_service(request)
    logs = log_service.list_logs()
    return {"logs": logs, "total": len(logs)}


@router.get("/daily-logs/search")
async def search_logs(q: str, request: Request):
    """Search across all recent daily logs for items matching a query.

    Returns matches grouped by date with section type and item details.
    Example: /daily-logs/search?q=asparagus
    """
    log_service = _get_log_service(request)
    results = log_service.search_logs(q)
    total_hits = sum(len(r["hits"]) for r in results)
    return {"query": q, "results": results, "totalHits": total_hits}


@router.get("/daily-logs/{date_key}/report", response_class=HTMLResponse)
async def daily_log_report(date_key: str, request: Request):
    """Render a combined daily report as a standalone, print-friendly HTML page."""
    log_service = _get_log_service(request)
    log = log_service.get_log(date_key)
    if not log:
        raise HTTPException(status_code=404, detail=f"No log found for {date_key}")
    return _render_report_html(log, date_key)


@router.get("/daily-logs/{date_key}")
async def get_log(date_key: str, request: Request):
    """Get full daily log for a date including all sections."""
    log_service = _get_log_service(request)
    log = log_service.get_log(date_key)
    if not log:
        raise HTTPException(status_code=404, detail=f"No log found for {date_key}")
    return log


@router.get("/daily-logs/{date_key}/{section}")
async def get_log_section(date_key: str, section: str, request: Request):
    """Get a single section of a daily log (exceptions, pulls, processing, notes, outOfStock)."""
    log_service = _get_log_service(request)
    data = log_service.get_log_section(date_key, section)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Section '{section}' not found for {date_key}")
    return {"items": data, "total": len(data)}


# ---- Cleanup ----

@router.delete("/daily-logs/cleanup")
async def cleanup_old_logs(request: Request):
    """Delete daily logs older than 7 days, including photos."""
    log_service = _get_log_service(request)
    deleted = log_service.cleanup_old_logs()
    return {"status": "ok", "deleted": deleted}


# ---- Report HTML renderer ----

def _render_report_html(log: dict, date_key: str) -> str:
    """Build a self-contained, print-friendly HTML report."""
    from html import escape as esc

    dow = esc(log.get("dayOfWeek", ""))
    status = esc(log.get("status", "partial"))
    items_exp = log.get("totalItemsExpected", 0)
    cases_exp = log.get("totalCasesExpected", 0)
    items_rcv = log.get("totalItemsReceived", 0)
    cases_rcv = log.get("totalCasesReceived", 0)
    items_proc = log.get("totalItemsProcessed", 0)
    cases_proc = log.get("totalCasesProcessed", 0)

    # Exceptions
    exceptions = log.get("exceptions", [])
    exc_rows = ""
    for e in exceptions:
        st = esc(e.get("receivedStatus", ""))
        st_class = "short" if st == "SHORT" else "over" if st == "OVER" else "return"
        notes_html = f'<div class="note">{esc(e.get("receivedNotes", ""))}</div>' if e.get("receivedNotes") else ""
        exc_rows += f"""<tr>
            <td><span class="tag {st_class}">{st}</span></td>
            <td class="name">{esc(e.get("rawDescription", ""))}</td>
            <td class="num">{e.get("quantityReceived", "?")}/{e.get("quantityExpected", "?")}</td>
            <td class="dim">{esc(e.get("supplierName", ""))}</td>
        </tr>{f'<tr><td></td><td colspan="3">{notes_html}</td></tr>' if notes_html else ''}"""

    # Pulls
    pulls = log.get("pulls", [])
    pull_rows = ""
    for p in pulls:
        conf = "&#10003;" if p.get("pullConfirmed") else "&#9675;"
        pull_rows += f"""<tr>
            <td class="num">{p.get("pullQuantity", 0)}</td>
            <td class="name">{esc(p.get("rawDescription", ""))}</td>
            <td>{conf}</td>
            <td class="dim">{esc(p.get("supplierName", ""))}</td>
        </tr>"""

    # Processing
    processing = log.get("processing", [])
    proc_rows = ""
    for p in processing:
        time_str = ""
        if p.get("totalTime"):
            mins = round(p["totalTime"] / 60)
            time_str = f"{mins}m"
            if p.get("timePerCase"):
                time_str += f" ({round(p['timePerCase'])}s/cs)"
        photo = f'<a href="{esc(p["photoUrl"])}" target="_blank">view</a>' if p.get("photoUrl") else ""
        carry = ' <span class="tag carry">carry</span>' if p.get("carryover") else ""
        proc_rows += f"""<tr>
            <td class="name">{esc(p.get("itemName", ""))}{carry}</td>
            <td class="num">{p.get("cases", 0)}</td>
            <td class="dim">{time_str}</td>
            <td>{photo}</td>
        </tr>"""

    # Out of stock
    oos = log.get("outOfStock", [])
    oos_rows = ""
    for o in oos:
        oos_rows += f"""<tr>
            <td class="name">{esc(o.get("rawDescription", ""))}</td>
            <td class="dim">{esc(o.get("supplierName", ""))}</td>
            <td class="num">{o.get("quantityExpected", 0)}</td>
        </tr>"""

    # Notes
    notes = log.get("notes", [])
    note_rows = ""
    for n in notes:
        icon = {"item": "&#128230;", "delivery": "&#128666;", "freeform": "&#128221;"}.get(n.get("type"), "&#128221;")
        src = "Processing" if n.get("source") == "produce-processor" else "Delivery"
        item_label = f'<strong>{esc(n.get("itemName", ""))}</strong> ' if n.get("itemName") else ""
        note_rows += f"""<tr>
            <td>{icon}</td>
            <td>{item_label}{esc(n.get("text", ""))}</td>
            <td class="dim">{src}</td>
        </tr>"""

    def section(title, count, table_html, empty_msg="None"):
        if not table_html:
            return f'<div class="section"><h2>{title}</h2><p class="empty">{empty_msg}</p></div>'
        return f'<div class="section"><h2>{title} <span class="count">{count}</span></h2><table>{table_html}</table></div>'

    status_color = "#166534" if status == "complete" else "#854d0e"
    status_bg = "#dcfce7" if status == "complete" else "#fef9c3"

    proc_meta = ""
    if cases_proc:
        proc_meta = f" &middot; {cases_proc} cases processed ({items_proc} items)"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Log — {esc(date_key)}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    background: #f5f5f7; color: #1d1d1f; font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased; padding: 1rem;
  }}
  .report {{ max-width: 700px; margin: 0 auto; background: white; border-radius: 16px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }}
  .header {{ padding: 1.25rem 1.5rem; border-bottom: 1px solid #e5e5ea; }}
  .header h1 {{ font-size: 1.5rem; font-weight: 800; color: #1d1d1f; }}
  .header .meta {{ font-size: 0.85rem; color: #6e6e73; margin-top: 0.25rem; }}
  .status {{ display: inline-block; font-size: 0.75rem; font-weight: 700;
    padding: 2px 10px; border-radius: 10px; background: {status_bg}; color: {status_color}; }}
  .section {{ padding: 1rem 1.5rem; border-bottom: 1px solid #f0f0f2; }}
  .section:last-child {{ border-bottom: none; }}
  .section h2 {{ font-size: 0.9rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: #6e6e73; margin-bottom: 0.5rem; }}
  .count {{ font-size: 0.75rem; background: #f0f0f2; padding: 1px 7px; border-radius: 8px; }}
  table {{ width: 100%; border-collapse: collapse; }}
  td {{ padding: 5px 6px; vertical-align: top; }}
  tr {{ border-bottom: 1px solid #f5f5f7; }}
  tr:last-child {{ border-bottom: none; }}
  .name {{ font-weight: 600; }}
  .num {{ white-space: nowrap; text-align: right; }}
  .dim {{ font-size: 0.8rem; color: #8e8e93; }}
  .note {{ font-size: 0.8rem; color: #8e8e93; font-style: italic; }}
  .empty {{ font-size: 0.85rem; color: #8e8e93; font-style: italic; padding: 0.25rem 0; }}
  .tag {{ font-size: 0.65rem; font-weight: 700; padding: 2px 6px; border-radius: 4px;
    text-transform: uppercase; white-space: nowrap; }}
  .short {{ background: #fee2e2; color: #991b1b; }}
  .over {{ background: #dbeafe; color: #1e40af; }}
  .return {{ background: #fef3c7; color: #92400e; }}
  .carry {{ background: #e0e7ff; color: #3730a3; }}
  a {{ color: #007aff; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  @media print {{
    body {{ background: white; padding: 0; }}
    .report {{ box-shadow: none; border-radius: 0; }}
    .no-print {{ display: none; }}
  }}
  .print-bar {{ text-align: right; padding: 0.75rem 1.5rem 0; }}
  .print-bar button {{ font-size: 0.85rem; padding: 6px 16px; border: 1px solid #d2d2d7;
    border-radius: 8px; background: white; color: #1d1d1f; cursor: pointer; font-weight: 600; }}
  .print-bar button:hover {{ background: #f5f5f7; }}
</style>
</head>
<body>
<div class="report">
  <div class="print-bar no-print"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="header">
    <h1>{dow} {esc(date_key)} <span class="status">{status}</span></h1>
    <div class="meta">
      {cases_exp} cases expected ({items_exp} items) &middot;
      {cases_rcv} cases received ({items_rcv} items){proc_meta}
    </div>
  </div>
  {section("Notes", len(notes), note_rows, "No notes")}
  {section("Out of Stock", len(oos), oos_rows, "None")}
  {section("Processing", len(processing), proc_rows, "No processing data")}
  {section("Exceptions", len(exceptions), exc_rows, "No exceptions")}
  {section("Pulls", len(pulls), pull_rows, "No pulls")}
</div>
</body>
</html>"""
    return html

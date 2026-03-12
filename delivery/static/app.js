/**
 * Delivery Check-In App
 * iPad-optimized web app for produce delivery receiving.
 */

const API = '/api/v1';

// ---- Version History ----
const VERSION_HISTORY = [
    { version: 'v1.43', description: 'Street button in header, supplier name in modal, UX polish and label updates' },
    { version: 'v1.42', description: 'Remove landing page; go straight to import when no active delivery' },
    { version: 'v1.41', description: 'Cache busters use commit hash; version number only bumps on request' },
    { version: 'v1.41', description: 'Confirmed label stacked above checkbox, pushed right of Floor Pull label' },
    { version: 'v1.40', description: 'Pull confirmed checkbox sits next to Floor Pull label, steppers stay aligned' },
    { version: 'v1.39', description: 'Pull confirmed checkbox moves inline above + button in modal' },
    { version: 'v1.38', description: 'Bold supplier headings in Live Report' },
    { version: 'v1.37', description: 'Remove Switch Delivery from menu; import or continue only' },
    { version: 'v1.36', description: 'Suppliers pill toggles expand/collapse; remove Expand All pill' },
    { version: 'v1.35', description: 'Suppliers accordion is the default view' },
    { version: 'v1.34', description: 'Multi button shares centered position with Expand All' },
    { version: 'v1.33', description: 'Sort bar: Suppliers/Items/Cases order, centered Expand All, Multi filter' },
    { version: 'v1.32', description: 'Adjustment rows show quantity and status label for all types' },
    { version: 'v1.31', description: 'Remove summary stat lines from all reports; show item detail only' },
    { version: 'v1.30', description: 'Live Report pulls are interactive: tappable rows to confirm/unconfirm' },
    { version: 'v1.29', description: 'Report item detail: names and supplier shown below case totals' },
    { version: 'v1.28', description: 'Case-centric reports: show aggregate case totals instead of item rows' },
    { version: 'v1.27', description: 'Pulls included in completion modal and completed delivery reports' },
    { version: 'v1.26', description: 'Live Report section headings; rename View Reports to View Past Deliveries' },
    { version: 'v1.25', description: 'Combined Live Report (adjustments + pulls) in hamburger menu' },
    { version: 'v1.24', description: 'Continue Delivery option in hamburger menu' },
    { version: 'v1.23', description: 'Delivery-first nav: auto-open active delivery, hamburger admin menu' },
    { version: 'v1.22', description: 'Floor Pull inline with Qty Received; pull sheet syncs to item list' },
    { version: 'v1.21', description: 'Manual floor pull stepper + Pull Sheet screen' },
    { version: 'v1.20', description: 'Add commit hash to version display' },
    { version: 'v1.19', description: 'Single-item unreceive, landing page polish, friendly filenames' },
    { version: 'v1.12', description: 'Adjustments rename, pull confirmation, supplier sort, UI polish' },
    { version: 'v1.06', description: 'Adjustments rename, notes in reports, header cleanup' },
    { version: 'v1.02', description: 'Pull confirmation, auto-detect suppliers, live adjustments, cross-supplier view' },
    { version: 'v1.01', description: 'Landing page refinements, inline reports, navigation fixes' },
    { version: 'v1.00', description: 'Landing page, app title, version history' },
    { version: 'v0.29', description: 'Firestore real-time listeners for live cross-iPad updates' },
    { version: 'v0.28', description: 'Supplier accordion, progress bars, expand/collapse, report deletion' },
    { version: 'v0.27', description: 'Pull quantity, reports viewer, layout redesign, UX improvements' },
    { version: 'v0.26', description: 'Bulk receive/unreceive, Receive All, Delivery Complete flow' },
    { version: 'v0.25', description: 'Fix floor-pull quantities and merge duplicate supplier blocks' },
    { version: 'v0.24', description: 'Initial delivery worksheet parser, API, and iPad check-in UI' },
];

// ---- Firebase Real-time ----
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAwLYQgXOfYo9wXh8IWJgMldPpxsKU_p50",
    authDomain: "delivery-worksheet-app.firebaseapp.com",
    projectId: "delivery-worksheet-app",
    storageBucket: "delivery-worksheet-app.firebasestorage.app",
    messagingSenderId: "481756503401",
    appId: "1:481756503401:web:d0b31495ce5af4824a31f8"
};

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

// ---- State ----
let currentView = 'storage';
let currentDelivery = null;
let currentSupplierIdx = null;
let checkInItem = null; // { supplierIdx, itemIdx }
let pullPopupItem = null; // { supplierIdx, itemIdx }
let supplierFilter = null; // null = show all, or { idx, name } to filter to one supplier
let itemSortMode = 'supplier'; // 'alpha', 'qty', or 'supplier'
let multiFilter = false;   // show only items shared across 2+ suppliers
let showReceived = false; // false = show pending items, true = show received items
let searchQuery = ''; // search filter for item list
let completionShown = false; // prevent duplicate completion modal
let expandedSuppliers = new Set(); // supplier indices expanded in accordion view
let expandedLocations = new Set(); // location zone keys expanded in accordion view
let highCountData = null; // { lowercase_item_name: { sat, sun, mon } } or null
let inventoryData = null; // { lowercase_item_name: { name, basement_location, floor_location } } or null

// ---- Real-time Listener State ----
let activeUnsubscribes = [];       // functions to call to tear down listeners
let pendingDeliveryUpdate = null;  // snapshot data waiting for modal to close
let lastWriteTimestamp = 0;        // to debounce our own writes

// ---- Navigation ----
const views = ['deliveries', 'storage', 'detail', 'complete', 'reports', 'pullsheet'];

function showView(name) {
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        el.classList.toggle('active', v === name);
    });
    currentView = name;

    const title = document.getElementById('page-title');
    const badge = document.getElementById('status-badge');
    const brandText = document.getElementById('header-brand-text');
    document.getElementById('app-header').classList.remove('street-view-active');

    // Always show delivery date in brand text when a delivery is loaded
    brandText.textContent = currentDelivery
        ? `${currentDelivery.day_of_week} ${formatDate(currentDelivery.delivery_date)}`
        : '';

    switch (name) {

        case 'deliveries':
            title.textContent = '(Main View)';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'storage':
            title.textContent = '(Main View)';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'detail':
            title.textContent = '(Main View)';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'complete':
            title.textContent = '(Main View)';
            badge.textContent = 'completed';
            badge.className = 'badge badge-completed';
            break;
        case 'reports':
            title.textContent = '(Main View)';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'pullsheet':
            title.textContent = '(Street View)';
            badge.textContent = '';
            badge.className = 'badge';
            document.getElementById('app-header').classList.add('street-view-active');
            break;
    }
}

function goHome() {
    if (currentDelivery && currentDelivery.status !== 'completed') {
        // Active delivery exists — go (back) to it
        if (currentView !== 'detail') {
            showView('detail');
        }
    } else {
        showNoDeliveryScreen();
    }
}

function goBack() {
    switch (currentView) {
        case 'detail':
            // Clear supplier filter if active; otherwise do nothing (delivery is home)
            if (supplierFilter !== null) {
                clearSupplierFilter();
            }
            break;
        case 'pullsheet':
            showView('detail');
            break;
        case 'storage':
        case 'deliveries':
        case 'reports':
            if (currentDelivery && currentDelivery.status !== 'completed') {
                showView('detail');
            } else {
                showNoDeliveryScreen();
            }
            break;
        case 'complete':
            goHome();
            break;
    }
}

function showNoDeliveryScreen() {
    cleanupListeners();
    currentDelivery = null;
    currentSupplierIdx = null;
    completionShown = false;
    supplierFilter = null;
    updateLiveStatusBtn();
    showStorageFiles();
}

// ---- Live Status Button ----
function updateLiveStatusBtn() {
    const active = currentDelivery && currentDelivery.status !== 'completed';
    const liveBtn = document.getElementById('live-status-btn');
    if (liveBtn) liveBtn.classList.toggle('hidden', !active);
    const continueBtn = document.getElementById('header-continue-btn');
    if (continueBtn) continueBtn.classList.toggle('hidden', !active);
}

// ---- Admin Menu ----
function openAdminModal() {
    document.getElementById('admin-modal').classList.remove('hidden');
    loadFileStatusPanel();
}

function closeAdminModal() {
    document.getElementById('admin-modal').classList.add('hidden');
}

function showCloverHelp(type) {
    const titles = { delivery: 'Delivery worksheet', highcount: 'High count', inventory: 'Inventory worksheet' };
    const imgs = { delivery: '/static/images/clover-delivery.png', highcount: '/static/images/clover-highcount.png', inventory: '/static/images/clover-inventory.png' };
    document.getElementById('clover-help-title').textContent = 'Where to find: ' + titles[type];
    document.getElementById('clover-help-img').src = imgs[type];
    document.getElementById('clover-help-modal').classList.remove('hidden');
}

async function loadFileStatusPanel() {
    const container = document.getElementById('file-status-rows');
    container.innerHTML = '<div style="color:#94a3b8;font-size:14px">Loading...</div>';
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    try {
        const [storageRes, downloadsRes] = await Promise.all([
            fetch('/api/v1/storage/files'),
            fetch('/api/v1/local/downloads-scan').catch(() => null),
        ]);
        const data = await storageRes.json();
        const downloads = downloadsRes && downloadsRes.ok ? await downloadsRes.json() : {};
        const files = data.files || [];
        const delivery = files.filter(f => f.name.toLowerCase().includes('delivery') && f.name.toLowerCase().includes('worksheet'));
        const highcount = files.filter(f => f.name.toLowerCase().includes('high_count'));
        const inventory = files.filter(f => f.name.toLowerCase().includes('inventory'));
        const fmtTime = iso => {
            if (!iso) return '';
            const d = new Date(iso);
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        };
        const fmtDate = iso => {
            if (!iso) return '';
            const d = new Date(iso);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };
        const rows = [
            { label: 'Delivery worksheet', type: 'delivery', match: delivery, needsToday: true },
            { label: 'High count', type: 'highcount', match: highcount, needsToday: true },
            { label: 'Inventory', type: 'inventory', match: inventory, needsToday: false },
        ];
        rows.forEach(row => {
            const latest = row.match[0];
            const input = document.getElementById(`upload-input-${row.type}`);
            if (input) input.dataset.existingUpdated = latest && latest.updated ? latest.updated : '';
        });
        container.innerHTML = rows.map(row => {
            const latest = row.match[0];
            const hasToday = latest && latest.name.includes(todayStr);
            const ok = row.needsToday ? hasToday : !!latest;
            const existingMs = latest && latest.updated ? new Date(latest.updated).getTime() : 0;
            const localFile = downloads[row.type];
            const localMs = localFile ? new Date(localFile.modified).getTime() : 0;
            const localIsNewer = localFile && localMs > existingMs;

            const uploadedAt = latest && latest.updated
                ? `${fmtDate(latest.updated)} ${fmtTime(latest.updated)}`
                : 'Not uploaded';

            // Build the info lines
            let infoHtml = `<div style="font-size:12px;color:#64748b">${uploadedAt}</div>`;
            if (localFile) {
                const localLabel = localIsNewer
                    ? `<span style="color:#10b981;font-weight:700">Available: </span>${fmtDate(localFile.modified)} ${fmtTime(localFile.modified)}`
                    : `<span style="color:#94a3b8">In Downloads: </span>${fmtDate(localFile.modified)} ${fmtTime(localFile.modified)} <span style="color:#94a3b8">(same or older)</span>`;
                infoHtml += `<div style="font-size:11px;margin-top:2px">${localLabel}</div>`;
            }

            const uploadBtn = !ok
                ? `<button onclick="document.getElementById('upload-input-${row.type}').click()" style="padding:4px 12px;background:#f59e0b;color:white;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Upload</button>`
                : localIsNewer
                    ? `<button onclick="document.getElementById('upload-input-${row.type}').click()" style="padding:4px 10px;background:#f59e0b;color:white;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Replace</button>`
                    : `<button onclick="document.getElementById('upload-input-${row.type}').click()" style="padding:4px 10px;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Replace</button>`;

            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:${ok?'#f0fdf4':'#fff7ed'};border-radius:8px;border:1px solid ${ok?'#10b981':'#f59e0b'}">
                <span style="font-size:18px">${ok?'✅':'⚠️'}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:14px;color:#1e293b">${row.label}</div>
                    ${infoHtml}
                </div>
                ${uploadBtn}
                <button onclick="showCloverHelp('${row.type}')" style="padding:4px 8px;background:#f1f5f9;color:#64748b;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" title="Where to find this in Clover">?</button>
            </div>`;
        }).join('');
    } catch(e) {
        container.innerHTML = '<div style="color:#ef4444;font-size:14px">Could not load file status</div>';
    }
}

async function handleTypedUpload(event, type) {
    const file = event.target.files[0];
    const existingUpdated = event.target.dataset.existingUpdated || '';
    event.target.value = '';
    if (!file) return;
    if (existingUpdated) {
        const existingMs = new Date(existingUpdated).getTime();
        if (file.lastModified <= existingMs) {
            showToast(`Not uploaded — file is not newer than current version (${new Date(existingUpdated).toLocaleString()})`, 'error');
            return;
        }
    }
    showToast(`Uploading ${file.name}...`, 'info');
    try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/v1/storage/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        showToast(`Uploaded: ${file.name}`, 'success');
        loadFileStatusPanel();
    } catch (err) {
        showToast(`Upload failed: ${err.message}`, 'error');
    }
}


// ---- API Helpers ----
async function apiGet(path) {
    const res = await fetch(API + path);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiPost(path) {
    const res = await fetch(API + path, { method: 'POST' });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiPatch(path, body) {
    const res = await fetch(API + path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(API + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

// ---- Real-time Listener Helpers ----

function cleanupListeners() {
    activeUnsubscribes.forEach(unsub => unsub());
    activeUnsubscribes = [];
    pendingDeliveryUpdate = null;
}

function isModalOpen() {
    const checkinModal = document.getElementById('checkin-modal');
    const completeModal = document.getElementById('complete-modal');
    return (checkinModal && !checkinModal.classList.contains('hidden')) ||
           (completeModal && !completeModal.classList.contains('hidden'));
}

function applyDeliveryUpdate(data) {
    // Preserve scroll position
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    // Replace delivery data (client-side state like sort/filter/expanded is preserved)
    currentDelivery = data;
    applyWeekColor(data.delivery_date);
    updateLiveStatusBtn();

    // Re-render whichever view is active
    if (currentView === 'pullsheet') {
        renderLiveReport();
    } else {
        renderDetail();
    }

    // Restore scroll position
    window.scrollTo(0, scrollY);
}

function listenToDelivery(deliveryId) {
    const unsub = db.collection('deliveries').doc(deliveryId)
        .onSnapshot((doc) => {
            if (!doc.exists) return;
            if (!currentDelivery || currentDelivery.id !== deliveryId) return;

            // Skip if this is likely our own write echoing back
            if (Date.now() - lastWriteTimestamp < 2000) {
                lastWriteTimestamp = 0;
                return;
            }

            const data = doc.data();

            if (isModalOpen()) {
                pendingDeliveryUpdate = data;
                return;
            }

            applyDeliveryUpdate(data);
        }, (error) => {
            console.error('Firestore listener error:', error);
        });

    activeUnsubscribes.push(unsub);
}

function applyPendingUpdate() {
    if (pendingDeliveryUpdate) {
        const update = pendingDeliveryUpdate;
        pendingDeliveryUpdate = null;
        applyDeliveryUpdate(update);
    }
}

function listenToDeliveryList() {
    const unsub = db.collection('deliveries')
        .onSnapshot((snapshot) => {
            if (currentView !== 'deliveries') return;

            const deliveries = [];
            snapshot.forEach((doc) => {
                const d = doc.data();
                const totalItems = d.suppliers
                    ? d.suppliers.reduce((sum, s) => sum + (s.items ? s.items.length : 0), 0)
                    : 0;
                const checkedIn = d.suppliers
                    ? d.suppliers.reduce((sum, s) =>
                        sum + (s.items ? s.items.filter(i => i.received_status !== 'pending').length : 0), 0)
                    : 0;
                deliveries.push({
                    id: d.id || doc.id,
                    day_of_week: d.day_of_week || '',
                    delivery_date: d.delivery_date,
                    source_filename: d.source_filename || '',
                    status: d.status || 'parsed',
                    supplier_count: d.suppliers ? d.suppliers.length : 0,
                    item_count: totalItems,
                    checked_in_count: checkedIn,
                    parsed_at: d.parsed_at || '',
                });
            });

            // Sort by parsed_at descending (newest first)
            deliveries.sort((a, b) => (b.parsed_at || '').localeCompare(a.parsed_at || ''));

            renderDeliveryList(deliveries);
        }, (error) => {
            console.error('Delivery list listener error:', error);
        });

    activeUnsubscribes.push(unsub);
}

// ---- Delivery List ----
async function loadDeliveries() {
    showView('deliveries');
    try {
        const data = await apiGet('/deliveries');
        renderDeliveryList(data.deliveries);

        // Attach real-time listener for live updates from other iPads
        cleanupListeners();
        listenToDeliveryList();
    } catch (e) {
        showToast('Failed to load deliveries', 'error');
    }
}

function renderDeliveryList(deliveries) {
    const container = document.getElementById('delivery-list');
    if (!deliveries.length) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No deliveries yet</p>
                <p class="subtitle">Import a worksheet from Firebase Storage to get started</p>
            </div>`;
        return;
    }

    container.innerHTML = deliveries.map(d => {
        const pct = d.item_count > 0 ? Math.round((d.checked_in_count / d.item_count) * 100) : 0;
        const label = `${d.day_of_week} ${formatDate(d.delivery_date)}`;
        return `
        <div class="card" onclick="openDelivery('${d.id}')">
            <div class="card-header">
                <div>
                    <div class="card-title">${label}</div>
                    <div class="card-subtitle">${d.source_filename}</div>
                </div>
                <div class="card-header-right">
                    <span class="badge badge-${d.status.replace('_', '-')}">${d.status.replace('_', ' ')}</span>
                    <button class="delete-btn" onclick="event.stopPropagation(); deleteDelivery('${d.id}', '${label}')" title="Delete delivery">&times;</button>
                </div>
            </div>
            <div class="card-meta">
                <span class="card-meta-item">${d.supplier_count} suppliers</span>
                <span class="card-meta-item">${d.item_count} items</span>
                <span class="card-meta-item">${d.checked_in_count}/${d.item_count} checked in</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
        </div>`;
    }).join('');
}

async function deleteDelivery(id, name) {
    if (!confirm(`Delete delivery "${name}"?\n\nThis cannot be undone.`)) return;
    try {
        await apiDelete(`/deliveries/${id}`);
        showToast('Delivery deleted');
        loadDeliveries();
    } catch (e) {
        showToast('Failed to delete delivery', 'error');
    }
}

// ---- Adjustment Reports ----
async function showReports() {
    showView('reports');
    const container = document.getElementById('report-list');
    container.innerHTML = '<div class="loading">Loading reports...</div>';

    try {
        const data = await apiGet('/reports');
        if (!data.reports || !data.reports.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No reports yet</p>
                    <p class="subtitle">Adjustment reports are created when deliveries are completed</p>
                </div>`;
            return;
        }
        renderReportList(data.reports);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Failed to load reports</p></div>`;
        showToast('Failed to load reports', 'error');
    }
}

let cachedReports = [];

function renderReportList(reports) {
    cachedReports = reports;
    const container = document.getElementById('report-list');
    container.innerHTML = reports.map((r, idx) => {
        const completedDate = r.completed_at ? new Date(r.completed_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
        }) : '';
        const deliveryDate = r.delivery_date ? formatDate(r.delivery_date) : '';
        const hasExceptions = r.total_exceptions > 0;
        const exceptionBadge = hasExceptions
            ? `<span class="report-exception-count">${r.total_exceptions} adjustment${r.total_exceptions !== 1 ? 's' : ''}</span>`
            : `<span class="report-no-exceptions">No adjustments</span>`;

        const adjItems = (r.exception_items || []).map(i => ({
            name: i.raw_description, supplier: i.supplier_name, status: i.received_status,
            diff: i.received_status === 'short' ? Math.max(0, (i.quantity_expected || 0) - (i.quantity_received || 0))
                : i.received_status === 'over' ? Math.max(0, (i.quantity_received || 0) - (i.quantity_expected || 0))
                : (i.quantity_expected || 0),
        }));
        const normPulls = (r.pull_items || []).map(i => ({
            name: i.raw_description, supplier: i.supplier_name,
            cases: i.pull_quantity, confirmed: i.pull_confirmed,
        }));

        return `
        <div class="card report-card" onclick="toggleReportDetail(${idx})">
            <div class="card-header">
                <div>
                    <div class="card-title">${r.day_of_week} ${deliveryDate}</div>
                    <div class="card-subtitle">Completed ${completedDate}</div>
                </div>
                <div class="card-header-right">
                    ${exceptionBadge}
                </div>
            </div>
            <div class="card-meta">
                <span class="card-meta-item">${r.total_items} items</span>
                <span class="card-meta-item">${r.source_filename}</span>
            </div>
            <div class="report-detail" id="report-detail-${idx}" style="display:none;">
                <div class="report-section-header">Returns and Adjustments</div>
                ${buildAdjustmentStatsHtml(adjItems)}
                <div class="report-section-header">Pulls</div>
                ${buildPullStatsHtml(normPulls)}
                <button class="report-delete-btn" onclick="event.stopPropagation(); deleteReport(${idx})">Delete Report</button>
            </div>
        </div>`;
    }).join('');
}

function toggleReportDetail(idx) {
    const detail = document.getElementById(`report-detail-${idx}`);
    if (detail) {
        detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    }
}

async function showReportById(reportId) {
    showView('reports');
    const container = document.getElementById('report-list');
    container.innerHTML = '<div class="loading">Loading report...</div>';

    try {
        const data = await apiGet('/reports');
        if (!data.reports || !data.reports.length) {
            container.innerHTML = `<div class="empty-state"><p>Report not found</p></div>`;
            return;
        }
        renderReportList(data.reports);
        // Find and auto-expand the matching report
        const idx = data.reports.findIndex(r => r.id === reportId);
        if (idx >= 0) {
            const detail = document.getElementById(`report-detail-${idx}`);
            if (detail) detail.style.display = 'block';
        }
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Failed to load report</p></div>`;
        showToast('Failed to load report', 'error');
    }
}

async function deleteReport(idx) {
    const report = cachedReports[idx];
    if (!report) return;
    const label = `${report.day_of_week} ${report.delivery_date || ''}`.trim();
    if (!confirm(`Delete report for "${label}"?`)) return;

    try {
        await apiDelete(`/reports/${report.id}`);
        cachedReports.splice(idx, 1);
        if (cachedReports.length === 0) {
            document.getElementById('report-list').innerHTML = `
                <div class="empty-state">
                    <p>No reports yet</p>
                    <p class="subtitle">Adjustment reports are created when deliveries are completed</p>
                </div>`;
        } else {
            renderReportList(cachedReports);
        }
        showToast('Report deleted', 'success');
    } catch (e) {
        showToast('Failed to delete report', 'error');
    }
}

// ---- Storage Files ----
async function showStorageFiles() {
    showView('storage');
    const container = document.getElementById('storage-list');
    container.innerHTML = '<div class="loading">Loading files from Firebase Storage...</div>';

    try {
        const data = await apiGet('/storage/files');
        if (!data.files || !data.files.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No files in incoming folder</p>
                    <p class="subtitle">Upload PDF/CSV files to Firebase Storage incoming folder</p>
                </div>`;
            return;
        }

        // Categorize files by type and date
        const dateGroups = new Map(); // dateStr -> { delivery: file|null, highCount: file|null }
        let inventoryFile = null;

        data.files.forEach(f => {
            const lname = f.name.toLowerCase();
            const dateMatch = f.name.match(/(\d{4}-\d{2}-\d{2})/);
            const dateStr = dateMatch ? dateMatch[1] : null;
            if (lname.includes('inventory')) {
                inventoryFile = f;
            } else if (dateStr) {
                if (!dateGroups.has(dateStr)) dateGroups.set(dateStr, { delivery: null, highCount: null });
                const g = dateGroups.get(dateStr);
                if (lname.includes('high_count')) g.highCount = f;
                else g.delivery = f;
            }
        });

        let html = '';

        // Date groups sorted newest first
        [...dateGroups.keys()].sort().reverse().forEach(dateStr => {
            const g = dateGroups.get(dateStr);
            const dateLabel = friendlyDateStr(dateStr);
            html += `<div class="import-group">
                <div class="import-group-title">${dateLabel}</div>`;
            if (g.delivery) {
                html += `<div class="import-file-row" onclick="parseStorageFile('${g.delivery.name}')">
                    <span class="import-type-chip import-type-delivery">Delivery</span>
                    <span class="import-parse-btn">Parse</span>
                </div>`;
            } else {
                html += `<div class="import-file-row import-row-missing">
                    <span class="import-type-chip import-type-missing">Delivery</span>
                    <span class="import-missing-text">Not uploaded</span>
                </div>`;
            }
            if (g.highCount) {
                html += `<div class="import-file-row" onclick="parseHighCountFile('${g.highCount.name}')">
                    <span class="import-type-chip import-type-highcount">High Count</span>
                    <span class="import-parse-btn">Parse</span>
                </div>`;
            } else {
                html += `<div class="import-file-row import-row-missing">
                    <span class="import-type-chip import-type-missing">High Count</span>
                    <span class="import-missing-text">Not uploaded</span>
                </div>`;
            }
            html += `</div>`;
        });

        // Inventory section
        html += `<div class="import-group">
            <div class="import-group-title">Inventory</div>`;
        if (inventoryFile) {
            html += `<div class="import-file-row" onclick="parseInventoryFile('${inventoryFile.name}')">
                <span class="import-type-chip import-type-inventory">Inventory</span>
                <span class="import-file-date">${friendlyFileName(inventoryFile.name)}</span>
                <span class="import-parse-btn">Parse</span>
            </div>`;
        } else {
            html += `<div class="import-file-row import-row-missing">
                <span class="import-type-chip import-type-missing">Inventory</span>
                <span class="import-missing-text">Not uploaded</span>
            </div>`;
        }
        html += `</div>`;

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Could not connect to Firebase Storage</p>
                <p class="subtitle">${e.message}</p>
            </div>`;
    }
}

async function parseStorageFile(fileName) {
    showToast('Parsing file...', 'info');
    try {
        const res = await fetch(API + `/storage/files/${encodeURIComponent(fileName)}/parse`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            const msg = err && err.detail ? err.detail : 'Failed to parse file';
            showToast(msg, 'error');
            return;
        }
        const data = await res.json();
        showToast(`Parsed: ${data.supplier_count} suppliers, ${data.item_count} items`, 'success');
        openDelivery(data.delivery_id);
    } catch (e) {
        showToast('Failed to parse file', 'error');
    }
}

async function parseInventoryFile(fileName) {
    showToast('Parsing inventory...', 'info');
    try {
        const res = await fetch(API + `/storage/files/${encodeURIComponent(fileName)}/parse-inventory`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            const msg = err && err.detail ? err.detail : 'Failed to parse inventory';
            showToast(msg, 'error');
            return;
        }
        const data = await res.json();
        // Reload inventory cache immediately
        inventoryData = null;
        await loadInventory();
        // Re-render if currently showing location sort
        if (itemSortMode === 'location') renderItemList();
        showToast(`Inventory saved: ${data.item_count} items (${data.date})`, 'success');
    } catch (e) {
        showToast('Failed to parse inventory', 'error');
    }
}

async function parseHighCountFile(fileName) {
    showToast('Parsing high count...', 'info');
    try {
        const res = await fetch(API + `/storage/files/${encodeURIComponent(fileName)}/parse-high-count`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            const msg = err && err.detail ? err.detail : 'Failed to parse high count';
            showToast(msg, 'error');
            return;
        }
        const data = await res.json();
        showToast(`High count saved: ${data.nonzero_count} items with forecast data (${data.date})`, 'success');
        // Reload high count data if we're currently on a delivery with the same date
        if (currentDelivery && currentDelivery.delivery_date === data.date) {
            await loadHighCount(data.date);
            renderDetail();
        }
    } catch (e) {
        showToast('Failed to parse high count', 'error');
    }
}

// ---- High Count Data ----
async function loadHighCount(dateStr) {
    if (!dateStr) { highCountData = null; return; }
    try {
        const data = await apiGet(`/high-counts/${dateStr}`);
        const items = data.items || {};
        highCountData = Object.keys(items).length > 0 ? items : null;
    } catch (e) {
        highCountData = null;
    }
}

// ---- Inventory Data ----
async function loadInventory() {
    // Skip only if already loaded with actual data
    if (inventoryData && Object.keys(inventoryData).length > 0) return;
    try {
        const data = await apiGet('/inventory/latest');
        const raw = data.items || {};
        // Normalize keys: collapse multiple spaces so lookup matches delivery names
        const items = {};
        for (const [k, v] of Object.entries(raw)) {
            items[k.replace(/\s+/g, ' ').trim()] = v;
        }
        inventoryData = Object.keys(items).length > 0 ? items : null;
    } catch (e) {
        inventoryData = null;
    }
}

// ---- Delivery Detail ----
async function openDelivery(id) {
    try {
        const delivery = await apiGet(`/deliveries/${id}`);
        currentDelivery = delivery;
        applyWeekColor(delivery.delivery_date);
        completionShown = false;
        updateLiveStatusBtn();
        await Promise.all([
            loadHighCount(delivery.delivery_date || null),
            loadInventory(),
        ]);

        // If already completed, show the delivery-over screen
        if (delivery.status === 'completed') {
            showDeliveryOverScreen();
            return;
        }

        supplierFilter = null; // reset filter
        expandedSuppliers = new Set(); // reset accordion
        expandedLocations = new Set(); // reset location accordion
        showReceived = false; // reset to pending view
        searchQuery = ''; // reset search
        // Reset supplier filter UI
        document.getElementById('item-receive-all-btn').innerHTML = '';
        renderDetail();
        showView('detail');

        // Subscribe to real-time updates for this delivery
        cleanupListeners();
        listenToDelivery(id);
    } catch (e) {
        console.error('openDelivery error:', e);
        showToast('Failed to load delivery', 'error');
    }
}

function renderDetail() {
    if (!currentDelivery) return;
    const delivery = currentDelivery;

    const totalItems = delivery.suppliers.reduce((sum, s) => sum + s.items.length, 0);
    const checkedIn = delivery.suppliers.reduce((sum, s) =>
        sum + s.items.filter(i => i.received_status !== 'pending').length, 0);
    const allItemsFlat = delivery.suppliers.flatMap(s => s.items);
    const totalCases = casesExpected(allItemsFlat);

    const detailTitle = document.getElementById('detail-title');

    if (supplierFilter !== null) {
        // Supplier-filtered: show supplier name in detail-title
        const supplier = delivery.suppliers[supplierFilter.idx];
        const supRcv = casesReceived(supplier.items);
        const supExp = casesExpected(supplier.items);
        detailTitle.classList.remove('hidden');
        document.getElementById('detail-title-text').textContent = supplier.supplier_name;
        document.getElementById('delivery-summary').innerHTML =
            progressBar(supRcv, supExp);
    } else {
        // Normal delivery view — date is in header, hide detail-title
        detailTitle.classList.add('hidden');
        const allItems = delivery.suppliers.flatMap(s => s.items);
        const rcvCases = casesReceived(allItems);
        document.getElementById('delivery-summary').innerHTML =
            progressBar(rcvCases, totalCases);
    }

    // Sync search input with state
    const searchInput = document.getElementById('item-search');
    if (searchInput) {
        searchInput.value = searchQuery;
        document.getElementById('search-clear-btn').classList.toggle('hidden', !searchQuery);
    }

    renderItemList();
}

function setShowReceived(val) {
    showReceived = val;
    renderDetail();
}

// ---- Supplier abbreviation ----
function abbreviateSupplier(name) {
    const abbrevs = {
        'Ace Natural Produce': 'Ace',
        "D'Artagnan Inc.": "D'Art",
        'Four Seasons Produce': '4Seasns',
        'Lancaster Farm Fresh Coop': 'LFC',
        'Myers Produce': 'Myers',
    };
    if (abbrevs[name]) return abbrevs[name];
    // Default: use first word
    const first = name.split(/\s+/)[0];
    return first.length > 8 ? first.substring(0, 7) : first;
}

// ---- Flat Item List (Items tab) ----
function renderItemList() {
    const delivery = currentDelivery;
    if (!delivery) return;

    // Flatten all items with supplier references
    let flatItems = [];
    delivery.suppliers.forEach((supplier, sIdx) => {
        supplier.items.forEach((item, iIdx) => {
            flatItems.push({
                ...item,
                supplierIdx: sIdx,
                itemIdx: iIdx,
                supplierName: supplier.supplier_name,
                supplierAbbrev: abbreviateSupplier(supplier.supplier_name),
            });
        });
    });

    // Filter by received status: off = pending only, on = show all items
    if (!showReceived) {
        flatItems = flatItems.filter(item => item.received_status === 'pending');
    }

    // Filter to one supplier if active
    if (supplierFilter !== null) {
        flatItems = flatItems.filter(item => item.supplierIdx === supplierFilter.idx);
    }

    // Multi filter: items appearing in 2+ supplier blocks
    if (multiFilter && itemSortMode === 'alpha') {
        const descSuppliers = new Map();
        currentDelivery.suppliers.forEach((supplier, sIdx) => {
            supplier.items.forEach(item => {
                if (!descSuppliers.has(item.raw_description)) descSuppliers.set(item.raw_description, new Set());
                descSuppliers.get(item.raw_description).add(sIdx);
            });
        });
        const multiDescs = new Set([...descSuppliers.entries()]
            .filter(([, suppliers]) => suppliers.size > 1)
            .map(([desc]) => desc));
        flatItems = flatItems.filter(item => multiDescs.has(item.raw_description));
    }

    // Update sort button states — only one active at a time
    document.getElementById('sort-alpha').classList.toggle('active', itemSortMode === 'alpha');
    document.getElementById('sort-qty').classList.toggle('active', itemSortMode === 'qty');

    const locBtn = document.getElementById('sort-location');
    locBtn.classList.toggle('active', itemSortMode === 'location');
    const allLocsExpanded = itemSortMode === 'location' && currentDelivery && expandedLocations.size > 0;
    locBtn.classList.toggle('chevron-expanded', allLocsExpanded);
    locBtn.classList.toggle('chevron-collapsed', itemSortMode === 'location' && !allLocsExpanded);

    const supplierBtn = document.getElementById('sort-supplier');
    supplierBtn.classList.toggle('active', itemSortMode === 'supplier');
    supplierBtn.classList.toggle('hidden', supplierFilter !== null);
    const allSuppExpanded = itemSortMode === 'supplier' && currentDelivery &&
        currentDelivery.suppliers.every((s, idx) => expandedSuppliers.has(idx));
    supplierBtn.classList.toggle('chevron-expanded', allSuppExpanded);
    supplierBtn.classList.toggle('chevron-collapsed', itemSortMode === 'supplier' && !allSuppExpanded);

    // Multi button: only in Items mode
    const multiBtn = document.getElementById('sort-multi');
    multiBtn.classList.toggle('hidden', itemSortMode !== 'alpha' || supplierFilter !== null);
    multiBtn.classList.toggle('active', multiFilter);



    const container = document.getElementById('flat-item-list');
    container.classList.toggle('show-received', showReceived);

    // Supplier accordion mode (search handled inside accordion)
    if (itemSortMode === 'supplier' && supplierFilter === null) {
        renderSupplierAccordion(container, flatItems);
        return;
    }

    // Filter by search query (for flat list modes)
    if (searchQuery) {
        flatItems = flatItems.filter(item =>
            item.raw_description.toLowerCase().includes(searchQuery) ||
            item.supplierName.toLowerCase().includes(searchQuery)
        );
    }

    if (!flatItems.length) {
        let emptyMsg;
        if (multiFilter) {
            emptyMsg = 'No items are shared across multiple suppliers';
        } else if (searchQuery) {
            emptyMsg = 'No items match your search';
        } else if (!showReceived) {
            emptyMsg = 'All items received!';
        } else {
            emptyMsg = 'No items yet';
        }
        container.innerHTML = `<div class="empty-state"><p>${emptyMsg}</p></div>`;
        return;
    }

    // Group by description to deduplicate cross-supplier items
    const groups = new Map();
    flatItems.forEach(item => {
        const key = item.raw_description.toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    });

    let sortedGroups = [...groups.values()];
    if (itemSortMode === 'qty') {
        sortedGroups.sort((a, b) => {
            const totalA = a.reduce((s, i) => s + i.quantity_expected, 0);
            const totalB = b.reduce((s, i) => s + i.quantity_expected, 0);
            const diff = totalB - totalA;
            return diff !== 0 ? diff : a[0].raw_description.toLowerCase().localeCompare(b[0].raw_description.toLowerCase());
        });
    } else {
        // alpha sort (used as base for both 'alpha' and 'location' modes)
        sortedGroups.sort((a, b) =>
            a[0].raw_description.toLowerCase().localeCompare(b[0].raw_description.toLowerCase())
        );
    }

    if (itemSortMode === 'location') {
        if (!inventoryData || Object.keys(inventoryData).length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No inventory data</p><p class="subtitle">Parse the inventory worksheet from the import screen first</p></div>';
            return;
        }
        const locationOrder = ['G', 'X', 'Y'];
        const locationGroups = new Map();
        sortedGroups.forEach(group => {
            const key = group[0].raw_description.toLowerCase().replace(/\s+/g, ' ').trim();
            const inv = inventoryData && inventoryData[key];
            const locFirst = inv ? (inv.basement_location || '').charAt(0).toUpperCase() : '';
            const bucket = locationOrder.includes(locFirst) ? locFirst : 'Other';
            if (!locationGroups.has(bucket)) locationGroups.set(bucket, []);
            locationGroups.get(bucket).push(group);
        });
        const orderedKeys = [
            ...locationOrder.filter(k => locationGroups.has(k)),
            ...[...locationGroups.keys()].filter(k => !locationOrder.includes(k)),
        ];
        let html = '';
        orderedKeys.forEach(locKey => {
            const isExpanded = expandedLocations.has(locKey);
            const groups = locationGroups.get(locKey);
            const itemCount = groups.reduce((n, g) => n + g.length, 0);
            const chevronClass = isExpanded ? 'accordion-chevron expanded' : 'accordion-chevron';
            html += `<div class="location-zone-header" onclick="toggleLocationZone('${locKey}')">
                <span class="${chevronClass}">&#9654;</span>
                <span class="location-zone-name">${locKey}</span>
                <span class="location-zone-count">${itemCount}</span>
            </div>`;
            if (isExpanded) {
                html += groups.map(group =>
                    group.length === 1
                        ? renderCompactRow(group[0], supplierFilter === null, null)
                        : renderMultiSupplierRow(group)
                ).join('');
            }
        });
        container.innerHTML = html;
        return;
    }

    container.innerHTML = sortedGroups.map(group =>
        group.length === 1
            ? renderCompactRow(group[0], supplierFilter === null, null)
            : renderMultiSupplierRow(group)
    ).join('');
}

function buildCrossSupplierMap() {
    // Build a map: description -> [{ supplierName, supplierIdx, itemIdx, qty, received_status, pull_quantity, pull_confirmed }]
    if (!currentDelivery) return new Map();
    const map = new Map();
    currentDelivery.suppliers.forEach((supplier, sIdx) => {
        supplier.items.forEach((item, iIdx) => {
            const key = item.raw_description.toLowerCase();
            if (!map.has(key)) map.set(key, []);
            map.get(key).push({
                supplierName: supplier.supplier_name,
                supplierIdx: sIdx,
                itemIdx: iIdx,
                qty: item.quantity_expected,
                received_status: item.received_status,
                pull_quantity: item.pull_quantity,
                pull_confirmed: item.pull_confirmed,
            });
        });
    });
    return map;
}

function renderCompactRow(item, showSupplier, crossMap = null) {
    const isPending = item.received_status === 'pending';
    const statusClass = isPending ? '' : `checked-${item.received_status}`;
    const processingClass = item.needs_processing ? 'needs-processing' : '';
    const floorClass = item.pull_for_floor ? 'pull-for-floor' : '';


    const pullConfirmedClass = item.pull_confirmed ? 'pull-confirmed' : '';
    const pullQty = item.pull_quantity != null
        ? `<span class="pull-qty ${pullConfirmedClass}" onclick="event.stopPropagation(); openPullPopup(event, ${item.supplierIdx}, ${item.itemIdx})">(${item.pull_quantity})</span> `
        : '';

    const supplierChip = showSupplier
        ? `<div class="compact-supplier" onclick="event.stopPropagation(); filterBySupplier(${item.supplierIdx})">${item.supplierAbbrev}</div>`
        : '';

    // Build "also from" sub-rows for items shared across suppliers
    let alsoRow = '';
    if (crossMap) {
        const others = (crossMap.get(item.raw_description.toLowerCase()) || [])
            .filter(e => e.supplierIdx !== item.supplierIdx);
        if (others.length > 0) {
            alsoRow = others.map(e => {
                const eStatus = e.received_status === 'pending' ? '' : `checked-${e.received_status}`;
                const ePullConfirmedClass = e.pull_confirmed ? 'pull-confirmed' : '';
                const ePullQty = e.pull_quantity != null
                    ? `<span class="pull-qty ${ePullConfirmedClass}" onclick="event.stopPropagation(); openPullPopup(event, ${e.supplierIdx}, ${e.itemIdx})">(${e.pull_quantity})</span> `
                    : '';
                return `<div class="compact-row supplier-sub-row ${eStatus}" onclick="openCheckInModalFlat(${e.supplierIdx}, ${e.itemIdx})">
                    <div class="compact-qty">${ePullQty}${e.qty}</div>
                    <div class="compact-supplier sub-row-supplier" onclick="event.stopPropagation(); filterBySupplier(${e.supplierIdx})">${e.supplierName}</div>
                </div>`;
            }).join('');
        }
    }

    // High count forecast strip
    const hcKey = item.raw_description.toLowerCase();
    const hc = highCountData && highCountData[hcKey];
    const hcStrip = (hc && (hc.sat !== 0 || hc.sun !== 0 || hc.mon !== 0))
        ? `<div class="hc-strip"><span class="hc-day">${hc.sat}</span><span class="hc-day">${hc.sun}</span><span class="hc-day">${hc.mon}</span></div>`
        : '';

    return `
    <div class="compact-row ${statusClass} ${processingClass} ${floorClass}${showSupplier ? '' : ' accordion-item'}"
         onclick="openCheckInModalFlat(${item.supplierIdx}, ${item.itemIdx})">
        <div class="compact-qty">${pullQty}${item.quantity_expected}</div>
        <div class="compact-name">${item.raw_description}</div>
        ${supplierChip}
        ${hcStrip}
    </div>${alsoRow}`;
}

function renderMultiSupplierRow(items) {
    const totalQty = items.reduce((sum, item) => sum + item.quantity_expected, 0);
    const firstName = items[0].raw_description;

    // High count strip (same item name across all)
    const hcKey = firstName.toLowerCase();
    const hc = highCountData && highCountData[hcKey];
    const hcStrip = (hc && (hc.sat !== 0 || hc.sun !== 0 || hc.mon !== 0))
        ? `<div class="hc-strip"><span class="hc-day">${hc.sat}</span><span class="hc-day">${hc.sun}</span><span class="hc-day">${hc.mon}</span></div>`
        : '';

    const mainRow = `
    <div class="compact-row multi-supplier-header">
        <div class="compact-qty">${totalQty}</div>
        <div class="compact-name">${firstName}</div>
        ${hcStrip}
    </div>`;

    const subRows = items.map(item => {
        const isPending = item.received_status === 'pending';
        const statusClass = isPending ? '' : `checked-${item.received_status}`;
        const pullConfirmedClass = item.pull_confirmed ? 'pull-confirmed' : '';
        const pullQty = item.pull_quantity != null
            ? `<span class="pull-qty ${pullConfirmedClass}" onclick="event.stopPropagation(); openPullPopup(event, ${item.supplierIdx}, ${item.itemIdx})">(${item.pull_quantity})</span> `
            : '';
        return `
        <div class="compact-row supplier-sub-row ${statusClass}"
             onclick="openCheckInModalFlat(${item.supplierIdx}, ${item.itemIdx})">
            <div class="compact-qty">${pullQty}${item.quantity_expected}</div>
            <div class="compact-supplier sub-row-supplier" onclick="event.stopPropagation(); filterBySupplier(${item.supplierIdx})">${item.supplierName}</div>
        </div>`;
    }).join('');

    return mainRow + subRows;
}

function renderSupplierAccordion(container, flatItems) {
    const delivery = currentDelivery;
    if (!delivery) return;

    const crossMap = buildCrossSupplierMap();

    // Build sorted supplier list (alphabetical)
    let supplierIndices = delivery.suppliers.map((s, idx) => idx);
    supplierIndices.sort((a, b) =>
        delivery.suppliers[a].supplier_name.toLowerCase().localeCompare(
            delivery.suppliers[b].supplier_name.toLowerCase()
        )
    );

    let html = '';
    let anyVisible = false;

    supplierIndices.forEach(sIdx => {
        const supplier = delivery.suppliers[sIdx];
        const isExpanded = expandedSuppliers.has(sIdx);

        // Get items for this supplier from the flat list (already filtered by showReceived)
        let supplierItems = flatItems.filter(item => item.supplierIdx === sIdx);

        // Hide fully-received suppliers when showReceived is off
        const allDone = supplier.items.every(i => i.received_status !== 'pending');
        if (!showReceived && allDone) return;

        // Apply search filter
        if (searchQuery) {
            supplierItems = supplierItems.filter(item =>
                item.raw_description.toLowerCase().includes(searchQuery) ||
                item.supplierName.toLowerCase().includes(searchQuery)
            );
        }

        // Skip suppliers with no matching items when searching
        if (searchQuery && supplierItems.length === 0) return;

        anyVisible = true;

        // Sort items within supplier alphabetically
        supplierItems.sort((a, b) =>
            a.raw_description.toLowerCase().localeCompare(b.raw_description.toLowerCase())
        );

        // Compute stats from ALL supplier items (not just filtered)
        const allItems = supplier.items;
        const totalItems = allItems.length;
        const doneItems = allItems.filter(i => i.received_status !== 'pending').length;
        const rcvCases = casesReceived(allItems);
        const expCases = casesExpected(allItems);
        const someDone = doneItems > 0 && !allDone;

        const statusClass = allDone ? 'supplier-complete' : '';
        const chevronClass = isExpanded ? 'accordion-chevron expanded' : 'accordion-chevron';

        // Receive All / Unreceive All button (only when expanded)
        let receiveBtn = '';
        if (isExpanded) {
            const pendingCount = allItems.filter(i => i.received_status === 'pending').length;
            receiveBtn = pendingCount === 0
                ? `<button class="receive-all-btn unreceive" onclick="event.stopPropagation(); unreceiveAllSupplier(${sIdx})">Unreceive All</button>`
                : `<button class="receive-all-btn" onclick="event.stopPropagation(); receiveAllSupplier(${sIdx})">Receive All</button>`;
        }

        html += `
        <div class="supplier-accordion-header ${statusClass}" onclick="toggleSupplierAccordion(${sIdx})">
            <span class="${chevronClass}">&#9654;</span>
            <span class="accordion-supplier-name">${supplier.supplier_name} <span class="accordion-case-count"><span class="count-green">${fmtNum(rcvCases)}</span>/${fmtNum(expCases)}</span></span>
            ${receiveBtn ? `<span class="accordion-receive-all">${receiveBtn}</span>` : ''}
        </div>`;

        if (isExpanded && supplierItems.length > 0) {
            html += supplierItems.map(item => renderCompactRow(item, false, crossMap)).join('');
        }
    });

    if (!anyVisible) {
        container.innerHTML = `<div class="empty-state"><p>${searchQuery ? 'No items match your search' : 'All items received!'}</p></div>`;
    } else {
        container.innerHTML = html;
    }
}

function toggleSupplierAccordion(supplierIdx) {
    if (expandedSuppliers.has(supplierIdx)) {
        expandedSuppliers.delete(supplierIdx);
    } else {
        expandedSuppliers.add(supplierIdx);
    }
    renderItemList();
}

function toggleSupplierView() {
    if (itemSortMode === 'supplier') {
        toggleExpandAll();
    } else {
        setItemSort('supplier');
    }
}

function toggleLocationView() {
    if (itemSortMode === 'location') {
        toggleAllLocations();
    } else {
        setItemSort('location');
    }
}

function toggleAllLocations() {
    if (expandedLocations.size > 0) {
        expandedLocations = new Set();
    } else {
        ['G', 'X', 'Y', 'Other'].forEach(k => expandedLocations.add(k));
    }
    renderItemList();
}

function toggleLocationZone(locKey) {
    if (expandedLocations.has(locKey)) {
        expandedLocations.delete(locKey);
    } else {
        expandedLocations.add(locKey);
    }
    renderItemList();
}

function toggleExpandAll() {
    if (!currentDelivery) return;
    const allExpanded = currentDelivery.suppliers.every((s, idx) => expandedSuppliers.has(idx));
    if (allExpanded) {
        expandedSuppliers.clear();
    } else {
        currentDelivery.suppliers.forEach((s, idx) => expandedSuppliers.add(idx));
    }
    renderItemList();
}

function filterBySupplier(supplierIdx) {
    const supplier = currentDelivery.suppliers[supplierIdx];
    supplierFilter = { idx: supplierIdx, name: supplier.supplier_name };

    // Switch to alpha sort when drilling into a single supplier
    if (itemSortMode === 'supplier') {
        itemSortMode = 'alpha';
    }

    // Replace summary and title with supplier info

    // Reuse the top-level summary bar with supplier stats
    const supRcvF = casesReceived(supplier.items);
    const supExpF = casesExpected(supplier.items);
    document.getElementById('delivery-summary').innerHTML =
        progressBar(supRcvF, supExpF);

    // Reuse the detail-title with supplier name, make it go back to clear filter
    const detailTitle = document.getElementById('detail-title');
    detailTitle.classList.remove('hidden');
    document.getElementById('detail-title-text').textContent = supplier.supplier_name;

    // Receive All / Unreceive All button in sort bar
    renderReceiveAllButton(supplierIdx, 'item-receive-all-btn');

    renderItemList();
    // Scroll to top
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
}

function clearSupplierFilter() {
    supplierFilter = null;
    searchQuery = '';
    itemSortMode = 'supplier'; // return to supplier accordion view
    document.getElementById('item-receive-all-btn').innerHTML = '';
    // Reset search input
    const searchInput = document.getElementById('item-search');
    searchInput.value = '';
    document.getElementById('search-clear-btn').classList.add('hidden');
    // Re-render restores delivery summary and title
    renderDetail();
}

function updateFilteredSupplierSummary() {
    if (supplierFilter === null) return;
    const supplier = currentDelivery.suppliers[supplierFilter.idx];
    const supRcvU = casesReceived(supplier.items);
    const supExpU = casesExpected(supplier.items);
    const summaryEl = document.getElementById('delivery-summary');
    summaryEl.innerHTML = progressBar(supRcvU, supExpU);
}

// ---- Pull Sheet ----

function showLiveReport() {
    showView('pullsheet');
    renderLiveReport();
}

function renderLiveReport() {
    if (!currentDelivery) return;
    let html = '';

    // --- Adjustments section ---
    const exceptions = getExceptionItems();
    const adjItems = exceptions.map(e => ({
        name: e.description, supplier: e.supplierName, status: e.status,
        diff: e.status === 'short' ? Math.max(0, (e.expected || 0) - (e.received || 0))
            : e.status === 'over' ? Math.max(0, (e.received || 0) - (e.expected || 0))
            : (e.expected || 0),
    }));

    html += '<div class="report-section-header">Returns and Adjustments</div>';
    html += buildAdjustmentStatsHtml(adjItems);

    // --- Pulls section ---
    const pullItems = [];
    currentDelivery.suppliers.forEach((supplier, sIdx) => {
        supplier.items.forEach((item, iIdx) => {
            if (item.pull_quantity > 0)
                pullItems.push({ ...item, supplierIdx: sIdx, itemIdx: iIdx, supplierName: supplier.supplier_name });
        });
    });
    pullItems.sort((a, b) => {
        const sup = a.supplierName.toLowerCase().localeCompare(b.supplierName.toLowerCase());
        return sup !== 0 ? sup : a.raw_description.toLowerCase().localeCompare(b.raw_description.toLowerCase());
    });

    html += '<div class="report-section-header">Pulls</div>';

    if (pullItems.length === 0) {
        html += '<div class="report-section-empty">No pull items</div>';
    } else {
        let currentSupplierName = null;
        pullItems.forEach(item => {
            if (item.supplierName !== currentSupplierName) {
                currentSupplierName = item.supplierName;
                html += `<div class="pull-sheet-supplier">${item.supplierName}</div>`;
            }
            const confirmedClass = item.pull_confirmed ? 'pull-confirmed' : '';
            const statusChip = item.pull_confirmed
                ? `<div class="pull-sheet-check done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20,6 9,17 4,12"/></svg></div>`
                : `<div class="pull-sheet-check pending"></div>`;
            html += `
            <div class="pull-sheet-row ${confirmedClass}" onclick="togglePullFromReport(${item.supplierIdx}, ${item.itemIdx})">
                <span class="pull-sheet-qty">${item.pull_quantity} <span class="pull-sheet-of">(of ${item.quantity_expected})</span></span>
                <span class="pull-sheet-name">${item.raw_description}</span>
                ${statusChip}
            </div>`;
        });
    }

    document.getElementById('live-report-content').innerHTML = html;
}

async function togglePullFromReport(supplierIdx, itemIdx) {
    const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/pull-confirm`,
            {}
        );
        lastWriteTimestamp = Date.now();
        item.pull_confirmed = !item.pull_confirmed;
        renderLiveReport();
        renderItemList();
    } catch (e) {
        showToast('Failed to update pull status', 'error');
    }
}

function onSearchInput() {
    const input = document.getElementById('item-search');
    searchQuery = input.value.trim().toLowerCase();
    document.getElementById('search-clear-btn').classList.toggle('hidden', !searchQuery);
    renderItemList();
}

function clearSearch() {
    const input = document.getElementById('item-search');
    input.value = '';
    searchQuery = '';
    document.getElementById('search-clear-btn').classList.add('hidden');
    renderItemList();
    input.focus();
}

async function setItemSort(mode) {
    if (mode !== 'alpha') multiFilter = false;
    itemSortMode = mode;
    if (mode === 'location') await loadInventory();
    renderItemList();
}

function toggleMultiFilter() {
    multiFilter = !multiFilter;
    renderItemList();
}

// ---- Check-in Modal ----

let modalExpectedQty = 0; // track expected qty for the open modal
let selectedReason = null; // 'short', 'over', or 'return'

// Called from flat item list (Items tab)
function openCheckInModalFlat(supplierIdx, itemIdx) {
    currentSupplierIdx = supplierIdx;
    openCheckInModal(itemIdx);
}

// Called from supplier drill-in (Suppliers tab) or from flat list via wrapper
function openCheckInModal(itemIdx) {
    const supplier = currentDelivery.suppliers[currentSupplierIdx];
    const item = supplier.items[itemIdx];
    checkInItem = { supplierIdx: currentSupplierIdx, itemIdx };

    document.getElementById('modal-supplier-name').textContent = supplier.supplier_name;
    document.getElementById('modal-item-name').textContent = item.raw_description;
    modalExpectedQty = item.quantity_expected;
    document.getElementById('modal-expected').textContent = item.quantity_expected;
    document.getElementById('modal-qty').value = item.quantity_received ?? item.quantity_expected;
    document.getElementById('modal-notes').value = item.received_notes || '';

    // Restore previous reason if item was already checked in
    if (item.received_status && item.received_status !== 'pending' && item.received_status !== 'ok') {
        selectedReason = item.received_status;
    } else {
        selectedReason = null;
    }

    // Floor Pull stepper
    document.getElementById('modal-pull-qty').value = item.pull_quantity ?? 0;

    // Pull confirmation checkbox
    const pullConfirmLabel = document.getElementById('pull-confirm-inline');
    const pullCheckbox = document.getElementById('pull-confirm-checkbox');
    if (item.pull_quantity != null && item.pull_quantity > 0) {
        pullConfirmLabel.classList.remove('hidden');
        pullCheckbox.classList.toggle('checked', !!item.pull_confirmed);
    } else {
        pullConfirmLabel.classList.add('hidden');
    }

    // Show unreceive button only if item is already received
    const unreceiveBtn = document.getElementById('modal-unreceive-btn');
    unreceiveBtn.classList.toggle('hidden', item.received_status === 'pending');

    updateModalStatusButtons();
    document.getElementById('checkin-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('checkin-modal').classList.add('hidden');
    checkInItem = null;
    selectedReason = null;
    applyPendingUpdate();
}

// Update status button labels and states based on current qty vs expected
function updateModalStatusButtons() {
    const qty = parseInt(document.getElementById('modal-qty').value) || 0;
    const diff = modalExpectedQty - qty;

    const shortBtn = document.getElementById('status-short');
    const overBtn = document.getElementById('status-over');
    const returnBtn = document.getElementById('status-return');
    const okBtn = document.getElementById('modal-ok-btn');

    // Reset all buttons
    shortBtn.classList.remove('active', 'needs-choice');
    overBtn.classList.remove('active', 'needs-choice');
    returnBtn.classList.remove('active', 'needs-choice');
    okBtn.classList.remove('ok-ready');

    if (qty === modalExpectedQty) {
        // Exact match: reset labels, OK is ready
        shortBtn.textContent = 'Short';
        overBtn.textContent = 'Over';
        returnBtn.textContent = 'Return';
        selectedReason = null;
        okBtn.classList.add('ok-ready');
    } else if (qty < modalExpectedQty) {
        // Under: show diff on Short and Return, user must pick one
        shortBtn.textContent = `${diff} - Short`;
        returnBtn.textContent = `${diff} - Return`;
        overBtn.textContent = 'Over';

        if (selectedReason === 'short') {
            shortBtn.classList.add('active');
            okBtn.classList.add('ok-ready');
        } else if (selectedReason === 'return') {
            returnBtn.classList.add('active');
            okBtn.classList.add('ok-ready');
        } else {
            // No reason selected yet — highlight both to prompt user to choose
            shortBtn.classList.add('needs-choice');
            returnBtn.classList.add('needs-choice');
        }
    } else {
        // Over: auto-highlight Over, OK is ready
        const overAmt = qty - modalExpectedQty;
        overBtn.textContent = `${overAmt} - Over`;
        shortBtn.textContent = 'Short';
        returnBtn.textContent = 'Return';
        selectedReason = 'over';
        overBtn.classList.add('active');
        okBtn.classList.add('ok-ready');
    }
}

function selectReason(reason) {
    const qty = parseInt(document.getElementById('modal-qty').value) || 0;

    // Only allow selecting Short/Return when qty < expected
    if (reason === 'short' || reason === 'return') {
        if (qty >= modalExpectedQty) return; // ignore if not applicable
        selectedReason = (selectedReason === reason) ? null : reason; // toggle
    } else if (reason === 'over') {
        if (qty <= modalExpectedQty) return; // ignore if not applicable
        selectedReason = 'over';
    }

    updateModalStatusButtons();
}

async function togglePullConfirmed() {
    if (!checkInItem) return;
    const cb = document.getElementById('pull-confirm-checkbox');
    cb.classList.toggle('checked');
    const { supplierIdx, itemIdx } = checkInItem;
    const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/pull-confirm`,
            {}
        );
        lastWriteTimestamp = Date.now();
        item.pull_confirmed = !item.pull_confirmed;
        renderItemList();
    } catch (e) {
        cb.classList.toggle('checked'); // revert on error
        showToast('Failed to update', 'error');
    }
}

// ---- Pull Popup ----
function openPullPopup(event, supplierIdx, itemIdx) {
    const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
    pullPopupItem = { supplierIdx, itemIdx };

    document.getElementById('pull-popup-name').textContent = item.raw_description;
    const qty = item.pull_quantity ?? 0;
    document.getElementById('pull-popup-qty').value = qty;

    const hasQty = qty > 0;
    document.getElementById('pull-popup-submit').classList.toggle('hidden', !hasQty);
    document.getElementById('pull-popup-confirm').classList.toggle('hidden', !hasQty);
    // Submit always starts unchecked; Confirmed reflects current state
    document.getElementById('pull-popup-submit').querySelector('.pull-checkbox').classList.remove('checked');
    document.getElementById('pull-popup-checkbox').classList.toggle('checked', !!item.pull_confirmed);

    // Position near the tapped element
    const popup = document.getElementById('pull-popup');
    popup.classList.remove('hidden');
    document.getElementById('pull-popup-backdrop').classList.remove('hidden');

    const rect = event.target.getBoundingClientRect();
    const pw = popup.offsetWidth || 220;
    const ph = popup.offsetHeight || 160;
    const margin = 10;

    let top = rect.bottom + margin;
    let left = rect.left;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (left < margin) left = margin;
    if (top + ph > window.innerHeight - margin) top = rect.top - ph - margin;

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
}

function closePullPopup() {
    document.getElementById('pull-popup').classList.add('hidden');
    document.getElementById('pull-popup-backdrop').classList.add('hidden');
    pullPopupItem = null;
}

function _pullPopupShowHideRows(qty) {
    const hasQty = qty > 0;
    document.getElementById('pull-popup-submit').classList.toggle('hidden', !hasQty);
    document.getElementById('pull-popup-confirm').classList.toggle('hidden', !hasQty);
}

async function adjustPullPopupQty(delta) {
    if (!pullPopupItem) return;
    const input = document.getElementById('pull-popup-qty');
    const newQty = Math.max(0, (parseInt(input.value) || 0) + delta);
    input.value = newQty;
    _pullPopupShowHideRows(newQty);
    // Qty changed — clear both checkboxes to await explicit Submit or Confirm
    document.getElementById('pull-popup-submit').querySelector('.pull-checkbox').classList.remove('checked');
    document.getElementById('pull-popup-checkbox').classList.remove('checked');

    const { supplierIdx, itemIdx } = pullPopupItem;
    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/set-pull`,
            { quantity: newQty }
        );
        lastWriteTimestamp = Date.now();
        const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
        item.pull_quantity = newQty > 0 ? newQty : null;
        item.pull_for_floor = newQty > 0;
        renderItemList();
    } catch (e) {
        showToast('Failed to update pull quantity', 'error');
    }
}

async function submitPullPopup() {
    // Submit: mark as requested for pulling. Resets confirmed since qty may have changed.
    if (!pullPopupItem) return;
    const { supplierIdx, itemIdx } = pullPopupItem;
    const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
    try {
        if (!item.pull_submitted) {
            await apiPatch(
                `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/pull-submit`,
                {}
            );
            lastWriteTimestamp = Date.now();
            item.pull_submitted = true;
        }
        if (item.pull_confirmed) {
            await apiPatch(
                `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/pull-confirm`,
                {}
            );
            lastWriteTimestamp = Date.now();
            item.pull_confirmed = false;
        }
        renderItemList();
    } catch (e) {
        showToast('Failed to submit pull', 'error');
        return;
    }
    closePullPopup();
}

async function confirmPullPopup() {
    // Toggle pull_confirmed — works whether currently confirmed or not.
    if (!pullPopupItem) return;
    const { supplierIdx, itemIdx } = pullPopupItem;
    const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/pull-confirm`,
            {}
        );
        lastWriteTimestamp = Date.now();
        item.pull_confirmed = !item.pull_confirmed;
        renderItemList();
    } catch (e) {
        showToast('Failed to update pull confirmation', 'error');
        return;
    }
    closePullPopup();
}

async function togglePullFromList(supplierIdx, itemIdx) {
    const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/pull-confirm`,
            {}
        );
        lastWriteTimestamp = Date.now();
        item.pull_confirmed = !item.pull_confirmed;
        renderItemList();
        showToast(item.pull_confirmed ? 'Pull confirmed' : 'Pull unconfirmed', 'success');
    } catch (e) {
        showToast('Failed to update pull status', 'error');
    }
}

function adjustQty(delta) {
    const input = document.getElementById('modal-qty');
    const val = parseInt(input.value) || 0;
    input.value = Math.max(0, val + delta);
    // Reset reason when qty changes (unless going over)
    const newQty = Math.max(0, val + delta);
    if (newQty >= modalExpectedQty && newQty > modalExpectedQty) {
        selectedReason = 'over';
    } else if (newQty === modalExpectedQty) {
        selectedReason = null;
    } else {
        // Keep selected reason if still applicable, otherwise reset
        if (selectedReason === 'over') selectedReason = null;
    }
    updateModalStatusButtons();
}

async function adjustPullQty(delta) {
    if (!checkInItem) return;
    const input = document.getElementById('modal-pull-qty');
    const val = parseInt(input.value) || 0;
    const newQty = Math.max(0, val + delta);
    input.value = newQty;

    // Update pull confirm visibility dynamically
    const pullConfirmLabel = document.getElementById('pull-confirm-inline');
    if (newQty > 0) {
        pullConfirmLabel.classList.remove('hidden');
    } else {
        pullConfirmLabel.classList.add('hidden');
    }

    const { supplierIdx, itemIdx } = checkInItem;
    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/set-pull`,
            { quantity: newQty }
        );
        lastWriteTimestamp = Date.now();

        // Update local state
        const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
        item.pull_quantity = newQty > 0 ? newQty : null;
        item.pull_for_floor = newQty > 0;

        // Re-render item list in background (no toast)
        renderItemList();
    } catch (e) {
        showToast('Failed to update pull quantity', 'error');
    }
}

// Also update on direct qty input
document.addEventListener('DOMContentLoaded', () => {
    const qtyInput = document.getElementById('modal-qty');
    if (qtyInput) {
        qtyInput.addEventListener('input', () => {
            const newQty = parseInt(qtyInput.value) || 0;
            if (newQty > modalExpectedQty) {
                selectedReason = 'over';
            } else if (newQty === modalExpectedQty) {
                selectedReason = null;
            } else if (selectedReason === 'over') {
                selectedReason = null;
            }
            updateModalStatusButtons();
        });
    }
});

async function submitCheckIn() {
    if (!checkInItem) return;

    const qty = parseInt(document.getElementById('modal-qty').value) || 0;
    const notes = document.getElementById('modal-notes').value.trim() || null;

    // Determine status
    let status;
    if (qty === modalExpectedQty) {
        status = 'ok';
    } else if (qty < modalExpectedQty) {
        if (!selectedReason || (selectedReason !== 'short' && selectedReason !== 'return')) {
            showToast('Please select Short or Return', 'error');
            return;
        }
        status = selectedReason;
    } else {
        status = 'over';
    }

    const { supplierIdx, itemIdx } = checkInItem;

    // Pull confirmation
    const pullConfirmLabel = document.getElementById('pull-confirm-inline');
    const pullConfirmed = !pullConfirmLabel.classList.contains('hidden')
        ? document.getElementById('pull-confirm-checkbox').classList.contains('checked')
        : null;

    try {
        const body = {
            quantity_received: qty,
            received_status: status,
            received_notes: notes,
        };
        if (pullConfirmed !== null) body.pull_confirmed = pullConfirmed;

        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/checkin`,
            body
        );
        lastWriteTimestamp = Date.now();

        // Update local state
        const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
        item.quantity_received = qty;
        item.received_status = status;
        item.received_notes = notes;
        if (pullConfirmed !== null) item.pull_confirmed = pullConfirmed;

        closeModal();

        // Re-render
        if (supplierFilter !== null) {
            updateFilteredSupplierSummary();
        }
        renderDetail();
        showToast('Item checked in', 'success');

        // Check if all items are now received
        if (!completionShown && checkAllItemsReceived()) {
            completionShown = true;
            showCompletionModal();
        }
    } catch (e) {
        showToast('Failed to check in item', 'error');
    }
}

// ---- Bulk Receive / Unreceive ----

function renderReceiveAllButton(supplierIdx, containerId) {
    const supplier = currentDelivery.suppliers[supplierIdx];
    const pendingCount = supplier.items.filter(i => i.received_status === 'pending').length;
    const allReceived = pendingCount === 0;
    const container = document.getElementById(containerId);

    if (allReceived) {
        container.innerHTML = `
            <button class="receive-all-btn unreceive" onclick="event.stopPropagation(); unreceiveAllSupplier(${supplierIdx})">
                Unreceive All
            </button>`;
    } else {
        container.innerHTML = `
            <button class="receive-all-btn" onclick="event.stopPropagation(); receiveAllSupplier(${supplierIdx})">
                Receive All
            </button>`;
    }
}

async function unreceiveItem() {
    if (!checkInItem) return;
    const { supplierIdx, itemIdx } = checkInItem;

    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/unreceive`,
            {}
        );
        lastWriteTimestamp = Date.now();

        // Update local state
        const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
        item.quantity_received = null;
        item.received_status = 'pending';
        item.received_notes = null;
        item.pull_confirmed = false;

        closeModal();

        if (supplierFilter !== null) {
            updateFilteredSupplierSummary();
        }
        renderDetail();
        showToast('Item unreceived', 'success');
    } catch (e) {
        showToast('Failed to unreceive item', 'error');
    }
}

async function receiveAllSupplier(supplierIdx) {
    const supplier = currentDelivery.suppliers[supplierIdx];
    const pendingItems = supplier.items.filter(i => i.received_status === 'pending');
    if (!pendingItems.length) return;

    showToast(`Receiving ${pendingItems.length} items...`, 'info');

    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/checkin-all-ok`,
            {}
        );
        lastWriteTimestamp = Date.now();

        // Update local state
        supplier.items.forEach(item => {
            if (item.received_status === 'pending') {
                item.quantity_received = item.quantity_expected;
                item.received_status = 'ok';
            }
        });

        // Re-render
        if (supplierFilter !== null) {
            updateFilteredSupplierSummary();
            renderReceiveAllButton(supplierIdx, 'item-receive-all-btn');
        }
        renderDetail();
        showToast(`All ${pendingItems.length} items received`, 'success');

        // Check if all items are now received
        if (!completionShown && checkAllItemsReceived()) {
            completionShown = true;
            showCompletionModal();
        }
    } catch (e) {
        showToast('Failed to receive all items', 'error');
    }
}

async function unreceiveAllSupplier(supplierIdx) {
    const supplier = currentDelivery.suppliers[supplierIdx];
    const receivedItems = supplier.items.filter(i => i.received_status !== 'pending');
    if (!receivedItems.length) return;

    showToast(`Unreceiving ${receivedItems.length} items...`, 'info');

    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/unreceive-all`,
            {}
        );
        lastWriteTimestamp = Date.now();

        // Update local state
        supplier.items.forEach(item => {
            if (item.received_status !== 'pending') {
                item.quantity_received = null;
                item.received_status = 'pending';
                item.received_notes = null;
            }
        });

        // Re-render
        if (supplierFilter !== null) {
            updateFilteredSupplierSummary();
            renderReceiveAllButton(supplierIdx, 'item-receive-all-btn');
        }
        renderDetail();
        showToast(`All ${receivedItems.length} items unreceived`, 'success');
    } catch (e) {
        showToast('Failed to unreceive items', 'error');
    }
}

// ---- Utilities ----
function fmtNum(n) {
    return Number(n).toLocaleString();
}

function casesReceived(items) {
    return items.reduce((sum, item) => {
        if (item.received_status === 'pending') return sum;
        return sum + (item.quantity_received != null ? item.quantity_received : item.quantity_expected);
    }, 0);
}

function casesExpected(items) {
    return items.reduce((sum, item) => sum + item.quantity_expected, 0);
}

function progressBar(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const countClickable = done > 0;
    const toggleBtn = `<button onclick="setShowReceived(${!showReceived})" style="padding:5px 12px;font-size:13px;font-weight:600;border:1px solid var(--border);border-radius:8px;background:${showReceived ? 'var(--success)' : 'var(--surface)'};color:${showReceived ? '#fff' : 'var(--text-secondary)'};cursor:pointer;white-space:nowrap">${showReceived ? 'Hide received' : 'Show received'}</button>`;
    return `
    <div class="progress-bar-summary">
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:4px">
            <div class="progress-bar-count${countClickable ? ' progress-bar-count-toggle' : ''}" style="margin-bottom:0"${countClickable ? ` onclick="setShowReceived(${!showReceived})"` : ''}><span class="${done > 0 ? 'count-green' : ''}">${fmtNum(done)}</span> / ${fmtNum(total)}</div>
            ${toggleBtn}
        </div>
        <div class="progress-bar-label">
            <span class="progress-bar-title ${showReceived ? 'progress-title-received' : ''}" onclick="setShowReceived(${!showReceived})">Received</span>
            <span class="progress-bar-title ${showReceived ? '' : 'progress-title-expected'}" onclick="setShowReceived(${!showReceived})">Expected</span>
        </div>
        <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${pct}%; transition: width 0.4s ease"></div>
        </div>
    </div>`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

function friendlyDateStr(dateStr) {
    // Convert "2026-02-27" -> "Friday, Feb 27, 2026"
    const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return dateStr;
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function friendlyFileName(name) {
    // Strip extension
    const base = name.replace(/\.[^.]+$/, '');
    // Try to find a date pattern (MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, MM.DD.YYYY)
    let m = base.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) {
        const d = new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
        if (!isNaN(d)) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    m = base.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) {
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
        if (!isNaN(d)) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    // Fallback: return filename without extension
    return base;
}

function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function refreshData() {
    switch (currentView) {
        case 'deliveries':
            loadDeliveries();
            break;
        case 'detail':
            if (currentDelivery) {
                openDelivery(currentDelivery.id);
            }
            break;
        case 'storage':
            showStorageFiles();
            break;
    }
    showToast('Refreshed', 'info');
}

// ---- Delivery Completion ----

function checkAllItemsReceived() {
    if (!currentDelivery) return false;
    for (const supplier of currentDelivery.suppliers) {
        for (const item of supplier.items) {
            if (item.received_status === 'pending') return false;
        }
    }
    return true;
}

function getExceptionItems() {
    if (!currentDelivery) return [];
    const exceptions = [];
    currentDelivery.suppliers.forEach(supplier => {
        supplier.items.forEach(item => {
            if (item.received_status !== 'ok' && item.received_status !== 'pending') {
                exceptions.push({
                    supplierName: supplier.supplier_name,
                    description: item.raw_description,
                    expected: item.quantity_expected,
                    received: item.quantity_received,
                    status: item.received_status,
                    notes: item.received_notes,
                });
            }
        });
    });
    return exceptions;
}

function buildAdjustmentStatsHtml(adjItems) {
    if (adjItems.length === 0) {
        return '<div class="report-section-empty">No adjustments — everything matched!</div>';
    }
    return adjItems.map(item => {
        const diffLabel = `${item.diff} ${item.status}`;
        return `
        <div class="report-item-row">
            <div class="report-item-info">
                <span class="report-item-name">${item.name}</span>
                <span class="report-item-supplier">${item.supplier}</span>
            </div>
            <span class="report-item-diff stat-${item.status}">${diffLabel}</span>
        </div>`;
    }).join('');
}

function buildPullStatsHtml(pullItems) {
    if (pullItems.length === 0) {
        return '<div class="report-section-empty">No pull items</div>';
    }
    return pullItems.map(item => {
        const statusChip = item.confirmed
            ? `<span class="report-item-diff stat-pull">&#10003;</span>`
            : `<span class="report-item-diff report-item-pending">•</span>`;
        return `
        <div class="report-item-row">
            <div class="report-item-info">
                <span class="report-item-name">${item.name}</span>
                <span class="report-item-supplier">${item.supplier}</span>
            </div>
            <span class="report-item-cases">${item.cases} cases</span>
            ${statusChip}
        </div>`;
    }).join('');
}

function showCompletionModal() {
    const exceptions = getExceptionItems();
    const adjItems = exceptions.map(e => ({
        name: e.description, supplier: e.supplierName, status: e.status,
        diff: e.status === 'short' ? Math.max(0, (e.expected || 0) - (e.received || 0))
            : e.status === 'over' ? Math.max(0, (e.received || 0) - (e.expected || 0))
            : (e.expected || 0),
    }));

    const normPullItems = [];
    if (currentDelivery) {
        currentDelivery.suppliers.forEach(supplier => {
            supplier.items.forEach(item => {
                if (item.pull_quantity > 0) normPullItems.push({
                    name: item.raw_description, supplier: supplier.supplier_name,
                    cases: item.pull_quantity, confirmed: item.pull_confirmed,
                });
            });
        });
    }

    let html = '';
    html += '<div class="report-section-header">Returns and Adjustments</div>';
    html += buildAdjustmentStatsHtml(adjItems);
    html += '<div class="report-section-header">Pulls</div>';
    html += buildPullStatsHtml(normPullItems);

    document.getElementById('exception-list').innerHTML = html;

    document.querySelector('.complete-modal-content .modal-header h2').textContent = 'All items received!';
    document.querySelector('.complete-subtitle').textContent = 'Review and confirm delivery complete?';
    document.querySelector('.complete-modal-content .modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="dismissCompletionModal()">Continue Checking In</button>
        <button class="btn btn-success" onclick="confirmDeliveryComplete()">Confirm Delivery Complete</button>`;

    document.getElementById('complete-modal').classList.remove('hidden');
}

function dismissCompletionModal() {
    document.getElementById('complete-modal').classList.add('hidden');
    completionShown = false;
    applyPendingUpdate();
}

async function confirmDeliveryComplete() {
    document.getElementById('complete-modal').classList.add('hidden');

    try {
        await apiPost(`/deliveries/${currentDelivery.id}/complete`);

        // Update local state
        currentDelivery.status = 'completed';

        // Show fireworks, then transition to complete screen
        playFireworks(() => {
            showDeliveryOverScreen();
        });
    } catch (e) {
        showToast('Failed to complete delivery', 'error');
        completionShown = false;
    }
}

function showDeliveryOverScreen() {
    const dateStr = currentDelivery.delivery_date
        ? formatDate(currentDelivery.delivery_date)
        : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('complete-date').textContent = dateStr;
    showView('complete');
}

function loadNewDelivery() {
    showNoDeliveryScreen();
}

// ---- Fireworks Animation ----

function playFireworks(onComplete) {
    const canvas = document.getElementById('fireworks-canvas');
    canvas.classList.add('active');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ff2d55', '#00d4ff', '#ff6b6b', '#ffd93d'];

    function createBurst(x, y, count) {
        const n = count || 60;
        for (let i = 0; i < n; i++) {
            const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.5;
            const speed = 2 + Math.random() * 6;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: 1.0,
                decay: 0.005 + Math.random() * 0.008,
                size: 2.5 + Math.random() * 4,
            });
        }
    }

    // Wave 1: three bursts across the screen
    setTimeout(() => createBurst(canvas.width * 0.25, canvas.height * 0.3, 70), 0);
    setTimeout(() => createBurst(canvas.width * 0.75, canvas.height * 0.25, 70), 300);
    setTimeout(() => createBurst(canvas.width * 0.5, canvas.height * 0.2, 80), 600);
    // Wave 2: more bursts
    setTimeout(() => createBurst(canvas.width * 0.15, canvas.height * 0.4, 50), 1200);
    setTimeout(() => createBurst(canvas.width * 0.85, canvas.height * 0.35, 50), 1500);
    setTimeout(() => createBurst(canvas.width * 0.5, canvas.height * 0.15, 90), 1800);
    // Wave 3: grand finale
    setTimeout(() => createBurst(canvas.width * 0.3, canvas.height * 0.25, 60), 2500);
    setTimeout(() => createBurst(canvas.width * 0.7, canvas.height * 0.2, 60), 2700);
    setTimeout(() => createBurst(canvas.width * 0.5, canvas.height * 0.3, 100), 3000);
    setTimeout(() => createBurst(canvas.width * 0.2, canvas.height * 0.15, 50), 3200);
    setTimeout(() => createBurst(canvas.width * 0.8, canvas.height * 0.15, 50), 3400);

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05; // gravity
            p.vx *= 0.995; // air resistance
            p.life -= p.decay;

            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();

            // Sparkle trail
            if (p.life > 0.3 && Math.random() < 0.3) {
                ctx.globalAlpha = p.life * 0.4;
                ctx.beginPath();
                ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.size * p.life * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1;

        if (particles.length > 0) {
            requestAnimationFrame(animate);
        } else {
            canvas.classList.remove('active');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Pause on celebration screen before transitioning
            if (onComplete) setTimeout(onComplete, 3000);
        }
    }

    requestAnimationFrame(animate);
}




// ---- Version History ----

function showVersionHistory() {
    const container = document.getElementById('version-list');
    container.innerHTML = VERSION_HISTORY.map((entry, idx) => `
        <div class="version-entry${idx === 0 ? ' version-current' : ''}">
            <span class="version-number">${entry.version}</span>
            <span class="version-desc">${entry.description}</span>
        </div>
    `).join('');
    document.getElementById('version-modal').classList.remove('hidden');
}

function closeVersionModal() {
    document.getElementById('version-modal').classList.add('hidden');
}

// ---- Week color ----
function applyWeekColor(dateStr) {
    // dateStr: 'YYYY-MM-DD', or omit to use today
    const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const startOfYear = new Date(base.getFullYear(), 0, 0);
    const julianDay = Math.floor((base - startOfYear) / 86400000);
    // ISO week number: weeks run Mon–Sun
    const d = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    document.getElementById('julian-day').innerHTML =
        `<span class="julian-label">Day</span> ${julianDay}&nbsp;&nbsp;<span class="julian-label">Week</span> ${weekNum}`;
    const weekColors = ['week-red', 'week-blue', 'week-yellow', 'week-green'];
    const header = document.getElementById('app-header');
    header.classList.remove(...weekColors);
    header.classList.add(weekColors[(weekNum - 1) % 4]);
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
    applyWeekColor();

    const currentVersion = VERSION_HISTORY[0].version;
    let commitHash = 'dev';
    try {
        const res = await fetch('/api/commit');
        const data = await res.json();
        commitHash = data.hash;
    } catch (e) { /* ignore */ }
    document.getElementById('app-version').textContent = `${currentVersion} · ${commitHash}`;

    await initApp();
});

async function initApp() {
    try {
        const data = await apiGet('/deliveries');
        const deliveries = data.deliveries || [];

        // Find the most recent non-completed delivery
        const active = deliveries
            .filter(d => d.status !== 'completed')
            .sort((a, b) => (b.parsed_at || '').localeCompare(a.parsed_at || ''))[0];

        if (active) {
            await openDelivery(active.id);
        } else {
            showNoDeliveryScreen();
        }
    } catch (e) {
        showToast('Failed to load deliveries', 'error');
        showNoDeliveryScreen();
    }
}

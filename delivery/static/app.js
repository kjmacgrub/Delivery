/**
 * Delivery Check-In App
 * iPad-optimized web app for produce delivery receiving.
 */

const API = '/api/v1';

// ---- Version History ----
const VERSION_HISTORY = [
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
let currentView = 'landing';
let currentDelivery = null;
let currentSupplierIdx = null;
let checkInItem = null; // { supplierIdx, itemIdx }
let supplierFilter = null; // null = show all, or { idx, name } to filter to one supplier
let itemSortMode = 'alpha'; // 'alpha', 'qty', or 'supplier'
let showReceived = false; // false = show pending items, true = show received items
let searchQuery = ''; // search filter for item list
let completionShown = false; // prevent duplicate completion modal
let expandedSuppliers = new Set(); // supplier indices expanded in accordion view

// ---- Real-time Listener State ----
let activeUnsubscribes = [];       // functions to call to tear down listeners
let pendingDeliveryUpdate = null;  // snapshot data waiting for modal to close
let lastWriteTimestamp = 0;        // to debounce our own writes

// ---- Navigation ----
const views = ['landing', 'deliveries', 'storage', 'detail', 'complete', 'reports', 'pullsheet'];

function showView(name) {
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        el.classList.toggle('active', v === name);
    });
    currentView = name;

    const title = document.getElementById('page-title');
    const badge = document.getElementById('status-badge');
    const brandText = document.getElementById('header-brand-text');

    // Default: clear brand text; views that show a delivery date will set it
    brandText.textContent = '';

    switch (name) {
        case 'landing':
            title.textContent = '';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'deliveries':
            title.textContent = 'Deliveries';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'storage':
            title.textContent = 'Import File';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'detail':
            title.textContent = '';
            badge.textContent = '';
            badge.className = 'badge';
            // Brand text set by renderDetail()
            break;
        case 'complete':
            title.textContent = 'Delivery Complete';
            badge.textContent = 'completed';
            badge.className = 'badge badge-completed';
            if (currentDelivery) {
                brandText.textContent = `${currentDelivery.day_of_week} ${formatDate(currentDelivery.delivery_date)}`;
            }
            break;
        case 'reports':
            title.textContent = 'Adjustment Reports';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'pullsheet':
            title.textContent = 'Live Report';
            badge.textContent = '';
            badge.className = 'badge';
            if (currentDelivery) {
                brandText.textContent = `${currentDelivery.day_of_week} ${formatDate(currentDelivery.delivery_date)}`;
            }
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
    showView('landing');
}

// ---- Admin Menu ----
function openAdminModal() {
    const hasActive = currentDelivery && currentDelivery.status !== 'completed';
    document.getElementById('admin-continue-btn').classList.toggle('hidden', !hasActive);
    document.getElementById('admin-report-btn').classList.toggle('hidden', !hasActive);
    document.getElementById('admin-modal').classList.remove('hidden');
}

function closeAdminModal() {
    document.getElementById('admin-modal').classList.add('hidden');
}

function showDeliveriesView() {
    cleanupListeners();
    showView('deliveries');
    loadDeliveries();
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

    // Re-render
    renderDetail();

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

        const excItems = r.exception_items || [];
        const casesShort = excItems.filter(i => i.received_status === 'short')
            .reduce((sum, i) => sum + Math.max(0, (i.quantity_expected || 0) - (i.quantity_received || 0)), 0);
        const casesOver = excItems.filter(i => i.received_status === 'over')
            .reduce((sum, i) => sum + Math.max(0, (i.quantity_received || 0) - (i.quantity_expected || 0)), 0);
        const returnCount = excItems.filter(i => i.received_status === 'return').length;
        const adjItems = excItems.map(i => ({
            name: i.raw_description, supplier: i.supplier_name, status: i.received_status,
            diff: i.received_status === 'short' ? Math.max(0, (i.quantity_expected || 0) - (i.quantity_received || 0))
                : i.received_status === 'over' ? Math.max(0, (i.quantity_received || 0) - (i.quantity_expected || 0)) : null,
        }));

        const pulls = r.pull_items || [];
        const totalPullCases = pulls.reduce((sum, i) => sum + (i.pull_quantity || 0), 0);
        const confirmedPullCases = pulls.filter(i => i.pull_confirmed)
            .reduce((sum, i) => sum + (i.pull_quantity || 0), 0);
        const normPulls = pulls.map(i => ({
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
                <div class="report-section-header">Adjustments</div>
                ${buildAdjustmentStatsHtml(casesShort, casesOver, returnCount, adjItems)}
                <div class="report-section-header">Pulls</div>
                ${buildPullStatsHtml(totalPullCases, confirmedPullCases, pulls.length, normPulls)}
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

        container.innerHTML = data.files.map(f => `
            <div class="card storage-card" onclick="parseStorageFile('${f.name}')">
                <div>
                    <div class="card-title">${f.name}</div>
                    <div class="card-subtitle">${formatSize(f.size)} &middot; ${formatTimestamp(f.updated)}</div>
                </div>
                <span class="storage-parse-label">Parse</span>
            </div>
        `).join('');
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

// ---- Delivery Detail ----
async function openDelivery(id) {
    try {
        const delivery = await apiGet(`/deliveries/${id}`);
        currentDelivery = delivery;
        completionShown = false;

        // If already completed, show the delivery-over screen
        if (delivery.status === 'completed') {
            showDeliveryOverScreen();
            return;
        }

        supplierFilter = null; // reset filter
        expandedSuppliers = new Set(); // reset accordion
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

    const receivedToggleClass = showReceived ? 'summary-stat clickable active-stat' : 'summary-stat clickable';

    // Always show delivery date in header brand
    const brandText = document.getElementById('header-brand-text');
    brandText.textContent = `${delivery.day_of_week} ${formatDate(delivery.delivery_date)}`;

    const detailTitle = document.getElementById('detail-title');

    if (supplierFilter !== null) {
        // Supplier-filtered: show supplier name in detail-title
        const supplier = delivery.suppliers[supplierFilter.idx];
        const supRcv = casesReceived(supplier.items);
        const supExp = casesExpected(supplier.items);
        detailTitle.classList.remove('hidden');
        document.getElementById('detail-title-text').textContent = supplier.supplier_name;
        document.getElementById('delivery-summary').innerHTML =
            progressBar(supRcv, supExp, receivedToggleClass);
    } else {
        // Normal delivery view — date is in header, hide detail-title
        detailTitle.classList.add('hidden');
        const allItems = delivery.suppliers.flatMap(s => s.items);
        const rcvCases = casesReceived(allItems);
        document.getElementById('delivery-summary').innerHTML =
            progressBar(rcvCases, totalCases, receivedToggleClass);
    }

    // Sync search input with state
    const searchInput = document.getElementById('item-search');
    if (searchInput) {
        searchInput.value = searchQuery;
        document.getElementById('search-clear-btn').classList.toggle('hidden', !searchQuery);
    }

    renderItemList();
}

function toggleReceivedView() {
    showReceived = !showReceived;
    updateReceivedToggle();
    renderDetail();
}

function updateReceivedToggle() {
    // Update toggle button state in both sort bars
    const btn1 = document.getElementById('toggle-received');
    const btn2 = document.getElementById('supplier-toggle-received');
    if (btn1) btn1.classList.toggle('active', showReceived);
    if (btn2) btn2.classList.toggle('active', showReceived);
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

    // Update sort button states — only one active at a time
    document.getElementById('sort-alpha').classList.toggle('active', itemSortMode === 'alpha');
    document.getElementById('sort-qty').classList.toggle('active', itemSortMode === 'qty');
    const supplierBtn = document.getElementById('sort-supplier');
    supplierBtn.classList.toggle('active', itemSortMode === 'supplier');
    supplierBtn.classList.toggle('hidden', supplierFilter !== null);

    // Show expand/collapse toggle only in supplier accordion mode
    const expandBtn = document.getElementById('expand-collapse-btn');
    if (itemSortMode === 'supplier' && supplierFilter === null) {
        const allExpanded = currentDelivery.suppliers.length > 0 &&
            currentDelivery.suppliers.every((s, idx) => expandedSuppliers.has(idx));
        expandBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';
        expandBtn.classList.remove('hidden');
    } else {
        expandBtn.classList.add('hidden');
    }


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

    // Sort based on current mode
    if (itemSortMode === 'qty') {
        flatItems.sort((a, b) => {
            const diff = b.quantity_expected - a.quantity_expected;
            if (diff !== 0) return diff;
            return a.raw_description.toLowerCase().localeCompare(b.raw_description.toLowerCase());
        });
    } else {
        flatItems.sort((a, b) => {
            return a.raw_description.toLowerCase().localeCompare(b.raw_description.toLowerCase());
        });
    }

    if (!flatItems.length) {
        let emptyMsg;
        if (searchQuery) {
            emptyMsg = 'No items match your search';
        } else if (!showReceived) {
            emptyMsg = 'All items received!';
        } else {
            emptyMsg = 'No items yet';
        }
        container.innerHTML = `<div class="empty-state"><p>${emptyMsg}</p></div>`;
        return;
    }

    // When filtered by supplier, show cross-supplier info for matching items
    if (supplierFilter !== null) {
        const crossSupplierMap = buildCrossSupplierMap();
        container.innerHTML = flatItems.map(item => {
            let html = renderCompactRow(item, false);
            const key = item.raw_description.toLowerCase();
            const others = crossSupplierMap[key];
            if (others && others.length > 0) {
                html += others.map(o =>
                    `<div class="compact-row cross-supplier-row">
                        <div class="compact-qty cross-supplier-qty">${o.qty}</div>
                        <div class="compact-name cross-supplier-name">also from ${o.supplierName}</div>
                    </div>`
                ).join('');
            }
            return html;
        }).join('');
    } else {
        container.innerHTML = flatItems.map(item => renderCompactRow(item, true)).join('');
    }
}

function buildCrossSupplierMap() {
    // Build a map of item description -> [{ supplierName, qty }] for OTHER suppliers
    if (!currentDelivery || supplierFilter === null) return {};
    const map = {};
    currentDelivery.suppliers.forEach((supplier, sIdx) => {
        if (sIdx === supplierFilter.idx) return; // skip current supplier
        supplier.items.forEach(item => {
            const key = item.raw_description.toLowerCase();
            if (!map[key]) map[key] = [];
            map[key].push({
                supplierName: supplier.supplier_name,
                qty: item.quantity_expected,
            });
        });
    });
    return map;
}

function renderCompactRow(item, showSupplier) {
    const isPending = item.received_status === 'pending';
    const statusClass = isPending ? '' : `checked-${item.received_status}`;
    const processingClass = item.needs_processing ? 'needs-processing' : '';
    const floorClass = item.pull_for_floor ? 'pull-for-floor' : '';

    const checkIcon = isPending
        ? '<div class="compact-check pending"></div>'
        : `<div class="compact-check done">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20,6 9,17 4,12"/>
            </svg>
           </div>`;

    const pullConfirmedClass = item.pull_confirmed ? 'pull-confirmed' : '';
    const pullQty = item.pull_quantity != null
        ? `<span class="pull-qty ${pullConfirmedClass}" onclick="event.stopPropagation(); togglePullFromList(${item.supplierIdx}, ${item.itemIdx})">(${item.pull_quantity})</span> `
        : '';
    const supplierChip = showSupplier
        ? `<div class="compact-supplier" onclick="event.stopPropagation(); filterBySupplier(${item.supplierIdx})">${item.supplierAbbrev}</div>`
        : '';

    return `
    <div class="compact-row ${statusClass} ${processingClass} ${floorClass}${showSupplier ? '' : ' accordion-item'}"
         onclick="openCheckInModalFlat(${item.supplierIdx}, ${item.itemIdx})">
        <div class="compact-qty">${pullQty}${item.quantity_expected}</div>
        <div class="compact-name">${item.raw_description}</div>
        ${supplierChip}
        ${checkIcon}
    </div>`;
}

function renderSupplierAccordion(container, flatItems) {
    const delivery = currentDelivery;
    if (!delivery) return;

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
        const allDone = doneItems === totalItems;
        const someDone = doneItems > 0 && !allDone;

        const statusClass = allDone ? 'supplier-complete' : '';
        const chevronClass = isExpanded ? 'accordion-chevron expanded' : 'accordion-chevron';
        const pct = expCases > 0 ? Math.round((rcvCases / expCases) * 100) : 0;

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
            <span class="accordion-supplier-name">${supplier.supplier_name} <span class="accordion-case-count">${fmtNum(expCases)}</span></span>
            <span class="accordion-focus" onclick="event.stopPropagation(); filterBySupplier(${sIdx})" title="Focus on ${supplier.supplier_name}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/><path d="M16 18l6-6-6-6"/></svg>
            </span>
            <span class="accordion-progress">
                <span class="accordion-progress-track">
                    <span class="accordion-progress-fill" style="width: ${pct}%"></span>
                </span>
                <span class="accordion-progress-label">${fmtNum(rcvCases)}/${fmtNum(expCases)}</span>
            </span>
            ${receiveBtn ? `<span class="accordion-receive-all">${receiveBtn}</span>` : ''}
        </div>`;

        if (isExpanded && supplierItems.length > 0) {
            html += supplierItems.map(item => renderCompactRow(item, false)).join('');
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
    const rcvClass = showReceived ? 'summary-stat clickable active-stat' : 'summary-stat clickable';
    document.getElementById('delivery-summary').innerHTML =
        progressBar(supRcvF, supExpF, rcvClass);

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
    const rcvClass2 = showReceived ? 'summary-stat clickable active-stat' : 'summary-stat clickable';
    const summaryEl = document.getElementById('delivery-summary');
    summaryEl.innerHTML = progressBar(supRcvU, supExpU, rcvClass2);
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
    const casesShort = exceptions.filter(e => e.status === 'short')
        .reduce((sum, e) => sum + Math.max(0, (e.expected || 0) - (e.received || 0)), 0);
    const casesOver = exceptions.filter(e => e.status === 'over')
        .reduce((sum, e) => sum + Math.max(0, (e.received || 0) - (e.expected || 0)), 0);
    const returnCount = exceptions.filter(e => e.status === 'return').length;
    const adjItems = exceptions.map(e => ({
        name: e.description, supplier: e.supplierName, status: e.status,
        diff: e.status === 'short' ? Math.max(0, (e.expected || 0) - (e.received || 0))
            : e.status === 'over' ? Math.max(0, (e.received || 0) - (e.expected || 0)) : null,
    }));

    html += '<div class="report-section-header">Adjustments</div>';
    html += buildAdjustmentStatsHtml(casesShort, casesOver, returnCount, adjItems);

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
    const totalPullCases = pullItems.reduce((sum, i) => sum + (i.pull_quantity || 0), 0);
    const confirmedPullCases = pullItems.filter(i => i.pull_confirmed)
        .reduce((sum, i) => sum + (i.pull_quantity || 0), 0);
    const pendingPullCases = totalPullCases - confirmedPullCases;

    html += '<div class="report-section-header">Pulls</div>';

    if (pullItems.length === 0) {
        html += '<div class="report-section-empty">No pull items</div>';
    } else {
        html += `<div class="report-stat-block">
            <div class="report-stat-row">
                <span class="report-stat-label">Total cases</span>
                <span class="report-stat-num stat-pull">${totalPullCases}</span>
            </div>
            <div class="report-stat-row">
                <span class="report-stat-label">Confirmed</span>
                <span class="report-stat-num stat-pull">${confirmedPullCases}</span>
            </div>
            ${pendingPullCases > 0 ? `<div class="report-stat-row">
                <span class="report-stat-label">Pending</span>
                <span class="report-stat-num">${pendingPullCases}</span>
            </div>` : ''}
        </div>`;

        let currentSupplierName = null;
        pullItems.forEach(item => {
            if (item.supplierName !== currentSupplierName) {
                currentSupplierName = item.supplierName;
                html += `<div class="pull-sheet-supplier">${item.supplierName}</div>`;
            }
            const confirmedClass = item.pull_confirmed ? 'pull-confirmed' : '';
            const statusChip = item.pull_confirmed
                ? `<span class="pull-confirmed-chip">&#10003;</span>`
                : `<span class="pull-pending-chip">&bull;</span>`;
            html += `
            <div class="pull-sheet-row ${confirmedClass}" onclick="togglePullFromReport(${item.supplierIdx}, ${item.itemIdx})">
                <span class="pull-sheet-qty">${item.pull_quantity}</span>
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

function setItemSort(mode) {
    itemSortMode = mode;
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
    const pullGroup = document.getElementById('pull-confirm-group');
    const pullCheckbox = document.getElementById('pull-confirm-checkbox');
    const pullQtySpan = document.getElementById('pull-confirm-qty');
    if (item.pull_quantity != null && item.pull_quantity > 0) {
        pullGroup.classList.remove('hidden');
        pullQtySpan.textContent = item.pull_quantity;
        pullCheckbox.classList.toggle('checked', !!item.pull_confirmed);
    } else {
        pullGroup.classList.add('hidden');
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

function togglePullConfirmed() {
    const cb = document.getElementById('pull-confirm-checkbox');
    cb.classList.toggle('checked');
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

    // Update pull-confirm-group visibility dynamically
    const pullGroup = document.getElementById('pull-confirm-group');
    const pullQtySpan = document.getElementById('pull-confirm-qty');
    if (newQty > 0) {
        pullGroup.classList.remove('hidden');
        pullQtySpan.textContent = newQty;
    } else {
        pullGroup.classList.add('hidden');
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
    const pullGroup = document.getElementById('pull-confirm-group');
    const pullConfirmed = !pullGroup.classList.contains('hidden')
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

function progressBar(done, total, toggleClass) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const cls = toggleClass || '';
    const onclick = toggleClass ? ' onclick="toggleReceivedView()"' : '';
    const toggleLabel = toggleClass
        ? `<div class="progress-bar-toggle"${onclick}>${showReceived ? 'Hide Received' : 'Show Received'}</div>`
        : '';
    return `
    <div class="progress-bar-summary ${cls}">
        ${toggleLabel}
        <div class="progress-bar-count"${onclick}><span class="${done > 0 ? 'count-green' : ''}">${fmtNum(done)}</span> / ${fmtNum(total)}</div>
        <div class="progress-bar-label"${onclick}>
            <span class="progress-bar-title">Received</span>
            <span class="progress-bar-title">Expected</span>
        </div>
        <div class="progress-bar-track"${onclick}>
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

function buildAdjustmentStatsHtml(casesShort, casesOver, returnCount, adjItems = []) {
    if (casesShort === 0 && casesOver === 0 && returnCount === 0) {
        return '<div class="report-section-empty">No adjustments — everything matched!</div>';
    }
    let html = '<div class="report-stat-block">';
    if (casesShort > 0) html += `
        <div class="report-stat-row">
            <span class="report-stat-label">Cases short</span>
            <span class="report-stat-num stat-short">${casesShort}</span>
        </div>`;
    if (casesOver > 0) html += `
        <div class="report-stat-row">
            <span class="report-stat-label">Cases over</span>
            <span class="report-stat-num stat-over">${casesOver}</span>
        </div>`;
    if (returnCount > 0) html += `
        <div class="report-stat-row">
            <span class="report-stat-label">Returns</span>
            <span class="report-stat-num stat-return">${returnCount} item${returnCount !== 1 ? 's' : ''}</span>
        </div>`;
    html += '</div>';
    adjItems.forEach(item => {
        const diffLabel = item.status === 'short' ? `-${item.diff}`
            : item.status === 'over' ? `+${item.diff}`
            : 'return';
        html += `
        <div class="report-item-row">
            <div class="report-item-info">
                <span class="report-item-name">${item.name}</span>
                <span class="report-item-supplier">${item.supplier}</span>
            </div>
            <span class="report-item-diff stat-${item.status}">${diffLabel}</span>
        </div>`;
    });
    return html;
}

function buildPullStatsHtml(totalCases, confirmedCases, itemCount, pullItems = []) {
    if (itemCount === 0) {
        return '<div class="report-section-empty">No pull items</div>';
    }
    const pendingCases = totalCases - confirmedCases;
    let html = '<div class="report-stat-block">';
    html += `
        <div class="report-stat-row">
            <span class="report-stat-label">Total cases</span>
            <span class="report-stat-num stat-pull">${totalCases}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">Confirmed</span>
            <span class="report-stat-num stat-pull">${confirmedCases}</span>
        </div>`;
    if (pendingCases > 0) html += `
        <div class="report-stat-row">
            <span class="report-stat-label">Pending</span>
            <span class="report-stat-num">${pendingCases}</span>
        </div>`;
    html += '</div>';
    pullItems.forEach(item => {
        const statusChip = item.confirmed
            ? `<span class="report-item-diff stat-pull">&#10003;</span>`
            : `<span class="report-item-diff report-item-pending">•</span>`;
        html += `
        <div class="report-item-row">
            <div class="report-item-info">
                <span class="report-item-name">${item.name}</span>
                <span class="report-item-supplier">${item.supplier}</span>
            </div>
            <span class="report-item-cases">${item.cases} cases</span>
            ${statusChip}
        </div>`;
    });
    return html;
}

function showCompletionModal() {
    const exceptions = getExceptionItems();
    const casesShort = exceptions.filter(e => e.status === 'short')
        .reduce((sum, e) => sum + Math.max(0, (e.expected || 0) - (e.received || 0)), 0);
    const casesOver = exceptions.filter(e => e.status === 'over')
        .reduce((sum, e) => sum + Math.max(0, (e.received || 0) - (e.expected || 0)), 0);
    const returnCount = exceptions.filter(e => e.status === 'return').length;
    const adjItems = exceptions.map(e => ({
        name: e.description, supplier: e.supplierName, status: e.status,
        diff: e.status === 'short' ? Math.max(0, (e.expected || 0) - (e.received || 0))
            : e.status === 'over' ? Math.max(0, (e.received || 0) - (e.expected || 0)) : null,
    }));

    const pullItems = [];
    if (currentDelivery) {
        currentDelivery.suppliers.forEach(supplier => {
            supplier.items.forEach(item => {
                if (item.pull_quantity > 0)
                    pullItems.push({ ...item, supplierName: supplier.supplier_name });
            });
        });
    }
    const totalPullCases = pullItems.reduce((sum, i) => sum + (i.pull_quantity || 0), 0);
    const confirmedPullCases = pullItems.filter(i => i.pull_confirmed)
        .reduce((sum, i) => sum + (i.pull_quantity || 0), 0);
    const normPullItems = pullItems.map(i => ({
        name: i.raw_description, supplier: i.supplierName,
        cases: i.pull_quantity, confirmed: i.pull_confirmed,
    }));

    let html = '';
    html += '<div class="report-section-header">Adjustments</div>';
    html += buildAdjustmentStatsHtml(casesShort, casesOver, returnCount, adjItems);
    html += '<div class="report-section-header">Pulls</div>';
    html += buildPullStatsHtml(totalPullCases, confirmedPullCases, pullItems.length, normPullItems);

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

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
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

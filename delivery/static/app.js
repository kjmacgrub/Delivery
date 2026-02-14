/**
 * Delivery Check-In App
 * iPad-optimized web app for produce delivery receiving.
 */

const API = '/api/v1';

// ---- State ----
let currentView = 'deliveries';
let currentDelivery = null;
let currentSupplierIdx = null;
let checkInItem = null; // { supplierIdx, itemIdx }
let detailTab = 'items'; // 'items' or 'suppliers'
let supplierFilter = null; // null = show all, or { idx, name } to filter to one supplier
let itemSortMode = 'alpha'; // 'alpha' or 'qty'
let supplierItemSortMode = 'alpha'; // 'alpha' or 'qty' for supplier drill-in view
let supplierListSortMode = 'alpha'; // 'alpha' or 'qty' for supplier cards list
let showReceived = false; // false = show pending items, true = show received items
let searchQuery = ''; // search filter for item list
let completionShown = false; // prevent duplicate completion modal

// ---- Navigation ----
const views = ['deliveries', 'storage', 'detail', 'checkin', 'complete'];

function showView(name) {
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        el.classList.toggle('active', v === name);
    });
    currentView = name;

    const appHeader = document.getElementById('app-header');
    const backBtn = document.getElementById('back-btn');
    const title = document.getElementById('page-title');
    const badge = document.getElementById('status-badge');

    // Show/hide the top header bar — hidden in checkin view (supplier has its own large header)
    if (name === 'checkin') {
        appHeader.classList.add('hidden');
    } else {
        appHeader.classList.remove('hidden');
    }

    switch (name) {
        case 'deliveries':
            backBtn.classList.add('hidden');
            title.textContent = 'Deliveries';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'storage':
            backBtn.classList.remove('hidden');
            title.textContent = 'Import File';
            badge.textContent = '';
            badge.className = 'badge';
            break;
        case 'detail':
            backBtn.classList.remove('hidden');
            if (currentDelivery) {
                title.textContent = `${currentDelivery.day_of_week} ${formatDate(currentDelivery.delivery_date)}`;
                badge.textContent = currentDelivery.status.replace('_', ' ');
                badge.className = `badge badge-${currentDelivery.status.replace('_', '-')}`;
            }
            break;
        case 'checkin':
            // Header handled by supplier-header in the view itself
            break;
        case 'complete':
            backBtn.classList.add('hidden');
            title.textContent = 'Delivery Complete';
            badge.textContent = 'completed';
            badge.className = 'badge badge-completed';
            break;
    }
}

function goBack() {
    switch (currentView) {
        case 'storage':
            showView('deliveries');
            break;
        case 'detail':
            // If supplier filter is active, clear it instead of going all the way back
            if (supplierFilter !== null) {
                clearSupplierFilter();
                return;
            }
            showView('deliveries');
            loadDeliveries();
            break;
        case 'checkin':
            showView('detail');
            renderDetail();
            break;
        case 'complete':
            showView('deliveries');
            loadDeliveries();
            break;
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

// ---- Delivery List ----
async function loadDeliveries() {
    try {
        const data = await apiGet('/deliveries');
        renderDeliveryList(data.deliveries);
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
        return `
        <div class="card" onclick="openDelivery('${d.id}')">
            <div class="card-header">
                <div>
                    <div class="card-title">${d.day_of_week} ${formatDate(d.delivery_date)}</div>
                    <div class="card-subtitle">${d.source_filename}</div>
                </div>
                <span class="badge badge-${d.status.replace('_', '-')}">${d.status.replace('_', ' ')}</span>
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
            <div class="card storage-card">
                <div>
                    <div class="card-title">${f.name}</div>
                    <div class="card-subtitle">${formatSize(f.size)} &middot; ${formatTimestamp(f.updated)}</div>
                </div>
                <button class="btn btn-primary" onclick="parseStorageFile('${f.name}')">
                    Parse
                </button>
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
        const data = await apiPost(`/storage/files/${encodeURIComponent(fileName)}/parse`);
        showToast(`Parsed: ${data.supplier_count} suppliers, ${data.item_count} items`, 'success');
        showView('deliveries');
        loadDeliveries();
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

        detailTab = 'items'; // always default to items tab
        supplierFilter = null; // reset filter
        showReceived = false; // reset to pending view
        searchQuery = ''; // reset search
        // Ensure supplier filter header and summary are hidden
        document.getElementById('item-supplier-header').classList.add('hidden');
        document.getElementById('item-supplier-summary').classList.add('hidden');
        document.getElementById('item-receive-all-btn').innerHTML = '';
        renderDetail();
        showView('detail');
    } catch (e) {
        showToast('Failed to load delivery', 'error');
    }
}

function renderDetail() {
    if (!currentDelivery) return;
    const delivery = currentDelivery;

    const totalItems = delivery.suppliers.reduce((sum, s) => sum + s.items.length, 0);
    const checkedIn = delivery.suppliers.reduce((sum, s) =>
        sum + s.items.filter(i => i.received_status !== 'pending').length, 0);
    const totalCases = delivery.total_cases_expected;

    // Summary bar — "Checked In" stat is clickable to toggle received view
    const checkedInClass = showReceived ? 'summary-stat clickable active-stat' : 'summary-stat clickable';
    document.getElementById('delivery-summary').innerHTML = `
        <div class="summary-stat">
            <div class="value">${delivery.suppliers.length}</div>
            <div class="label">Suppliers</div>
        </div>
        <div class="summary-stat">
            <div class="value">${totalItems}</div>
            <div class="label">Items</div>
        </div>
        <div class="${checkedInClass}" onclick="toggleReceivedView()">
            <div class="value">${checkedIn}/${totalItems}</div>
            <div class="label">Checked In</div>
        </div>
        <div class="summary-stat">
            <div class="value">${totalCases}</div>
            <div class="label">Cases</div>
        </div>
    `;

    // Toggle buttons
    document.getElementById('tab-items').classList.toggle('active', detailTab === 'items');
    document.getElementById('tab-suppliers').classList.toggle('active', detailTab === 'suppliers');

    // Show/hide tab content
    document.getElementById('tab-content-items').classList.toggle('hidden', detailTab !== 'items');
    document.getElementById('tab-content-suppliers').classList.toggle('hidden', detailTab !== 'suppliers');

    // Sync search input with state
    const searchInput = document.getElementById('item-search');
    if (searchInput) {
        searchInput.value = searchQuery;
        document.getElementById('search-clear-btn').classList.toggle('hidden', !searchQuery);
    }

    if (detailTab === 'items') {
        renderItemList();
    } else {
        renderSupplierList();
    }
}

function switchTab(tab) {
    detailTab = tab;
    if (supplierFilter !== null) {
        supplierFilter = null;
        // Restore app header, summary, toggle when leaving supplier filter
        document.getElementById('app-header').classList.remove('hidden');
        document.getElementById('delivery-summary').classList.remove('hidden');
        document.querySelector('.toggle-bar').classList.remove('hidden');
        document.getElementById('item-supplier-header').classList.add('hidden');
        document.getElementById('item-supplier-summary').classList.add('hidden');
        document.getElementById('item-receive-all-btn').innerHTML = '';
    }
    showReceived = false; // reset to pending view
    renderDetail();
}

function toggleReceivedView() {
    showReceived = !showReceived;
    // Always switch to Items tab since received view shows individual items
    if (showReceived && detailTab !== 'items') {
        detailTab = 'items';
        supplierFilter = null;
    }
    // If clearing supplier filter, restore headers
    if (supplierFilter !== null && showReceived) {
        // Keep supplier filter but that's fine — received view can still filter by supplier
    }
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

    // Filter by received status
    if (showReceived) {
        flatItems = flatItems.filter(item => item.received_status !== 'pending');
    } else {
        flatItems = flatItems.filter(item => item.received_status === 'pending');
    }

    // Filter to one supplier if active
    if (supplierFilter !== null) {
        flatItems = flatItems.filter(item => item.supplierIdx === supplierFilter.idx);
    }

    // Filter by search query
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

    // Update sort button states
    document.getElementById('sort-alpha').classList.toggle('active', itemSortMode === 'alpha');
    document.getElementById('sort-qty').classList.toggle('active', itemSortMode === 'qty');

    const container = document.getElementById('flat-item-list');

    // Build filter bars
    let filterBarHtml = '';
    if (showReceived) {
        filterBarHtml += `
        <div class="received-filter-bar">
            <span>Received Items (${flatItems.length})</span>
            <button class="clear-filter" onclick="toggleReceivedView()">Back to Pending</button>
        </div>`;
    }

    if (!flatItems.length) {
        let emptyMsg;
        if (searchQuery) {
            emptyMsg = 'No items match your search';
        } else if (showReceived) {
            emptyMsg = 'No items received yet';
        } else {
            emptyMsg = 'All items received!';
        }
        container.innerHTML = filterBarHtml + `<div class="empty-state"><p>${emptyMsg}</p></div>`;
        return;
    }

    container.innerHTML = filterBarHtml + flatItems.map(item => {
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

        return `
        <div class="compact-row ${statusClass} ${processingClass} ${floorClass}"
             onclick="openCheckInModalFlat(${item.supplierIdx}, ${item.itemIdx})">
            <div class="compact-qty">${item.quantity_expected}</div>
            <div class="compact-name">${item.raw_description}</div>
            <div class="compact-supplier" onclick="event.stopPropagation(); filterBySupplier(${item.supplierIdx})">${item.supplierAbbrev}</div>
            ${checkIcon}
        </div>`;
    }).join('');
}

function filterBySupplier(supplierIdx) {
    const supplier = currentDelivery.suppliers[supplierIdx];
    supplierFilter = { idx: supplierIdx, name: supplier.supplier_name };
    // Hide app header, summary, and toggle — show large supplier header instead
    document.getElementById('app-header').classList.add('hidden');
    document.getElementById('delivery-summary').classList.add('hidden');
    document.querySelector('.toggle-bar').classList.add('hidden');
    const header = document.getElementById('item-supplier-header');
    header.classList.remove('hidden');
    document.getElementById('item-supplier-header-name').textContent = supplier.supplier_name;

    // Show supplier summary bar
    const doneCount = supplier.items.filter(i => i.received_status !== 'pending').length;
    const pct = supplier.items.length > 0 ? Math.round((doneCount / supplier.items.length) * 100) : 0;
    const summaryEl = document.getElementById('item-supplier-summary');
    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
        <div class="summary-stat">
            <div class="value">${supplier.expected_cases}</div>
            <div class="label">Cases</div>
        </div>
        <div class="summary-stat">
            <div class="value">${supplier.items.length}</div>
            <div class="label">Items</div>
        </div>
        <div class="summary-stat">
            <div class="value">${doneCount}/${supplier.items.length}</div>
            <div class="label">Done</div>
        </div>
        <div class="summary-stat">
            <div class="value">${pct}%</div>
            <div class="label">Complete</div>
        </div>
    `;

    // Receive All / Unreceive All button in sort bar
    renderReceiveAllButton(supplierIdx, 'item-receive-all-btn');

    renderItemList();
    // Scroll to top since we're hiding the app header
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
}

function clearSupplierFilter() {
    supplierFilter = null;
    searchQuery = '';
    // Restore app header, summary, and toggle bar
    document.getElementById('app-header').classList.remove('hidden');
    document.getElementById('delivery-summary').classList.remove('hidden');
    document.querySelector('.toggle-bar').classList.remove('hidden');
    document.getElementById('item-supplier-header').classList.add('hidden');
    document.getElementById('item-supplier-summary').classList.add('hidden');
    document.getElementById('item-receive-all-btn').innerHTML = '';
    // Reset search input
    const searchInput = document.getElementById('item-search');
    searchInput.value = '';
    document.getElementById('search-clear-btn').classList.add('hidden');
    renderItemList();
}

function updateFilteredSupplierSummary() {
    if (supplierFilter === null) return;
    const supplier = currentDelivery.suppliers[supplierFilter.idx];
    const doneCount = supplier.items.filter(i => i.received_status !== 'pending').length;
    const pct = supplier.items.length > 0 ? Math.round((doneCount / supplier.items.length) * 100) : 0;
    const summaryEl = document.getElementById('item-supplier-summary');
    summaryEl.innerHTML = `
        <div class="summary-stat">
            <div class="value">${supplier.expected_cases}</div>
            <div class="label">Cases</div>
        </div>
        <div class="summary-stat">
            <div class="value">${supplier.items.length}</div>
            <div class="label">Items</div>
        </div>
        <div class="summary-stat">
            <div class="value">${doneCount}/${supplier.items.length}</div>
            <div class="label">Done</div>
        </div>
        <div class="summary-stat">
            <div class="value">${pct}%</div>
            <div class="label">Complete</div>
        </div>
    `;
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

// ---- Supplier List (Suppliers tab) ----
function renderSupplierList() {
    const delivery = currentDelivery;
    if (!delivery) return;

    // Update sort button states
    document.getElementById('supplier-list-sort-alpha').classList.toggle('active', supplierListSortMode === 'alpha');
    document.getElementById('supplier-list-sort-qty').classList.toggle('active', supplierListSortMode === 'qty');

    // Build sorted list with original indices
    let sorted = delivery.suppliers.map((s, idx) => ({ ...s, originalIdx: idx }));

    if (supplierListSortMode === 'qty') {
        sorted.sort((a, b) => {
            const diff = b.expected_cases - a.expected_cases;
            if (diff !== 0) return diff;
            return a.supplier_name.toLowerCase().localeCompare(b.supplier_name.toLowerCase());
        });
    } else {
        sorted.sort((a, b) =>
            a.supplier_name.toLowerCase().localeCompare(b.supplier_name.toLowerCase())
        );
    }

    const container = document.getElementById('supplier-list');
    container.innerHTML = sorted.map(s => {
        const itemCount = s.items.length;
        const doneCount = s.items.filter(i => i.received_status !== 'pending').length;
        const pct = itemCount > 0 ? Math.round((doneCount / itemCount) * 100) : 0;

        return `
        <div class="card supplier-${s.status}" onclick="openSupplier(${s.originalIdx})">
            <div class="card-header">
                <div>
                    <div class="card-title">${s.supplier_name}</div>
                    <div class="card-subtitle">${s.expected_cases} cases &middot; ${itemCount} items</div>
                </div>
                <span class="badge badge-${s.status}">${s.status.replace('_', ' ')}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
        </div>`;
    }).join('');
}

function setSupplierListSort(mode) {
    supplierListSortMode = mode;
    renderSupplierList();
}

// ---- Supplier Check-in (drill-in from Supplier tab) ----
function openSupplier(idx) {
    currentSupplierIdx = idx;
    supplierItemSortMode = 'alpha'; // reset sort when opening a supplier
    renderCheckIn();
    showView('checkin');
    // Scroll to top since we're hiding the app header
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
}

function renderCheckIn() {
    const supplier = currentDelivery.suppliers[currentSupplierIdx];
    const doneCount = supplier.items.filter(i => i.received_status !== 'pending').length;
    const pct = supplier.items.length > 0
        ? Math.round((doneCount / supplier.items.length) * 100) : 0;

    // Large supplier name header
    document.getElementById('supplier-header-name').textContent = supplier.supplier_name;

    document.getElementById('supplier-summary').innerHTML = `
        <div class="summary-stat">
            <div class="value">${supplier.expected_cases}</div>
            <div class="label">Cases</div>
        </div>
        <div class="summary-stat">
            <div class="value">${supplier.items.length}</div>
            <div class="label">Items</div>
        </div>
        <div class="summary-stat">
            <div class="value">${doneCount}/${supplier.items.length}</div>
            <div class="label">Done</div>
        </div>
        <div class="summary-stat">
            <div class="value">${pct}%</div>
            <div class="label">Complete</div>
        </div>
    `;

    // Receive All / Unreceive All button in sort bar
    renderReceiveAllButton(currentSupplierIdx, 'supplier-receive-all-btn');

    // Update sort button states
    document.getElementById('supplier-sort-alpha').classList.toggle('active', supplierItemSortMode === 'alpha');
    document.getElementById('supplier-sort-qty').classList.toggle('active', supplierItemSortMode === 'qty');

    // Build sorted item list with original indices preserved for check-in API
    let sortedItems = supplier.items.map((item, idx) => ({ ...item, originalIdx: idx }));

    // Filter out received items (same as flat list behavior)
    sortedItems = sortedItems.filter(item => item.received_status === 'pending');

    if (supplierItemSortMode === 'qty') {
        sortedItems.sort((a, b) => {
            const diff = b.quantity_expected - a.quantity_expected;
            if (diff !== 0) return diff;
            return a.raw_description.toLowerCase().localeCompare(b.raw_description.toLowerCase());
        });
    } else {
        sortedItems.sort((a, b) =>
            a.raw_description.toLowerCase().localeCompare(b.raw_description.toLowerCase())
        );
    }

    const container = document.getElementById('item-list');

    if (!sortedItems.length) {
        container.innerHTML = '<div class="empty-state"><p>All items received!</p></div>';
        return;
    }

    container.innerHTML = sortedItems.map(item => {
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

        return `
        <div class="compact-row ${statusClass} ${processingClass} ${floorClass}"
             onclick="openCheckInModal(${item.originalIdx})">
            <div class="compact-qty">${item.quantity_expected}</div>
            <div class="compact-name">${item.raw_description}</div>
            ${checkIcon}
        </div>`;
    }).join('');
}

function setSupplierItemSort(mode) {
    supplierItemSortMode = mode;
    renderCheckIn();
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

    updateModalStatusButtons();
    document.getElementById('checkin-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('checkin-modal').classList.add('hidden');
    checkInItem = null;
    selectedReason = null;
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
    shortBtn.classList.remove('active');
    overBtn.classList.remove('active');
    returnBtn.classList.remove('active');
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
        }
        // If no reason selected yet, OK stays dim (user must pick Short or Return)
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

    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${supplierIdx}/items/${itemIdx}/checkin`,
            {
                quantity_received: qty,
                received_status: status,
                received_notes: notes,
            }
        );

        // Update local state
        const item = currentDelivery.suppliers[supplierIdx].items[itemIdx];
        item.quantity_received = qty;
        item.received_status = status;
        item.received_notes = notes;

        closeModal();

        // Re-render the appropriate view
        if (currentView === 'detail') {
            if (supplierFilter !== null) {
                // Update the supplier-specific summary bar
                updateFilteredSupplierSummary();
            }
            renderDetail();
        } else if (currentView === 'checkin') {
            renderCheckIn();
            showView('checkin'); // refresh badge
        }
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

        // Update local state
        supplier.items.forEach(item => {
            if (item.received_status === 'pending') {
                item.quantity_received = item.quantity_expected;
                item.received_status = 'ok';
            }
        });

        // Re-render
        if (currentView === 'checkin') {
            renderCheckIn();
        } else if (currentView === 'detail') {
            if (supplierFilter !== null) {
                updateFilteredSupplierSummary();
                renderReceiveAllButton(supplierIdx, 'item-receive-all-btn');
            }
            renderDetail();
        }
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

        // Update local state
        supplier.items.forEach(item => {
            if (item.received_status !== 'pending') {
                item.quantity_received = 0;
                item.received_status = 'pending';
                item.received_notes = null;
            }
        });

        // Re-render
        if (currentView === 'checkin') {
            renderCheckIn();
        } else if (currentView === 'detail') {
            if (supplierFilter !== null) {
                updateFilteredSupplierSummary();
                renderReceiveAllButton(supplierIdx, 'item-receive-all-btn');
            }
            renderDetail();
        }
        showToast(`All ${receivedItems.length} items unreceived`, 'success');
    } catch (e) {
        showToast('Failed to unreceive items', 'error');
    }
}

// ---- Utilities ----
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
        case 'checkin':
            if (currentDelivery) {
                openDelivery(currentDelivery.id).then(() => {
                    if (currentSupplierIdx !== null) {
                        openSupplier(currentSupplierIdx);
                    }
                });
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

function showCompletionModal() {
    const exceptions = getExceptionItems();
    const listEl = document.getElementById('exception-list');

    if (exceptions.length === 0) {
        listEl.innerHTML = `
            <div class="no-exceptions">
                <p>No exceptions — everything matched!</p>
            </div>`;
    } else {
        listEl.innerHTML = `
            <div class="exception-count">${exceptions.length} exception${exceptions.length > 1 ? 's' : ''}</div>
            ${exceptions.map(ex => `
                <div class="exception-row exception-${ex.status}">
                    <div class="exception-info">
                        <div class="exception-name">${ex.description}</div>
                        <div class="exception-supplier">${ex.supplierName}</div>
                    </div>
                    <div class="exception-qty">
                        <span class="exception-expected">${ex.expected}</span>
                        <span class="exception-arrow">&rarr;</span>
                        <span class="exception-received">${ex.received ?? 0}</span>
                    </div>
                    <span class="badge badge-${ex.status}">${ex.status}</span>
                </div>
            `).join('')}`;
    }

    document.getElementById('complete-modal').classList.remove('hidden');
}

function dismissCompletionModal() {
    document.getElementById('complete-modal').classList.add('hidden');
    completionShown = false;
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
    currentDelivery = null;
    currentSupplierIdx = null;
    completionShown = false;
    showStorageFiles();
}

// ---- Fireworks Animation ----

function playFireworks(onComplete) {
    const canvas = document.getElementById('fireworks-canvas');
    canvas.classList.add('active');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ff2d55'];

    function createBurst(x, y) {
        for (let i = 0; i < 40; i++) {
            const angle = (Math.PI * 2 * i) / 40 + (Math.random() - 0.5) * 0.5;
            const speed = 2 + Math.random() * 4;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: 1.0,
                decay: 0.008 + Math.random() * 0.012,
                size: 2 + Math.random() * 3,
            });
        }
    }

    // Stagger 3 bursts across the screen
    setTimeout(() => createBurst(canvas.width * 0.3, canvas.height * 0.35), 0);
    setTimeout(() => createBurst(canvas.width * 0.7, canvas.height * 0.3), 400);
    setTimeout(() => createBurst(canvas.width * 0.5, canvas.height * 0.25), 800);

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.06; // gravity
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
        }

        ctx.globalAlpha = 1;

        if (particles.length > 0) {
            requestAnimationFrame(animate);
        } else {
            canvas.classList.remove('active');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (onComplete) onComplete();
        }
    }

    requestAnimationFrame(animate);
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    showView('deliveries');
    loadDeliveries();
});

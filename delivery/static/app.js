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
let supplierFilter = null; // null = show all, or { idx, name } to filter to one supplier
let itemSortMode = 'alpha'; // 'alpha', 'qty', or 'supplier'
let showReceived = false; // false = show pending items, true = show received items
let searchQuery = ''; // search filter for item list
let completionShown = false; // prevent duplicate completion modal
let expandedSuppliers = new Set(); // supplier indices expanded in accordion view

// ---- Navigation ----
const views = ['deliveries', 'storage', 'detail', 'complete', 'reports'];

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

    // Show/hide the top header bar — hidden in detail view
    if (name === 'detail') {
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
            break;
        case 'complete':
            backBtn.classList.add('hidden');
            title.textContent = 'Delivery Complete';
            badge.textContent = 'completed';
            badge.className = 'badge badge-completed';
            break;
        case 'reports':
            backBtn.classList.remove('hidden');
            title.textContent = 'Exception Reports';
            badge.textContent = '';
            badge.className = 'badge';
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
        case 'complete':
            showView('deliveries');
            loadDeliveries();
            break;
        case 'reports':
            showView('deliveries');
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

async function apiDelete(path) {
    const res = await fetch(API + path, { method: 'DELETE' });
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

// ---- Exception Reports ----
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
                    <p class="subtitle">Exception reports are created when deliveries are completed</p>
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
            ? `<span class="report-exception-count">${r.total_exceptions} exception${r.total_exceptions !== 1 ? 's' : ''}</span>`
            : `<span class="report-no-exceptions">No exceptions</span>`;

        const exceptionRows = (r.exception_items || []).map(item => {
            const statusClass = item.received_status;
            const received = item.quantity_received != null ? item.quantity_received : '?';
            return `
                <div class="report-exception-row">
                    <div class="report-exception-left-bar status-${statusClass}"></div>
                    <div class="report-exception-info">
                        <div class="report-exception-name">${item.raw_description}</div>
                        <div class="report-exception-supplier">${item.supplier_name}</div>
                    </div>
                    <div class="report-exception-qty">
                        ${item.quantity_expected} → ${received}
                    </div>
                    <span class="report-status-badge status-${statusClass}">${item.received_status}</span>
                </div>`;
        }).join('');

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
                ${hasExceptions ? exceptionRows : '<div class="report-all-good">✓ Everything matched — no exceptions</div>'}
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
                    <p class="subtitle">Exception reports are created when deliveries are completed</p>
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

        supplierFilter = null; // reset filter
        expandedSuppliers = new Set(); // reset accordion
        showReceived = false; // reset to pending view
        searchQuery = ''; // reset search
        // Reset supplier filter UI
        document.getElementById('item-receive-all-btn').innerHTML = '';
        document.getElementById('detail-title').setAttribute('onclick', 'goBack()');
        renderDetail();
        showView('detail');
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
    const totalCases = delivery.total_cases_expected;

    const receivedToggleClass = showReceived ? 'summary-stat clickable active-stat' : 'summary-stat clickable';

    if (supplierFilter !== null) {
        // Supplier-filtered: show supplier stats and name
        const supplier = delivery.suppliers[supplierFilter.idx];
        const supRcv = casesReceived(supplier.items);
        const supExp = casesExpected(supplier.items);
        document.getElementById('detail-title-text').textContent = supplier.supplier_name;
        document.getElementById('detail-title').setAttribute('onclick', 'clearSupplierFilter()');
        document.getElementById('delivery-summary').innerHTML =
            progressBar(supRcv, supExp, receivedToggleClass);
    } else {
        // Normal delivery view
        document.getElementById('detail-title-text').textContent = `${delivery.day_of_week} ${formatDate(delivery.delivery_date)}`;
        document.getElementById('detail-title').setAttribute('onclick', 'goBack()');
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

    // Update sort button states
    const isSupplierSort = itemSortMode === 'supplier';
    document.getElementById('sort-alpha').classList.toggle('active', itemSortMode === 'alpha');
    const casesBtn = document.getElementById('sort-qty');
    casesBtn.classList.toggle('active', itemSortMode === 'qty');
    casesBtn.classList.toggle('hidden', isSupplierSort);
    const supplierBtn = document.getElementById('sort-supplier');
    supplierBtn.classList.toggle('active', isSupplierSort);
    supplierBtn.classList.toggle('hidden', supplierFilter !== null);

    // Show expand/collapse toggle only in supplier accordion mode
    const expandBtn = document.getElementById('expand-collapse-btn');
    if (isSupplierSort && supplierFilter === null) {
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

    container.innerHTML = flatItems.map(item => renderCompactRow(item, true)).join('');
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

    const pullQty = item.pull_quantity != null ? `<span class="pull-qty">(${item.pull_quantity})</span> ` : '';
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
            <span class="accordion-supplier-name">${supplier.supplier_name}</span>
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

    // Switch away from supplier sort (irrelevant with single supplier)
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
    document.getElementById('detail-title-text').textContent = supplier.supplier_name;
    document.getElementById('detail-title').setAttribute('onclick', 'clearSupplierFilter()');

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
    // Restore detail-title onclick
    document.getElementById('detail-title').setAttribute('onclick', 'goBack()');
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
        ? `<div class="progress-bar-toggle"${onclick}>${showReceived ? 'Hide Received' : 'Show All'}</div>`
        : '';
    return `
    <div class="progress-bar-summary ${cls}">
        ${toggleLabel}
        <div class="progress-bar-label"${onclick}>
            <span class="progress-bar-count">${fmtNum(done)} / ${fmtNum(total)}</span>
            <span class="progress-bar-title">Received</span>
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

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    showView('deliveries');
    loadDeliveries();
});

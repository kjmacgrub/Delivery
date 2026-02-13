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

// ---- Navigation ----
const views = ['deliveries', 'storage', 'detail', 'checkin'];

function showView(name) {
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        el.classList.toggle('active', v === name);
    });
    currentView = name;

    const backBtn = document.getElementById('back-btn');
    const title = document.getElementById('page-title');
    const badge = document.getElementById('status-badge');

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
            backBtn.classList.remove('hidden');
            if (currentDelivery && currentSupplierIdx !== null) {
                const supplier = currentDelivery.suppliers[currentSupplierIdx];
                title.textContent = supplier.supplier_name;
                badge.textContent = supplier.status.replace('_', ' ');
                badge.className = `badge badge-${supplier.status}`;
            }
            break;
    }
}

function goBack() {
    switch (currentView) {
        case 'storage':
            showView('deliveries');
            break;
        case 'detail':
            showView('deliveries');
            loadDeliveries();
            break;
        case 'checkin':
            showView('detail');
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
        renderDeliveryDetail(delivery);
        showView('detail');
    } catch (e) {
        showToast('Failed to load delivery', 'error');
    }
}

function renderDeliveryDetail(delivery) {
    const totalItems = delivery.suppliers.reduce((sum, s) => sum + s.items.length, 0);
    const checkedIn = delivery.suppliers.reduce((sum, s) =>
        sum + s.items.filter(i => i.received_status !== 'pending').length, 0);
    const totalCases = delivery.total_cases_expected;

    document.getElementById('delivery-summary').innerHTML = `
        <div class="summary-stat">
            <div class="value">${delivery.suppliers.length}</div>
            <div class="label">Suppliers</div>
        </div>
        <div class="summary-stat">
            <div class="value">${totalItems}</div>
            <div class="label">Items</div>
        </div>
        <div class="summary-stat">
            <div class="value">${checkedIn}/${totalItems}</div>
            <div class="label">Checked In</div>
        </div>
        <div class="summary-stat">
            <div class="value">${totalCases}</div>
            <div class="label">Cases</div>
        </div>
    `;

    const container = document.getElementById('supplier-list');
    container.innerHTML = delivery.suppliers.map((s, idx) => {
        const itemCount = s.items.length;
        const doneCount = s.items.filter(i => i.received_status !== 'pending').length;
        const pct = itemCount > 0 ? Math.round((doneCount / itemCount) * 100) : 0;

        return `
        <div class="card supplier-${s.status}" onclick="openSupplier(${idx})">
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

// ---- Supplier Check-in ----
function openSupplier(idx) {
    currentSupplierIdx = idx;
    renderCheckIn();
    showView('checkin');
}

function renderCheckIn() {
    const supplier = currentDelivery.suppliers[currentSupplierIdx];
    const doneCount = supplier.items.filter(i => i.received_status !== 'pending').length;
    const pct = supplier.items.length > 0
        ? Math.round((doneCount / supplier.items.length) * 100) : 0;

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

    const container = document.getElementById('item-list');
    container.innerHTML = supplier.items.map((item, idx) => {
        const isPending = item.received_status === 'pending';
        const statusClass = isPending ? '' : `checked-${item.received_status}`;
        const processingClass = item.needs_processing ? 'needs-processing' : '';
        const floorClass = item.pull_for_floor ? 'pull-for-floor' : '';

        const tags = [];
        if (item.organic_status) {
            const tagClass = item.organic_status === 'organic' ? 'tag-organic'
                : item.organic_status === 'conventional' ? 'tag-conventional'
                : 'tag-ipm';
            tags.push(`<span class="tag ${tagClass}">${item.organic_status}</span>`);
        }
        if (item.pull_for_floor) tags.push('<span class="tag tag-floor">Floor</span>');
        if (item.needs_processing) tags.push('<span class="tag tag-process">Process</span>');
        if (item.category) tags.push(`<span class="tag tag-category">${item.category}</span>`);

        const details = [];
        if (item.variety) details.push(item.variety);
        if (item.size_packaging) details.push(item.size_packaging);
        if (item.brand) details.push(item.brand);

        const checkIcon = isPending
            ? '<div class="item-check pending"></div>'
            : `<div class="item-check done">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
               </div>`;

        return `
        <div class="item-card ${statusClass} ${processingClass} ${floorClass}"
             onclick="openCheckInModal(${idx})">
            <div class="item-qty">${item.quantity_expected}</div>
            <div class="item-info">
                <div class="item-name">${item.product_type || item.raw_description}</div>
                ${details.length ? `<div class="item-details">${details.join(' &middot; ')}</div>` : ''}
                ${tags.length ? `<div class="item-tags">${tags.join('')}</div>` : ''}
            </div>
            ${checkIcon}
        </div>`;
    }).join('');
}

// ---- Check-in Modal ----
function openCheckInModal(itemIdx) {
    const supplier = currentDelivery.suppliers[currentSupplierIdx];
    const item = supplier.items[itemIdx];
    checkInItem = { supplierIdx: currentSupplierIdx, itemIdx };

    document.getElementById('modal-item-name').textContent =
        item.product_type || item.raw_description;
    document.getElementById('modal-expected').textContent = item.quantity_expected;
    document.getElementById('modal-qty').value = item.quantity_received ?? item.quantity_expected;
    document.getElementById('modal-notes').value = item.received_notes || '';

    // Set status
    const status = item.received_status === 'pending' ? 'ok' : item.received_status;
    selectStatus(status);

    document.getElementById('checkin-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('checkin-modal').classList.add('hidden');
    checkInItem = null;
}

function selectStatus(status) {
    document.querySelectorAll('.status-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === status);
    });
}

function adjustQty(delta) {
    const input = document.getElementById('modal-qty');
    const val = parseInt(input.value) || 0;
    input.value = Math.max(0, val + delta);
}

async function submitCheckIn() {
    if (!checkInItem) return;

    const qty = parseInt(document.getElementById('modal-qty').value) || 0;
    const status = document.querySelector('.status-btn.active')?.dataset.status || 'ok';
    const notes = document.getElementById('modal-notes').value.trim() || null;

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
        renderCheckIn();
        showView('checkin'); // refresh badge
        showToast('Item checked in', 'success');
    } catch (e) {
        showToast('Failed to check in item', 'error');
    }
}

async function checkInAllOk() {
    if (currentSupplierIdx === null) return;

    const supplier = currentDelivery.suppliers[currentSupplierIdx];
    const pendingCount = supplier.items.filter(i => i.received_status === 'pending').length;

    if (pendingCount === 0) {
        showToast('All items already checked in', 'info');
        return;
    }

    try {
        await apiPatch(
            `/deliveries/${currentDelivery.id}/suppliers/${currentSupplierIdx}/checkin-all-ok`,
            {}
        );

        // Update local state
        supplier.items.forEach(item => {
            if (item.received_status === 'pending') {
                item.quantity_received = item.quantity_expected;
                item.received_status = 'ok';
            }
        });
        supplier.status = 'complete';

        renderCheckIn();
        showView('checkin'); // refresh badge
        showToast(`${pendingCount} items marked as OK`, 'success');
    } catch (e) {
        showToast('Failed to bulk check-in', 'error');
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
            if (currentDelivery) openDelivery(currentDelivery.id);
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

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    showView('deliveries');
    loadDeliveries();
});

/**
 * HostelFix - Dynamic Admin Warden Management Module
 * Complete database-driven CRUD, Scope Assignment, Granular RBAC,
 * Student Resolution, and Admin Profile Integration.
 */

// --- Core Safe Helper Functions ---
function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function escapeHtml(text) {
    if (!text && text !== 0) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safeShowToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else if (typeof showToast === 'function') {
        showToast(message, type);
    } else {
        console.log(`[Toast ${type}]`, message);
    }
}

function showLoading() {
    const el = document.getElementById('loadingOverlay') || document.getElementById('spinnerOverlay');
    if (el) el.classList.remove('hidden');
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay') || document.getElementById('spinnerOverlay');
    if (el) el.classList.add('hidden');
}

// --- Warden Profile Photo Handlers & Live Preview ---
function handleWardenPhotoFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        safeShowToast('Please select a valid image file (PNG, JPG, WEBP).', 'warning');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const photoInput = document.getElementById('wardenFormPhoto');
        if (photoInput) photoInput.value = e.target.result;
        updateWardenFormPhotoPreview(e.target.result);
        safeShowToast('Photo loaded successfully from file.', 'info');
    };
    reader.onerror = () => safeShowToast('Failed to read image file.', 'error');
    reader.readAsDataURL(file);
}

function handleWardenPhotoUrlInput(url) {
    updateWardenFormPhotoPreview(url);
}

function clearWardenFormPhoto() {
    const photoInput = document.getElementById('wardenFormPhoto');
    const fileInput = document.getElementById('wardenFormPhotoFile');
    if (photoInput) photoInput.value = '';
    if (fileInput) fileInput.value = '';
    updateWardenFormPhotoPreview('');
}

function updateWardenFormPhotoPreview(photoUrl) {
    const previewImg = document.getElementById('wardenFormPhotoPreviewImg');
    const previewInit = document.getElementById('wardenFormPhotoPreviewInitial');
    const clearBtn = document.getElementById('wardenFormPhotoClearBtn');
    const nameInput = document.getElementById('wardenFormName');
    const initial = ((nameInput && nameInput.value.trim()) || 'W').charAt(0).toUpperCase();

    if (previewInit) previewInit.textContent = initial;

    if (photoUrl && String(photoUrl).trim()) {
        const trimmed = String(photoUrl).trim();
        if (previewImg) {
            previewImg.src = trimmed;
            previewImg.classList.remove('hidden');
            previewImg.onerror = () => {
                previewImg.classList.add('hidden');
                if (previewInit) previewInit.classList.remove('hidden');
            };
            previewImg.onload = () => {
                previewImg.classList.remove('hidden');
                if (previewInit) previewInit.classList.add('hidden');
            };
        }
        if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
        if (previewImg) previewImg.classList.add('hidden');
        if (previewInit) previewInit.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
    }
}

let cachedWardensList = [];
let cachedPermissionCatalog = [];
let wardenSearchQuery = '';
let wardenStatusFilter = 'all';
let wardenBlockFilter = 'all';

async function fetchPermissionCatalog() {
    if (cachedPermissionCatalog && cachedPermissionCatalog.length > 0) return cachedPermissionCatalog;
    try {
        const res = await apiRequest('/api/admin/permissions-catalog');
        if (res.ok) {
            cachedPermissionCatalog = await parseJsonResponse(res);
        }
    } catch (e) {
        console.warn('Failed to fetch permissions catalog:', e);
    }
    return cachedPermissionCatalog || [];
}

async function loadWardensList() {
    try {
        const res = await apiRequest(`/api/admin/wardens?_t=${Date.now()}`);
        if (res.ok) {
            cachedWardensList = await parseJsonResponse(res);
            window.currentWardensList = cachedWardensList;
            return cachedWardensList;
        }
    } catch (e) {
        console.error('Failed to load wardens:', e);
    }
    return [];
}

async function loadWardenStats() {
    try {
        const res = await apiRequest(`/api/admin/wardens-stats?_t=${Date.now()}`);
        if (res.ok) {
            return await parseJsonResponse(res);
        }
    } catch (e) {
        console.warn('Failed to load warden stats:', e);
    }
    return null;
}

async function refreshAdminWardensPage(buttonEl) {
    let icon = null;
    if (buttonEl) {
        icon = buttonEl.querySelector('i') || buttonEl;
        if (icon && icon.classList) icon.classList.add('fa-spin');
    }
    showToast('Fetching latest wardens from database...', 'info');
    try {
        await renderAdminWardensPage();
        if (document.getElementById('adminTotalWardens')) {
            const stats = await loadWardenStats();
            if (stats) document.getElementById('adminTotalWardens').textContent = stats.totalWardens || 0;
        }
        showToast('Wardens refreshed from database!', 'success');
    } catch (err) {
        showToast('Error refreshing wardens from database.', 'error');
    } finally {
        if (icon && icon.classList) icon.classList.remove('fa-spin');
    }
}

// ============================================================================
// 1. RENDER WARDEN MANAGEMENT PAGE
// ============================================================================

async function renderAdminWardensPage() {
    const container = document.getElementById('adminWardensGrid');
    if (!container) return;

    // 1. Render Stats Bar
    const statsContainer = document.getElementById('adminWardensStatsBar');
    const stats = await loadWardenStats();
    if (statsContainer && stats) {
        statsContainer.innerHTML = `
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                <div class="glass rounded-2xl p-4 border border-border">
                    <p class="text-xs font-semibold text-text-secondary">Total Wardens</p>
                    <p class="text-2xl font-bold text-text mt-1">${stats.totalWardens || 0}</p>
                </div>
                <div class="glass rounded-2xl p-4 border border-border">
                    <p class="text-xs font-semibold text-text-secondary">Active Wardens</p>
                    <p class="text-2xl font-bold text-emerald mt-1">${stats.activeWardens || 0}</p>
                </div>
                <div class="glass rounded-2xl p-4 border border-border">
                    <p class="text-xs font-semibold text-text-secondary">Inactive</p>
                    <p class="text-2xl font-bold text-amber-500 mt-1">${stats.inactiveWardens || 0}</p>
                </div>
                <div class="glass rounded-2xl p-4 border border-border">
                    <p class="text-xs font-semibold text-text-secondary">Students Managed</p>
                    <p class="text-2xl font-bold text-primary mt-1">${stats.studentsManaged || 0}</p>
                </div>
                <div class="glass rounded-2xl p-4 border border-border">
                    <p class="text-xs font-semibold text-text-secondary">Pending Complaints</p>
                    <p class="text-2xl font-bold text-warning mt-1">${stats.pendingComplaints || 0}</p>
                </div>
                <div class="glass rounded-2xl p-4 border border-border">
                    <p class="text-xs font-semibold text-text-secondary">Pending Gate Passes</p>
                    <p class="text-2xl font-bold text-purple-600 mt-1">${stats.pendingGatePasses || 0}</p>
                </div>
            </div>
        `;
    }

    // 2. Load wardens
    const wardens = await loadWardensList();
    renderFilteredWardensList(wardens);
}

function generateWardenId() {
    return `WRD-${Math.floor(100000 + Math.random() * 900000)}`;
}

function prepareWardenModal(modal) {
    if (!modal) return;
    // Keep the overlay outside any hidden .page container. Otherwise the
    // handler can run successfully while the modal remains invisible because
    // an ancestor page has display:none.
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.pointerEvents = 'auto';
}

function refreshWardenFormId() {
    const input = document.getElementById('wardenFormCustomId');
    if (input) input.value = generateWardenId();
}

function renderFilteredWardensList(wardensToFilter) {
    const container = document.getElementById('adminWardensGrid');
    if (!container) return;

    let wardens = Array.isArray(wardensToFilter) ? wardensToFilter : cachedWardensList;

    // Apply Search
    if (wardenSearchQuery) {
        const query = wardenSearchQuery.toLowerCase().trim();
        wardens = wardens.filter(w => 
            (w.name && w.name.toLowerCase().includes(query)) ||
            (w.email && w.email.toLowerCase().includes(query)) ||
            (w.phone && w.phone.toLowerCase().includes(query)) ||
            (w.userId && w.userId.toLowerCase().includes(query)) ||
            (w.block && w.block.toLowerCase().includes(query)) ||
            (w.hostelBlock && w.hostelBlock.toLowerCase().includes(query))
        );
    }

    // Apply Status Filter
    if (wardenStatusFilter !== 'all') {
        wardens = wardens.filter(w => (w.status || 'Active').toLowerCase() === wardenStatusFilter.toLowerCase());
    }

    // Apply Block Filter
    if (wardenBlockFilter !== 'all') {
        wardens = wardens.filter(w => {
            const b = (w.block || w.hostelBlock || w.scope?.block || '').toLowerCase();
            return b.includes(wardenBlockFilter.toLowerCase()) || b === 'all';
        });
    }

    if (!wardens || wardens.length === 0) {
        container.innerHTML = `
            <div class="col-span-full glass p-12 rounded-3xl border border-border text-center space-y-4 max-w-lg mx-auto my-6">
                <div class="w-20 h-20 rounded-3xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center mx-auto text-3xl shadow-inner">
                    <i class="fa-solid fa-user-shield"></i>
                </div>
                <h3 class="text-xl font-bold text-text">No Wardens Added</h3>
                <p class="text-sm text-text-secondary">Create your first warden account to start managing hostel operations.</p>
                <button onclick="openAddWardenModal()" class="btn-primary px-6 py-3 rounded-2xl text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-primary/25 hover:scale-105 transition-transform">
                    <i class="fa-solid fa-plus"></i> Add New Warden
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = wardens.map(w => {
        const isActive = (w.status || 'Active') === 'Active';
        const statusClass = isActive ? 'bg-emerald/10 text-emerald border-emerald/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20';
        const scope = w.scope || {};
        const hostelText = scope.hostel || 'Main Hostel';
        const blockText = scope.block || w.block || w.hostelBlock || 'Block A';
        const floorsText = scope.floors && scope.floors !== 'All' ? `Floor ${scope.floors}` : 'All Floors';
        const roomsText = scope.rooms && scope.rooms !== 'All' ? `Rooms: ${scope.rooms}` : 'All Rooms';
        const permsCount = Array.isArray(w.permissions) ? w.permissions.length : 15;
        const studentCount = w.studentCount !== undefined ? w.studentCount : 0;
        const photoUrl = w.profilePhoto || '';
        const initialChar = (w.name || 'W').charAt(0).toUpperCase();

        return `
            <div class="glass rounded-3xl border border-border p-6 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between group hover:border-primary/40 bg-surface">
                <div>
                    <!-- Card Header -->
                    <div class="flex items-start justify-between gap-3 mb-4 pb-4 border-b border-border/70">
                        <div class="flex items-center gap-3 min-w-0">
                            <div class="relative w-12 h-12 shrink-0">
                                <img src="${escapeHtml(photoUrl)}" alt="" class="w-12 h-12 rounded-2xl object-cover border border-border shadow-md ${photoUrl ? '' : 'hidden'}" onerror="this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');">
                                <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-base flex items-center justify-center shadow-md shadow-indigo-500/20 ${photoUrl ? 'hidden' : ''}">
                                    ${initialChar}
                                </div>
                            </div>
                            <div class="min-w-0">
                                <h3 class="font-bold text-base text-text truncate group-hover:text-primary transition-colors">${escapeHtml(w.name || 'Hostel Warden')}</h3>
                                <p class="text-xs text-text-secondary truncate mt-0.5"><i class="fa-solid fa-envelope text-primary/70 mr-1"></i>${escapeHtml(w.email || '')}</p>
                            </div>
                        </div>
                        <button onclick="toggleWardenStatus('${w.id || w.userId}', '${w.status || 'Active'}')" title="Click to toggle status" class="px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${statusClass} hover:opacity-80 shrink-0">
                            <span class="w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald animate-pulse' : 'bg-slate-400'}"></span>
                            ${w.status || 'Active'}
                        </button>
                    </div>

                    <!-- Details Matrix -->
                    <div class="space-y-2.5 text-xs mb-5">
                        <!-- Phone & ID -->
                        <div class="flex items-center justify-between text-text-secondary">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-id-badge text-text-muted"></i> ID: <strong class="font-mono text-text">${w.userId || w.id || '—'}</strong></span>
                            ${w.phone ? `<a href="tel:${w.phone}" class="text-primary font-semibold hover:underline flex items-center gap-1"><i class="fa-solid fa-phone text-xs"></i> ${escapeHtml(w.phone)}</a>` : '<span class="text-text-muted">No phone</span>'}
                        </div>

                        <!-- Scope Badge -->
                        <div class="p-3 rounded-2xl bg-surface-alt border border-border/80 space-y-1.5">
                            <div class="flex items-center justify-between font-semibold text-text">
                                <span class="flex items-center gap-1.5 text-indigo-600 font-bold"><i class="fa-solid fa-building"></i> ${escapeHtml(hostelText)}</span>
                                <span class="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 text-[10px] font-bold uppercase">${escapeHtml(blockText)}</span>
                            </div>
                            <div class="flex items-center justify-between text-[11px] text-text-secondary pt-1 border-t border-border/50">
                                <span><i class="fa-solid fa-layer-group text-text-muted mr-1"></i>${escapeHtml(floorsText)}</span>
                                <span><i class="fa-solid fa-door-open text-text-muted mr-1"></i>${escapeHtml(roomsText)}</span>
                            </div>
                        </div>

                        <!-- Optional Metadata Preview if available -->
                        ${w.gender || w.emergencyContact ? `
                            <div class="flex items-center justify-between text-[11px] text-text-secondary px-1">
                                ${w.gender ? `<span><i class="fa-solid fa-venus-mars mr-1 text-text-muted"></i>${escapeHtml(w.gender)}</span>` : '<span></span>'}
                                ${w.emergencyContact ? `<span><i class="fa-solid fa-phone-volume mr-1 text-amber-500"></i>Emg: ${escapeHtml(w.emergencyContact)}</span>` : ''}
                            </div>
                        ` : ''}

                        <!-- Metrics (Students & Permissions) -->
                        <div class="grid grid-cols-2 gap-2 pt-1">
                            <div onclick="openWardenStudentsModal('${w.id || w.userId}')" class="p-2.5 rounded-xl bg-primary/5 border border-primary/15 hover:bg-primary/10 cursor-pointer transition-all text-center">
                                <p class="text-[10px] uppercase font-bold text-primary">Assigned Students</p>
                                <p class="text-lg font-bold text-primary mt-0.5 flex items-center justify-center gap-1">
                                    <i class="fa-solid fa-users text-xs"></i> ${studentCount}
                                </p>
                            </div>
                            <div onclick="openWardenPermissionsModal('${w.id || w.userId}')" class="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/15 hover:bg-purple-500/10 cursor-pointer transition-all text-center">
                                <p class="text-[10px] uppercase font-bold text-purple-600">Permissions</p>
                                <p class="text-lg font-bold text-purple-600 mt-0.5 flex items-center justify-center gap-1">
                                    <i class="fa-solid fa-shield-halved text-xs"></i> ${permsCount} / 15
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="pt-4 border-t border-border/60 flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <button onclick="openWardenStudentsModal('${w.id || w.userId}')" title="View Assigned Students" class="px-2.5 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-white text-xs font-semibold transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-users text-[11px]"></i> Students
                        </button>
                        <button onclick="openWardenPermissionsModal('${w.id || w.userId}')" title="Manage Permissions" class="px-2.5 py-1.5 rounded-xl bg-purple-500/10 text-purple-600 hover:bg-purple-600 hover:text-white text-xs font-semibold transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-shield-halved text-[11px]"></i> RBAC
                        </button>
                        <button onclick="openWardenDigitalIdModal('${w.id || w.userId}')" title="View Official Digital Identity Card with Admin Signature" class="px-2.5 py-1.5 rounded-xl bg-emerald/10 text-emerald hover:bg-emerald hover:text-white text-xs font-semibold transition-all flex items-center gap-1.5 border border-emerald/20 shadow-xs">
                            <i class="fa-solid fa-id-card text-[11px]"></i> Digital ID
                        </button>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button type="button" data-warden-edit="${escapeHtml(w.id || w.userId || '')}" onclick="event.stopPropagation(); openEditWardenModal(this.dataset.wardenEdit);" title="Edit Warden Profile" class="px-3 h-8 rounded-xl border border-border bg-surface-alt hover:bg-primary hover:text-white text-text-secondary flex items-center justify-center gap-1.5 text-xs font-semibold transition-all">
                            <i class="fa-solid fa-pen-to-square"></i><span>Edit</span>
                        </button>
                        <button onclick="deleteWardenWithConfirm('${w.id || w.userId}', '${escapeHtml(w.name || 'Warden')}')" title="Delete Warden" class="w-8 h-8 rounded-xl border border-danger/20 bg-danger/5 hover:bg-danger hover:text-white text-danger flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function filterWardensBySearch(query) {
    wardenSearchQuery = query || '';
    renderFilteredWardensList();
}

function filterWardensByStatus(status) {
    wardenStatusFilter = status || 'all';
    renderFilteredWardensList();
}

function filterWardensByBlock(block) {
    wardenBlockFilter = block || 'all';
    renderFilteredWardensList();
}

// ============================================================================
// 2. ADMIN PROFILE: "MY WARDENS" SECTION
// ============================================================================

async function renderAdminProfileWardens() {
    const container = document.getElementById('adminProfileMyWardensContainer');
    if (!container) return;

    const wardens = await loadWardensList();
    if (!wardens || wardens.length === 0) {
        container.innerHTML = `
            <div class="p-6 rounded-2xl bg-surface-alt border border-border text-center space-y-2">
                <p class="text-sm font-semibold text-text">No Wardens Assigned</p>
                <p class="text-xs text-text-secondary">You have not created or assigned any wardens yet.</p>
                <button onclick="navigateTo('admin-wardens'); setTimeout(openAddWardenModal, 100);" class="mt-2 btn-primary px-4 py-2 rounded-xl text-white text-xs font-semibold inline-flex items-center gap-2">
                    <i class="fa-solid fa-plus"></i> Add Warden
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="space-y-3">
            <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-bold uppercase tracking-wider text-text-secondary">Assigned Wardens (${wardens.length})</p>
                <button onclick="navigateTo('admin-wardens')" class="text-xs text-primary font-bold hover:underline">Manage All ➔</button>
            </div>
            ${wardens.map(w => {
                const isActive = (w.status || 'Active') === 'Active';
                const scope = w.scope || {};
                const blockText = scope.block || w.block || 'Block A';
                const floorsText = scope.floors && scope.floors !== 'All' ? `Fl: ${scope.floors}` : 'All Fl';
                const studentCount = w.studentCount !== undefined ? w.studentCount : 0;
                const permsCount = Array.isArray(w.permissions) ? w.permissions.length : 15;

                return `
                    <div class="p-4 rounded-2xl border border-border/80 bg-surface-alt flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-primary/30 transition-all">
                        <div class="flex items-center gap-3 min-w-0">
                            <div class="relative w-10 h-10 shrink-0">
                                <img src="${escapeHtml(w.profilePhoto || '')}" alt="" class="w-10 h-10 rounded-xl object-cover border border-border shadow-sm ${w.profilePhoto ? '' : 'hidden'}" onerror="this.classList.add('hidden'); if(this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');">
                                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-sm ${w.profilePhoto ? 'hidden' : ''}">
                                    ${(w.name || 'W').charAt(0).toUpperCase()}
                                </div>
                            </div>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <h4 class="font-bold text-sm text-text truncate">${escapeHtml(w.name || 'Warden')}</h4>
                                    <span class="px-2 py-0.2 rounded-full text-[10px] font-bold ${isActive ? 'bg-emerald/10 text-emerald border border-emerald/20' : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'}">${w.status || 'Active'}</span>
                                </div>
                                <p class="text-xs text-text-secondary truncate"><i class="fa-solid fa-envelope text-primary/70 mr-1"></i>${escapeHtml(w.email || '')}</p>
                            </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-2 text-xs">
                            <span class="px-2.5 py-1 rounded-lg bg-surface border border-border font-semibold text-text-secondary flex items-center gap-1">
                                <i class="fa-solid fa-building text-indigo-500"></i> ${escapeHtml(blockText)} • ${escapeHtml(floorsText)}
                            </span>
                            <span class="px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-bold flex items-center gap-1">
                                <i class="fa-solid fa-users"></i> ${studentCount} Students
                            </span>
                            <span class="px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-600 font-bold flex items-center gap-1">
                                <i class="fa-solid fa-shield-halved"></i> ${permsCount} RBAC
                            </span>
                            <button onclick="openWardenDigitalIdModal('${w.id || w.userId}')" title="View Digital ID Card" class="px-2.5 py-1 rounded-lg bg-emerald/10 text-emerald hover:bg-emerald hover:text-white font-bold flex items-center gap-1 transition-all border border-emerald/20 shadow-xs">
                                <i class="fa-solid fa-id-card"></i> Digital ID
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ============================================================================
// 3. DYNAMIC HOSTEL STRUCTURE & CASCADES
// ============================================================================

let cachedHostelStructure = null;
let latestCreatedWardenCredentials = null;

async function fetchHostelStructure() {
    if (cachedHostelStructure) return cachedHostelStructure;
    try {
        const res = await apiRequest('/api/hostel-structure');
        if (res.ok) {
            cachedHostelStructure = await parseJsonResponse(res);
            return cachedHostelStructure;
        }
    } catch (e) {
        console.warn('Could not fetch hostel structure, using defaults:', e.message);
    }
    // Fallback default structure
    cachedHostelStructure = {
        hostels: ['Main Hostel', 'Boys Hostel', 'Girls Hostel', 'PG Hostel', 'All Hostels'],
        blocks: [
            {
                name: 'Block A',
                floors: ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'],
                roomsByFloor: {
                    'Floor 1': ['101-130'],
                    'Floor 2': ['201-230'],
                    'Floor 3': ['301-330'],
                    'All Floors': ['All Rooms', '101-130', '201-230', '301-330']
                }
            },
            {
                name: 'Block B',
                floors: ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'],
                roomsByFloor: {
                    'Floor 1': ['101-130'],
                    'Floor 2': ['201-230'],
                    'Floor 3': ['301-330'],
                    'All Floors': ['All Rooms']
                }
            },
            {
                name: 'Block C',
                floors: ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'],
                roomsByFloor: {
                    'Floor 1': ['101-130'],
                    'Floor 2': ['201-230'],
                    'Floor 3': ['301-330'],
                    'All Floors': ['All Rooms']
                }
            },
            {
                name: 'Block D',
                floors: ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'],
                roomsByFloor: {
                    'Floor 1': ['101-130'],
                    'Floor 2': ['201-230'],
                    'Floor 3': ['301-330'],
                    'All Floors': ['All Rooms']
                }
            }
        ]
    };
    return cachedHostelStructure;
}

async function populateDynamicHostelSelects(selectedBlock = 'Block A', selectedFloor = 'All', selectedRoom = 'All') {
    const struct = await fetchHostelStructure();
    const blockSelect = document.getElementById('wardenFormBlock');
    if (!blockSelect) return;

    // Populate Blocks
    blockSelect.innerHTML = (struct.blocks || []).map(b => `
        <option value="${escapeHtml(b.name)}" ${b.name === selectedBlock ? 'selected' : ''}>${escapeHtml(b.name)}</option>
    `).join('') + '<option value="All">All Blocks</option>';

    // Trigger Floor update
    await handleWardenBlockChange(selectedBlock, selectedFloor, selectedRoom);
}

async function handleWardenBlockChange(blockName, preselectedFloor = null, preselectedRoom = null) {
    const struct = await fetchHostelStructure();
    const floorSelect = document.getElementById('wardenFormFloors');
    if (!floorSelect) return;

    const blockObj = (struct.blocks || []).find(b => b.name === blockName);
    const floors = blockObj?.floors || ['Floor 1', 'Floor 2', 'Floor 3', 'All Floors'];

    floorSelect.innerHTML = '<option value="All">All Floors</option>' + floors.filter(f => f !== 'All' && f !== 'All Floors').map(f => `
        <option value="${escapeHtml(f)}">${escapeHtml(f)}</option>
    `).join('');

    if (preselectedFloor) {
        floorSelect.value = preselectedFloor;
    }

    await handleWardenFloorChange(floorSelect.value, preselectedRoom);
}

async function handleWardenFloorChange(floorName, preselectedRoom = null) {
    const roomInput = document.getElementById('wardenFormRooms');
    if (!roomInput) return;

    if (preselectedRoom) {
        roomInput.value = preselectedRoom;
        return;
    }

    const blockName = document.getElementById('wardenFormBlock')?.value || 'Block A';
    const struct = await fetchHostelStructure();
    const blockObj = (struct.blocks || []).find(b => b.name === blockName);

    if (floorName === 'Floor 1' || floorName === '1') {
        roomInput.value = '101-130';
    } else if (floorName === 'Floor 2' || floorName === '2') {
        roomInput.value = '201-230';
    } else if (floorName === 'Floor 3' || floorName === '3') {
        roomInput.value = '301-330';
    } else {
        roomInput.value = 'All';
    }
}

// ============================================================================
// 4. ADD / EDIT WARDEN MODAL HANDLERS
// ============================================================================

async function openAddWardenModal() {
    const modal = document.getElementById('adminWardenModal');
    if (!modal) return;

    // Show the form first. Optional catalog/hostel requests must never make
    // the Add New Warden button appear unresponsive.
    prepareWardenModal(modal);

    let catalog = [];
    try {
        catalog = await fetchPermissionCatalog();
    } catch (error) {
        console.warn('Warden permission catalog unavailable:', error.message);
    }

    // Reset Form
    document.getElementById('adminWardenModalTitle').textContent = 'Add New Warden';
    document.getElementById('adminWardenIdField').value = '';
    document.getElementById('wardenFormName').value = '';
    document.getElementById('wardenFormEmail').value = '';
    document.getElementById('wardenFormPhone').value = '';
    document.getElementById('wardenFormCustomId').value = generateWardenId();
    document.getElementById('wardenFormStatus').value = 'Active';

    // Show Auto-Password notice & hide edit password inputs
    const addNotice = document.getElementById('wardenAddPasswordNotice');
    const editSection = document.getElementById('wardenEditPasswordSection');
    if (addNotice) addNotice.classList.remove('hidden');
    if (editSection) editSection.classList.add('hidden');

    if (document.getElementById('wardenFormPassword')) document.getElementById('wardenFormPassword').value = '';
    if (document.getElementById('wardenFormConfirmPassword')) document.getElementById('wardenFormConfirmPassword').value = '';
    if (document.getElementById('wardenFormGender')) document.getElementById('wardenFormGender').value = 'Male';
    if (document.getElementById('wardenFormAddress')) document.getElementById('wardenFormAddress').value = '';
    if (document.getElementById('wardenFormEmergencyContact')) document.getElementById('wardenFormEmergencyContact').value = '';
    clearWardenFormPhoto();

    // Populate Dynamic Blocks & Floors
    try {
        await populateDynamicHostelSelects('Block A', 'All', 'All');
    } catch (error) {
        console.warn('Dynamic hostel scope unavailable; using form defaults:', error.message);
    }

    // Render Permissions Checkboxes
    renderWardenPermissionCheckboxes(catalog, catalog.map(p => p.id));

    setTimeout(() => document.getElementById('wardenFormName')?.focus(), 100);
}

async function openEditWardenModal(wardenId) {
    const modal = document.getElementById('adminWardenModal');
    if (!modal) return;

    // Open immediately so a slow database request never makes the Edit button
    // look inactive. The fields are populated as soon as the record resolves.
    prepareWardenModal(modal);
    const title = document.getElementById('adminWardenModalTitle');
    if (title) title.textContent = 'Loading Warden Details...';

    let warden = cachedWardensList.find(w => (w.id === wardenId || w.userId === wardenId));
    // The card may have been rendered by a real-time refresh before the local
    // cache was updated. Resolve the clicked record directly instead of
    // silently making the Edit button do nothing.
    if (!warden) {
        try {
            const response = await apiRequest(`/api/admin/wardens/${encodeURIComponent(wardenId)}`);
            if (response.ok) {
                warden = await parseJsonResponse(response);
                if (warden && !cachedWardensList.some(item => item.id === warden.id || item.userId === warden.userId)) {
                    cachedWardensList.push(warden);
                }
            }
        } catch (error) {
            console.warn('Unable to load warden for editing:', error.message);
        }
    }
    if (!warden) {
        closeAdminWardenModal();
        showToast('Warden not found.', 'error');
        return;
    }

    let catalog = [];
    try {
        catalog = await fetchPermissionCatalog();
    } catch (error) {
        console.warn('Warden permission catalog unavailable:', error.message);
    }

    document.getElementById('adminWardenModalTitle').textContent = 'Edit Warden Details';
    document.getElementById('adminWardenIdField').value = warden.userId || warden.id;
    document.getElementById('wardenFormName').value = warden.name || '';
    document.getElementById('wardenFormEmail').value = warden.email || '';
    document.getElementById('wardenFormPhone').value = warden.phone || '';
    document.getElementById('wardenFormCustomId').value = warden.userId || warden.id || '';

    // Hide Auto-Password notice & show optional edit password inputs
    const addNotice = document.getElementById('wardenAddPasswordNotice');
    const editSection = document.getElementById('wardenEditPasswordSection');
    if (addNotice) addNotice.classList.add('hidden');
    if (editSection) editSection.classList.remove('hidden');

    if (document.getElementById('wardenFormPassword')) document.getElementById('wardenFormPassword').value = '';
    if (document.getElementById('wardenFormConfirmPassword')) document.getElementById('wardenFormConfirmPassword').value = '';

    if (document.getElementById('wardenFormGender')) document.getElementById('wardenFormGender').value = warden.gender || 'Male';
    if (document.getElementById('wardenFormAddress')) document.getElementById('wardenFormAddress').value = warden.address || '';
    if (document.getElementById('wardenFormEmergencyContact')) document.getElementById('wardenFormEmergencyContact').value = warden.emergencyContact || '';
    if (document.getElementById('wardenFormPhoto')) document.getElementById('wardenFormPhoto').value = warden.profilePhoto || '';
    updateWardenFormPhotoPreview(warden.profilePhoto || '');

    const scope = warden.scope || {};
    document.getElementById('wardenFormHostel').value = scope.hostel || 'Main Hostel';
    document.getElementById('wardenFormStatus').value = warden.status || 'Active';

    // Populate Dynamic Scope Selects
    try {
        await populateDynamicHostelSelects(scope.block || warden.block || 'Block A', scope.floors || 'All', scope.rooms || 'All');
    } catch (error) {
        console.warn('Dynamic hostel scope unavailable; using saved scope:', error.message);
    }

    const activePerms = Array.isArray(warden.permissions) ? warden.permissions : catalog.map(p => p.id);
    renderWardenPermissionCheckboxes(catalog, activePerms);

}

function renderWardenPermissionCheckboxes(catalog, activePermissions) {
    const container = document.getElementById('wardenFormPermissionsContainer');
    if (!container) return;

    const permsSet = new Set(activePermissions);

    // Group by category
    const grouped = {};
    catalog.forEach(p => {
        const group = p.group || 'General';
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(p);
    });

    container.innerHTML = Object.entries(grouped).map(([group, list]) => `
        <div class="p-3 rounded-2xl bg-surface-alt border border-border/70 space-y-2">
            <p class="text-[11px] font-bold uppercase tracking-wider text-primary">${escapeHtml(group)}</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${list.map(item => `
                    <label class="flex items-start gap-2.5 p-2 rounded-xl bg-surface border border-border/60 hover:border-primary/40 cursor-pointer transition-all">
                        <input type="checkbox" name="wardenPermissions" value="${item.id}" ${permsSet.has(item.id) ? 'checked' : ''} class="w-4 h-4 rounded text-primary focus:ring-primary border-border mt-0.5">
                        <div class="min-w-0 flex-1 text-xs">
                            <p class="font-bold text-text">${escapeHtml(item.label)}</p>
                            <p class="text-[10px] text-text-secondary leading-tight mt-0.5">${escapeHtml(item.description || '')}</p>
                        </div>
                    </label>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function selectAllWardenPermissions(selectAll = true) {
    document.querySelectorAll('input[name="wardenPermissions"]').forEach(cb => {
        cb.checked = Boolean(selectAll);
    });
}

function closeAdminWardenModal() {
    const modal = document.getElementById('adminWardenModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
}

async function handleAdminWardenSubmit(e) {
    e.preventDefault();
    const wardenId = document.getElementById('adminWardenIdField').value;
    const name = document.getElementById('wardenFormName').value.trim();
    const email = document.getElementById('wardenFormEmail').value.trim();
    const phone = document.getElementById('wardenFormPhone').value.trim();
    const customId = document.getElementById('wardenFormCustomId').value.trim();
    const password = document.getElementById('wardenFormPassword')?.value || '';
    const confirmPassword = document.getElementById('wardenFormConfirmPassword')?.value || '';
    const hostel = document.getElementById('wardenFormHostel').value;
    const block = document.getElementById('wardenFormBlock').value;
    const floors = document.getElementById('wardenFormFloors').value.trim() || 'All';
    const rooms = document.getElementById('wardenFormRooms').value.trim() || 'All';
    const status = document.getElementById('wardenFormStatus').value;

    const gender = document.getElementById('wardenFormGender')?.value || '';
    const address = document.getElementById('wardenFormAddress')?.value?.trim() || '';
    const emergencyContact = document.getElementById('wardenFormEmergencyContact')?.value?.trim() || '';
    const profilePhoto = document.getElementById('wardenFormPhoto')?.value?.trim() || '';

    const checkedPerms = Array.from(document.querySelectorAll('input[name="wardenPermissions"]:checked')).map(cb => cb.value);

    if (!name || !email) {
        safeShowToast('Name and Gmail/Email address are required.', 'warning');
        return;
    }

    if (!isValidEmail(email)) {
        safeShowToast('Please enter a valid Gmail / Email address.', 'warning');
        return;
    }

    if (!phone) {
        safeShowToast('Mobile number is required.', 'warning');
        return;
    }

    if (password && confirmPassword && password !== confirmPassword) {
        safeShowToast('Password and Confirm Password do not match.', 'error');
        return;
    }

    showLoading();
    try {
        const payload = {
            name,
            fullName: name,
            email,
            phone,
            mobileNumber: phone,
            wardenId: customId,
            hostel,
            hostelBlock: block,
            block,
            floors,
            rooms,
            status,
            gender,
            address,
            emergencyContact,
            profilePhoto,
            permissions: checkedPerms
        };
        if (password) {
            payload.password = password;
            payload.confirmPassword = confirmPassword;
        }

        const url = wardenId ? `/api/admin/wardens/${encodeURIComponent(wardenId)}` : '/api/admin/wardens';
        const method = wardenId ? 'PUT' : 'POST';

        const res = await apiRequest(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await parseJsonResponse(res);
        hideLoading();

        if (!res.ok) {
            if (res.status === 409) {
                safeShowToast(data.error || 'A user/warden with this email address already exists. Please edit the existing warden or use another email.', 'warning');
            } else {
                safeShowToast(data.error || 'Failed to save warden details.', 'error');
            }
            return;
        }

        closeAdminWardenModal();

        // If created new warden with a generated temporary password, show the Success Credentials modal
        if (!wardenId && data.temporaryPassword) {
            openWardenSuccessModal({
                name: data.name,
                wardenId: data.userId || data.wardenId || data.id,
                email: data.email,
                block: block,
                floors: floors,
                rooms: rooms,
                temporaryPassword: data.temporaryPassword
            });
        } else {
            safeShowToast(`Warden ${data.name} saved successfully!`, 'success');
        }

        await renderAdminWardensPage();
        await renderAdminProfileWardens();
        if (typeof updateAdminDashboardSummary === 'function') updateAdminDashboardSummary();
        if (typeof refreshAdminDashboardData === 'function') refreshAdminDashboardData();
        const stats = await loadWardenStats();
        if (stats && document.getElementById('adminTotalWardens')) {
            document.getElementById('adminTotalWardens').textContent = stats.totalWardens || 0;
        }
    } catch (err) {
        hideLoading();
        console.error('Error saving warden:', err);
        safeShowToast('Unable to reach server. Please try again.', 'error');
    }
}

// ============================================================================
// 4.5 WARDEN SUCCESS CREDENTIALS MODAL & CLIPBOARD
// ============================================================================

function openWardenSuccessModal(details) {
    latestCreatedWardenCredentials = details;

    const modal = document.getElementById('wardenCreatedSuccessModal');
    if (!modal) return;

    if (document.getElementById('succWardenName')) document.getElementById('succWardenName').textContent = details.name;
    if (document.getElementById('succWardenId')) document.getElementById('succWardenId').textContent = details.wardenId;
    if (document.getElementById('succWardenEmail')) document.getElementById('succWardenEmail').textContent = details.email;
    if (document.getElementById('succWardenScope')) {
        document.getElementById('succWardenScope').textContent = `${details.block} • ${details.floors || 'All'} • Rm ${details.rooms || 'All'}`;
    }
    if (document.getElementById('succWardenPassword')) {
        document.getElementById('succWardenPassword').value = details.temporaryPassword;
    }

    modal.classList.remove('hidden');
}

function closeWardenSuccessModal() {
    const modal = document.getElementById('wardenCreatedSuccessModal');
    if (modal) modal.classList.add('hidden');
}

function copyTemporaryPasswordOnly() {
    const pwdInput = document.getElementById('succWardenPassword');
    if (!pwdInput || !pwdInput.value) return;

    navigator.clipboard.writeText(pwdInput.value).then(() => {
        showToast('Temporary password copied to clipboard!', 'success');
    }).catch(() => {
        pwdInput.select();
        document.execCommand('copy');
        showToast('Password copied!', 'success');
    });
}

function copyWardenCredentials() {
    if (!latestCreatedWardenCredentials) return;
    const c = latestCreatedWardenCredentials;
    const text = `HostelFix Warden Credentials:\n• Name: ${c.name}\n• Warden ID: ${c.wardenId}\n• Email: ${c.email}\n• Assigned Scope: ${c.block} (${c.floors}, Rooms: ${c.rooms})\n• Temporary Password: ${c.temporaryPassword}\n\nNote: You will be prompted to set a permanent password upon first login at http://localhost:5000.`;

    navigator.clipboard.writeText(text).then(() => {
        showToast('Complete warden login credentials copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Credentials copied!', 'success');
    });
}

async function toggleWardenStatus(wardenId, currentStatus) {
    const nextStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    showLoading();
    try {
        const res = await apiRequest(`/api/admin/wardens/${encodeURIComponent(wardenId)}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus })
        });
        hideLoading();
        if (res.ok) {
            showToast(`Warden marked as ${nextStatus}!`, 'success');
            await renderAdminWardensPage();
            await renderAdminProfileWardens();
        } else {
            const data = await parseJsonResponse(res);
            showToast(data.error || 'Failed to update status.', 'error');
        }
    } catch (e) {
        hideLoading();
        showToast('Error updating status.', 'error');
    }
}

async function deleteWardenWithConfirm(wardenId, wardenName) {
    if (!confirm(`Are you sure you want to delete Warden "${wardenName}"?\n\nThis will permanently remove their login credentials, scope, and RBAC permissions from the database.`)) {
        return;
    }

    showLoading();
    try {
        const res = await apiRequest(`/api/admin/wardens/${encodeURIComponent(wardenId)}`, {
            method: 'DELETE'
        });
        hideLoading();
        if (res.ok) {
            showToast(`Warden "${wardenName}" removed successfully!`, 'success');
            await renderAdminWardensPage();
            await renderAdminProfileWardens();
        } else {
            const data = await parseJsonResponse(res);
            showToast(data.error || 'Failed to delete warden.', 'error');
        }
    } catch (e) {
        hideLoading();
        showToast('Error deleting warden.', 'error');
    }
}

// ============================================================================
// 4. VIEW ASSIGNED STUDENTS MODAL
// ============================================================================

async function openWardenStudentsModal(wardenId) {
    const modal = document.getElementById('wardenStudentsModal');
    if (!modal) return;

    const warden = cachedWardensList.find(w => (w.id === wardenId || w.userId === wardenId));
    const titleEl = document.getElementById('wardenStudentsModalTitle');
    const subtitleEl = document.getElementById('wardenStudentsModalSubtitle');
    const listEl = document.getElementById('wardenStudentsModalList');

    if (titleEl) titleEl.textContent = `Students Assigned to ${warden?.name || 'Warden'}`;
    if (subtitleEl) {
        const scope = warden?.scope || {};
        subtitleEl.textContent = `Scope: ${scope.hostel || 'Main Hostel'} • ${scope.block || warden?.block || 'Block A'} • Floors: ${scope.floors || 'All'} • Rooms: ${scope.rooms || 'All'}`;
    }

    if (listEl) listEl.innerHTML = '<div class="p-8 text-center text-text-secondary"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading assigned students...</div>';
    modal.classList.remove('hidden');

    try {
        const res = await apiRequest(`/api/admin/wardens/${encodeURIComponent(wardenId)}/students`);
        if (res.ok) {
            const students = await parseJsonResponse(res);
            if (!students || students.length === 0) {
                listEl.innerHTML = `
                    <div class="p-8 text-center text-text-secondary space-y-2">
                        <div class="w-12 h-12 rounded-xl bg-slate-500/10 text-slate-500 flex items-center justify-center mx-auto text-xl">
                            <i class="fa-solid fa-user-slash"></i>
                        </div>
                        <p class="font-bold text-text">No Students Found</p>
                        <p class="text-xs">No registered students currently match this warden's configured scope.</p>
                    </div>
                `;
                return;
            }

            listEl.innerHTML = `
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-surface-alt text-text-secondary uppercase font-bold border-b border-border/80">
                            <tr>
                                <th class="px-4 py-3">Student Name</th>
                                <th class="px-4 py-3">Reg. Number</th>
                                <th class="px-4 py-3">Block & Room</th>
                                <th class="px-4 py-3">Phone</th>
                                <th class="px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-border/60">
                            ${students.map(s => `
                                <tr class="hover:bg-surface-alt/50 transition-colors">
                                    <td class="px-4 py-3 font-bold text-text flex items-center gap-2">
                                        <div class="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-[11px] shrink-0">
                                            ${(s.name || 'S').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p>${escapeHtml(s.name || 'Student')}</p>
                                            <p class="text-[10px] text-text-muted font-normal">${escapeHtml(s.email || '')}</p>
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 font-mono font-semibold">${escapeHtml(s.registrationNumber || s.regNo || '—')}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 font-bold text-[11px]">${escapeHtml(s.hostelBlock || s.block || 'Block A')}</span>
                                        <span class="font-semibold text-text ml-1">Rm ${escapeHtml(s.roomNumber || s.room || '—')}</span>
                                    </td>
                                    <td class="px-4 py-3 text-text-secondary">${s.phone ? `<a href="tel:${s.phone}" class="text-primary hover:underline">${escapeHtml(s.phone)}</a>` : '—'}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'Inactive' ? 'bg-slate-500/10 text-slate-500' : 'bg-emerald/10 text-emerald'}">${s.status || 'Active'}</span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    } catch (e) {
        listEl.innerHTML = '<div class="p-8 text-center text-danger font-semibold">Failed to fetch students.</div>';
    }
}

function closeWardenStudentsModal() {
    const modal = document.getElementById('wardenStudentsModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
}

// ============================================================================
// 5. QUICK PERMISSIONS MODAL
// ============================================================================

let currentQuickPermsWardenId = '';

async function openWardenPermissionsModal(wardenId) {
    const modal = document.getElementById('wardenPermissionsModal');
    if (!modal) return;

    currentQuickPermsWardenId = wardenId;
    const warden = cachedWardensList.find(w => (w.id === wardenId || w.userId === wardenId));
    const titleEl = document.getElementById('wardenPermissionsModalTitle');
    const container = document.getElementById('wardenQuickPermissionsList');

    if (titleEl) titleEl.textContent = `Permissions for ${warden?.name || 'Warden'}`;

    const catalog = await fetchPermissionCatalog();
    const activePerms = new Set(Array.isArray(warden?.permissions) ? warden.permissions : catalog.map(p => p.id));

    if (container) {
        container.innerHTML = catalog.map(item => `
            <label class="p-3 rounded-2xl bg-surface-alt border border-border/80 hover:border-primary/40 flex items-start gap-3 cursor-pointer transition-all">
                <input type="checkbox" name="quickPermItem" value="${item.id}" ${activePerms.has(item.id) ? 'checked' : ''} class="w-4 h-4 rounded text-primary focus:ring-primary border-border mt-0.5">
                <div class="min-w-0 flex-1 text-xs">
                    <div class="flex items-center justify-between">
                        <p class="font-bold text-text">${escapeHtml(item.label)}</p>
                        <span class="text-[10px] font-bold text-primary uppercase">${escapeHtml(item.group || 'RBAC')}</span>
                    </div>
                    <p class="text-[11px] text-text-secondary leading-tight mt-0.5">${escapeHtml(item.description || '')}</p>
                </div>
            </label>
        `).join('');
    }

    modal.classList.remove('hidden');
}

function toggleAllQuickPermissions(selectAll = true) {
    document.querySelectorAll('input[name="quickPermItem"]').forEach(cb => {
        cb.checked = Boolean(selectAll);
    });
}

function closeWardenPermissionsModal() {
    const modal = document.getElementById('wardenPermissionsModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
}

async function saveWardenQuickPermissions() {
    if (!currentQuickPermsWardenId) return;

    const checkedPerms = Array.from(document.querySelectorAll('input[name="quickPermItem"]:checked')).map(cb => cb.value);

    showLoading();
    try {
        const res = await apiRequest(`/api/admin/wardens/${encodeURIComponent(currentQuickPermsWardenId)}/permissions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: checkedPerms })
        });
        hideLoading();
        if (res.ok) {
            showToast('Permissions saved successfully!', 'success');
            closeWardenPermissionsModal();
            await renderAdminWardensPage();
            await renderAdminProfileWardens();
        } else {
            const data = await parseJsonResponse(res);
            showToast(data.error || 'Failed to update permissions.', 'error');
        }
    } catch (e) {
        hideLoading();
        showToast('Error updating permissions.', 'error');
    }
}

// ============================================================================
// 5.5 OFFICIAL WARDEN DIGITAL IDENTITY CARD MODAL & EXPORT
// ============================================================================

let currentDigitalIdWardenData = null;

async function openWardenDigitalIdModal(wardenId) {
    const modal = document.getElementById('wardenDigitalIdModal');
    if (!modal) return;

    showLoading();
    let warden = cachedWardensList.find(w => (w.id === wardenId || w.userId === wardenId));
    let digitalId = null;

    try {
        const res = await apiRequest(`/api/admin/wardens/${encodeURIComponent(wardenId)}/digital-id`);
        if (res.ok) {
            const data = await parseJsonResponse(res);
            if (data && data.warden) {
                warden = data.warden;
                digitalId = data.digitalId;
            }
        }
    } catch (e) {
        console.warn('Error fetching digital ID from server:', e);
    }
    hideLoading();

    if (!warden) {
        showToast('Warden record not found.', 'error');
        return;
    }

    currentDigitalIdWardenData = { warden, digitalId };

    const name = warden.name || warden.fullName || 'Hostel Warden';
    const cleanId = warden.userId || warden.wardenId || warden.id || 'WRD-000000';
    const email = warden.email || '—';
    const phone = warden.phone || warden.mobileNumber || '—';
    const gender = warden.gender || 'Not specified';
    const address = warden.address || 'Campus Staff Quarters, Block 2';
    const emergencyContact = warden.emergencyContact || '—';
    const photoUrl = warden.profilePhoto || '';
    const status = warden.status || 'Active';
    const isActive = status === 'Active';

    const scope = warden.scope || {};
    const hostel = scope.hostel || 'Main Hostel';
    const block = scope.block || warden.block || warden.hostelBlock || 'Block A';
    const floors = scope.floors && scope.floors !== 'All' ? `Floor ${scope.floors}` : 'All Floors';
    const rooms = scope.rooms && scope.rooms !== 'All' ? `Rooms ${scope.rooms}` : 'All Rooms';
    const permsCount = Array.isArray(warden.permissions) ? warden.permissions.length : 15;

    const sig = digitalId || warden.adminSignature || {};
    const certId = sig.certificateId || `HF-WRD-CERT-${cleanId}`;
    const signedBy = sig.signedBy || 'System Administrator';
    const signedAt = sig.signedAt ? new Date(sig.signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const fingerprint = sig.fingerprint || (sig.signatureHash ? sig.signatureHash.slice(0, 24).toUpperCase().match(/.{4}/g).join('-') : 'HF-AUTH-VERIFIED-2026');

    // Populate photo & avatar
    const imgEl = document.getElementById('idCardPhoto');
    const avatarWrap = document.getElementById('idCardAvatarInitial');
    if (imgEl && avatarWrap) {
        avatarWrap.textContent = name.charAt(0).toUpperCase();
        if (photoUrl) {
            imgEl.src = photoUrl;
            imgEl.classList.remove('hidden');
            imgEl.onerror = () => {
                imgEl.classList.add('hidden');
                avatarWrap.classList.remove('hidden');
            };
            imgEl.onload = () => {
                imgEl.classList.remove('hidden');
                avatarWrap.classList.add('hidden');
            };
            avatarWrap.classList.add('hidden');
        } else {
            imgEl.classList.add('hidden');
            avatarWrap.classList.remove('hidden');
        }
    }

    if (document.getElementById('idCardName')) document.getElementById('idCardName').textContent = name;
    if (document.getElementById('idCardWardenId')) document.getElementById('idCardWardenId').textContent = cleanId;
    if (document.getElementById('idCardEmail')) document.getElementById('idCardEmail').textContent = email;
    if (document.getElementById('idCardPhone')) document.getElementById('idCardPhone').textContent = phone;
    if (document.getElementById('idCardGender')) document.getElementById('idCardGender').textContent = gender;
    if (document.getElementById('idCardEmergencyContact')) document.getElementById('idCardEmergencyContact').textContent = emergencyContact;
    if (document.getElementById('idCardAddress')) document.getElementById('idCardAddress').textContent = address;

    if (document.getElementById('idCardHostel')) document.getElementById('idCardHostel').textContent = hostel;
    if (document.getElementById('idCardBlock')) document.getElementById('idCardBlock').textContent = block;
    if (document.getElementById('idCardFloors')) document.getElementById('idCardFloors').textContent = floors;
    if (document.getElementById('idCardRooms')) document.getElementById('idCardRooms').textContent = rooms;
    if (document.getElementById('idCardPermissionsCount')) document.getElementById('idCardPermissionsCount').textContent = `${permsCount} / 15 RBAC Authorized`;

    if (document.getElementById('idCardStatusBadge')) {
        document.getElementById('idCardStatusBadge').innerHTML = `
            <span class="w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
            <span>${isActive ? 'VERIFIED ACTIVE WARDEN' : 'INACTIVE WARDEN'}</span>
        `;
        document.getElementById('idCardStatusBadge').className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'} tracking-wider uppercase`;
    }

    // Admin Digital Signature & Stamp Fields
    if (document.getElementById('idCardSignedBy')) document.getElementById('idCardSignedBy').textContent = signedBy;
    if (document.getElementById('idCardCertId')) document.getElementById('idCardCertId').textContent = certId;
    if (document.getElementById('idCardSignatureFingerprint')) document.getElementById('idCardSignatureFingerprint').textContent = fingerprint;
    if (document.getElementById('idCardSignedAt')) document.getElementById('idCardSignedAt').textContent = signedAt;

    // Scannable dynamic QR Code (Optimized for Google Lens and Camera Scanners)
    if (document.getElementById('idCardQrImage')) {
        const qrEl = document.getElementById('idCardQrImage');
        const origin = window.location.origin;
        const verifyUrl = `${origin}/verify-warden?id=${encodeURIComponent(cleanId)}&cert=${encodeURIComponent(certId)}`;
        if (sig.qrImage && sig.qrPayload && String(sig.qrPayload).startsWith('http')) {
            qrEl.src = sig.qrImage;
        } else {
            qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(verifyUrl)}`;
        }
    }

    prepareWardenModal(modal);
}

function closeWardenDigitalIdModal() {
    const modal = document.getElementById('wardenDigitalIdModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
}

const SRI_SHAKTHI_BANNER_DATA_URL = '/public/sri_shakthi_header.jpg';

function printWardenDigitalIdCard() {
    const printArea = document.getElementById('wardenDigitalIdCardContent');
    if (!printArea) return window.print();

    const cardHtml = printArea.outerHTML;
    const printWindow = window.open('', '_blank', 'width=850,height=900');
    if (!printWindow) {
        return window.print();
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sri Shakthi Institute of Engineering & Technology - Warden Official Smart Credential</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { 
                    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; 
                    background: #f8fafc; 
                    color: #0f172a;
                    padding: 30px 20px; 
                    display: flex; 
                    flex-direction: column;
                    justify-content: center; 
                    align-items: center; 
                    min-height: 100vh; 
                    margin: 0;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .print-card-wrapper {
                    max-width: 640px; 
                    width: 100%; 
                    background: #ffffff; 
                    padding: 28px; 
                    border-radius: 20px; 
                    border: 1px solid #e2e8f0;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
                }
                .print-banner-img {
                    width: 100%;
                    max-height: 90px;
                    object-fit: contain;
                    display: block;
                    margin: 0 auto;
                }
                @media print {
                    body { 
                        background: #ffffff !important; 
                        padding: 0 !important; 
                        margin: 0 !important;
                    }
                    .no-print { display: none !important; }
                    .print-card-wrapper {
                        max-width: 100% !important;
                        border: none !important;
                        box-shadow: none !important;
                        padding: 16px !important;
                        page-break-inside: avoid;
                    }
                    #wardenDigitalIdCardContent {
                        box-shadow: none !important;
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <div class="no-print" style="margin-bottom: 16px; display: flex; gap: 10px; align-items: center;">
                <button onclick="window.print()" style="background: #4f46e5; color: white; border: none; padding: 8px 18px; border-radius: 10px; font-weight: bold; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);">
                    <i class="fa-solid fa-print"></i> Print ID Card / Save as PDF
                </button>
                <button onclick="window.close()" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer;">
                    Close
                </button>
            </div>
            <div class="print-card-wrapper">
                <!-- Sri Shakthi Institution Header Banner (Added only on Print / Download) -->
                <div style="width: 100%; display: flex; justify-content: center; align-items: center; padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid #e2e8f0;">
                    <img src="${SRI_SHAKTHI_BANNER_DATA_URL}" onerror="this.onerror=null;this.src='/public/siet-logo.png'" alt="Sri Shakthi Institute of Engineering and Technology" class="print-banner-img">
                </div>
                ${cardHtml}
            </div>
            <script>
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        window.print();
                    }, 400);
                });
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function copyWardenDigitalIdDetails() {
    if (!currentDigitalIdWardenData) return;
    const w = currentDigitalIdWardenData.warden;
    const sig = currentDigitalIdWardenData.digitalId || w.adminSignature || {};
    const text = `HostelFix Official Warden Digital Identity:
• Name: ${w.name || w.fullName}
• Warden ID: ${w.userId || w.id}
• Status: ${w.status || 'Active'}
• Email: ${w.email}
• Mobile: ${w.phone || w.mobileNumber}
• Scope: ${w.scope?.hostel || 'Main Hostel'} - ${w.scope?.block || w.block || 'Block A'} (${w.scope?.floors || 'All Floors'})
• Certificate ID: ${sig.certificateId || 'HF-WRD-CERT-' + (w.userId || w.id)}
• Signature Hash: ${sig.signatureHash || 'VERIFIED'}
• Signed By: ${sig.signedBy || 'System Administrator'}
• Endorsement: OFFICIALLY ENDORSED & DIGITALLY SIGNED`;

    navigator.clipboard.writeText(text).then(() => {
        showToast('Digital ID card credentials & signature copied!', 'success');
    }).catch(() => {
        showToast('Digital ID details copied!', 'success');
    });
}

function openWardenSuccessDigitalId() {
    if (!latestCreatedWardenCredentials) return;
    openWardenDigitalIdModal(latestCreatedWardenCredentials.wardenId);
}

function openWardenDashboardPreview(wardenId, wardenEmail, wardenName, block) {
    closeWardenSuccessModal();
    closeWardenDigitalIdModal();
    if (window.currentUser && window.currentUser.role === 'admin') {
        window.adminReturnUser = { ...window.currentUser };
    }
    const cleanId = wardenId || latestCreatedWardenCredentials?.wardenId || 'WRD-NEW';
    const cleanEmail = wardenEmail || latestCreatedWardenCredentials?.email || `${cleanId.toLowerCase()}@hostelfix.edu`;
    const cleanName = wardenName || latestCreatedWardenCredentials?.name || 'Hostel Warden';
    const cleanBlock = block || latestCreatedWardenCredentials?.block || 'Block A';

    window.currentUser = {
        id: cleanId,
        userId: cleanId,
        wardenId: cleanId,
        email: cleanEmail,
        name: cleanName,
        role: 'warden',
        block: cleanBlock,
        hostelBlock: cleanBlock
    };
    try {
        localStorage.setItem('hostelfix_user', JSON.stringify(window.currentUser));
    } catch (e) {}

    showToast(`Launching fresh dashboard for Warden ${cleanName} (${cleanId})...`, 'success');
    if (typeof navigateTo === 'function') navigateTo('warden-dashboard');
    if (typeof loadDashboardData === 'function') {
        loadDashboardData().then(() => {
            if (typeof renderWardenDashboard === 'function') renderWardenDashboard();
        });
    }
}

// ============================================================================
// 6. REAL-TIME SOCKET.IO SYNC & INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (window.socket) {
        window.socket.on('warden-created', () => {
            if (getActivePageId() === 'admin-wardens') renderAdminWardensPage();
            if (getActivePageId() === 'profile') renderAdminProfileWardens();
        });
        window.socket.on('warden-updated', () => {
            if (getActivePageId() === 'admin-wardens') renderAdminWardensPage();
            if (getActivePageId() === 'profile') renderAdminProfileWardens();
        });
        window.socket.on('warden-deleted', () => {
            if (getActivePageId() === 'admin-wardens') renderAdminWardensPage();
            if (getActivePageId() === 'profile') renderAdminProfileWardens();
        });
    }
});

// Export to window for inline HTML onclick handlers
window.renderAdminWardensPage = renderAdminWardensPage;
window.refreshAdminWardensPage = refreshAdminWardensPage;
window.renderAdminProfileWardens = renderAdminProfileWardens;
window.openAddWardenModal = openAddWardenModal;
window.openEditWardenModal = openEditWardenModal;
window.closeAdminWardenModal = closeAdminWardenModal;
window.handleAdminWardenSubmit = handleAdminWardenSubmit;
window.toggleWardenStatus = toggleWardenStatus;
window.deleteWardenWithConfirm = deleteWardenWithConfirm;
window.openWardenStudentsModal = openWardenStudentsModal;
window.closeWardenStudentsModal = closeWardenStudentsModal;
window.openWardenPermissionsModal = openWardenPermissionsModal;
window.closeWardenPermissionsModal = closeWardenPermissionsModal;
window.saveWardenQuickPermissions = saveWardenQuickPermissions;
window.selectAllWardenPermissions = selectAllWardenPermissions;
window.toggleAllQuickPermissions = toggleAllQuickPermissions;
window.filterWardensBySearch = filterWardensBySearch;
window.filterWardensByStatus = filterWardensByStatus;
window.filterWardensByBlock = filterWardensByBlock;
window.openWardenDigitalIdModal = openWardenDigitalIdModal;
window.closeWardenDigitalIdModal = closeWardenDigitalIdModal;
window.printWardenDigitalIdCard = printWardenDigitalIdCard;
window.copyWardenDigitalIdDetails = copyWardenDigitalIdDetails;
window.openWardenSuccessDigitalId = openWardenSuccessDigitalId;
window.openWardenDashboardPreview = openWardenDashboardPreview;


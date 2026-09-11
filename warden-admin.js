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
    if (!confirm(`Are you sure you want to delete Warden "${wardenName}"?\n\nThis will permanently remove their login credentials, scope, and RBAC permissions from the Supabase database.`)) {
        return;
    }

    showLoading();
    try {
        const res = await apiRequest(`/api/admin/wardens/${encodeURIComponent(wardenId)}`, {
            method: 'DELETE'
        });
        hideLoading();
        if (res.ok) {
            showToast(`Warden "${wardenName}" removed successfully from Supabase!`, 'success');
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
            showToast('Permissions saved successfully in Supabase!', 'success');
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

const SRI_SHAKTHI_BANNER_DATA_URL = "data:image/jpeg;base64,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";

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
                    <img src="${SRI_SHAKTHI_BANNER_DATA_URL}" alt="Sri Shakthi Institute of Engineering and Technology" class="print-banner-img">
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


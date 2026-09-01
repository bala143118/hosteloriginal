const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Add "My Wardens" container into Profile page
const profileEndMarker = `                            </div>
                        </div>

                    </div>`;

const myWardensBlock = `                            </div>
                        </div>

                    </div>

                    <!-- Admin "My Wardens" Section (Dynamically rendered for Admin) -->
                    <div id="adminProfileMyWardensWrapper" class="mt-8 hidden">
                        <div class="overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-md">
                            <div class="flex items-center justify-between mb-4 pb-3 border-b border-border">
                                <div>
                                    <h3 class="text-base font-bold text-text flex items-center gap-2">
                                        <i class="fa-solid fa-user-shield text-indigo-600"></i> My Wardens
                                    </h3>
                                    <p class="text-xs text-text-secondary">Hostel block wardens under your direct administrative oversight.</p>
                                </div>
                                <button onclick="navigateTo('admin-wardens')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 transition-all flex items-center gap-1.5 shadow-sm">
                                    <i class="fa-solid fa-gear text-[11px]"></i> Manage Wardens
                                </button>
                            </div>
                            <div id="adminProfileMyWardensContainer"></div>
                        </div>
                    </div>`;

if (!html.includes('adminProfileMyWardensWrapper')) {
    html = html.replace(profileEndMarker, myWardensBlock);
    console.log('Added adminProfileMyWardensWrapper to index.html');
}

// 2. Update page-admin-wardens
const adminWardensMarker = `<div class="flex-1 p-4 sm:p-6 lg:p-8">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                        <div>
                            <h1 class="text-2xl font-bold tracking-tight">Warden Management</h1>
                            <p class="text-text-secondary text-sm">View, add, and manage hostel block wardens and administrative oversight.</p>
                        </div>
                    </div>
                    <div id="adminWardensGrid" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div class="glass p-6 rounded-2xl text-center text-text-secondary">Loading wardens list...</div>
                    </div>
                </div>`;

const newAdminWardensSection = `<div class="flex-1 p-4 sm:p-6 lg:p-8">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 uppercase tracking-wider">Administration</span>
                            </div>
                            <h1 class="text-2xl font-bold tracking-tight mt-1">Warden Management</h1>
                            <p class="text-text-secondary text-sm">Control hostel block wardens, assign scopes, and manage granular RBAC permissions.</p>
                        </div>
                        <button onclick="openAddWardenModal()" type="button" class="btn-primary px-5 py-2.5 rounded-xl text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-primary/20 shrink-0 hover:scale-[1.02] transition-transform">
                            <i class="fa-solid fa-plus"></i> Add New Warden
                        </button>
                    </div>

                    <!-- Dynamic Warden Metrics Summary Bar -->
                    <div id="adminWardensStatsBar"></div>

                    <!-- Search & Filter Controls -->
                    <div class="glass rounded-2xl border border-border p-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
                        <div class="relative w-full sm:w-80">
                            <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-xs"></i>
                            <input type="text" oninput="filterWardensBySearch(this.value)" placeholder="Search by name, email, phone, block..." class="input-focus w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                        </div>
                        <div class="flex items-center gap-2.5 w-full sm:w-auto">
                            <select onchange="filterWardensByStatus(this.value)" class="input-focus px-3 py-2.5 rounded-xl border border-border bg-surface-alt text-xs font-semibold text-text-secondary">
                                <option value="all">All Status</option>
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                            <select onchange="filterWardensByBlock(this.value)" class="input-focus px-3 py-2.5 rounded-xl border border-border bg-surface-alt text-xs font-semibold text-text-secondary">
                                <option value="all">All Blocks</option>
                                <option value="Block A">Block A</option>
                                <option value="Block B">Block B</option>
                                <option value="Block C">Block C</option>
                                <option value="Block D">Block D</option>
                            </select>
                            <button onclick="renderAdminWardensPage()" title="Refresh Wardens" class="w-9 h-9 rounded-xl border border-border bg-surface-alt hover:bg-border text-text-secondary hover:text-text flex items-center justify-center text-xs transition-all shrink-0">
                                <i class="fa-solid fa-rotate"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Dynamic Wardens Grid -->
                    <div id="adminWardensGrid" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div class="glass p-6 rounded-2xl text-center text-text-secondary">Loading wardens list from Supabase...</div>
                    </div>
                </div>`;

if (html.includes(adminWardensMarker)) {
    html = html.replace(adminWardensMarker, newAdminWardensSection);
    console.log('Updated page-admin-wardens in index.html');
} else {
    // Fallback replace using regex
    const regex = /<div class="flex-1 p-4 sm:p-6 lg:p-8">[\s\S]*?<div id="adminWardensGrid"[\s\S]*?<\/div>\s*<\/div>/;
    html = html.replace(regex, newAdminWardensSection);
    console.log('Updated page-admin-wardens via regex in index.html');
}

// 3. Add Modals for Add/Edit Warden, Assigned Students, and Quick Permissions before </body>
const modalsHtml = `
    <!-- ===== DYNAMIC ADD / EDIT WARDEN MODAL ===== -->
    <div id="adminWardenModal" class="announcement-modal-overlay hidden" onclick="if(event.target === this) closeAdminWardenModal()">
        <div class="glass max-w-2xl w-full rounded-3xl border border-border overflow-hidden shadow-2xl animate-fade-in my-8 max-h-[90vh] flex flex-col bg-surface" onclick="event.stopPropagation()">
            <!-- Modal Header -->
            <div class="p-6 bg-gradient-to-r from-indigo-600 via-purple-600 to-primary text-white flex items-center justify-between shrink-0">
                <div>
                    <h3 id="adminWardenModalTitle" class="font-bold text-lg text-white">Add New Warden</h3>
                    <p class="text-xs text-white/80 mt-0.5">Configure warden credentials, control scope, and RBAC permissions in Supabase.</p>
                </div>
                <button type="button" onclick="closeAdminWardenModal()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xs transition-all">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Modal Body Form -->
            <form onsubmit="handleAdminWardenSubmit(event)" class="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
                <input type="hidden" id="adminWardenIdField">

                <!-- 1. General Profile -->
                <div>
                    <h4 class="font-bold uppercase tracking-wider text-text-secondary mb-3 flex items-center gap-1.5">
                        <i class="fa-solid fa-user-tag text-primary"></i> Basic Information
                    </h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                            <label class="block font-semibold text-text mb-1">Full Name <span class="text-danger">*</span></label>
                            <input id="wardenFormName" type="text" placeholder="e.g. Ravi Kumar" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs" required>
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Gmail / Email Address <span class="text-danger">*</span></label>
                            <input id="wardenFormEmail" type="email" placeholder="e.g. ravi@gmail.com" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs" required>
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Phone Number</label>
                            <input id="wardenFormPhone" type="tel" placeholder="e.g. +91 98765 43210" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Custom Employee/Warden ID (Optional)</label>
                            <input id="wardenFormCustomId" type="text" placeholder="e.g. WRD-101" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs font-mono">
                        </div>
                    </div>
                </div>

                <!-- 2. Authentication Password -->
                <div class="p-3.5 rounded-2xl bg-surface-alt border border-border/70">
                    <h4 class="font-bold uppercase tracking-wider text-text-secondary mb-2 flex items-center gap-1.5">
                        <i class="fa-solid fa-lock text-purple-600"></i> Account Password
                    </h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-text mb-1">Password</label>
                            <input id="wardenFormPassword" type="password" placeholder="Min. 6 characters" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface text-xs">
                            <p class="text-[10px] text-text-muted mt-1">Leave blank on edit to preserve current password.</p>
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Confirm Password</label>
                            <input id="wardenFormConfirmPassword" type="password" placeholder="Re-enter password" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface text-xs">
                        </div>
                    </div>
                </div>

                <!-- 3. Control Scope -->
                <div>
                    <h4 class="font-bold uppercase tracking-wider text-text-secondary mb-3 flex items-center gap-1.5">
                        <i class="fa-solid fa-compass text-indigo-600"></i> Assigned Hostel & Room Scope
                    </h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                            <label class="block font-semibold text-text mb-1">Hostel Residence</label>
                            <select id="wardenFormHostel" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                                <option value="Main Hostel">Main Hostel</option>
                                <option value="Boys Hostel">Boys Hostel</option>
                                <option value="Girls Hostel">Girls Hostel</option>
                                <option value="PG Hostel">PG Hostel</option>
                                <option value="All">All Hostels</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Hostel Block</label>
                            <select id="wardenFormBlock" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                                <option value="Block A">Block A</option>
                                <option value="Block B">Block B</option>
                                <option value="Block C">Block C</option>
                                <option value="Block D">Block D</option>
                                <option value="All">All Blocks</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Assigned Floors</label>
                            <input id="wardenFormFloors" type="text" placeholder="e.g. 1, 2 or 1-3 or All" value="All" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                            <p class="text-[10px] text-text-muted mt-0.5">Comma-separated or range (e.g. '1, 2' or 'All')</p>
                        </div>
                        <div>
                            <label class="block font-semibold text-text mb-1">Assigned Rooms</label>
                            <input id="wardenFormRooms" type="text" placeholder="e.g. 101-130 or All" value="All" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                            <p class="text-[10px] text-text-muted mt-0.5">Room range or list (e.g. '101-150' or 'All')</p>
                        </div>
                    </div>
                </div>

                <!-- 4. Status -->
                <div>
                    <label class="block font-semibold text-text mb-1">Warden Account Status</label>
                    <select id="wardenFormStatus" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                        <option value="Active">Active (Permitted to log in and manage hostel)</option>
                        <option value="Inactive">Inactive (Account temporarily disabled)</option>
                    </select>
                </div>

                <!-- 5. Granular RBAC Permissions -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h4 class="font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
                            <i class="fa-solid fa-shield-halved text-purple-600"></i> Role & Access Permissions (RBAC)
                        </h4>
                        <div class="flex items-center gap-2 text-[11px]">
                            <button type="button" onclick="selectAllWardenPermissions(true)" class="text-primary font-bold hover:underline">Select All</button>
                            <span>·</span>
                            <button type="button" onclick="selectAllWardenPermissions(false)" class="text-text-muted font-semibold hover:underline">Clear All</button>
                        </div>
                    </div>
                    <div id="wardenFormPermissionsContainer" class="space-y-3"></div>
                </div>

                <!-- Form Footer Actions -->
                <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
                    <button type="button" onclick="closeAdminWardenModal()" class="px-5 py-2.5 rounded-xl border border-border text-text-secondary hover:bg-surface-alt font-semibold">Cancel</button>
                    <button type="submit" class="btn-primary px-6 py-2.5 rounded-xl text-white font-semibold flex items-center gap-2 shadow-md shadow-primary/25">
                        <i class="fa-solid fa-floppy-disk"></i> Save Warden Profile
                    </button>
                </div>
            </form>
        </div>
    </div>

    <!-- ===== VIEW ASSIGNED STUDENTS MODAL ===== -->
    <div id="wardenStudentsModal" class="announcement-modal-overlay hidden" onclick="if(event.target === this) closeWardenStudentsModal()">
        <div class="glass max-w-3xl w-full rounded-3xl border border-border overflow-hidden shadow-2xl animate-fade-in my-8 max-h-[85vh] flex flex-col bg-surface" onclick="event.stopPropagation()">
            <div class="p-6 bg-gradient-to-r from-primary to-indigo-600 text-white flex items-center justify-between shrink-0">
                <div>
                    <h3 id="wardenStudentsModalTitle" class="font-bold text-lg text-white">Assigned Students</h3>
                    <p id="wardenStudentsModalSubtitle" class="text-xs text-white/80 mt-0.5">Students matching this warden's configured scope.</p>
                </div>
                <button type="button" onclick="closeWardenStudentsModal()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xs transition-all">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div id="wardenStudentsModalList" class="p-6 overflow-y-auto flex-1"></div>
            <div class="p-4 border-t border-border bg-surface-alt flex justify-end">
                <button type="button" onclick="closeWardenStudentsModal()" class="px-5 py-2 rounded-xl bg-surface border border-border font-semibold text-xs text-text hover:bg-border transition-all">
                    Close
                </button>
            </div>
        </div>
    </div>

    <!-- ===== QUICK PERMISSIONS TOGGLE MODAL ===== -->
    <div id="wardenPermissionsModal" class="announcement-modal-overlay hidden" onclick="if(event.target === this) closeWardenPermissionsModal()">
        <div class="glass max-w-lg w-full rounded-3xl border border-border overflow-hidden shadow-2xl animate-fade-in my-8 max-h-[85vh] flex flex-col bg-surface" onclick="event.stopPropagation()">
            <div class="p-6 bg-gradient-to-r from-purple-600 to-indigo-600 text-white flex items-center justify-between shrink-0">
                <div>
                    <h3 id="wardenPermissionsModalTitle" class="font-bold text-lg text-white">Warden Permissions</h3>
                    <p class="text-xs text-white/80 mt-0.5">Toggle granular RBAC permissions enforced by the backend.</p>
                </div>
                <button type="button" onclick="closeWardenPermissionsModal()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xs transition-all">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="p-6 overflow-y-auto flex-1 space-y-3">
                <div class="flex items-center justify-between pb-2 border-b border-border text-xs">
                    <span class="font-bold text-text-secondary">Granular Permissions</span>
                    <div class="flex items-center gap-2 text-[11px]">
                        <button type="button" onclick="toggleAllQuickPermissions(true)" class="text-primary font-bold hover:underline">Select All</button>
                        <span>·</span>
                        <button type="button" onclick="toggleAllQuickPermissions(false)" class="text-text-muted font-semibold hover:underline">Clear</button>
                    </div>
                </div>
                <div id="wardenQuickPermissionsList" class="space-y-2 max-h-[50vh] overflow-y-auto pr-1"></div>
            </div>
            <div class="p-4 border-t border-border bg-surface-alt flex items-center justify-end gap-3">
                <button type="button" onclick="closeWardenPermissionsModal()" class="px-4 py-2 rounded-xl border border-border font-semibold text-xs text-text-secondary hover:bg-surface transition-all">Cancel</button>
                <button type="button" onclick="saveWardenQuickPermissions()" class="btn-primary px-5 py-2 rounded-xl text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-primary/20">
                    <i class="fa-solid fa-floppy-disk"></i> Save Permissions
                </button>
            </div>
        </div>
    </div>
`;

if (!html.includes('id="adminWardenModal"')) {
    html = html.replace('</body>', `${modalsHtml}\n</body>`);
    console.log('Added Warden modals to index.html');
}

fs.writeFileSync('index.html', html, 'utf8');
console.log('Successfully updated index.html for Warden Management & Admin Profile!');

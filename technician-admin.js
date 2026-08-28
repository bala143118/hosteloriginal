(function () {
    'use strict';

    const apiBase = window.location.protocol === 'file:' ? 'http://localhost:5000' : '';

    function get(id) {
        return document.getElementById(id);
    }

    function notify(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            window.alert(message);
        }
    }

    function getAuthToken() {
        return window.currentUser?.token || localStorage.getItem('token') || '';
    }

    function getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = getAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    function escapeHtml(value = '') {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isValidEmail(email) {
        return typeof email === 'string' && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim());
    }

    // =========================================================================
    // 1. ADD TECHNICIAN MODAL
    // =========================================================================

    function openAddTechnicianModal() {
        const modal = get('addTechnicianModal');
        if (!modal) {
            notify('The Add Technician form is missing from this page.', 'error');
            return;
        }
        const form = get('addTechnicianForm') || modal.querySelector('form');
        if (form) form.reset();
        
        const errBox = get('addTechError');
        if (errBox) {
            errBox.textContent = '';
            errBox.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
        setTimeout(() => get('techName')?.focus(), 50);
    }

    function closeAddTechnicianModal() {
        const modal = get('addTechnicianModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.style.display = 'none';
        modal.style.visibility = 'hidden';
        modal.style.pointerEvents = 'none';
    }

    async function handleAddTechnician(event) {
        if (event) event.preventDefault();
        
        const errBox = get('addTechError');
        const showError = (msg) => {
            if (errBox) {
                errBox.textContent = msg;
                errBox.classList.remove('hidden');
            }
            notify(msg, 'warning');
        };

        if (errBox) errBox.classList.add('hidden');

        const name = get('techName')?.value.trim();
        const email = get('techEmail')?.value.trim();
        const phone = get('techPhone')?.value.trim();
        const technicianId = get('techEmployeeId')?.value.trim();
        const specialization = get('techSpecialization')?.value;
        const department = get('techDepartment')?.value;
        const password = get('techPassword')?.value || '';
        const confirmPassword = get('techConfirmPassword')?.value || '';
        const status = get('techStatus')?.value || 'Active';

        if (!name) return showError('Please enter the technician full name.');
        if (!email || !isValidEmail(email)) return showError('Please enter a valid email address.');
        if (!phone) return showError('Please enter the contact phone number.');
        if (!password || password.length < 6) return showError('Password must be at least 6 characters long.');
        if (password !== confirmPassword) return showError('Password and Confirm Password do not match.');

        const submitBtn = get('submitAddTechBtn') || (event?.target ? event.target.querySelector('button[type="submit"]') : null);
        const originalHtml = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
        }

        try {
            const payload = {
                name,
                email,
                phone,
                technicianId: technicianId || undefined,
                specialization,
                department,
                password,
                confirmPassword,
                status
            };

            const response = await fetch(`${apiBase}/api/technicians`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Unable to create technician account (${response.status}).`);
            }

            closeAddTechnicianModal();
            notify(`Technician ${result.name || name} (ID: ${result.userId || result.id || 'N/A'}) created successfully!`, 'success');
            
            await loadTechniciansList();
            if (typeof window.loadDashboardData === 'function') {
                window.loadDashboardData().catch(() => {});
            }
        } catch (error) {
            showError(error.message || 'Error creating technician account.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalHtml || '<i class="fa-solid fa-plus"></i> Create Technician Account';
            }
        }
    }

    // =========================================================================
    // 2. EDIT TECHNICIAN MODAL
    // =========================================================================

    function openEditTechnicianModal(id) {
        const tech = findTechnicianById(id);
        if (!tech) {
            notify('Technician details are unavailable. Please refresh and try again.', 'error');
            return;
        }

        const modal = get('editTechnicianModal');
        if (!modal) return;

        const errBox = get('editTechError');
        if (errBox) {
            errBox.textContent = '';
            errBox.classList.add('hidden');
        }

        if (get('editTechId')) get('editTechId').value = tech.id || tech.userId || tech.email;
        if (get('editTechName')) get('editTechName').value = tech.name || '';
        if (get('editTechEmail')) get('editTechEmail').value = tech.email || '';
        if (get('editTechPhone')) get('editTechPhone').value = tech.phone || '';
        if (get('editTechSpecialization')) get('editTechSpecialization').value = tech.specialization || 'General Maintenance';
        if (get('editTechDepartment')) get('editTechDepartment').value = tech.department || 'Maintenance Department';
        if (get('editTechStatus')) get('editTechStatus').value = tech.status || 'Active';
        if (get('editTechPassword')) get('editTechPassword').value = '';

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
        setTimeout(() => get('editTechName')?.focus(), 50);
    }

    function closeEditTechnicianModal() {
        const modal = get('editTechnicianModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.style.display = 'none';
        modal.style.visibility = 'hidden';
        modal.style.pointerEvents = 'none';
    }

    async function handleEditTechnician(event) {
        if (event) event.preventDefault();

        const errBox = get('editTechError');
        const showError = (msg) => {
            if (errBox) {
                errBox.textContent = msg;
                errBox.classList.remove('hidden');
            }
            notify(msg, 'warning');
        };

        if (errBox) errBox.classList.add('hidden');

        const id = get('editTechId')?.value;
        const name = get('editTechName')?.value.trim();
        const email = get('editTechEmail')?.value.trim();
        const phone = get('editTechPhone')?.value.trim();
        const specialization = get('editTechSpecialization')?.value;
        const department = get('editTechDepartment')?.value;
        const status = get('editTechStatus')?.value || 'Active';
        const password = get('editTechPassword')?.value || '';

        if (!id) return showError('Technician identifier is missing.');
        if (!name) return showError('Please enter the technician full name.');
        if (!email || !isValidEmail(email)) return showError('Please enter a valid email address.');
        if (password && password.length < 6) return showError('New password must be at least 6 characters.');

        const submitBtn = get('submitEditTechBtn') || (event?.target ? event.target.querySelector('button[type="submit"]') : null);
        const originalHtml = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        }

        try {
            const payload = {
                name,
                email,
                phone,
                specialization,
                department,
                status
            };
            if (password) payload.password = password;

            const response = await fetch(`${apiBase}/api/technicians/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Failed to update technician (${response.status}).`);
            }

            closeEditTechnicianModal();
            notify(`Technician ${result.name || name} updated successfully!`, 'success');
            
            await loadTechniciansList();
            if (typeof window.loadDashboardData === 'function') {
                window.loadDashboardData().catch(() => {});
            }
        } catch (error) {
            showError(error.message || 'Error updating technician.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalHtml || '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
            }
        }
    }

    // =========================================================================
    // 3. VIEW TECHNICIAN DETAILS MODAL
    // =========================================================================

    function openViewTechnicianModal(id) {
        const tech = findTechnicianById(id);
        if (!tech) {
            notify('Technician details are unavailable.', 'error');
            return;
        }

        const modal = get('viewTechnicianModal');
        if (!modal) return;

        const initials = (tech.name || 'TC').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        if (get('viewTechAvatar')) get('viewTechAvatar').textContent = initials;
        if (get('viewTechName')) get('viewTechName').textContent = tech.name || 'Technician';
        if (get('viewTechIdBadge')) get('viewTechIdBadge').textContent = tech.userId || tech.id || 'N/A';
        
        const statusBadge = get('viewTechStatusBadge');
        if (statusBadge) {
            const isActive = String(tech.status || 'Active').toLowerCase() === 'active';
            statusBadge.textContent = tech.status || 'Active';
            statusBadge.className = isActive
                ? 'text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald/10 text-emerald border border-emerald/30'
                : 'text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 border border-slate-500/30';
        }

        if (get('viewTechSpecialization')) get('viewTechSpecialization').textContent = tech.specialization || 'General Maintenance';
        if (get('viewTechDepartment')) get('viewTechDepartment').textContent = tech.department || 'Maintenance Department';
        if (get('viewTechEmail')) get('viewTechEmail').textContent = tech.email || 'N/A';
        if (get('viewTechPhone')) get('viewTechPhone').textContent = tech.phone || 'N/A';
        
        const createdDate = tech.createdAt ? new Date(tech.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Registered Staff';
        if (get('viewTechCreatedDate')) get('viewTechCreatedDate').textContent = createdDate;

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
    }

    function closeViewTechnicianModal() {
        const modal = get('viewTechnicianModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.style.display = 'none';
        modal.style.visibility = 'hidden';
        modal.style.pointerEvents = 'none';
    }

    // =========================================================================
    // 4. ACTIVATE / DEACTIVATE & DELETE ACTIONS
    // =========================================================================

    async function toggleTechnicianStatus(id, currentStatus) {
        const targetStatus = String(currentStatus || '').toLowerCase() === 'active' ? 'Inactive' : 'Active';
        const actionLabel = targetStatus === 'Active' ? 'Activate' : 'Deactivate';
        
        if (!confirm(`Are you sure you want to ${actionLabel.toLowerCase()} this technician account?`)) return;

        try {
            const response = await fetch(`${apiBase}/api/technicians/${encodeURIComponent(id)}/status`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({ status: targetStatus })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Unable to ${actionLabel.toLowerCase()} technician (${response.status}).`);
            }

            notify(`Technician status updated to ${targetStatus}.`, 'success');
            await loadTechniciansList();
        } catch (error) {
            notify(error.message || `Failed to update technician status.`, 'error');
        }
    }

    async function deleteTechnician(id) {
        const tech = findTechnicianById(id);
        const techName = tech ? tech.name : 'this technician';

        if (!confirm(`Are you sure you want to permanently remove ${techName}? This will unassign any pending work orders.`)) {
            return;
        }

        try {
            const response = await fetch(`${apiBase}/api/technicians/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Failed to delete technician (${response.status}).`);
            }

            notify(`Technician ${techName} removed successfully.`, 'success');
            await loadTechniciansList();
            if (typeof window.loadDashboardData === 'function') {
                window.loadDashboardData().catch(() => {});
            }
        } catch (error) {
            notify(error.message || 'Error deleting technician account.', 'error');
        }
    }

    // =========================================================================
    // 5. DATA LOADING & DYNAMIC RENDERING
    // =========================================================================

    function findTechnicianById(id) {
        const target = String(id || '').trim().toLowerCase();
        return (window.currentTechniciansList || []).find(t => 
            String(t.id || '').toLowerCase() === target ||
            String(t.userId || '').toLowerCase() === target ||
            String(t.email || '').toLowerCase() === target
        );
    }

    async function loadTechniciansList() {
        const container = get('adminTechniciansGrid');
        if (!container) return;

        try {
            const [techRes, compRes] = await Promise.all([
                fetch(`${apiBase}/api/technicians`, { headers: getAuthHeaders() }),
                fetch(`${apiBase}/api/complaints`, { headers: getAuthHeaders() })
            ]);

            if (!techRes.ok) throw new Error(`HTTP ${techRes.status}: Unable to load technicians.`);
            const technicians = await techRes.json();
            const complaints = compRes.ok ? await compRes.json() : [];

            const techArray = Array.isArray(technicians) ? technicians : [];
            window.currentTechniciansList = techArray;

            renderAdminTechnicians(techArray, complaints);

            const activeCount = techArray.filter(t => String(t.status || 'Active').toLowerCase() === 'active').length;
            const countEl = get('adminActiveTechnicians');
            if (countEl) countEl.textContent = String(activeCount);
        } catch (error) {
            console.error('Error loading technicians:', error);
            if (container) {
                container.innerHTML = `<div class="col-span-3 glass p-6 rounded-2xl text-center text-danger font-medium">Unable to load technicians list from database. Please check connection.</div>`;
            }
        }
    }

    function renderAdminTechnicians(technicians = [], complaints = []) {
        const container = get('adminTechniciansGrid');
        if (!container) return;

        window.currentTechniciansList = technicians;

        if (!technicians.length) {
            container.innerHTML = `
                <div class="col-span-3 glass p-10 rounded-3xl border border-dashed border-border text-center text-text-secondary">
                    <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-info/10 text-info flex items-center justify-center text-2xl">
                        <i class="fa-solid fa-screwdriver-wrench"></i>
                    </div>
                    <h3 class="font-bold text-base text-text mb-1">No Technicians Registered</h3>
                    <p class="text-xs text-text-secondary mb-4">Add maintenance staff to handle student complaints and repairs.</p>
                    <button onclick="openAddTechnicianModal()" class="btn-primary px-5 py-2 rounded-xl text-white text-xs font-semibold inline-flex items-center gap-2">
                        <i class="fa-solid fa-plus"></i> Add New Technician
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = technicians.map(t => {
            const id = t.id || t.userId || t.email;
            const initials = (t.name || 'TC').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            const done = (complaints || []).filter(c => (c.technician === t.name || c.assignedTo === t.name) && String(c.status).toLowerCase() === 'completed').length;
            const activeTasks = (complaints || []).filter(c => (c.technician === t.name || c.assignedTo === t.name) && String(c.status).toLowerCase() !== 'completed').length;
            const isActive = String(t.status || 'Active').toLowerCase() === 'active';
            const createdDate = t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Active';

            return `
                <div class="glass rounded-3xl border border-border p-5 card-hover relative group shadow-xs transition-all duration-200">
                    <div class="flex items-start justify-between mb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-info to-primary flex items-center justify-center text-white font-bold text-sm shadow-md">${escapeHtml(initials)}</div>
                            <div>
                                <h4 class="font-bold text-sm text-text leading-tight">${escapeHtml(t.name || 'Technician')}</h4>
                                <p class="text-xs text-primary font-medium mt-0.5">${escapeHtml(t.specialization || 'General Maintenance')}</p>
                                <span class="text-[10px] text-text-muted font-mono">${escapeHtml(t.userId || t.id || '')}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-1">
                            <button type="button" onclick="openViewTechnicianModal('${escapeHtml(id)}')" title="View Details" class="w-7 h-7 rounded-lg bg-surface-alt hover:bg-primary/10 text-text-secondary hover:text-primary flex items-center justify-center text-xs transition-all border border-border">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                            <button type="button" onclick="openEditTechnicianModal('${escapeHtml(id)}')" title="Edit Technician" class="w-7 h-7 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white flex items-center justify-center text-xs transition-all">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button type="button" onclick="toggleTechnicianStatus('${escapeHtml(id)}', '${escapeHtml(t.status || 'Active')}')" title="${isActive ? 'Deactivate' : 'Activate'}" class="w-7 h-7 rounded-lg ${isActive ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500 hover:text-white' : 'bg-emerald/10 text-emerald hover:bg-emerald hover:text-white'} flex items-center justify-center text-xs transition-all">
                                <i class="fa-solid ${isActive ? 'fa-user-slash' : 'fa-user-check'}"></i>
                            </button>
                            <button type="button" onclick="deleteTechnician('${escapeHtml(id)}')" title="Remove Technician" class="w-7 h-7 rounded-lg bg-danger/10 hover:bg-danger text-danger hover:text-white flex items-center justify-center text-xs transition-all">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-center mb-3.5">
                        <div class="bg-surface-alt rounded-xl p-2 border border-border/60">
                            <p class="font-bold text-sm text-text">${done}</p>
                            <p class="text-[10px] text-text-secondary uppercase">Resolved</p>
                        </div>
                        <div class="bg-surface-alt rounded-xl p-2 border border-border/60">
                            <p class="font-bold text-sm text-primary">${activeTasks}</p>
                            <p class="text-[10px] text-text-secondary uppercase">Active</p>
                        </div>
                        <div class="bg-surface-alt rounded-xl p-2 border border-border/60">
                            <p class="font-bold text-sm text-amber-500">4.9 ★</p>
                            <p class="text-[10px] text-text-secondary uppercase">Rating</p>
                        </div>
                    </div>
                    <div class="flex items-center justify-between text-xs pt-2 border-t border-border/60">
                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? 'bg-emerald/10 text-emerald border border-emerald/30' : 'bg-slate-500/10 text-slate-500 border border-slate-500/30'}">
                            <i class="fa-solid ${isActive ? 'fa-circle-check' : 'fa-circle-xmark'} text-[10px] mr-1"></i>${escapeHtml(t.status || 'Active')}
                        </span>
                        <span class="text-[11px] text-text-muted font-mono"><i class="fa-solid fa-phone text-[10px] mr-1"></i>${escapeHtml(t.phone || t.email || 'N/A')}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =========================================================================
    // 6. EXPORTS & GLOBAL EVENT BINDINGS
    // =========================================================================

    window.openAddTechnicianModal = openAddTechnicianModal;
    window.closeAddTechnicianModal = closeAddTechnicianModal;
    window.handleAddTechnician = handleAddTechnician;

    window.openEditTechnicianModal = openEditTechnicianModal;
    window.closeEditTechnicianModal = closeEditTechnicianModal;
    window.handleEditTechnician = handleEditTechnician;

    window.openViewTechnicianModal = openViewTechnicianModal;
    window.closeViewTechnicianModal = closeViewTechnicianModal;

    window.toggleTechnicianStatus = toggleTechnicianStatus;
    window.deleteTechnician = deleteTechnician;

    window.loadTechniciansList = loadTechniciansList;
    window.renderAdminTechnicians = renderAdminTechnicians;

    document.addEventListener('DOMContentLoaded', () => {
        const addBtn = get('addTechnicianButton') || document.querySelector('button[onclick*="openAddTechnicianModal"]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openAddTechnicianModal();
            });
        }
    });

})();

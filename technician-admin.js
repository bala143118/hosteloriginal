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

    function generateTechId() {
        const idInput = get('techEmployeeId');
        const randomNum = Math.floor(100000 + Math.random() * 900000);
        const newId = `TCH-${randomNum}`;
        if (idInput) idInput.value = newId;
        return newId;
    }

    // --- Technician Photo Preview Handlers ---
    function handleTechPhotoFileSelect(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            notify('Please select a valid image file (PNG, JPG, WEBP).', 'warning');
            event.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const photoInput = get('techFormPhoto');
            if (photoInput) photoInput.value = e.target.result;
            updateTechFormPhotoPreview(e.target.result);
            notify('Photo loaded successfully from file.', 'info');
        };
        reader.onerror = () => notify('Failed to read image file.', 'warning');
        reader.readAsDataURL(file);
    }

    function handleTechPhotoUrlInput(url) {
        const photoInput = get('techFormPhoto');
        const cleanUrl = (url || '').trim();
        if (photoInput) photoInput.value = cleanUrl;
        updateTechFormPhotoPreview(cleanUrl);
    }

    function clearTechFormPhoto() {
        const photoInput = get('techFormPhoto');
        const fileInput = get('techFormPhotoFile');
        const urlInput = get('techPhotoUrl');
        if (photoInput) photoInput.value = '';
        if (fileInput) fileInput.value = '';
        if (urlInput) urlInput.value = '';
        updateTechFormPhotoPreview('');
    }

    function updateTechFormPhotoPreview(photoUrl) {
        const previewImg = get('techFormPhotoPreviewImg');
        const previewInit = get('techFormPhotoPreviewInitial');
        const clearBtn = get('techFormPhotoClearBtn');
        const nameInput = get('techName');
        const initial = ((nameInput && nameInput.value.trim()) || 'T').charAt(0).toUpperCase();

        const cleanUrl = (photoUrl || '').trim();

        if (cleanUrl) {
            if (previewImg) {
                previewImg.onload = () => {
                    previewImg.classList.remove('hidden');
                    if (previewInit) previewInit.classList.add('hidden');
                    if (clearBtn) clearBtn.classList.remove('hidden');
                };
                previewImg.onerror = async () => {
                    if (!cleanUrl.startsWith('data:') && !previewImg.dataset.resolving) {
                        previewImg.dataset.resolving = "true";
                        try {
                            const res = await fetch(`/api/resolve-image?url=${encodeURIComponent(cleanUrl)}`);
                            if (res.ok) {
                                const data = await res.json();
                                if (data.success && data.imageUrl) {
                                    previewImg.onerror = null;
                                    delete previewImg.dataset.resolving;
                                    previewImg.src = data.imageUrl;
                                    previewImg.classList.remove('hidden');
                                    if (previewInit) previewInit.classList.add('hidden');
                                    if (clearBtn) clearBtn.classList.remove('hidden');
                                    const photoInput = get('techFormPhoto');
                                    if (photoInput) photoInput.value = data.imageUrl;
                                    return;
                                }
                            }
                        } catch (e) {
                            console.warn('Image resolution error:', e);
                        }
                    }
                    delete previewImg.dataset.resolving;
                    previewImg.classList.add('hidden');
                    if (previewInit) {
                        previewInit.textContent = initial;
                        previewInit.classList.remove('hidden');
                    }
                };
                delete previewImg.dataset.resolving;
                previewImg.src = cleanUrl;
            }
            if (clearBtn) clearBtn.classList.remove('hidden');
        } else {
            if (previewImg) {
                delete previewImg.dataset.resolving;
                previewImg.src = '';
                previewImg.classList.add('hidden');
            }
            if (previewInit) {
                previewInit.textContent = initial;
                previewInit.classList.remove('hidden');
            }
            if (clearBtn) clearBtn.classList.add('hidden');
        }
    }

    function prepareTechnicianModal(modal) {
        if (!modal) return;
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }
        modal.classList.remove('hidden');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('visibility', 'visible', 'important');
        modal.style.setProperty('opacity', '1', 'important');
        modal.style.setProperty('pointer-events', 'auto', 'important');
        modal.style.setProperty('z-index', '999999', 'important');
    }

    function openAddTechnicianModal() {
        const modal = get('addTechnicianModal');
        if (!modal) return;
        prepareTechnicianModal(modal);
        const form = modal.querySelector('form');
        if (form) form.reset();
        generateTechId();
        
        const errBox = get('addTechError');
        if (errBox) {
            errBox.textContent = '';
            errBox.classList.add('hidden');
        }
        setTimeout(() => get('techName')?.focus(), 50);
    }

    function closeAddTechnicianModal() {
        const modal = get('addTechnicianModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.style.setProperty('display', 'none', 'important');
        modal.style.setProperty('visibility', 'hidden', 'important');
        modal.style.setProperty('opacity', '0', 'important');
        modal.style.setProperty('pointer-events', 'none', 'important');
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
        const technicianId = get('techEmployeeId')?.value.trim() || generateTechId();
        const specialization = get('techSpecialization')?.value;
        const department = get('techDepartment')?.value;
        const hostelBlock = get('techHostelBlock')?.value;
        const shift = get('techShift')?.value;
        const gender = get('techGender')?.value;
        const emergencyContact = get('techEmergencyContact')?.value.trim();
        const password = 'tech123';

        if (!name) return showError('Please enter the technician full name.');
        if (!email || !isValidEmail(email)) return showError('Please enter a valid email address.');
        if (!phone) return showError('Please enter the contact phone number.');

        const submitBtn = get('submitAddTechBtn') || (event?.target ? event.target.querySelector('button[type="submit"]') : null);
        const originalHtml = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
        }

        const photoUrl = get('techFormPhoto')?.value || get('techPhotoUrl')?.value || '';
        const address = get('techAddress')?.value.trim() || '';

        try {
            const payload = {
                name,
                email,
                phone,
                technicianId,
                specialization,
                department,
                hostelBlock,
                shift,
                gender,
                emergencyContact,
                photoUrl,
                profilePhoto: photoUrl,
                address,
                password,
                status: 'Active'
            };

            const response = await (typeof window.apiRequest === 'function' 
                ? window.apiRequest('/api/technicians', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }) 
                : fetch('/api/technicians', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payload)
                }));

            const result = typeof window.parseJsonResponse === 'function' 
                ? await window.parseJsonResponse(response) 
                : await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `Unable to create technician account (${response.status}).`);
            }

            const loginId = result.userId || result.technicianId || technicianId || email;
            const tempPwd = result.temporaryPassword || password || 'tech123';

            closeAddTechnicianModal();
            notify(`Technician ${result.name || name} created! Login ID: ${loginId} | Password: ${tempPwd}`, 'success');
            if (typeof window.alert === 'function') {
                window.alert(`✅ Technician Account Created Successfully!\n\nTechnician Name: ${result.name || name}\nLogin ID: ${loginId}\nEmail: ${email}\nTemporary Password: ${tempPwd}\n\nNote: The technician must set a permanent password upon first login.`);
            }

            setTimeout(() => {
                openTechnicianDigitalIdModal(loginId);
            }, 200);
            
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

            const technicians = techRes.ok ? await techRes.json() : [];
            const complaints = compRes.ok ? await compRes.json() : [];

            const techArray = Array.isArray(technicians) ? technicians : [];
            window.currentTechniciansList = techArray;

            renderAdminTechnicians(techArray, complaints);

            const activeCount = techArray.filter(t => String(t.status || 'Active').toLowerCase() === 'active').length;
            const countEl = get('adminActiveTechnicians');
            if (countEl) countEl.textContent = String(activeCount);
        } catch (error) {
            console.error('Error loading technicians:', error);
            renderAdminTechnicians([], []);
        }
    }

    function renderAdminTechnicians(technicians = [], complaints = []) {
        const container = get('adminTechniciansGrid');
        if (!container) return;

        window.currentTechniciansList = technicians;

        // Update Top Summary Stats Bar
        const totalCount = technicians.length;
        const activeCount = technicians.filter(t => String(t.status || 'Active').toLowerCase() === 'active').length;
        const inactiveCount = totalCount - activeCount;
        const specsSet = new Set(technicians.map(t => t.specialization || 'General Maintenance'));
        const resolvedCount = (complaints || []).filter(c => String(c.status).toLowerCase() === 'completed').length;
        const activeTasksCount = (complaints || []).filter(c => String(c.status).toLowerCase() !== 'completed').length;

        const statTotal = get('statTotalTechs');
        const statActive = get('statActiveTechs');
        const statInactive = get('statInactiveTechs');
        const statSpecs = get('statSpecializations');
        const statTasks = get('statActiveTasks');
        const statResolved = get('statResolvedTickets');

        if (statTotal) statTotal.textContent = String(totalCount);
        if (statActive) statActive.textContent = String(activeCount);
        if (statInactive) statInactive.textContent = String(inactiveCount);
        if (statSpecs) statSpecs.textContent = String(Math.max(specsSet.size, 1));
        if (statTasks) statTasks.textContent = String(activeTasksCount);
        if (statResolved) statResolved.textContent = String(resolvedCount);

        let newHtml = '';
        if (!technicians.length) {
            newHtml = `
                <div class="col-span-3 glass p-10 rounded-3xl border border-border text-center flex flex-col items-center justify-center my-6 mx-auto w-full max-w-xl shadow-xs">
                    <div class="w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-3xl mb-4">
                        <i class="fa-solid fa-user-gear"></i>
                    </div>
                    <h3 class="font-bold text-lg text-text mb-1">No Technicians Added</h3>
                    <p class="text-xs text-text-secondary max-w-md mb-6 leading-relaxed">Create your first technician account to start managing hostel maintenance operations.</p>
                    <button type="button" onclick="openAddTechnicianModal()" class="btn-primary px-6 py-3 rounded-2xl text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-primary/20 hover:scale-[1.02] transition-transform cursor-pointer">
                        <i class="fa-solid fa-plus"></i> Add New Technician
                    </button>
                </div>
            `;
        } else {
            newHtml = technicians.map(t => {
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
                                <button type="button" onclick="openTechnicianDigitalIdModal('${escapeHtml(id)}')" title="View Digital ID Card" class="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 hover:bg-blue-600 hover:text-white font-bold flex items-center gap-1 transition-all border border-blue-500/20 shadow-xs text-[11px]">
                                    <i class="fa-solid fa-id-card"></i> Digital ID
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

        if (container.innerHTML !== newHtml) {
            container.innerHTML = newHtml;
        }
    }

    // =========================================================================
    // DIGITAL ID CARD FUNCTIONS FOR TECHNICIAN
    // =========================================================================

    let currentDigitalIdTechData = null;

    async function openTechnicianDigitalIdModal(techId) {
        const modal = get('technicianDigitalIdModal');
        if (!modal) return;

        prepareTechnicianModal(modal);

        let tech = (window.currentTechniciansList || []).find(t => (t.id === techId || t.userId === techId || t.technicianId === techId || t.email === techId));
        if (!tech) {
            try {
                const res = await fetch(`/api/technicians/${encodeURIComponent(techId)}`, { headers: getAuthHeaders() });
                if (res.ok) tech = await res.json();
            } catch (e) {}
        }

        if (!tech) {
            tech = {
                name: 'Technician Staff',
                userId: techId,
                technicianId: techId,
                email: `${String(techId).toLowerCase()}@hostelfix.edu`,
                specialization: 'General Maintenance',
                department: 'Maintenance Department',
                hostelBlock: 'All Blocks',
                shift: 'General Shift',
                status: 'Active'
            };
        }

        currentDigitalIdTechData = tech;

        const name = tech.name || 'Technician';
        const cleanId = tech.userId || tech.technicianId || tech.id || techId;
        const email = tech.email || '—';
        const phone = tech.phone || '—';
        const spec = tech.specialization || 'General Maintenance';
        const dept = tech.department || 'Maintenance Department';
        const block = tech.hostelBlock || tech.block || 'All Hostel Blocks';
        const shift = tech.shift || 'General Shift';
        const status = tech.status || 'Active';
        const isActive = String(status).toLowerCase() === 'active';

        const certId = `HF-TCH-CERT-${cleanId}`;
        const fingerprint = `HF-AUTH-${String(cleanId).toUpperCase()}-2026`;

        const imgEl = get('techIdCardPhoto');
        const avatarWrap = get('techIdCardAvatarInitial');
        if (imgEl && avatarWrap) {
            avatarWrap.textContent = name.charAt(0).toUpperCase();
            if (tech.photoUrl || tech.profilePhoto) {
                imgEl.src = tech.photoUrl || tech.profilePhoto;
                imgEl.classList.remove('hidden');
                avatarWrap.classList.add('hidden');
            } else {
                imgEl.classList.add('hidden');
                avatarWrap.classList.remove('hidden');
            }
        }

        if (get('techIdCardName')) get('techIdCardName').textContent = name;
        if (get('techIdCardSpecialization')) get('techIdCardSpecialization').textContent = spec;
        if (get('techIdCardId')) get('techIdCardId').textContent = cleanId;
        if (get('techIdCardDepartment')) get('techIdCardDepartment').textContent = dept;
        if (get('techIdCardShift')) get('techIdCardShift').textContent = shift;
        if (get('techIdCardEmail')) get('techIdCardEmail').textContent = email;
        if (get('techIdCardPhone')) get('techIdCardPhone').textContent = phone;
        if (get('techIdCardBlock')) get('techIdCardBlock').textContent = block;
        if (get('techIdCardStatusText')) get('techIdCardStatusText').textContent = isActive ? 'VERIFIED ACTIVE MAINTENANCE STAFF' : 'INACTIVE STAFF';
        if (get('techIdCardCertId')) get('techIdCardCertId').textContent = certId;
        if (get('techIdCardSignatureFingerprint')) get('techIdCardSignatureFingerprint').textContent = fingerprint;

        if (get('techIdCardQrImage')) {
            const qrData = encodeURIComponent(`https://hostelfix.edu/verify-tech?id=${cleanId}&cert=${certId}`);
            get('techIdCardQrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}`;
        }
    }

    function closeTechnicianDigitalIdModal() {
        const modal = get('technicianDigitalIdModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.setProperty('display', 'none', 'important');
        }
    }

    const SRI_SHAKTHI_BANNER_DATA_URL = (typeof window.SRI_SHAKTHI_BANNER_DATA_URL !== 'undefined') ? window.SRI_SHAKTHI_BANNER_DATA_URL : "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCABjAuIDASIAAhEBAxEB/8QAHQAAAgIDAQEBAAAAAAAAAAAAAAgHCQQFBgIDAf/EAGkQAAAEBQEEBAUKDBIHBgUFAAIDBAUAAQYHEhMIERQiISMyQhUxM1JyCRY3QUNRU2FighckcXN2g5GSorO00hg0OERXY3R1gZOVlqGjssLD0xlUVpTBxPAlNTZGZLEmJ0VVhIbR4eLx/xAHAEBAAIDAQEBAAAAAAAAAAAAAAECAwQFBgcICQoLAQABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAAtEQACAQMDAgUEAwEBA~~~~~~~~QIRAgMEESExQVEFEiJhcYETQpEyoSOxwf/aAAw0ax44rE7B2J4N8Hj9yM4";

    function printTechnicianDigitalIdCard() {
        const printArea = get('technicianDigitalIdCardContent');
        if (!printArea) return window.print();

        const cardHtml = printArea.outerHTML;
        const printWindow = window.open('', '_blank', 'width=850,height=900');
        if (!printWindow) return window.print();

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Sri Shakthi Institute of Engineering & Technology - Technician Official Smart Credential</title>
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
                        #technicianDigitalIdCardContent {
                            box-shadow: none !important;
                            page-break-inside: avoid;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="no-print" style="margin-bottom: 16px; display: flex; gap: 10px; align-items: center;">
                    <button onclick="window.print()" style="background: #2563eb; color: white; border: none; padding: 8px 18px; border-radius: 10px; font-weight: bold; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
                        <i class="fa-solid fa-print"></i> Print ID Card / Save as PDF
                    </button>
                    <button onclick="window.close()" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer;">
                        Close
                    </button>
                </div>
                <div class="print-card-wrapper">
                    <!-- Sri Shakthi Institution Header Banner (Added on Print / Download) -->
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

    function copyTechnicianDigitalIdDetails() {
        if (!currentDigitalIdTechData) return;
        const t = currentDigitalIdTechData;
        const text = `HostelFix Official Technician Digital Identity:
• Name: ${t.name}
• Technician ID: ${t.userId || t.technicianId || t.id}
• Specialization: ${t.specialization || 'General Maintenance'}
• Department: ${t.department || 'Maintenance Department'}
• Assigned Scope: ${t.hostelBlock || 'All Blocks'} (${t.shift || 'General Shift'})
• Status: ${t.status || 'Active'}
• Email: ${t.email}
• Mobile: ${t.phone || 'N/A'}`;

        navigator.clipboard.writeText(text).then(() => {
            notify('Technician Digital ID details copied!', 'success');
        }).catch(() => {
            notify('Details copied!', 'info');
        });
    }

    function openTechnicianDashboardPreview(techId, techEmail, techName, specialization, department) {
        closeTechnicianDigitalIdModal();
        closeAddTechnicianModal();

        let tech = (window.currentTechniciansList || []).find(t => (t.id === techId || t.userId === techId || t.technicianId === techId || t.email === techId));
        if (!tech && currentDigitalIdTechData) tech = currentDigitalIdTechData;

        const cleanId = techId || tech?.userId || tech?.technicianId || tech?.id || 'TCH-NEW';
        const cleanEmail = techEmail || tech?.email || `${cleanId.toLowerCase()}@hostelfix.edu`;
        const cleanName = techName || tech?.name || 'Technician Staff';
        const cleanSpec = specialization || tech?.specialization || 'General Maintenance';
        const cleanDept = department || tech?.department || 'Maintenance Department';

        if (window.currentUser && window.currentUser.role === 'admin') {
            window.adminReturnUser = { ...window.currentUser };
        }

        window.currentUser = {
            id: cleanId,
            userId: cleanId,
            technicianId: cleanId,
            email: cleanEmail,
            name: cleanName,
            role: 'technician',
            specialization: cleanSpec,
            department: cleanDept
        };

        try {
            localStorage.setItem('hostelfix_user', JSON.stringify(window.currentUser));
        } catch (e) {}

        notify(`Launching fresh dashboard for Technician ${cleanName} (${cleanId})...`, 'success');
        if (typeof navigateTo === 'function') navigateTo('technician-dashboard');
        if (typeof loadDashboardData === 'function') {
            loadDashboardData().then(() => {
                if (typeof renderTechnicianDashboard === 'function') renderTechnicianDashboard();
            });
        }
    }

    // =========================================================================
    // 6. EXPORTS & GLOBAL EVENT BINDINGS
    // =========================================================================

    window.openAddTechnicianModal = openAddTechnicianModal;
    window.closeAddTechnicianModal = closeAddTechnicianModal;
    window.handleAddTechnician = handleAddTechnician;
    window.handleTechPhotoFileSelect = handleTechPhotoFileSelect;
    window.handleTechPhotoUrlInput = handleTechPhotoUrlInput;
    window.clearTechFormPhoto = clearTechFormPhoto;

    window.openTechnicianDigitalIdModal = openTechnicianDigitalIdModal;
    window.closeTechnicianDigitalIdModal = closeTechnicianDigitalIdModal;
    window.printTechnicianDigitalIdCard = printTechnicianDigitalIdCard;
    window.copyTechnicianDigitalIdDetails = copyTechnicianDigitalIdDetails;
    window.openTechnicianDashboardPreview = openTechnicianDashboardPreview;

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

(function () {
    'use strict';

    const apiBase = window.location.protocol === 'file:' ? 'http://localhost:5000' : '';

    function get(id) {
        return document.getElementById(id);
    }

    function notify(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type || 'info');
        } else {
            window.alert(message);
        }
    }

    function openWardenForm() {
        const modal = get('addWardenModal');
        if (!modal) {
            notify('The Add Warden form is missing from this page.', 'error');
            return;
        }
        const form = modal.querySelector('form');
        if (form) form.reset();
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
        setTimeout(() => get('wardenName')?.focus(), 50);
    }

    function closeWardenForm() {
        const modal = get('addWardenModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.style.display = 'none';
        modal.style.visibility = 'hidden';
        modal.style.pointerEvents = 'none';
    }

    async function submitWardenForm(event) {
        event.preventDefault();
        const name = get('wardenName')?.value.trim();
        const email = get('wardenEmail')?.value.trim();
        const password = get('wardenPassword')?.value || '';
        const hostel = get('wardenHostel')?.value || 'All';
        const hostelBlock = get('wardenHostelBlock')?.value || 'Block A';
        const floors = get('wardenFloors')?.value.trim() || 'All';
        const rooms = get('wardenRooms')?.value.trim() || 'All';
        const phone = get('wardenPhone')?.value.trim() || '';

        const permissions = {
            view_students: get('perm_students') ? get('perm_students').checked : true,
            approve_gatepasses: get('perm_gatepasses') ? get('perm_gatepasses').checked : true,
            manage_complaints: get('perm_complaints') ? get('perm_complaints').checked : true,
            view_cctv: get('perm_cctv') ? get('perm_cctv').checked : true
        };

        if (!name || !email || !password) {
            notify('Enter the warden name, email, and password.', 'warning');
            return;
        }
        if (password.length < 6) {
            notify('Password must be at least 6 characters long.', 'warning');
            return;
        }

        const submitButton = event.target.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.dataset.originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
        }

        try {
            const token = window.currentUser?.token || localStorage.getItem('token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(`${apiBase}/api/wardens`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    name,
                    email,
                    password,
                    hostel,
                    hostelBlock,
                    floors,
                    rooms,
                    phone,
                    permissions
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `Unable to create warden (${response.status}).`);

            closeWardenForm();
            notify(`Warden created with Control Scope [${hostelBlock} / Floors: ${floors} / Rooms: ${rooms}]. Login ID: ${result.userId || result.id}`, 'success');
            window.setTimeout(() => window.location.reload(), 500);
        } catch (error) {
            notify(error.message || 'Unable to create warden account.', 'error');
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = submitButton.dataset.originalText || '<i class="fa-solid fa-plus"></i> Create Warden Account';
            }
        }
    }

    window.openAddWardenModal = openWardenForm;
    window.closeAddWardenModal = closeWardenForm;
    window.handleAddWarden = submitWardenForm;

    document.addEventListener('DOMContentLoaded', function () {
        const addButton = get('addWardenButton');
        if (addButton) addButton.addEventListener('click', openWardenForm);

        const form = get('addWardenModal')?.querySelector('form');
        if (form) form.addEventListener('submit', submitWardenForm);
    });
})();

const API_BASE_URL = (() => {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:5000';
    }

    const hostname = window.location.hostname;
    const port = window.location.port;

    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '5000') {
        return 'http://localhost:5000';
    }

    return '';
})();

const DEBUG_CCTV_INFERENCE = window.location.search.includes('debug=true');

// If you want to use a fallback stream URL, set it here. For upload-based detection, leave it empty.
const CCTV_STREAM_SOURCE = '';
const CCTV_INFERENCE_API = '/api/cctv-inference';
const CCTV_REVIEW_CONFIDENCE = 0.3;
const CCTV_EMERGENCY_PERSIST_MS = 500;
const CROWD_ALERT_THRESHOLD = 20;
const CROWD_ALERT_STABLE_FRAMES = 3;
const CCTV_LIVE_CAPTURE_MAX_WIDTH = 640;
const CCTV_UPLOAD_CAPTURE_MAX_WIDTH = 960;
const CCTV_LIVE_INFERENCE_INTERVAL_MS = 700;
const CCTV_UPLOAD_INFERENCE_INTERVAL_MS = 350;
let cctvInferenceInterval = null;
let cctvCanvas = null;
let cctvVideoSourceUrl = '';
let cctvVideoElement = null;
let cctvInferenceInProgress = false;
let cctvFireDetectedState = false;
let cctvFireStableCount = 0;
let cctvNoFireStableCount = 0;
let cctvCrowdStableCount = 0;
let cctvCrowdAlertState = false;
let cctvCrowdAlertShown = false;
let cctvEmergencyAlertSent = false;
let cctvEmergencyAlertInFlight = false;
let emergencyAlertCameraName = 'Hostel CCTV Camera 3';
let emergencyAlertCameraLocation = 'Block A - Ground Floor';
let cctvAlertConfidenceThreshold = 0.5;
let cctvHazardStartedAt = null;
let cctvDetectionLogEntries = [];
let cctvDetectionSessionStartedAt = null;

function formatCCTVTimestamp(date = new Date()) {
    return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'medium'
    }).format(date);
}

function resetCCTVDetectionLogs() {
    cctvDetectionLogEntries = [];
    cctvDetectionSessionStartedAt = new Date().toISOString();
    updateCCTVDetectionLogOutput();
}

function appendCCTVDetectionLogEntry(entry) {
    cctvDetectionLogEntries.push({
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString()
    });
    updateCCTVDetectionLogOutput();
}

function updateCCTVDetectionLogOutput() {
    const resultEl = document.getElementById('cctvInferenceOutput');
    if (!resultEl) return;

    if (!cctvDetectionLogEntries.length) {
        resultEl.textContent = 'Start live camera monitoring to see detections here.';
        return;
    }

    const logText = cctvDetectionLogEntries.slice(-60).map((entry, index) => {
        const detectionLines = Array.isArray(entry.predictions) && entry.predictions.length
            ? entry.predictions.map((item) => `- ${item.label} (${Math.round((Number(item.confidence) || 0) * 100)}%)`).join('\n')
            : '- No fire or smoke detections returned.';
        const crowdLine = entry.personCount > 0 ? `People detected: ${entry.personCount}` : 'No crowd';
        return `[${formatCCTVTimestamp(new Date(entry.timestamp))}] Entry ${index + 1}
Source: ${entry.sourceLabel}
Status: ${entry.summary}
Confidence: ${entry.confidenceText}
Speed: ${entry.speedText}
${crowdLine}
${detectionLines}`;
    }).join('\n\n');

    resultEl.textContent = logText;
    resultEl.scrollTop = resultEl.scrollHeight;
}

async function downloadCCTVDetectionLogPdf() {
    if (!cctvDetectionLogEntries.length) {
        showToast('No detection log is available to download yet.', 'warning');
        return;
    }

    const statusEl = document.getElementById('cctvModelStatus');
    const accuracyEl = document.getElementById('cctvAccuracy');
    const speedEl = document.getElementById('cctvSpeed');
    const crowdCountEl = document.getElementById('cctvCrowdCount');
    const payload = {
        title: 'Hostel CCTV Detection Log',
        generatedAt: new Date().toISOString(),
        sessionStartedAt: cctvDetectionSessionStartedAt,
        currentStatus: statusEl?.textContent?.trim() || 'N/A',
        currentConfidence: accuracyEl?.textContent?.trim() || 'N/A',
        currentSpeed: speedEl?.textContent?.trim() || 'N/A',
        currentCrowdCount: crowdCountEl?.textContent?.trim() || 'N/A',
        entries: cctvDetectionLogEntries
    };

    try {
        const response = await apiRequest('/api/cctv-log-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unable to generate the PDF.' }));
            throw new Error(errorData.error || 'Unable to generate the PDF.');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.href = url;
        link.download = `cctv-detection-log-${stamp}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Detection log PDF downloaded successfully.', 'success');
    } catch (error) {
        console.error('PDF download failed:', error);
        showToast(error.message || 'Unable to download the detection log PDF.', 'error');
    }
}

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

async function apiRequest(path, options = {}) {
    const url = apiUrl(path);
    console.debug('[API]', options.method || 'GET', url);
    return fetch(url, options);
}

async function parseJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const body = await response.text();
        return {
            error: `Server returned invalid JSON (${response.status})`,
            status: response.status,
            statusText: response.statusText,
            body
        };
    }

    try {
        return await response.json();
    } catch (error) {
        const body = await response.text();
        return {
            error: 'Failed to parse JSON response from server.',
            details: error.message,
            body
        };
    }
}

async function requestCCTVInference(imageDataUrl, options = {}) {
    const endpoint = DEBUG_CCTV_INFERENCE ? `${CCTV_INFERENCE_API}?debug=true` : CCTV_INFERENCE_API;
    const response = await apiRequest(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image: imageDataUrl,
            sourceType: options.sourceType || 'live',
            includeCrowd: options.includeCrowd !== false
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown inference error.' }));
        throw new Error(errorData.error || 'CCTV inference request failed.');
    }

    const json = await response.json();
    if (json && typeof json === 'object') {
        if (json.success === true && json.result !== undefined) {
            return json.result;
        }
        if (json.result !== undefined) {
            return json.result;
        }
    }
    return json;
}

async function saveEmergencyAlertSettings(event) {
    event.preventDefault();
    const alertCameraName = document.getElementById('emergencyAlertCamera')?.value.trim() || 'Hostel CCTV Camera 3';
    const alertCameraLocation = document.getElementById('emergencyAlertLocation')?.value.trim() || 'Block A - Ground Floor';
    const alertMinConfidenceValue = Number(document.getElementById('emergencyAlertConfidence')?.value);
    const alertMinConfidence = Math.min(99, Math.max(1, Math.round(Number.isFinite(alertMinConfidenceValue) ? alertMinConfidenceValue : (cctvAlertConfidenceThreshold * 100))));
    try {
        const response = await apiRequest('/api/admin-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertCameraName, alertCameraLocation, alertMinConfidence }) });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Unable to save emergency settings.');
        emergencyAlertCameraName = data.alertCameraName;
        emergencyAlertCameraLocation = data.alertCameraLocation;
        cctvAlertConfidenceThreshold = (Number(data.alertMinConfidence) || 50) / 100;
        showToast('Telegram emergency alert settings saved successfully.', 'success');
    } catch (error) {
        showToast(error.message || 'Unable to save emergency settings.', 'error');
    }
}

async function loadEmergencyAlertSettings() {
    const cameraInput = document.getElementById('emergencyAlertCamera');
    const locationInput = document.getElementById('emergencyAlertLocation');
    const confidenceInput = document.getElementById('emergencyAlertConfidence');
    if (!cameraInput && !locationInput && !confidenceInput) return;
    const response = await apiRequest('/api/admin-settings');
    const data = await parseJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Unable to load emergency settings.');
    if (cameraInput) cameraInput.value = data.alertCameraName || emergencyAlertCameraName;
    if (locationInput) locationInput.value = data.alertCameraLocation || emergencyAlertCameraLocation;
    if (confidenceInput) confidenceInput.value = Number(data.alertMinConfidence) || 50;
    emergencyAlertCameraName = data.alertCameraName || emergencyAlertCameraName;
    emergencyAlertCameraLocation = data.alertCameraLocation || emergencyAlertCameraLocation;
    cctvAlertConfidenceThreshold = (Number(data.alertMinConfidence) || 50) / 100;
}

function renderAlertHistory(alerts) {
    const body = document.getElementById('alertHistoryTableBody');
    if (!body) return;
    body.innerHTML = alerts.length ? alerts.map((alert) => `<tr><td class="py-3 pr-4">${alert.date}<br><span class="text-xs text-text-secondary">${alert.time}</span></td><td class="py-3 pr-4 font-medium">${alert.detectionType}</td><td class="py-3 pr-4">${alert.confidence}%</td><td class="py-3 pr-4">${alert.cameraName || alert.camera}<br><span class="text-xs text-text-secondary">${alert.location || ''}</span></td><td class="py-3 pr-4">${alert.telegramStatus || alert.status}</td><td class="py-3">${alert.imagePath ? `<a href="${alert.imagePath}" target="_blank"><img src="${alert.imagePath}" alt="Emergency screenshot" class="h-12 w-16 rounded-lg object-cover border border-border"></a>` : '-'}</td></tr>`).join('') : '<tr><td colspan="6" class="py-5 text-center text-text-secondary">No alerts have been sent yet.</td></tr>';
}

async function loadAlertHistory() {
    const response = await apiRequest('/api/alert-history');
    const data = await parseJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Unable to load alert history.');
    renderAlertHistory(data);
}

function showEmergencyBrowserNotification(alert) {
    playNotificationTone();
    const camera = alert.cameraName || alert.camera;
    showToast(`Emergency: ${alert.detectionType} detected at ${camera} (${alert.confidence}%).`, 'error');
    const feed = document.getElementById('cctvVideoPlayer')?.parentElement;
    if (feed) {
        feed.style.boxShadow = 'inset 0 0 0 5px #ef4444, 0 0 32px rgba(239,68,68,.85)';
        setTimeout(() => { feed.style.boxShadow = ''; }, 60_000);
    }
    showModal('FIRE / SMOKE EMERGENCY', `<div class="space-y-4 text-center"><i class="fa-solid fa-triangle-exclamation text-6xl text-danger"></i><p class="text-xl font-bold">${alert.detectionType} detected</p><p class="text-text-secondary">${camera} - ${alert.location || 'Hostel CCTV Location'}</p><p class="text-lg font-semibold">Confidence: ${alert.confidence}%</p><p class="text-sm text-text-secondary">${alert.date} ${alert.time}</p><button onclick="closeModal()" class="btn-primary px-6 py-3 rounded-xl text-white font-semibold">Acknowledge Alert</button></div>`);
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('HostelFix Emergency Alert', {
            body: `${alert.detectionType} detected at ${camera} (${alert.confidence}%). Verify immediately.`,
            icon: '/public/logo.png'
        });
    }
}

async function enableEmergencyBrowserNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
}

async function sendTelegramEmergencyAlert(prediction, imageDataUrl) {
    if (cctvEmergencyAlertSent || cctvEmergencyAlertInFlight) return;
    cctvEmergencyAlertInFlight = true;
    try {
        const response = await apiRequest('/api/send-telegram-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: FireDetectionUtils.isFireLabel(prediction.label) ? 'Fire' : 'Smoke', confidence: prediction.confidence, camera: emergencyAlertCameraName, location: emergencyAlertCameraLocation, image: imageDataUrl }) });
        const data = await parseJsonResponse(response);
        if (response.status === 202 && data.status === 'cooldown') { cctvEmergencyAlertSent = true; return; }
        if (!response.ok) throw new Error(data.error || 'Unable to send Telegram emergency alert');
        cctvEmergencyAlertSent = true;
        showToast('Telegram emergency alert sent successfully.', 'success');
    } catch (error) {
        showToast(error.message || 'Unable to send Telegram emergency alert', 'error');
        console.error('Telegram emergency alert failed:', error);
    } finally {
        cctvEmergencyAlertInFlight = false;
    }
}

let pageHistory = ['landing'];

function getActivePageId() {
    const activePage = document.querySelector('.page.active');
    return activePage ? activePage.id.replace('page-', '') : 'landing';
}

function navigateTo(pageId, options = {}) {
    const { skipHistory = false } = options;
    const dashboardRoles = {
        'student-dashboard': 'student',
        'technician-dashboard': 'technician',
        'admin-dashboard': 'admin'
    };

    if (dashboardRoles[pageId] && (!currentUser || currentUser.role !== dashboardRoles[pageId])) {
        showToast('Please sign in with the correct role to open this dashboard.', 'warning');
        pageId = 'login';
    }

    if (pageId === 'profile' && !currentUser) {
        showToast('Please sign in to view your profile.', 'warning');
        pageId = 'login';
    }

    const currentPageId = getActivePageId();

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + pageId);
    if (target) {
        target.classList.add('active');
        window.scrollTo(0, 0);
    }
    document.getElementById('mobileMenu').classList.add('hidden');
    document.querySelectorAll('.sidebar-mobile').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('[id^="sidebarOverlay"]').forEach(o => o.classList.add('hidden'));

    if (!skipHistory && currentPageId !== pageId) {
        pageHistory.push(pageId);
    }

    if (pageId === 'complaint-registration') {
        prepareComplaintForm();
    }

    if (pageId === 'laundry') {
        prepareLaundryForm();
    }

    if (pageId === 'notifications') {
        renderStudentNotifications();
        updateNotificationBadge();
    }

    if (pageId === 'profile') {
        renderCurrentUserProfile();
    }

    if (pageId === 'admin-settings') {
        loadEmergencyAlertSettings().catch((error) => console.error(error));
        loadAlertHistory().catch((error) => console.error(error));
    }

    if (currentUser) {
        updateSidebarIdentity();
    }
}

function navigateBack() {
    if (pageHistory.length > 1) {
        pageHistory.pop();
        navigateTo(pageHistory[pageHistory.length - 1], { skipHistory: true });
        return;
    }

    navigateTo('landing', { skipHistory: true });
    pageHistory = ['landing'];
}

function toggleMobileMenu() {
    document.getElementById('mobileMenu').classList.toggle('hidden');
}

let currentUser = null;
window.getCurrentUser = () => currentUser;
let selectedLoginRole = 'student';
let technicians = [];
let announcementSocket = null;
let studentNotifications = [];
const USER_SESSION_KEY = 'hostelfix.currentUser';

function getCurrentUserStorageKey() {
    if (!currentUser) return null;
    return `hostelfix.profileImage.${currentUser.userId || currentUser.email || currentUser.name}`;
}

function persistCurrentUser() {
    if (!currentUser) {
        localStorage.removeItem(USER_SESSION_KEY);
        return;
    }

    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(currentUser));
}

function restoreCurrentUser() {
    const saved = localStorage.getItem(USER_SESSION_KEY);
    if (!saved) return false;

    try {
        currentUser = JSON.parse(saved);
        return Boolean(currentUser);
    } catch (error) {
        console.error('Unable to restore saved user session:', error);
        localStorage.removeItem(USER_SESSION_KEY);
        currentUser = null;
        return false;
    }
}

function getCurrentUserProfileImage() {
    const key = getCurrentUserStorageKey();
    return key ? localStorage.getItem(key) : '';
}

function setCurrentUserProfileImage(dataUrl) {
    const key = getCurrentUserStorageKey();
    if (!key) return;

    if (dataUrl) {
        localStorage.setItem(key, dataUrl);
    } else {
        localStorage.removeItem(key);
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function prepareComplaintForm() {
    const studentNameInput = document.getElementById('complaintStudentName');
    const regInput = document.getElementById('complaintRegistrationNumber');

    if (currentUser) {
        fillStudentForm(currentUser);
        if (studentNameInput) studentNameInput.readOnly = true;
        if (regInput) regInput.readOnly = true;
        return;
    }

    if (studentNameInput) {
        studentNameInput.readOnly = false;
        studentNameInput.value = '';
    }
    if (regInput) {
        regInput.readOnly = false;
        regInput.value = '';
    }
}

function prepareLaundryForm() {
    const studentNameInput = document.getElementById('laundryStudentName');
    const regInput = document.getElementById('laundryRegistrationNumber');
    const blockInput = document.getElementById('laundryHostelBlock');
    const roomInput = document.getElementById('laundryRoomNumber');

    if (currentUser) {
        if (studentNameInput) studentNameInput.value = currentUser.name || '';
        if (regInput) regInput.value = currentUser.registrationNumber || '';
        if (blockInput) blockInput.value = currentUser.hostelBlock || '';
        if (roomInput) roomInput.value = currentUser.roomNumber || '';
    } else {
        if (studentNameInput) studentNameInput.value = '';
        if (regInput) regInput.value = '';
        if (blockInput) blockInput.value = '';
        if (roomInput) roomInput.value = '';
    }
}

function fillStudentForm(user) {
    if (!user) return;
    const studentNameInput = document.getElementById('complaintStudentName');
    const regInput = document.getElementById('complaintRegistrationNumber');
    const roomInput = document.getElementById('complaintRoomNumber');
    const hostelBlockInput = document.getElementById('complaintHostelBlock');
    const gatePassStudentNameInput = document.getElementById('gatePassStudentName');
    const gatePassRegInput = document.getElementById('gatePassRegistrationNumber');
    const gatePassRoomInput = document.getElementById('gatePassRoomNumber');
    const gatePassHostelBlockInput = document.getElementById('gatePassHostelBlock');
    const studentWelcomeText = document.getElementById('studentWelcomeText');

    if (studentNameInput) studentNameInput.value = user.name || '';
    if (regInput) regInput.value = user.registrationNumber || '';
    if (roomInput) roomInput.value = user.roomNumber || '';
    if (hostelBlockInput && user.hostelBlock) hostelBlockInput.value = user.hostelBlock;
    if (gatePassStudentNameInput) gatePassStudentNameInput.value = user.name || '';
    if (gatePassRegInput) gatePassRegInput.value = user.registrationNumber || '';
    if (gatePassRoomInput) gatePassRoomInput.value = user.roomNumber || '';
    if (gatePassHostelBlockInput && user.hostelBlock) gatePassHostelBlockInput.value = user.hostelBlock;
    if (studentWelcomeText) studentWelcomeText.textContent = `Welcome back, ${user.name || 'Student'}! Here is your overview.`;
}

function updateStudentDashboardStats(data) {
    if (!data) return;
    const stats = {
        studentTotalComplaints: data.total || 0,
        studentPendingComplaints: data.pending || 0,
        studentInProgressComplaints: data.inProgress || 0,
        studentResolvedComplaints: data.completed || 0
    };

    Object.entries(stats).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value.toLocaleString();
    });
}

function mergeAnnouncements(announcements) {
    if (!Array.isArray(announcements)) return;
    const existingById = Object.fromEntries(studentNotifications.map((item) => [item.id, item]));
    announcements.forEach((announcement) => {
        if (!announcement || !announcement.id) return;
        const previous = existingById[announcement.id];
        existingById[announcement.id] = {
            ...announcement,
            read: previous ? previous.read : false
        };
    });
    studentNotifications = Object.values(existingById).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateNotificationBadge() {
    const badgeIds = ['studentNotificationBadge', 'studentSidebarNotificationBadge'];
    const unreadCount = studentNotifications.filter((item) => !item.read).length;
    badgeIds.forEach((id) => {
        const badge = document.getElementById(id);
        if (!badge) return;
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    });
}

function renderStudentNotifications() {
    const list = document.getElementById('studentNotificationsList');
    if (!list) return;
    if (!studentNotifications.length) {
        list.innerHTML = '<div class="text-center py-20 text-text-secondary"><i class="fa-solid fa-bell-slash text-3xl mb-4"></i><p class="text-base font-medium">No announcements yet.</p><p class="text-sm mt-2">Any live notices from admin will appear here.</p></div>';
        renderDashboardAnnouncements();
        return;
    }

    list.innerHTML = studentNotifications.map((announcement) => {
        const unreadBadge = announcement.read ? '' : '<span class="inline-flex items-center px-2 py-1 rounded-full bg-primary text-white text-[11px] font-semibold">NEW</span>';
        return `
            <div class="glass rounded-3xl border border-border p-6 mb-4 shadow-sm ${announcement.priority === 'Emergency' ? 'border-danger/40 bg-danger/5' : ''}">
                <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                    <div>
                        <p class="text-sm text-text-secondary uppercase tracking-[0.2em] mb-2">${announcement.audience || 'All Students'}</p>
                        <h3 class="text-lg font-semibold">${announcement.title || 'Untitled Announcement'}</h3>
                        <p class="text-sm mt-1 text-text-secondary">Posted by ${announcement.adminName || 'Admin'} on ${new Date(announcement.createdAt).toLocaleString()}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        ${unreadBadge}
                        <span class="px-3 py-1 rounded-full text-xs font-semibold ${announcement.priority === 'Emergency' ? 'bg-danger text-white' : announcement.priority === 'Important' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}">${announcement.priority || 'Normal'}</span>
                    </div>
                </div>
                <p class="text-text-secondary leading-relaxed">${announcement.message || ''}</p>
            </div>
        `;
    }).join('');
}

function markAllNotificationsRead() {
    studentNotifications = studentNotifications.map((item) => ({ ...item, read: true }));
    updateNotificationBadge();
    renderStudentNotifications();
    renderDashboardAnnouncements();
    showToast('All announcements marked as read.', 'success');
}

function renderDashboardAnnouncements() {
    const container = document.getElementById('studentDashboardAnnouncementsList');
    if (!container) return;

    if (!studentNotifications.length) {
        container.innerHTML = '<div class="text-sm text-text-secondary">No announcements yet. When admin sends a notice, it will appear here with a badge.</div>';
        return;
    }

    container.innerHTML = studentNotifications.slice(0, 2).map((announcement) => {
        const priorityClass = announcement.priority === 'Emergency'
            ? 'bg-danger text-white'
            : announcement.priority === 'Important'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700';

        return `
            <div class="rounded-3xl border border-border p-4 bg-white/90 shadow-sm">
                <div class="flex items-start justify-between gap-3 mb-3">
                    <div>
                        <p class="text-sm font-semibold">${announcement.title || 'Untitled Announcement'}</p>
                        <p class="text-xs text-text-secondary">${new Date(announcement.createdAt).toLocaleString()}</p>
                    </div>
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${priorityClass}">${announcement.priority || 'Normal'}</span>
                </div>
                <p class="text-sm text-text-secondary line-clamp-3">${announcement.message || ''}</p>
            </div>
        `;
    }).join('');
}

function openAnnouncementPopup() {
    const modal = document.getElementById('announcementAdminModal');
    if (!modal) return;
    modal.classList.remove('hidden');
}

function closeAnnouncementPopup() {
    const modal = document.getElementById('announcementAdminModal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function closeAnnouncementModal() {
    const modal = document.getElementById('announcementEmergencyModal');
    if (!modal) return;
    modal.classList.add('hidden');
}

function showEmergencyModal(announcement) {
    const modal = document.getElementById('announcementEmergencyModal');
    const title = document.getElementById('announcementEmergencyTitle');
    const message = document.getElementById('announcementEmergencyMessage');
    if (!modal || !title || !message) return;
    title.textContent = announcement.title || 'Emergency Announcement';
    message.textContent = announcement.message || 'Please follow the emergency instructions from your hostel authorities.';
    modal.classList.remove('hidden');
}

function playNotificationTone() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 620;
        gain.gain.value = 0.06;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.08);
        oscillator.onended = () => ctx.close();
    } catch (err) {
        console.warn('Notification tone failed:', err);
    }
}

async function fetchAnnouncements() {
    try {
        const response = await apiRequest('/api/announcements');
        const data = await parseJsonResponse(response);
        if (!response.ok) {
            console.warn('Failed to load announcements:', data.error || response.status);
            return;
        }
        mergeAnnouncements(Array.isArray(data) ? data : []);
        updateNotificationBadge();
        renderDashboardAnnouncements();
        if (getActivePageId() === 'notifications') {
            renderStudentNotifications();
        }
    } catch (error) {
        console.error('Announcement fetch failed:', error);
    }
}

function setupAnnouncementSocket() {
    try {
        if (typeof io !== 'function') {
            console.warn('Socket.IO client not loaded. Live announcements will not update automatically.');
            return;
        }
        const socketUrl = API_BASE_URL || undefined;
        announcementSocket = socketUrl ? io(socketUrl) : io();
        announcementSocket.on('connect', () => {
            console.debug('Connected to announcement socket', socketUrl || window.location.origin);
        });
        announcementSocket.on('connect_error', (error) => {
            console.warn('Live announcement socket connection error:', error);
        });
        announcementSocket.on('announcement.created', (announcement) => {
            if (!announcement || !announcement.id) return;
            mergeAnnouncements([announcement]);
            updateNotificationBadge();
            renderDashboardAnnouncements();
            if (currentUser?.role === 'student') {
                playNotificationTone();
                showToast(`New announcement: ${announcement.title}`, 'info');
                if (announcement.priority === 'Emergency') {
                    showEmergencyModal(announcement);
                }
            }
            if (getActivePageId() === 'notifications') {
                renderStudentNotifications();
            }
        });
        announcementSocket.on('emergency-alert', (alert) => {
            if (!alert?.id || currentUser?.role !== 'admin') return;
            showEmergencyBrowserNotification(alert);
            if (getActivePageId() === 'admin-settings') loadAlertHistory().catch(console.error);
        });
    } catch (error) {
        console.error('Unable to initialize announcement socket:', error);
    }
}

async function sendLiveAnnouncement(event) {
    if (event && event.preventDefault) event.preventDefault();
    const title = document.getElementById('announcementTitle')?.value.trim();
    const message = document.getElementById('announcementMessage')?.value.trim();
    const priority = document.getElementById('announcementPriority')?.value || 'Normal';
    const audience = document.getElementById('announcementAudience')?.value || 'All Students';
    const adminName = currentUser?.name || 'Admin';

    if (!title || !message) {
        showToast('Title and message are required for announcements.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, message, priority, audience, adminName })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || 'Unable to send announcement.', 'error');
            return;
        }

        closeAnnouncementPopup();
        document.getElementById('announcementForm')?.reset();
        mergeAnnouncements([data]);
        updateNotificationBadge();
        showToast('Announcement sent successfully.', 'success');
    } catch (error) {
        hideLoading();
        showToast('Unable to send announcement. Please try again.', 'error');
        console.error(error);
    }
}

function getPriorityBadgeClass(priority = 'Medium') {
    const lower = String(priority).toLowerCase();
    if (lower.includes('high')) return 'badge-high';
    if (lower.includes('medium')) return 'badge-medium';
    if (lower.includes('low')) return 'badge-low';
    return 'badge-pending';
}

function getCategoryIcon(category = '') {
    const lower = String(category).toLowerCase();
    if (lower.includes('electric')) return 'fa-bolt';
    if (lower.includes('plumb')) return 'fa-faucet';
    if (lower.includes('furn')) return 'fa-chair';
    if (lower.includes('wifi')) return 'fa-wifi';
    if (lower.includes('door')) return 'fa-door-closed';
    if (lower.includes('ac')) return 'fa-wind';
    if (lower.includes('light')) return 'fa-lightbulb';
    if (lower.includes('house')) return 'fa-broom';
    return 'fa-tools';
}

function formatComplaintDate(dateString) {
    if (!dateString) return 'Recent';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Recent';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getGatePassStatusClass(status = 'Pending') {
    const lower = String(status).toLowerCase();
    if (lower.includes('approved')) return 'badge-completed';
    if (lower.includes('rejected')) return 'badge-high';
    return 'badge-pending';
}

function renderGatePassTable(gatePasses = []) {
    const tableBody = document.getElementById('adminGatePassTableBody');
    if (!tableBody) return;

    if (!gatePasses.length) {
        tableBody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-sm text-text-secondary text-center">No gate pass requests yet.</td></tr>';
        return;
    }

    tableBody.innerHTML = gatePasses.map((entry) => `
        <tr class="table-row">
            <td class="px-6 py-4 text-sm font-medium">${entry.id || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${entry.student || 'Anonymous'}</td>
            <td class="px-6 py-4 text-sm">${entry.registrationNumber || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${entry.reason || 'General'}</td>
            <td class="px-6 py-4 text-sm">${entry.session || 'Morning'}</td>
            <td class="px-6 py-4"><span class="${getGatePassStatusClass(entry.status)} px-2.5 py-1 rounded-full text-xs font-medium">${entry.status || 'Pending'}</span></td>
            <td class="px-6 py-4 text-sm text-text-secondary">
                ${String(entry.status || '').toLowerCase() === 'pending'
                    ? `<div class="flex gap-2"><button onclick="approveGatePass('${entry.id}', 'Approved')" class="px-3 py-2 rounded-lg bg-emerald text-white text-xs font-medium hover:bg-emerald-dark transition-all">Approve</button><button onclick="approveGatePass('${entry.id}', 'Rejected')" class="px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-surface-alt transition-all">Reject</button></div>`
                    : formatComplaintDate(entry.createdAt)}
            </td>
        </tr>
    `).join('');
}

function renderComplaintRow(complaint) {
    const icon = getCategoryIcon(complaint.category);
    const statusClass = getStatusBadgeClass(complaint.status);
    const priorityClass = getPriorityBadgeClass(complaint.priority);

    return `
        <tr class="table-row">
            <td class="px-6 py-4 text-sm font-medium">${complaint.id || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${complaint.student || 'Anonymous'}</td>
            <td class="px-6 py-4 text-sm">${complaint.roomNumber || 'N/A'}</td>
            <td class="px-6 py-4 text-sm"><span class="flex items-center gap-2"><i class="fa-solid ${icon} text-primary"></i> ${complaint.category || 'General'}</span></td>
            <td class="px-6 py-4"><span class="${priorityClass} px-2.5 py-1 rounded-full text-xs font-medium">${complaint.priority || 'Medium'}</span></td>
            <td class="px-6 py-4"><span class="${statusClass} px-2.5 py-1 rounded-full text-xs font-medium">${complaint.status || 'Pending'}</span></td>
            <td class="px-6 py-4 text-sm text-text-secondary">${formatComplaintDate(complaint.createdAt)}</td>
        </tr>
    `;
}

function updateStudentRecentComplaints(complaints) {
    const tableBody = document.getElementById('studentRecentComplaintsTableBody');
    if (!tableBody) return;

    const visibleComplaints = complaints
        .filter((complaint) => !currentUser || !currentUser.email || complaint.email === currentUser.email || complaint.student === currentUser.name)
        .slice(0, 4);

    if (!visibleComplaints.length) {
        tableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-sm text-text-secondary text-center">No complaints yet. Submit your first complaint to see it here.</td></tr>';
        return;
    }

    tableBody.innerHTML = visibleComplaints.map(renderComplaintRow).join('');
}

function populateTechnicianDropdown(technicianList = []) {
    const techSelect = document.getElementById('complaintAssignedTo');
    if (!techSelect) return;

    technicians = Array.isArray(technicianList) ? technicianList : [];
    techSelect.innerHTML = '<option value="">Select technician (optional)</option>' + technicians
        .map((tech) => `<option value="${tech.name}">${tech.name}</option>`)
        .join('');
}

function getVisibleTechnicianComplaints(complaints, includeCompleted = false) {
    if (!currentUser || currentUser.role !== 'technician') {
        return complaints;
    }

    return complaints.filter((complaint) => {
        const matchesTechnician = normalizeText(complaint.assignedTo) === normalizeText(currentUser.name);
        if (!matchesTechnician) return false;
        if (!includeCompleted && String(complaint.status || '').toLowerCase() === 'completed') return false;
        return true;
    });
}

async function markComplaintComplete(complaintId) {
    if (!complaintId) return;

    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Completed' })
        });
        const data = await response.json();
        hideLoading();

        if (!response.ok) {
            showToast(data.error || 'Unable to complete the job.', 'error');
            return;
        }

        showToast('Complaint marked complete and student notified.', 'success');
        await loadDashboardData();
        navigateTo('technician-dashboard');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function deleteComplaint(complaintId) {
    if (!complaintId) return;
    if (!confirm('Delete this assigned job? This action cannot be undone.')) return;

    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}`, {
            method: 'DELETE'
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to delete complaint (${response.status}).`, 'error');
            return;
        }

        showToast('Assigned job deleted successfully.', 'success');
        await loadDashboardData();
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

function renderTechComplaintCard(complaint) {
    return `
        <div class="glass rounded-2xl border border-border overflow-hidden card-hover">
            <div class="p-6">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><i class="fa-solid ${getCategoryIcon(complaint.category)} text-primary"></i></div>
                        <div>
                            <h4 class="font-semibold">${complaint.category || 'General Complaint'}</h4>
                            <p class="text-xs text-text-secondary">${complaint.roomNumber || 'Room N/A'} | ${complaint.student || 'Anonymous'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="${getPriorityBadgeClass(complaint.priority)} px-2.5 py-1 rounded-full text-xs font-medium">${complaint.priority || 'Medium'}</span>
                        <button onclick="deleteComplaint('${complaint.id}')" class="w-9 h-9 rounded-full bg-surface border border-border text-text-secondary hover:bg-danger hover:text-white transition-all" title="Delete assigned job">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p class="text-sm text-text-secondary mb-4">${complaint.description || 'No description provided yet.'}</p>
                <div class="flex items-center gap-2 mb-4">
                    <div class="w-16 h-16 rounded-xl bg-surface-alt border border-border flex items-center justify-center">
                        <i class="fa-solid fa-image text-text-muted text-xl"></i>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="showToast('Job accepted successfully!', 'success')" class="flex-1 py-2 rounded-xl bg-emerald text-white text-sm font-medium hover:bg-emerald-dark transition-all">
                        <i class="fa-solid fa-check mr-1"></i> Accept
                    </button>
                    <button onclick="showToast('Work started!', 'info')" class="flex-1 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-dark transition-all">
                        <i class="fa-solid fa-play mr-1"></i> Start Work
                    </button>
                    <button onclick="markComplaintComplete('${complaint.id}')" class="flex-1 py-2 rounded-xl bg-surface border border-border text-text text-sm font-medium hover:bg-surface-alt transition-all">
                        <i class="fa-solid fa-flag-checkered mr-1"></i> Complete
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderTechAssignedComplaints(complaints) {
    const dashboardContainer = document.getElementById('technicianAssignedComplaints');
    const pageContainer = document.getElementById('technicianAssignedPageComplaints');
    const visibleComplaints = getVisibleTechnicianComplaints(complaints, false);

    const noDataMarkup = '<div class="glass rounded-2xl border border-border p-6 text-sm text-text-secondary">No complaints are assigned to your name yet.</div>';

    const markup = visibleComplaints.map(renderTechComplaintCard).join('');

    if (dashboardContainer) {
        dashboardContainer.innerHTML = visibleComplaints.length ? markup : noDataMarkup;
    }

    if (pageContainer) {
        pageContainer.innerHTML = visibleComplaints.length ? markup : noDataMarkup;
    }
}

function renderTechCompletedComplaints(complaints) {
    const container = document.getElementById('technicianCompletedPageComplaints');
    if (!container) return;

    const completedComplaints = getVisibleTechnicianComplaints(complaints, true)
        .filter((complaint) => String(complaint.status || '').toLowerCase() === 'completed');

    if (!completedComplaints.length) {
        container.innerHTML = '<div class="glass rounded-2xl border border-border p-6 text-sm text-text-secondary">No completed jobs yet.</div>';
        return;
    }

    container.innerHTML = `
        <div class="glass rounded-2xl border border-border overflow-hidden">
            <table class="w-full">
                <thead class="bg-surface-alt">
                    <tr>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">ID</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Issue</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Room</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Completed</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-border">
                    ${completedComplaints.map((complaint) => `
                        <tr class="table-row">
                            <td class="px-6 py-4 text-sm font-medium">${complaint.id || 'N/A'}</td>
                            <td class="px-6 py-4 text-sm">${complaint.category || 'General Complaint'}</td>
                            <td class="px-6 py-4 text-sm">${complaint.roomNumber || 'N/A'}</td>
                            <td class="px-6 py-4 text-sm text-text-secondary">${formatComplaintDate(complaint.createdAt)}</td>
                            <td class="px-6 py-4"><span class="${getStatusBadgeClass(complaint.status)} px-2.5 py-1 rounded-full text-xs font-medium">${complaint.status || 'Completed'}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderTechSummary(complaints) {
    const techJobs = document.getElementById('techJobs');
    const techPending = document.getElementById('techPending');
    const techCompleted = document.getElementById('techCompleted');
    const techUrgent = document.getElementById('techUrgent');

    if (!techJobs && !techPending && !techCompleted && !techUrgent) return;

    const visibleComplaints = getVisibleTechnicianComplaints(complaints, false);
    const total = visibleComplaints.length;
    const pending = visibleComplaints.filter((item) => ['Pending', 'Assigned', 'Accepted'].includes(item.status)).length;
    const completed = getVisibleTechnicianComplaints(complaints, true).filter((item) => item.status === 'Completed').length;
    const urgent = visibleComplaints.filter((item) => String(item.priority).toLowerCase() === 'high').length;

    if (techJobs) techJobs.textContent = total.toLocaleString();
    if (techPending) techPending.textContent = pending.toLocaleString();
    if (techCompleted) techCompleted.textContent = completed.toLocaleString();
    if (techUrgent) techUrgent.textContent = urgent.toLocaleString();
}

function renderAdminSummary(summary, complaints) {
    const adminTotal = document.getElementById('adminTotalComplaints');
    const adminPending = document.getElementById('adminPendingComplaints');
    const adminCompleted = document.getElementById('adminCompletedComplaints');
    const adminActiveTechnicians = document.getElementById('adminActiveTechnicians');

    if (adminTotal) adminTotal.textContent = String(summary.total || complaints.length || 0).toLocaleString();
    if (adminPending) adminPending.textContent = String(summary.pending || 0).toLocaleString();
    if (adminCompleted) adminCompleted.textContent = String(summary.completed || 0).toLocaleString();
    if (adminActiveTechnicians) adminActiveTechnicians.textContent = String(summary.activeTechnicians || 0).toLocaleString();
}

function updateNavAfterLogin() {
    const navProfileBtn = document.getElementById('navProfileBtn');
    if (!navProfileBtn) return;
    navProfileBtn.classList.remove('hidden');
    navProfileBtn.innerHTML = `<i class="fa-solid fa-user"></i><span>${currentUser?.name || 'Profile'}</span>`;
    navProfileBtn.onclick = () => navigateTo('profile');
    updateSidebarIdentity();
    requestAnimationFrame(updateSidebarIdentity);
    window.setTimeout(updateSidebarIdentity, 100);
}

function resetNavAfterLogout() {
    const navProfileBtn = document.getElementById('navProfileBtn');
    if (!navProfileBtn) return;

    navProfileBtn.classList.add('hidden');
    navProfileBtn.innerHTML = '<i class="fa-solid fa-user"></i><span>Profile</span>';
    navProfileBtn.onclick = () => navigateTo('login');
}

function updateSidebarIdentity() {
    if (!currentUser) return;

    const roleLabels = {
        student: 'Student',
        technician: 'Technician',
        admin: 'Administrator'
    };
    const initials = (currentUser.name || 'User')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
    const roleLabel = roleLabels[currentUser.role] || 'User';
    const profileImage = getCurrentUserProfileImage();

    document.querySelectorAll('.sidebar-mobile').forEach((sidebar) => {
        const navigation = sidebar.querySelector('nav');
        const identityCard = navigation?.previousElementSibling;
        if (!identityCard) return;

        const avatar = identityCard.children[0];
        const textLines = identityCard.children[1]?.querySelectorAll('p') || [];
        if (avatar) {
            if (profileImage) {
                avatar.innerHTML = `<img src="${profileImage}" alt="Profile" class="h-full w-full rounded-full object-cover">`;
            } else {
                avatar.textContent = initials;
            }
        }
        if (textLines[0]) textLines[0].textContent = currentUser.name || 'User';
        if (textLines[1]) textLines[1].textContent = roleLabel;

        identityCard.classList.add('cursor-pointer');
        identityCard.title = 'Open profile';
        identityCard.onclick = () => navigateTo('profile');
    });

    document.querySelectorAll('.sidebar-mobile button').forEach((button) => {
        if (button.textContent.trim() === 'Profile') {
            button.classList.add('hidden');
        }
    });
}

function logoutCurrentUser() {
    currentUser = null;
    localStorage.removeItem(USER_SESSION_KEY);
    resetNavAfterLogout();
    navigateTo('login', { skipHistory: true });
    showToast('You have been logged out successfully.', 'success');
}

function getCurrentUserDashboard() {
    if (currentUser?.role === 'technician') return 'technician-dashboard';
    if (currentUser?.role === 'admin') return 'admin-dashboard';
    return 'student-dashboard';
}

function renderCurrentUserProfile() {
    if (!currentUser) {
        navigateTo('login');
        return;
    }

    const roleLabels = {
        student: 'Student',
        technician: 'Technician',
        admin: 'Administrator'
    };
    const roleLabel = roleLabels[currentUser.role] || 'User';
    const extraDetails = currentUser.role === 'student'
        ? [currentUser.hostelBlock, currentUser.roomNumber].filter(Boolean).join(' • ') || 'No room details provided'
        : currentUser.role === 'technician'
            ? 'Technician account'
            : 'Administrator account';
    const extraLabel = currentUser.role === 'student' ? 'Hostel / Room' : 'Account Details';
    const profileImage = getCurrentUserProfileImage();
    const initials = (currentUser.name || 'User')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || 'U';

    const fields = {
        profileName: currentUser.name || 'User',
        profileRole: roleLabel,
        profileUserId: currentUser.userId || '—',
        profileEmail: currentUser.email || '—',
        profileEmailHeadline: currentUser.email || 'No email available',
        profileRoleDetail: roleLabel,
        profileExtraLabel: extraLabel,
        profileExtraValue: extraDetails
    };

    Object.entries(fields).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });

    const avatar = document.getElementById('profileAvatar');
    if (avatar) {
        avatar.innerHTML = profileImage
            ? `<img src="${profileImage}" alt="Profile picture" class="h-full w-full object-cover">`
            : initials;
    }
}

function handleProfileImageChange(event) {
    const file = event.target.files?.[0];
    if (!file || !currentUser) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please choose a valid image file.', 'warning');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        setCurrentUserProfileImage(reader.result);
        renderCurrentUserProfile();
        updateSidebarIdentity();
        showToast('Profile image updated successfully.', 'success');
    };
    reader.onerror = () => showToast('Unable to read that image file.', 'error');
    reader.readAsDataURL(file);
    event.target.value = '';
}

function toggleSidebar() {
    document.querySelectorAll('.sidebar-mobile').forEach(s => s.classList.toggle('open'));
    document.querySelectorAll('[id^="sidebarOverlay"]').forEach(o => o.classList.toggle('hidden'));
}

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const icon = document.getElementById('darkModeIcon');
    if (document.documentElement.classList.contains('dark')) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
    }
}

function selectRole(role) {
    selectedLoginRole = role;
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.classList.remove('active', 'border-primary', 'bg-primary/5', 'text-primary');
        btn.classList.add('border-border', 'text-text-secondary');
    });
    const active = document.querySelector('[data-role="' + role + '"]');
    if (active) {
        active.classList.remove('border-border', 'text-text-secondary');
        active.classList.add('active', 'border-primary', 'bg-primary/5', 'text-primary');
    }

}

function togglePassword(btn) {
    const input = btn.parentElement.querySelector('input');
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const role = selectedLoginRole;
    console.debug('Login attempt payload:', { email, role });
    if (!email || !password) {
        showToast('Please enter your user ID or email and password.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Login failed (${response.status}).`, 'error');
            return;
        }

        currentUser = data;
        persistCurrentUser();
        updateNavAfterLogin();
        showToast(`Welcome back, ${data.name}!`, 'success');
        if (role === 'technician') {
            const techSidebarName = document.getElementById('techSidebarName');
            const techSidebarRole = document.getElementById('techSidebarRole');
            const techWelcomeText = document.getElementById('techWelcomeText');
            if (techSidebarName) techSidebarName.textContent = data.name || 'Technician';
            if (techSidebarRole) techSidebarRole.textContent = 'Technician';
            if (techWelcomeText) techWelcomeText.textContent = `Welcome back, ${data.name || 'Technician'}! Here are your tasks for today.`;
        }
        if (role === 'student') {
            fillStudentForm(data);
            navigateTo('student-dashboard');
        } else if (role === 'technician') {
            navigateTo('technician-dashboard');
        } else if (role === 'admin') {
            navigateTo('admin-dashboard');
        } else {
            navigateTo('student-dashboard');
        }
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function handleRegister(e) {
    e.preventDefault();

    const name = document.getElementById('registerName')?.value.trim();
    const email = document.getElementById('registerEmail')?.value.trim();
    const password = document.getElementById('registerPassword')?.value || '';
    const role = document.getElementById('registerRole')?.value || '';

    if (!name || !email || !password || !role) {
        showToast('Please complete the registration form before submitting.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                email,
                password,
                role
            })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Registration failed (${response.status}).`, 'error');
            return;
        }

        e.target.reset();
        navigateTo('login');
        selectRole(data.role);

        const loginIdentifier = document.getElementById('loginEmail');
        if (loginIdentifier) {
            loginIdentifier.value = data.userId;
        }

        showToast(`Account created. Your user ID is ${data.userId}. Please sign in to continue.`, 'success');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function handleComplaintSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const studentName = currentUser?.name || document.getElementById('complaintStudentName').value.trim();
    const registrationNumber = currentUser?.registrationNumber || document.getElementById('complaintRegistrationNumber').value.trim();
    const hostelBlock = document.getElementById('complaintHostelBlock')?.value || 'Unknown';
    const roomNumber = document.getElementById('complaintRoomNumber').value.trim();
    const category = document.getElementById('complaintCategory').value || 'General';
    const description = document.getElementById('complaintDescription').value.trim();
    const priority = form.querySelector('input[name="priority"]:checked')?.value || 'medium';
    const assignedTo = document.getElementById('complaintAssignedTo')?.value || 'Unassigned';

    if (!studentName || !registrationNumber || !roomNumber || !category || !description) {
        showToast('Please complete all complaint details before submitting.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/complaints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student: studentName,
                email: currentUser?.email || '',
                registrationNumber,
                hostelBlock,
                roomNumber,
                category,
                priority: priority.charAt(0).toUpperCase() + priority.slice(1),
                description,
                assignedTo
            })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to submit complaint (${response.status}).`, 'error');
            return;
        }

        showToast(`Complaint submitted successfully! ID: ${data.id}`, 'success');
        form.reset();
        if (currentUser) {
            prepareComplaintForm();
            updateNavAfterLogin();
        }
        loadLandingStats();
        navigateTo('student-dashboard');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function handleGatePassSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const studentName = currentUser?.name || document.getElementById('gatePassStudentName').value.trim();
    const registrationNumber = currentUser?.registrationNumber || document.getElementById('gatePassRegistrationNumber').value.trim();
    const hostelBlock = document.getElementById('gatePassHostelBlock')?.value || 'Unknown';
    const roomNumber = document.getElementById('gatePassRoomNumber').value.trim();
    const reason = document.getElementById('gatePassReason').value.trim();
    const session = document.getElementById('gatePassSession').value || 'Morning';
    const gateDate = document.getElementById('gatePassDate').value || new Date().toISOString().split('T')[0];

    if (!studentName || !registrationNumber || !roomNumber || !reason || !gateDate) {
        showToast('Please complete the gate-pass form before submitting.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/gate-passes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student: studentName,
                email: currentUser?.email || '',
                registrationNumber,
                hostelBlock,
                roomNumber,
                reason,
                session,
                gateDate
            })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to submit gate pass (${response.status}).`, 'error');
            return;
        }

        showToast(`Gate pass submitted successfully! ID: ${data.id}`, 'success');
        form.reset();
        if (currentUser) {
            fillStudentForm(currentUser);
        }
        loadLandingStats();
        navigateTo('student-dashboard');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function handleLaundrySubmit(e) {
    e.preventDefault();
    const form = e.target;
    const studentName = document.getElementById('laundryStudentName').value.trim();
    const registrationNumber = document.getElementById('laundryRegistrationNumber').value.trim();
    const hostelBlock = document.getElementById('laundryHostelBlock').value.trim();
    const roomNumber = document.getElementById('laundryRoomNumber').value.trim();
    const dressCount = parseInt(document.getElementById('laundryDressCount').value, 10);
    const pickupDate = document.getElementById('laundryPickupDate').value || new Date().toISOString().split('T')[0];
    const details = document.getElementById('laundryDetails').value.trim();

    if (!studentName || !registrationNumber || !dressCount || !details) {
        showToast('Please complete the laundry request form before submitting.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/laundry-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student: studentName,
                email: currentUser?.email || '',
                registrationNumber,
                hostelBlock,
                roomNumber,
                dressCount,
                pickupDate,
                details
            })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to submit laundry request (${response.status}).`, 'error');
            return;
        }

        showToast(`Laundry request submitted successfully! ID: ${data.id}`, 'success');
        form.reset();
        if (currentUser) {
            prepareLaundryForm();
        }
        navigateTo('student-dashboard');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function approveGatePass(gatePassId, status) {
    if (!gatePassId) return;
    showLoading();
    try {
        const response = await apiRequest(`/api/gate-passes/${encodeURIComponent(gatePassId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, approvedBy: currentUser?.name || 'Admin' })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to update gate pass (${response.status}).`, 'error');
            return;
        }

        showToast(`Gate pass ${status.toLowerCase()} successfully.`, 'success');
        await loadDashboardData();
        navigateTo('admin-dashboard');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

function handleFileSelect(input) {
    const preview = document.getElementById('uploadPreview');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.innerHTML = '<img src="' + e.target.result + '" class="max-h-32 mx-auto rounded-lg">';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function searchComplaint() {
    const queryInput = document.getElementById('complaintSearchInput');
    const searchValue = queryInput ? queryInput.value.trim() : '';
    const trackingResult = document.getElementById('trackingResult');

    if (!searchValue) {
        showToast('Please enter a complaint ID to search.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(searchValue)}`);
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            trackingResult.innerHTML = `<p class="text-danger font-semibold">${data.error || 'Complaint not found.'}</p>`;
            return;
        }

        trackingResult.innerHTML = renderTrackingResult(data);
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function loadDashboardData() {
    try {
        const [summaryResponse, complaintsResponse, techniciansResponse, gatePassesResponse] = await Promise.all([
            apiRequest('/api/summary'),
            apiRequest('/api/complaints'),
            apiRequest('/api/technicians'),
            apiRequest('/api/gate-passes')
        ]);

        const summary = await parseJsonResponse(summaryResponse);
        const complaints = await parseJsonResponse(complaintsResponse);
        const technicianList = await parseJsonResponse(techniciansResponse);
        const gatePasses = await parseJsonResponse(gatePassesResponse);

        if (!summaryResponse.ok || !complaintsResponse.ok || !techniciansResponse.ok || !gatePassesResponse.ok) {
            const failed = [
                !summaryResponse.ok && summary,
                !complaintsResponse.ok && complaints,
                !techniciansResponse.ok && technicianList,
                !gatePassesResponse.ok && gatePasses
            ].find(Boolean);
            throw new Error(failed?.error || 'Failed to load dashboard data.');
        }

        populateTechnicianDropdown(technicianList);

        const values = {
            landingTotalComplaints: summary.total || 0,
            landingResolvedToday: summary.resolvedToday || 0,
            landingPendingRequests: summary.pending || 0,
            landingActiveTechnicians: summary.activeTechnicians || 0
        };

        Object.entries(values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) {
                el.dataset.value = value;
                el.textContent = value.toLocaleString();
            }
        });

        updateStudentDashboardStats(summary);
        updateStudentRecentComplaints(complaints);
        renderTechAssignedComplaints(complaints);
        renderTechCompletedComplaints(complaints);
        renderTechSummary(complaints);
        renderAdminSummary(summary, complaints);
        renderGatePassTable(gatePasses);

        const gatePassCount = document.getElementById('adminGatePassCount');
        if (gatePassCount) gatePassCount.textContent = `${gatePasses.length}`;

        if (document.getElementById('page-landing')?.classList.contains('active')) {
            animateNumbers();
        }
    } catch (error) {
        console.error('Unable to load dashboard data:', error);
    }
}

function loadLandingStats() {
    return loadDashboardData();
}

function renderTrackingResult(complaint) {
    return `
        <div class="text-center mb-8">
            <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
                <i class="fa-solid fa-hashtag"></i> ${complaint.id}
            </div>
            <h2 class="text-xl font-bold mb-1">${complaint.category || 'Complaint'} - ${complaint.status}</h2>
            <p class="text-text-secondary text-sm">${complaint.roomNumber || 'Room N/A'} | Reported on ${new Date(complaint.createdAt).toLocaleDateString()}</p>
        </div>
        <div class="relative pl-8">
            <div class="timeline-line"></div>
            ${complaint.timeline.map((step, index) => `
                <div class="relative flex items-start gap-4">
                    <div class="absolute left-[-20px] w-10 h-10 rounded-full bg-emerald flex items-center justify-center text-white shadow-lg z-10">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    <div class="ml-6 flex-1">
                        <div class="glass rounded-xl p-4 border border-border">
                            <div class="flex items-center justify-between mb-2">
                                <h4 class="font-semibold">${step}</h4>
                                <span class="text-xs text-text-muted">Step ${index + 1}</span>
                            </div>
                            <p class="text-sm text-text-secondary">${index === 0 ? 'Complaint recorded in the system.' : 'Status updated.'}</p>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-3 items-end pointer-events-none';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-circle-xmark',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    toast.className = 'toast toast-' + (type || 'info');
    toast.style.pointerEvents = 'auto';
    toast.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i><span class="toast-message">' + message + '</span>';

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function showModal(title, content) {
    const overlay = document.getElementById('modalOverlay');
    const modalContent = document.getElementById('modalContent');
    modalContent.innerHTML = '<div class="p-6 border-b border-border flex items-center justify-between"><h3 class="font-semibold text-lg">' + title + '</h3><button onclick="closeModal()" class="w-8 h-8 rounded-lg hover:bg-surface-alt flex items-center justify-center transition-all"><i class="fa-solid fa-xmark text-text-secondary"></i></button></div><div class="p-6">' + content + '</div>';
    overlay.classList.add('active');
}

function openCCTVMonitoring() {
    const secureWarning = !window.isSecureContext ? '<div class="rounded-2xl border border-danger/20 bg-danger/5 p-4 text-danger text-sm">Camera access is blocked on file:// pages or insecure origins. Open the app from <strong>http://localhost:5000</strong> and reload this modal.</div>' : '';
    const content = `
        <div class="space-y-5 cctv-modal">
            <div class="modal-card rounded-[2rem] border border-border bg-surface-alt shadow-xl overflow-hidden">
                <div class="modal-card-header flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 class="font-semibold text-2xl">Hostel CCTV Live Monitoring</h4>
                        <p class="text-sm text-text-secondary mt-2 max-w-xl">Use your webcam for live room and hostel monitoring with real-time fire and smoke detection.</p>
                    </div>
                    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end w-full">
                        <button type="button" onclick="startLiveCCTV()" class="btn btn-primary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[11rem]">Start Live Camera</button>
                        <label class="btn btn-secondary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[11rem] text-center cursor-pointer">
                            Upload Video
                            <input id="cctvVideoUpload" type="file" accept="video/*" class="hidden" onchange="handleCCTVUpload(event)">
                        </label>
                        <button type="button" onclick="stopCCTVMonitoring()" class="btn btn-secondary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[11rem]">Stop Monitoring</button>
                    </div>
                </div>
            </div>
            ${secureWarning}
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
                <div class="cctv-card rounded-[1.75rem] border border-border bg-surface-alt shadow-lg overflow-hidden">
                    <div class="px-6 py-5 border-b border-border bg-white/90">
                        <h5 class="font-semibold text-lg">Camera or Uploaded Video Feed</h5>
                    </div>
                    <div class="relative bg-black aspect-video">
                        <video id="cctvVideoPlayer" class="w-full h-full object-cover" autoplay muted playsinline></video>
                        <div id="cctvOverlay" class="pointer-events-none absolute inset-0"></div>
                        <div id="cctvVideoWarning" class="absolute inset-0 flex items-center justify-center text-white text-center px-4 text-sm bg-black/70" style="display:none;">
                            Choose Start Live Camera or Upload Video.
                        </div>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Status</h5>
                        <p class="text-sm text-text-secondary" id="cctvModelStatus">Live camera ready. Click Start Live Camera to begin fire and smoke detection.</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Crowd Count</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="cctvCrowdCount">No crowd</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Detection Confidence</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="cctvAccuracy">N/A</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Speed</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="cctvSpeed">N/A</p>
                    </div>
                </div>
            </div>
            <div class="cctv-card rounded-[1.75rem] border border-border bg-surface-alt shadow-lg p-5">
                <div class="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
                    <h5 class="font-semibold">Detection Log</h5>
                    <button type="button" onclick="downloadCCTVDetectionLogPdf()" class="btn btn-secondary px-4 py-2 rounded-xl text-sm font-semibold self-start sm:self-auto">
                        <i class="fa-solid fa-file-pdf mr-2"></i>Download PDF
                    </button>
                </div>
                <pre id="cctvInferenceOutput" class="whitespace-pre-wrap text-sm text-text-secondary bg-white/90 rounded-2xl p-4 h-48 overflow-auto border border-border">Start live camera monitoring to see detections here.</pre>
            </div>
        </div>
    `;
    showModal('Hostel CCTV Live Monitoring', content);
    updateCCTVDetectionLogOutput();
}

async function startLiveCCTV() {
    await enableEmergencyBrowserNotifications();
    const statusEl = document.getElementById('cctvModelStatus');
    const warningEl = document.getElementById('cctvVideoWarning');
    const showWarning = (message) => {
        if (warningEl) {
            warningEl.textContent = message;
            warningEl.style.display = 'flex';
        }
    };
    const hideWarning = () => {
        if (warningEl) {
            warningEl.style.display = 'none';
        }
    };

    if (statusEl) {
        statusEl.textContent = 'Checking camera access...';
    }
    hideWarning();
    stopCCTVInference();
    releaseCCTVVideoUpload();

    cctvVideoElement = document.getElementById('cctvVideoPlayer');

    if (!window.isSecureContext) {
        if (statusEl) {
            statusEl.textContent = 'Camera access requires a secure origin. Open the app from http://localhost:5000 instead of file://.';
        }
        showWarning('Open the app using http://localhost:5000 so the browser can allow webcam access.');
        return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        if (statusEl) {
            statusEl.textContent = 'Camera access is not supported by this browser.';
        }
        showWarning('Your browser does not support webcam access. Use Chrome or Edge.');
        return;
    }

    let videoConstraints = { facingMode: 'user' };
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === 'videoinput');
        if (!videoDevices.length) {
            if (statusEl) {
                statusEl.textContent = 'No webcam detected. Please connect a camera and try again.';
            }
            showWarning('No webcam detected. Connect a camera and reload.');
            return;
        }
        if (videoDevices[0]?.deviceId) {
            videoConstraints = { deviceId: { exact: videoDevices[0].deviceId } };
        }
    } catch (error) {
        console.warn('Device enumeration failed:', error);
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        if (!stream) {
            throw new Error('No camera stream returned.');
        }

        if (cctvVideoElement) {
            cctvVideoElement.muted = true;
            cctvVideoElement.playsInline = true;
            cctvVideoElement.autoplay = true;
            cctvVideoElement.srcObject = stream;
            cctvVideoElement.style.backgroundColor = '#000';
            cctvVideoElement.style.visibility = 'visible';

            const track = stream.getVideoTracks()[0];
            if (track) {
                track.onended = () => {
                    showWarning('Camera stopped unexpectedly. Reopen the camera to continue detection.');
                    if (statusEl) {
                        statusEl.textContent = 'Camera feed ended unexpectedly.';
                    }
                };
                track.onmute = () => {
                    showWarning('Camera feed muted or unavailable. Please check camera permissions.');
                };
                track.onunmute = () => {
                    hideWarning();
                };
            }

            cctvVideoElement.onpause = () => {
                if (cctvVideoElement && cctvVideoElement.srcObject) {
                    cctvVideoElement.play().catch((pauseError) => {
                        console.warn('Camera feed paused, retrying playback:', pauseError);
                        showWarning('Camera paused unexpectedly. Click Start Live Camera again.');
                    });
                }
            };

            const onReady = async () => {
                if (cctvVideoElement.readyState < 2) {
                    return;
                }

                try {
                    await cctvVideoElement.play();
                } catch (playError) {
                    console.warn('Video playback failed:', playError);
                }

                hideWarning();
                if (statusEl) {
                    statusEl.textContent = 'Camera feed active. Detecting objects from frames...';
                }
                startCCTVInference(cctvVideoElement, document.getElementById('cctvInferenceOutput'), statusEl);
            };

            cctvVideoElement.removeEventListener('loadeddata', onReady);
            cctvVideoElement.removeEventListener('canplay', onReady);
            cctvVideoElement.removeEventListener('playing', onReady);

            cctvVideoElement.addEventListener('loadeddata', onReady, { once: true });
            cctvVideoElement.addEventListener('canplay', onReady, { once: true });
            cctvVideoElement.addEventListener('playing', onReady, { once: true });

            setTimeout(() => {
                if (cctvVideoElement && cctvVideoElement.readyState < 2) {
                    showWarning('Still waiting for camera feed. Please allow webcam permission or close other apps using the camera.');
                    if (statusEl) {
                        statusEl.textContent = 'Waiting for camera feed to start.';
                    }
                }
            }, 6000);
        }

        if (statusEl) {
            statusEl.textContent = 'Camera permission granted. Starting feed...';
        }
    } catch (error) {
        console.error('Camera access failed:', error);
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            showWarning('Camera permission denied. Allow camera access and try again.');
            if (statusEl) {
                statusEl.textContent = 'Camera permission denied. Allow camera access and try again.';
            }
        } else if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
            showWarning('No available camera found. Connect a webcam and retry.');
            if (statusEl) {
                statusEl.textContent = 'No available camera found. Connect a webcam and retry.';
            }
        } else {
            showWarning('Unable to start camera feed. Refresh the page and allow camera permission.');
            if (statusEl) {
                statusEl.textContent = 'Unable to access camera. Refresh and try again.';
            }
        }
    }
}

function releaseCCTVVideoUpload() {
    if (cctvVideoSourceUrl) {
        URL.revokeObjectURL(cctvVideoSourceUrl);
        cctvVideoSourceUrl = '';
    }
    if (cctvVideoElement && !cctvVideoElement.srcObject) {
        cctvVideoElement.removeAttribute('src');
        cctvVideoElement.load();
    }
}

function stopCCTVMonitoring() {
    stopCCTVInference();
    releaseCCTVVideoUpload();
    if (cctvVideoElement) {
        cctvVideoElement.pause();
        cctvVideoElement.style.visibility = 'hidden';
    }
    const statusEl = document.getElementById('cctvModelStatus');
    if (statusEl) {
        statusEl.textContent = 'CCTV monitoring stopped.';
    }
    appendCCTVDetectionLogEntry({
        sourceLabel: 'System',
        summary: 'Monitoring stopped by user.',
        confidenceText: 'N/A',
        speedText: 'N/A',
        personCount: 0,
        includeCrowd: true,
        predictions: []
    });
}

function handleCCTVUpload(event) {
    const file = event.target.files && event.target.files[0];
    const statusEl = document.getElementById('cctvModelStatus');
    const warningEl = document.getElementById('cctvVideoWarning');
    const video = document.getElementById('cctvVideoPlayer');
    event.target.value = '';

    if (!file || !video) {
        return;
    }
    if (!file.type.startsWith('video/')) {
        if (statusEl) statusEl.textContent = 'Please select a valid video file.';
        return;
    }

    stopCCTVInference();
    cctvVideoElement = video;
    releaseCCTVVideoUpload();
    cctvVideoSourceUrl = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = cctvVideoSourceUrl;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.onpause = null;

    if (warningEl) warningEl.style.display = 'none';
    if (statusEl) statusEl.textContent = `Loading ${file.name} for fire and smoke detection...`;

    video.onloadeddata = async () => {
        try {
            await video.play();
            if (statusEl) statusEl.textContent = 'Uploaded video active. Detecting fire and smoke from frames...';
            startCCTVInference(video, document.getElementById('cctvInferenceOutput'), statusEl, { sourceType: 'upload' });
        } catch (error) {
            console.error('Uploaded video playback failed:', error);
            if (statusEl) statusEl.textContent = 'Unable to play the uploaded video.';
        }
    };
    video.onended = () => {
        stopCCTVInference(false);
        if (statusEl) statusEl.textContent = 'Uploaded video finished. Detection stopped.';
    };
    video.onerror = () => {
        stopCCTVInference(false);
        if (statusEl) statusEl.textContent = 'Unable to load this video file.';
    };
}

function getCCTVFrameCaptureConfig(video, sourceType = 'live') {
    const maxWidth = sourceType === 'upload' ? CCTV_UPLOAD_CAPTURE_MAX_WIDTH : CCTV_LIVE_CAPTURE_MAX_WIDTH;
    const quality = sourceType === 'upload' ? 0.85 : 0.72;
    const intervalMs = sourceType === 'upload' ? CCTV_UPLOAD_INFERENCE_INTERVAL_MS : CCTV_LIVE_INFERENCE_INTERVAL_MS;
    const sourceWidth = Math.max(1, Number(video?.videoWidth) || 480);
    const sourceHeight = Math.max(1, Number(video?.videoHeight) || 360);
    const width = Math.min(maxWidth, sourceWidth);
    const height = Math.max(1, Math.round(width * (sourceHeight / sourceWidth)));
    return { width, height, quality, intervalMs };
}

function startCCTVInference(video, resultEl, statusEl, options = {}) {
    if (!video) return;
    stopCCTVInference(false);
    cctvInferenceInProgress = false;
    cctvFireDetectedState = false;
    cctvFireStableCount = 0;
    cctvNoFireStableCount = 0;
    cctvCrowdStableCount = 0;
    cctvCrowdAlertState = false;
    cctvCrowdAlertShown = false;
    cctvEmergencyAlertSent = false;
    cctvEmergencyAlertInFlight = false;
    cctvHazardStartedAt = null;
    resetCCTVDetectionLogs();
    const sourceType = options.sourceType === 'upload' ? 'upload' : 'live';
    const includeCrowd = true;
    const captureConfig = getCCTVFrameCaptureConfig(video, sourceType);
    const sourceLabel = sourceType === 'upload' ? 'Uploaded video' : 'Live camera';

    if (!cctvCanvas) {
        cctvCanvas = document.createElement('canvas');
    }
    cctvCanvas.width = captureConfig.width;
    cctvCanvas.height = captureConfig.height;

    const accuracyEl = document.getElementById('cctvAccuracy');
    const speedEl = document.getElementById('cctvSpeed');
    const crowdCountEl = document.getElementById('cctvCrowdCount');
    if (crowdCountEl) {
        crowdCountEl.textContent = 'No crowd';
    }

    cctvInferenceInterval = setInterval(async () => {
        if (cctvInferenceInProgress) {
            return;
        }
        if (video.readyState < 2) {
            return;
        }
        cctvInferenceInProgress = true;

        const ctx = cctvCanvas.getContext('2d');
        if (!ctx) {
            cctvInferenceInProgress = false;
            return;
        }

        ctx.drawImage(video, 0, 0, cctvCanvas.width, cctvCanvas.height);
        const imageDataUrl = cctvCanvas.toDataURL('image/jpeg', captureConfig.quality);
        const startTime = performance.now();

        try {
            const result = await requestCCTVInference(imageDataUrl, { sourceType, includeCrowd });
            const elapsed = performance.now() - startTime;
            const parsed = parseDetectionResult(result);
            const predictionEntries = parsed.predictions.map((item) => ({
                label: String(item.label || '').trim() || 'unknown',
                confidence: Number(item.confidence || item.score || item.conf || 0) || 0,
                box: item.box || null
            }));
            const crowd = includeCrowd && result && typeof result === 'object' ? result.crowd : null;
            const people = Array.isArray(crowd?.people) ? crowd.people.map((person) => ({
                label: 'person',
                confidence: Number(person.confidence) || 0,
                box: person.box || null,
                trackId: person.trackId
            })) : [];
            const personCount = Number(crowd?.personCount) || people.length;
            if (crowdCountEl) crowdCountEl.textContent = personCount > 0 ? `${personCount} people` : 'No crowd';
            renderCCTVBoxes([...predictionEntries, ...people]);
            const hazardCandidate = getBestHazardCandidate(predictionEntries, CCTV_REVIEW_CONFIDENCE);
            const hazardPrediction = FireDetectionUtils.getHazardPrediction(predictionEntries, cctvAlertConfidenceThreshold);
            const bestPrediction = predictionEntries.slice().sort((a, b) => b.confidence - a.confidence)[0];
            const confidence = hazardCandidate ? hazardCandidate.confidence : (bestPrediction ? bestPrediction.confidence : 0);
            if (hazardPrediction) {
                if (!cctvHazardStartedAt) cctvHazardStartedAt = Date.now();
                cctvFireStableCount = Math.floor((Date.now() - cctvHazardStartedAt) / 1000);
                cctvNoFireStableCount = 0;
            } else {
                cctvNoFireStableCount += 1;
                cctvFireStableCount = 0;
                cctvHazardStartedAt = null;
            }
            if (hazardPrediction && Date.now() - cctvHazardStartedAt >= CCTV_EMERGENCY_PERSIST_MS) {
                cctvFireDetectedState = true;
                sendTelegramEmergencyAlert(hazardPrediction, imageDataUrl);
            } else if (cctvNoFireStableCount >= 2) {
                cctvFireDetectedState = false;
            }

            if (includeCrowd && personCount >= CROWD_ALERT_THRESHOLD) {
                cctvCrowdStableCount += 1;
            } else {
                cctvCrowdStableCount = 0;
                cctvCrowdAlertState = false;
                cctvCrowdAlertShown = false;
            }
            if (cctvCrowdStableCount >= CROWD_ALERT_STABLE_FRAMES) {
                cctvCrowdAlertState = true;
                if (!cctvCrowdAlertShown) {
                    cctvCrowdAlertShown = true;
                    showToast(`Crowd alert: ${personCount} people detected in the CCTV feed.`, 'warning');
                }
            }

            if (statusEl) {
                if (cctvFireDetectedState) {
                    statusEl.textContent = `Emergency alert sent: ${hazardPrediction ? hazardPrediction.label : 'fire or smoke'} detected (${Math.round(confidence * 100)}%).`;
                } else if (hazardCandidate) {
                    statusEl.textContent = `Possible ${hazardCandidate.label} detected (${Math.round(hazardCandidate.confidence * 100)}%).`;
                } else if (includeCrowd && cctvCrowdAlertState) {
                    statusEl.textContent = `Crowd alert: ${personCount} people detected (threshold ${CROWD_ALERT_THRESHOLD}).`;
                } else if (bestPrediction) {
                    statusEl.textContent = `No fire or smoke confirmed. Current top detection: ${bestPrediction.label} (${Math.round(bestPrediction.confidence * 100)}%).`;
                } else {
                    statusEl.textContent = 'No detections returned from the current frame.';
                }
            }
            if (accuracyEl) {
                accuracyEl.textContent = `${Math.round(confidence * 100)}%`;
            }
            if (speedEl) {
                speedEl.textContent = `${Math.round(elapsed)} ms per frame`;
            }
            if (resultEl) {
                const summary = cctvFireDetectedState
                    ? 'Fire or smoke detected in frame.'
                    : hazardCandidate
                        ? `Possible ${hazardCandidate.label} detected. Watching for a stable high-confidence signal.`
                    : includeCrowd && cctvCrowdAlertState
                        ? `Crowd alert: ${personCount} people detected.`
                        : includeCrowd
                            ? `People detected: ${personCount}. No fire or smoke alert.`
                            : 'Upload scan active. No fire or smoke alert.';
                appendCCTVDetectionLogEntry({
                    sourceLabel,
                    summary,
                    confidenceText: `${Math.round(confidence * 100)}%`,
                    speedText: `${Math.round(elapsed)} ms per frame`,
                    personCount,
                    includeCrowd,
                    predictions: predictionEntries
                });
            }
        } catch (error) {
            console.error('CCTV inference request failed:', error);
            const message = error instanceof TypeError && error.message === 'Failed to fetch'
                ? 'Cannot reach the inference server. Run npm start, then open http://localhost:5000.'
                : error.message;
            if (statusEl) {
                statusEl.textContent = message;
            }
            if (resultEl) {
                resultEl.textContent = message;
            }
            if (accuracyEl) {
                accuracyEl.textContent = 'N/A';
            }
            if (speedEl) {
                speedEl.textContent = 'N/A';
            }
            appendCCTVDetectionLogEntry({
                sourceLabel,
                summary: message,
                confidenceText: 'N/A',
                speedText: 'N/A',
                personCount: 0,
                includeCrowd,
                predictions: []
            });
        } finally {
            cctvInferenceInProgress = false;
        }
    }, captureConfig.intervalMs);
}

function renderCCTVBoxes(predictions) {
    const overlay = document.getElementById('cctvOverlay');
    if (!overlay) return;

    overlay.replaceChildren();
    const frameWidth = cctvCanvas?.width || 480;
    const frameHeight = cctvCanvas?.height || 360;

    predictions.forEach((prediction) => {
        if (!Array.isArray(prediction.box) || prediction.box.length < 4) return;
        const [rawX, rawY, rawWidth, rawHeight] = prediction.box.map(Number);
        if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) || rawWidth <= 0 || rawHeight <= 0) return;

        const normalized = Math.max(rawX, rawY, rawWidth, rawHeight) <= 1;
        const left = normalized ? rawX * 100 : (rawX / frameWidth) * 100;
        const top = normalized ? rawY * 100 : (rawY / frameHeight) * 100;
        const width = normalized ? rawWidth * 100 : (rawWidth / frameWidth) * 100;
        const height = normalized ? rawHeight * 100 : (rawHeight / frameHeight) * 100;
        const safeLeft = Math.max(0, left);
        const safeTop = Math.max(0, top);
        const isFire = FireDetectionUtils.isFireLabel(prediction.label);
        const isSmoke = FireDetectionUtils.isSmokeLabel(prediction.label);
        const color = isFire ? '#ef4444' : isSmoke ? '#f97316' : '#22c55e';

        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${safeLeft}%;top:${safeTop}%;width:${Math.min(100 - safeLeft, width)}%;height:${Math.min(100 - safeTop, height)}%;border:3px solid ${color};box-shadow:0 0 0 1px rgba(255,255,255,.9);`;

        const label = document.createElement('span');
        const trackingLabel = prediction.trackId != null ? ` #${prediction.trackId}` : '';
        label.textContent = `${isFire || isSmoke ? 'ALERT: ' : ''}${prediction.label}${trackingLabel} ${Math.round(prediction.confidence * 100)}%`;
        label.style.cssText = `position:absolute;left:-3px;top:-28px;background:${color};color:#fff;padding:4px 7px;border-radius:6px 6px 6px 0;font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;`;
        box.appendChild(label);
        overlay.appendChild(box);
    });
}

function calculateConfidence(parsed) {
    if (!parsed) {
        return 0;
    }

    if (parsed.predictions && parsed.predictions.length > 0) {
        const confidences = parsed.predictions.map((item) => Number(item.confidence) || 0);
        const maxConfidence = Math.max(...confidences, 0);
        return Math.min(100, Math.max(0, Math.round(maxConfidence * 100)));
    }

    if (parsed.labels && parsed.labels.length > 0) {
        return 50;
    }

    return 0;
}

function getBestHazardCandidate(predictions, threshold = CCTV_REVIEW_CONFIDENCE) {
    return FireDetectionUtils.getHazardPrediction(predictions, threshold);
}

function stopCCTVInference(stopStream = true) {
    if (cctvInferenceInterval) {
        clearInterval(cctvInferenceInterval);
        cctvInferenceInterval = null;
    }

    if (stopStream && cctvVideoElement && cctvVideoElement.srcObject) {
        const tracks = cctvVideoElement.srcObject.getTracks();
        tracks.forEach((track) => track.stop());
        cctvVideoElement.srcObject = null;
    }

    if (stopStream && cctvVideoElement && !cctvVideoElement.srcObject) {
        releaseCCTVVideoUpload();
    }

    cctvInferenceInProgress = false;
    renderCCTVBoxes([]);
}

function parseDetectionResult(result) {
    if (result == null) {
        return { labels: [], boxes: [], predictions: [] };
    }

    if (typeof result === 'object' && !Array.isArray(result)) {
        if (result.result !== undefined && result.predictions === undefined) {
            return parseDetectionResult(result.result);
        }
        if (result.debug && result.result !== undefined) {
            return parseDetectionResult(result.result);
        }
    }

    if (typeof result === 'string') {
        return { labels: [result], boxes: [], predictions: [{ label: result, confidence: 0 }] };
    }

    const labels = [];
    const boxes = [];
    const predictions = [];

    if (Array.isArray(result)) {
        result.forEach((item) => {
            if (item && typeof item === 'object') {
                if (Array.isArray(item) && item.length === 0) return;
                if (item.predictions && Array.isArray(item.predictions)) {
                    item.predictions.forEach((prediction) => {
                        if (prediction.label) labels.push(prediction.label);
                        if (prediction.box) boxes.push(prediction.box);
                        predictions.push({
                            label: prediction.label || String(prediction.name || ''),
                            confidence: Number(prediction.confidence || prediction.score || 0) || 0,
                            box: prediction.box || prediction.bbox || null
                        });
                    });
                } else if (item.labels || item.boxes) {
                    if (item.labels) labels.push(...[].concat(item.labels));
                    if (item.boxes) boxes.push(...[].concat(item.boxes));
                } else if (item.label || item.name) {
                    labels.push(item.label || item.name);
                    predictions.push({
                        label: item.label || item.name,
                        confidence: Number(item.confidence || item.score || 0) || 0,
                        box: item.box || item.bbox || null
                    });
                }
            }
        });
        return { labels, boxes, predictions };
    }

    if (typeof result === 'object') {
        if (result.predictions && Array.isArray(result.predictions)) {
            result.predictions.forEach((item) => {
                if (!item) return;
                const label = item.label || item.name || String(item.class || item.cls || 'object');
                const confidence = Number(item.confidence || item.score || item.conf || 0) || 0;
                const box = item.box || item.bbox || item.boundingBox || null;
                labels.push(label);
                if (box) boxes.push(box);
                predictions.push({ label, confidence, box });
            });
        }
        if (result.labels) {
            labels.push(...[].concat(result.labels));
        }
        if (result.label) {
            labels.push(result.label);
        }
        if (result.name) {
            labels.push(result.name);
        }
        if (result.boxes) {
            boxes.push(...[].concat(result.boxes));
        }
        if (result.bboxes) {
            boxes.push(...[].concat(result.bboxes));
        }
        return { labels, boxes, predictions };
    }

    return { labels: [String(result)], boxes: [], predictions: [{ label: String(result), confidence: 0 }] };
}

function formatInferenceResult(result) {
    if (!result) {
        return 'No inference result returned.';
    }

    if (typeof result === 'string') {
        return result;
    }

    if (Array.isArray(result)) {
        const parsed = parseDetectionResult(result);
        if (parsed.labels.length > 0) {
            return parsed.labels.map((label, index) => `- ${label}${parsed.boxes[index] ? ` (${JSON.stringify(parsed.boxes[index])})` : ''}`).join('\n');
        }
        return result.map((item, index) => `Frame ${index + 1}: ${JSON.stringify(item)}`).join('\n\n');
    }

    if (typeof result === 'object') {
        const parsed = parseDetectionResult(result);
        if (parsed.labels.length > 0) {
            return parsed.labels.map((label, index) => `- ${label}${parsed.boxes[index] ? ` (${JSON.stringify(parsed.boxes[index])})` : ''}`).join('\n');
        }
        if (parsed.boxes.length > 0) {
            return parsed.boxes.map((box, index) => `- Bounding box #${index + 1}: ${JSON.stringify(box)}`).join('\n');
        }
        if (result.debug) {
            return [
                'Debug inference response:',
                `stdout: ${result.stdout || ''}`,
                `stderr: ${result.stderr || ''}`,
                `result: ${JSON.stringify(result.result || {})}`
            ].join('\n\n');
        }
        return Object.entries(result)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join('\n');
    }

    return String(result);
}

function closeModal() {
    stopCCTVInference();
    const video = document.getElementById('cctvVideoPlayer');
    if (video) {
        video.pause();
    }
    releaseCCTVVideoUpload();
    cctvVideoElement = null;
    document.getElementById('modalOverlay').classList.remove('active');
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
        closeAnnouncementPopup();
        closeAnnouncementModal();
    }
});

function animateNumbers() {
    const stats = [
        { id: 'landingTotalComplaints', target: parseInt(document.getElementById('landingTotalComplaints')?.dataset.value || '0', 10) },
        { id: 'landingResolvedToday', target: parseInt(document.getElementById('landingResolvedToday')?.dataset.value || '0', 10) },
        { id: 'landingPendingRequests', target: parseInt(document.getElementById('landingPendingRequests')?.dataset.value || '0', 10) },
        { id: 'landingActiveTechnicians', target: parseInt(document.getElementById('landingActiveTechnicians')?.dataset.value || '0', 10) }
    ];
    stats.forEach(stat => {
        const el = document.getElementById(stat.id);
        if (!el || Number.isNaN(stat.target)) return;
        let current = 0;
        const increment = Math.max(stat.target / 50, 1);
        const timer = setInterval(() => {
            current += increment;
            if (current >= stat.target) {
                current = stat.target;
                clearInterval(timer);
            }
            el.textContent = Math.floor(current).toLocaleString();
        }, 30);
    });
}

const landingObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.target.id === 'page-landing' && mutation.target.classList.contains('active')) {
            setTimeout(animateNumbers, 500);
        }
    });
});

document.addEventListener('DOMContentLoaded', function() {
    const landing = document.getElementById('page-landing');
    if (landing) landingObserver.observe(landing, { attributes: true, attributeFilter: ['class'] });

    if (restoreCurrentUser()) {
        updateNavAfterLogin();
        updateSidebarIdentity();
    } else {
        resetNavAfterLogout();
    }

    loadDashboardData();
    fetchAnnouncements();
    setupAnnouncementSocket();
    if (landing && landing.classList.contains('active')) {
        setTimeout(animateNumbers, 500);
    }
});



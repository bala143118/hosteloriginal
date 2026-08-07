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
const CCTV_FIRE_ALERT_CONFIDENCE = 0.4;
const CCTV_SMOKE_ALERT_CONFIDENCE = 0.65;
const CCTV_FIRE_EMERGENCY_PERSIST_MS = 150;
const CCTV_SMOKE_EMERGENCY_PERSIST_MS = 1200;
const CROWD_ALERT_THRESHOLD = 20;
const CROWD_ALERT_STABLE_FRAMES = 3;
const CCTV_LIVE_CAPTURE_MAX_WIDTH = 640;
const CCTV_UPLOAD_CAPTURE_MAX_WIDTH = 960;
const CCTV_LIVE_INFERENCE_INTERVAL_MS = 700;
const CCTV_UPLOAD_INFERENCE_INTERVAL_MS = 350;
const FACE_AUTH_INFERENCE_API = '/api/face-auth-inference';
const FACE_AUTH_LIVE_CAPTURE_MAX_WIDTH = 960;
const FACE_AUTH_UPLOAD_CAPTURE_MAX_WIDTH = 1280;
const FACE_AUTH_LIVE_INFERENCE_INTERVAL_MS = 650;
const FACE_AUTH_UPLOAD_INFERENCE_INTERVAL_MS = 320;
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
let cctvFireHazardStartedAt = null;
let cctvSmokeHazardStartedAt = null;
let cctvDetectionLogEntries = [];
let cctvDetectionSessionStartedAt = null;
let showAllAdminGatePassRows = false;
let faceAuthInferenceInterval = null;
let faceAuthCanvas = null;
let faceAuthVideoSourceUrl = '';
let faceAuthVideoElement = null;
let faceAuthInferenceInProgress = false;
let faceAuthUnauthorizedAlertShown = false;
let faceAuthDetectionLogEntries = [];
let faceAuthDetectionSessionStartedAt = null;

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

function formatFaceAuthTimestamp(date = new Date()) {
    return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'medium'
    }).format(date);
}

function resetFaceAuthDetectionLogs() {
    faceAuthDetectionLogEntries = [];
    faceAuthDetectionSessionStartedAt = new Date().toISOString();
    updateFaceAuthDetectionLogOutput();
}

function appendFaceAuthDetectionLogEntry(entry) {
    faceAuthDetectionLogEntries.push({
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString()
    });
    updateFaceAuthDetectionLogOutput();
}

function updateFaceAuthDetectionLogOutput() {
    const resultEl = document.getElementById('faceAuthInferenceOutput');
    if (!resultEl) return;

    if (!faceAuthDetectionLogEntries.length) {
        resultEl.textContent = 'Start face authentication monitoring to see verification results here.';
        return;
    }

    const logText = faceAuthDetectionLogEntries.slice(-60).map((entry, index) => {
        const faceLine = Number(entry.faceCount) > 0 ? `Faces detected: ${entry.faceCount}` : 'No faces detected';
        return `[${formatFaceAuthTimestamp(new Date(entry.timestamp))}] Entry ${index + 1}
Source: ${entry.sourceLabel}
Status: ${entry.summary}
Confidence: ${entry.confidenceText}
Speed: ${entry.speedText}
Authorized: ${entry.authorizedCount}
Unauthorized: ${entry.unauthorizedCount}
${faceLine}`;
    }).join('\n\n');

    resultEl.textContent = logText;
    resultEl.scrollTop = resultEl.scrollHeight;
}

async function requestFaceAuthInference(imageDataUrl, options = {}) {
    const response = await apiRequest(FACE_AUTH_INFERENCE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image: imageDataUrl,
            reloadKnownFaces: options.reloadKnownFaces === true
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown face authentication error.' }));
        if (response.status === 404 && /API route not found/i.test(String(errorData.error || ''))) {
            throw new Error('Face authentication API route is missing. Restart the Node server and reload the page.');
        }
        throw new Error(errorData.error || 'Face authentication request failed.');
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

async function getPreferredVideoConstraints() {
    const fallbackConstraints = [
        { video: true, audio: false },
        { video: { facingMode: 'user' }, audio: false },
        { video: { facingMode: { ideal: 'environment' } }, audio: false }
    ];

    if (!navigator.mediaDevices?.enumerateDevices) {
        return fallbackConstraints;
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === 'videoinput');
        if (!videoDevices.length) {
            return [];
        }

        const preferredConstraints = [];
        const nonVirtualDevice = videoDevices.find((device) => {
            const label = String(device.label || '').toLowerCase();
            return !/(virtual|obs|snap|manycam|droidcam|epoccam|iriun)/i.test(label);
        });

        if (nonVirtualDevice?.deviceId) {
            preferredConstraints.push({ video: { deviceId: { exact: nonVirtualDevice.deviceId } }, audio: false });
        }
        preferredConstraints.push(...fallbackConstraints);
        return preferredConstraints;
    } catch (error) {
        console.warn('Device enumeration failed:', error);
        return fallbackConstraints;
    }
}

async function requestCameraStream() {
    const constraintCandidates = await getPreferredVideoConstraints();
    if (!constraintCandidates.length) {
        throw new Error('NO_CAMERA_DEVICES');
    }

    let lastError = null;
    for (const constraints of constraintCandidates) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
            lastError = error;
            const retryableErrors = ['OverconstrainedError', 'NotFoundError', 'AbortError'];
            if (!retryableErrors.includes(error?.name)) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Unable to access camera.');
}

function describeCameraError(error) {
    if (error?.message === 'NO_CAMERA_DEVICES') {
        return {
            warning: 'No webcam detected. Connect a camera and reload.',
            status: 'No webcam detected. Please connect a camera and try again.'
        };
    }

    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        return {
            warning: 'Camera permission denied. Allow camera access in the browser and try again.',
            status: 'Camera permission denied. Allow camera access and try again.'
        };
    }

    if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
        return {
            warning: 'The camera is busy in another app. Close Teams, WhatsApp, Zoom, Camera, or other apps using the webcam and try again.',
            status: 'Camera is already in use by another application.'
        };
    }

    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
        return {
            warning: 'No available camera found. Connect a webcam and retry.',
            status: 'No available camera found. Connect a webcam and retry.'
        };
    }

    return {
        warning: `Unable to start camera feed. ${error?.name ? `(${error.name}) ` : ''}Refresh the page and allow camera permission.`,
        status: `Unable to access camera.${error?.name ? ` ${error.name}.` : ''}`
    };
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
        const response = await apiRequest('/api/send-telegram-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: prediction.detectionType || (FireDetectionUtils.isFireLabel(prediction.label) ? 'Fire' : 'Smoke'), confidence: prediction.confidence, camera: emergencyAlertCameraName, location: emergencyAlertCameraLocation, image: imageDataUrl }) });
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
        'admin-dashboard': 'admin',
        'warden-dashboard': 'warden',
        'security-dashboard': 'security'
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

    if (pageId === 'login') {
        const loginForm = document.querySelector('#page-login form');
        if (loginForm) loginForm.reset();
    }

    if (pageId === 'register') {
        const registerForm = document.querySelector('#page-register form');
        if (registerForm) registerForm.reset();
    }

    if (pageId === 'complaint-registration') {
        prepareComplaintForm();
    }

    if (pageId === 'gate-pass') {
        if (currentUser) {
            fillStudentForm(currentUser);
        } else {
            clearGatePassPhotoSelection(false);
        }
        updateGatePassAssignedWarden().catch(e=>console.error(e));
        setTimeout(setupCustomDatePickers, 50);
    }

    if (pageId === 'laundry') {
        prepareLaundryForm();
        setTimeout(setupCustomDatePickers, 50);
    }

    if (pageId === 'complaint-tracking') {
        prepareComplaintTracking();
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

    if (pageId === 'admin-wardens') {
        loadWardensList().catch((error) => console.error(error));
    }

    if (pageId === 'admin-technicians') {
        loadTechniciansList().catch((error) => console.error(error));
    }

    if (pageId.startsWith('admin-') || pageId.startsWith('technician-')) {
        loadDashboardData().catch((error) => console.error(error));
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
let latestComplaints = [];
let latestGatePasses = [];
let latestLaundryRequests = [];
let latestSubmittedGatePass = null;
let currentGatePassPhotoDataUrl = '';
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

function getStudentNotificationQuery() {
    if (!currentUser || currentUser.role !== 'student') return '';
    const params = new URLSearchParams();
    if (currentUser.email) params.set('email', currentUser.email);
    if (currentUser.name) params.set('name', currentUser.name);
    if (currentUser.registrationNumber) params.set('registrationNumber', currentUser.registrationNumber);
    if (currentUser.userId) params.set('userId', currentUser.userId);
    return params.toString();
}

function isNotificationForCurrentUser(notification) {
    if (!currentUser || currentUser.role !== 'student' || !notification) return false;
    const currentEmail = normalizeText(currentUser.email);
    const currentName = normalizeText(currentUser.name);
    const currentRegistrationNumber = normalizeText(currentUser.registrationNumber);
    const currentUserId = normalizeText(currentUser.userId);

    return (
        (currentEmail && normalizeText(notification.targetEmail) === currentEmail)
        || (currentName && normalizeText(notification.targetName) === currentName)
        || (currentRegistrationNumber && normalizeText(notification.targetRegistrationNumber) === currentRegistrationNumber)
        || (currentUserId && normalizeText(notification.targetUserId) === currentUserId)
    );
}

function getStudentProfileFromActivity() {
    if (!currentUser) return null;

    const matchesCurrentUser = (entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const currentEmail = normalizeText(currentUser.email);
        const currentName = normalizeText(currentUser.name);
        return (
            (currentEmail && normalizeText(entry.email) === currentEmail)
            || (currentName && normalizeText(entry.student) === currentName)
        );
    };

    const complaintMatch = latestComplaints.find(matchesCurrentUser);
    const gatePassMatch = latestGatePasses.find(matchesCurrentUser);
    const laundryMatch = latestLaundryRequests.find(matchesCurrentUser);
    const source = complaintMatch || gatePassMatch || laundryMatch;

    if (!source) return null;

    return {
        registrationNumber: source.registrationNumber || currentUser.registrationNumber || '',
        hostelBlock: source.hostelBlock || currentUser.hostelBlock || '',
        roomNumber: source.roomNumber || currentUser.roomNumber || ''
    };
}

function isGatePassForCurrentUser(entry) {
    if (!currentUser || !entry || typeof entry !== 'object') return false;

    const currentEmail = normalizeText(currentUser.email);
    const currentName = normalizeText(currentUser.name);
    const currentRegistrationNumber = normalizeText(currentUser.registrationNumber);
    const currentUserId = normalizeText(currentUser.userId);

    return (
        (currentEmail && normalizeText(entry.email) === currentEmail)
        || (currentName && normalizeText(entry.student) === currentName)
        || (currentRegistrationNumber && normalizeText(entry.registrationNumber) === currentRegistrationNumber)
        || (currentUserId && normalizeText(entry.userId) === currentUserId)
    );
}

function getLatestSubmittedGatePass() {
    if (latestSubmittedGatePass && isGatePassForCurrentUser(latestSubmittedGatePass)) {
        return latestSubmittedGatePass;
    }

    return latestGatePasses.find(isGatePassForCurrentUser) || null;
}

function syncCurrentUserStudentProfile() {
    if (!currentUser || currentUser.role !== 'student') return;
    const derived = getStudentProfileFromActivity();
    if (!derived) return;

    let changed = false;
    ['registrationNumber', 'hostelBlock', 'roomNumber'].forEach((field) => {
        if (!currentUser[field] && derived[field]) {
            currentUser[field] = derived[field];
            changed = true;
        }
    });

    if (changed) {
        persistCurrentUser();
    }
}

function prepareComplaintForm() {
    const studentNameInput = document.getElementById('complaintStudentName');
    const regInput = document.getElementById('complaintRegistrationNumber');
    const roomInput = document.getElementById('complaintRoomNumber');
    const hostelBlockInput = document.getElementById('complaintHostelBlock');

    if (studentNameInput) {
        studentNameInput.readOnly = false;
        studentNameInput.value = '';
    }
    if (regInput) {
        regInput.readOnly = false;
        regInput.value = '';
    }
    if (roomInput) {
        roomInput.readOnly = false;
        roomInput.value = '';
    }
    if (hostelBlockInput) {
        hostelBlockInput.disabled = false;
        hostelBlockInput.value = 'Block A';
    }
}

function prepareLaundryForm() {
    const studentNameInput = document.getElementById('laundryStudentName');
    const regInput = document.getElementById('laundryRegistrationNumber');
    const blockInput = document.getElementById('laundryHostelBlock');
    const roomInput = document.getElementById('laundryRoomNumber');

    if (studentNameInput) studentNameInput.value = '';
    if (regInput) regInput.value = '';
    if (blockInput) blockInput.value = '';
    if (roomInput) roomInput.value = '';
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
    if (hostelBlockInput) hostelBlockInput.value = user.hostelBlock || 'Block A';
    if (gatePassStudentNameInput) gatePassStudentNameInput.value = '';
    if (gatePassRegInput) gatePassRegInput.value = '';
    if (gatePassRoomInput) gatePassRoomInput.value = '';
    if (gatePassHostelBlockInput) gatePassHostelBlockInput.value = '';
    if (studentWelcomeText) studentWelcomeText.textContent = `Welcome back, ${user.name || 'Student'}! Here is your overview.`;
    clearGatePassPhotoSelection(false);
}

async function updateGatePassAssignedWarden() {
    const blockSelect = document.getElementById('gatePassHostelBlock');
    const wardenText = document.getElementById('gatePassAssignedWardenText');
    if (!wardenText) return;
    const selectedBlock = blockSelect?.value || currentUser?.hostelBlock || 'Block A';
    try {
        const response = await apiRequest('/api/wardens');
        if (response.ok) {
            const wardens = await parseJsonResponse(response);
            const blockWarden = Array.isArray(wardens) 
                ? (wardens.find(w => normalizeText(w.hostelBlock) === normalizeText(selectedBlock)) || wardens[0])
                : null;
            if (blockWarden) {
                wardenText.innerHTML = `<strong class="text-indigo-600 font-bold">${blockWarden.name}</strong> <span class="text-xs font-medium text-text-secondary">(${blockWarden.hostelBlock || selectedBlock} Oversight • ${blockWarden.email} • ${blockWarden.phone || '+91 98765 43210'})</span>`;
                return;
            }
        }
    } catch (e) {
        console.error(e);
    }
    wardenText.textContent = `Duty Warden (${selectedBlock} Oversight)`;
}

function renderGatePassPhotoPreview(photoDataUrl = '') {
    const preview = document.getElementById('gatePassPhotoPreview');
    if (!preview) return;

    if (photoDataUrl) {
        preview.innerHTML = `
            <img src="${photoDataUrl}" alt="Student photo preview" class="w-full h-full object-cover">
            <button type="button" onclick="clearGatePassPhotoSelection(false)" title="Remove photo" class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-slate-900/85 hover:bg-rose-600 text-white flex items-center justify-center text-[10px] shadow-sm transition-all focus:outline-none z-10 border border-white/20">
                <i class="fa-solid fa-xmark"></i>
            </button>`;
        return;
    }

    preview.textContent = 'No photo';
}

function syncGatePassPhotoFromProfile(force = false) {
    const profilePhoto = getCurrentUserProfileImage();
    if (!force && currentGatePassPhotoDataUrl) {
        renderGatePassPhotoPreview(currentGatePassPhotoDataUrl);
        return;
    }

    currentGatePassPhotoDataUrl = profilePhoto || '';
    renderGatePassPhotoPreview(currentGatePassPhotoDataUrl);
}

function clearGatePassPhotoSelection(useProfileFallback = false) {
    currentGatePassPhotoDataUrl = '';
    const input = document.getElementById('gatePassPhoto');
    if (input) input.value = '';
    if (useProfileFallback) {
        syncGatePassPhotoFromProfile(true);
        return;
    }
    renderGatePassPhotoPreview('');
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Unable to read the selected image.'));
        reader.readAsDataURL(file);
    });
}

function loadImageElement(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Unable to load the selected image.'));
        image.src = source;
    });
}

async function resizeImageToJpeg(file, maxSize = 640, quality = 0.82) {
    const objectUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
        loadImageElement(objectUrl)
            .then((image) => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext('2d');
                if (!context) {
                    throw new Error('Unable to process the selected image.');
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            })
            .catch(reject)
            .finally(() => {
                URL.revokeObjectURL(objectUrl);
            });
    });
}

async function handleGatePassPhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
        clearGatePassPhotoSelection(false);
        return;
    }

    if (!file.type.startsWith('image/')) {
        showToast('Please choose a valid image file for the student photo.', 'warning');
        clearGatePassPhotoSelection(false);
        return;
    }

    try {
        currentGatePassPhotoDataUrl = await resizeImageToJpeg(file);
        renderGatePassPhotoPreview(currentGatePassPhotoDataUrl);
        showToast('Student photo added successfully.', 'success');
    } catch (error) {
        console.error('Gate pass photo processing failed:', error);
        try {
            currentGatePassPhotoDataUrl = await readFileAsDataUrl(file);
            renderGatePassPhotoPreview(currentGatePassPhotoDataUrl);
            showToast('Student photo added successfully.', 'success');
        } catch (fallbackError) {
            console.error('Gate pass photo fallback failed:', fallbackError);
            clearGatePassPhotoSelection(false);
            showToast('Unable to process that student photo.', 'error');
        }
    }
}

function getComplaintStudentProfile() {
    return {
        name: document.getElementById('complaintStudentName')?.value.trim() || '',
        registrationNumber: document.getElementById('complaintRegistrationNumber')?.value.trim() || '',
        hostelBlock: document.getElementById('complaintHostelBlock')?.value || 'Unknown',
        roomNumber: document.getElementById('complaintRoomNumber')?.value.trim() || ''
    };
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
        list.innerHTML = `
            <div class="glass rounded-2xl border border-border p-12 text-center text-text-secondary">
                <i class="fa-solid fa-bell-slash text-2xl mb-3 text-text-muted"></i>
                <p class="text-sm font-semibold text-text">No notifications yet</p>
                <p class="text-xs mt-1 text-text-secondary">Gate pass approvals and admin notices will appear here.</p>
            </div>`;
        renderDashboardAnnouncements();
        return;
    }

    list.innerHTML = studentNotifications.map((announcement) => {
        const isEmergency = announcement.priority === 'Emergency';
        const isImportant = announcement.priority === 'Important';
        const unreadBadge = announcement.read ? '' : '<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-bold tracking-wide">NEW</span>';
        
        const priorityBadge = isEmergency 
            ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-danger text-white">Emergency</span>'
            : isImportant 
                ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">Important</span>'
                : '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-surface-alt text-text-secondary border border-border">Normal</span>';

        const iconClass = isEmergency
            ? 'fa-triangle-exclamation text-danger bg-danger/10'
            : isImportant
                ? 'fa-circle-exclamation text-amber-600 bg-amber-500/10'
                : 'fa-bell text-primary bg-primary/10';

        const iconName = isEmergency ? 'fa-triangle-exclamation' : isImportant ? 'fa-circle-exclamation' : 'fa-bell';

        return `
            <div class="glass rounded-2xl border border-border p-4 sm:p-5 shadow-xs transition-all hover:border-border/80 ${isEmergency ? 'border-danger/30 bg-danger/[0.02]' : ''}">
                <div class="flex items-start gap-3.5">
                    <div class="w-8 h-8 rounded-xl ${iconClass} flex items-center justify-center text-xs shrink-0 mt-0.5">
                        <i class="fa-solid ${iconName}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-[10px] font-bold tracking-wider text-text-secondary uppercase bg-surface-alt px-2 py-0.5 rounded-md border border-border/60">${announcement.audience || 'All Students'}</span>
                                <h3 class="text-sm font-semibold text-text">${announcement.title || 'Notification'}</h3>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                                ${unreadBadge}
                                ${priorityBadge}
                            </div>
                        </div>
                        <p class="text-xs text-text-secondary leading-relaxed mb-2">${announcement.message || ''}</p>
                        <p class="text-[11px] text-text-muted flex items-center gap-1.5">
                            <i class="fa-regular fa-clock text-[10px]"></i>
                            <span>${announcement.adminName || 'Gate Pass System'}</span>
                            <span>•</span>
                            <span>${new Date(announcement.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function markAllNotificationsRead() {
    studentNotifications = studentNotifications.map((item) => ({ ...item, read: true }));
    updateNotificationBadge();
    renderStudentNotifications();
    renderDashboardAnnouncements();
    showToast('All notifications marked as read.', 'success');
}

function renderDashboardAnnouncements() {
    const container = document.getElementById('studentDashboardAnnouncementsList');
    if (!container) return;

    if (!studentNotifications.length) {
        container.innerHTML = '<div class="text-sm text-text-secondary">No notifications yet. Gate pass approvals and admin notices will appear here with a badge.</div>';
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

async function fetchStudentNotifications() {
    if (!currentUser || currentUser.role !== 'student') return;

    const query = getStudentNotificationQuery();
    if (!query) return;

    try {
        const response = await apiRequest(`/api/student-notifications?${query}`);
        const data = await parseJsonResponse(response);
        if (!response.ok) {
            console.warn('Failed to load student notifications:', data.error || response.status);
            return;
        }
        mergeAnnouncements(Array.isArray(data) ? data : []);
        updateNotificationBadge();
        renderDashboardAnnouncements();
        if (getActivePageId() === 'notifications') {
            renderStudentNotifications();
        }
    } catch (error) {
        console.error('Student notification fetch failed:', error);
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
        announcementSocket.on('student-notification.created', (notification) => {
            if (!notification || !notification.id || !isNotificationForCurrentUser(notification)) return;
            mergeAnnouncements([notification]);
            updateNotificationBadge();
            renderDashboardAnnouncements();
            playNotificationTone();
            showToast(notification.title || 'New notification received.', 'info');
            if (getActivePageId() === 'notifications') {
                renderStudentNotifications();
            }
        });
        announcementSocket.on('emergency-alert', (alert) => {
            if (!alert?.id || currentUser?.role !== 'admin') return;
            showEmergencyBrowserNotification(alert);
            if (getActivePageId() === 'admin-settings') loadAlertHistory().catch(console.error);
        });
        announcementSocket.on('gate-pass.created', (gatePass) => {
            if (!gatePass || !gatePass.id) return;
            latestGatePasses = [gatePass, ...latestGatePasses.filter((entry) => entry?.id !== gatePass.id)];
            renderGatePassTable(latestGatePasses);
            renderWardenDashboard();
            renderSecurityDashboard();
            const gatePassCount = document.getElementById('adminGatePassCount');
            if (gatePassCount) gatePassCount.textContent = `${latestGatePasses.length}`;
            if (currentUser?.role === 'admin' || currentUser?.role === 'warden') {
                showToast(`🔔 New Gate Pass request from ${gatePass.student || 'Student'} (${gatePass.hostelBlock || 'Hostel'})`, 'info');
            }
        });
        announcementSocket.on('complaint.created', (complaint) => {
            if (!complaint || !complaint.id) return;
            loadDashboardData().catch(console.error);
            if (currentUser?.role === 'admin' || currentUser?.role === 'technician') {
                showToast(`New complaint #${complaint.id} logged`, 'info');
            }
        });
        announcementSocket.on('complaint.updated', (complaint) => {
            if (!complaint || !complaint.id) return;
            loadDashboardData().catch(console.error);
            if (isComplaintForCurrentUser(complaint)) {
                showToast(`Complaint #${complaint.id} status updated to ${complaint.status}`, 'info');
            }
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
        if (data.telegramDelivered) {
            showToast('Live announcement sent successfully and shared to your Telegram bot.', 'success');
        } else if (data.telegramConfigured) {
            showToast('Live announcement was sent, but Telegram delivery could not be confirmed.', 'warning');
        } else {
            showToast('Live announcement sent successfully.', 'success');
        }
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

function formatGatePassDate(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getGatePassStatusClass(status = 'Pending') {
    const lower = String(status).toLowerCase();
    if (lower.includes('completed')) return 'badge-completed';
    if (lower.includes('returned')) return 'badge-low';
    if (lower === 'out') return 'badge-medium';
    if (lower.includes('generated')) return 'badge-medium';
    if (lower.includes('approved')) return 'badge-completed';
    if (lower.includes('rejected')) return 'badge-high';
    return 'badge-pending';
}

function renderStudentGatePassQr() {
    const card = document.getElementById('gatePassQrCard');
    if (!card) return;
    const pass = latestGatePasses.find(isGatePassForCurrentUser);
    if (!pass) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const status = pass.status || 'REQUESTED';
    const statusText = document.getElementById('gatePassQrStatus');
    const image = document.getElementById('gatePassQrImage');
    const expiry = document.getElementById('gatePassQrExpiry');
    const download = document.getElementById('downloadGatePassQrButton');
    const timeline = document.getElementById('gatePassTimeline');
    if (statusText) statusText.textContent = `${pass.id} · ${status}`;
    if (image) { image.src = pass.qrImage || ''; image.classList.toggle('hidden', !pass.qrImage); }
    if (expiry) expiry.textContent = pass.expiryDate ? `Valid until ${new Date(pass.expiryDate).toLocaleString()}` : 'QR appears after faculty approval.';
    if (download) download.classList.toggle('hidden', !pass.qrImage);
    if (timeline) {
        const steps = ['REQUESTED', 'QR GENERATED', 'OUT', 'RETURNED', 'COMPLETED'];
        const current = steps.indexOf(status);
        timeline.innerHTML = steps.map((step, index) => `<span class="px-2.5 py-1 rounded-full ${index <= current ? 'bg-primary/10 text-primary' : 'bg-surface-alt text-text-secondary'}">${step}</span>`).join('');
    }
}

function downloadGatePassQr() {
    const pass = latestGatePasses.find(isGatePassForCurrentUser);
    if (!pass?.qrImage) return showToast('Your QR code is not ready yet.', 'warning');
    const link = document.createElement('a'); link.href = pass.qrImage; link.download = `${pass.id}-qr.png`; link.click();
}

function toggleAdminGatePassSeeAll() {
    showAllAdminGatePassRows = !showAllAdminGatePassRows;
    renderGatePassTable(latestGatePasses);
}

function renderGatePassTable(gatePasses = []) {
    const tableBody = document.getElementById('adminGatePassTableBody');
    const seeAllButton = document.getElementById('adminGatePassSeeAllButton');
    renderStudentGatePassQr();
    if (!tableBody) return;

    const defaultVisibleRows = 4;

    if (!gatePasses.length) {
        tableBody.innerHTML = '<tr><td colspan="10" class="px-6 py-8 text-sm text-text-secondary text-center">No gate pass requests yet.</td></tr>';
        if (seeAllButton) seeAllButton.classList.add('hidden');
        return;
    }

    if (seeAllButton) {
        if (gatePasses.length > defaultVisibleRows) {
            seeAllButton.classList.remove('hidden');
            seeAllButton.textContent = showAllAdminGatePassRows ? 'Show less' : 'See all';
        } else {
            seeAllButton.classList.add('hidden');
        }
    }

    const visibleGatePasses = showAllAdminGatePassRows ? gatePasses : gatePasses.slice(0, defaultVisibleRows);

    tableBody.innerHTML = visibleGatePasses.map((entry) => `
        <tr class="table-row">
            <td class="px-6 py-4 text-sm font-medium">${entry.id || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${entry.student || 'Anonymous'}</td>
            <td class="px-6 py-4 text-sm">${entry.registrationNumber || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${entry.reason || 'General'}</td>
            <td class="px-6 py-4 text-sm">${entry.session || 'Morning'}</td>
            <td class="px-6 py-4 text-sm text-text-secondary">${formatGatePassDate(entry.gateDate)}</td>
            <td class="px-6 py-4 text-sm text-text-secondary">${formatGatePassDate(entry.returnDate)}</td>
            <td class="px-6 py-4"><span class="${getGatePassStatusClass(entry.status)} px-2.5 py-1 rounded-full text-xs font-medium">${entry.status || 'Pending'}</span></td>
            <td class="px-6 py-4 text-sm text-text-secondary">
                ${entry.studentPhoto
                    ? `<img src="${entry.studentPhoto}" alt="Student photo" class="w-12 h-12 rounded-xl object-cover border border-border">`
                    : '<span class="text-xs">No photo</span>'}
            </td>
            <td class="px-6 py-4 text-sm text-text-secondary">
                ${['pending', 'requested'].includes(String(entry.status || '').toLowerCase())
                    ? `<div class="flex flex-wrap gap-2"><button onclick="approveGatePass('${entry.id}', 'Approved')" class="px-3 py-2 rounded-lg bg-emerald text-white text-xs font-medium hover:bg-emerald-dark transition-all">Approve</button><button onclick="approveGatePass('${entry.id}', 'Rejected')" class="px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-surface-alt transition-all">Reject</button><button onclick="downloadGatePassPdf('${entry.id}')" class="px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-surface-alt transition-all">Download PDF</button></div>`
                    : `<div class="flex flex-wrap items-center gap-2"><span>${formatComplaintDate(entry.createdAt)}</span><button onclick="downloadGatePassPdf('${entry.id}')" class="px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-surface-alt transition-all">Download PDF</button></div>`}
            </td>
        </tr>
    `).join('');
}

function escapePdfTextForClient(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function wrapPdfTextForClient(text, width, fontSize) {
    const maxChars = Math.max(10, Math.floor(width / Math.max(fontSize * 0.52, 1)));
    const lines = [];
    String(text ?? '').split(/\r?\n/).forEach((rawLine) => {
        const line = rawLine.trimEnd();
        if (!line) {
            lines.push('');
            return;
        }
        let remaining = line;
        while (remaining.length > maxChars) {
            let splitAt = remaining.lastIndexOf(' ', maxChars);
            if (splitAt <= 0) splitAt = maxChars;
            lines.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trimStart();
        }
        lines.push(remaining);
    });
    return lines;
}

function getPdfImageAssetFromDataUrl(dataUrl) {
    return new Promise((resolve) => {
        if (!dataUrl) {
            resolve(null);
            return;
        }

        const image = new Image();
        image.onload = () => {
            const maxWidth = 220;
            const maxHeight = 220;
            const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.86);
            const base64 = jpegDataUrl.split(',')[1] || '';
            const binary = atob(base64);
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            resolve({
                bytes,
                width: canvas.width,
                height: canvas.height
            });
        };
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

async function createGatePassPdfBlob(gatePass) {
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 28;
    const objects = [];
    const addObject = (content) => {
        objects.push(content);
        return objects.length;
    };
    const rgb = (color) => color.map((value) => (value / 255).toFixed(3)).join(' ');
    const commands = [];
    let imageObjectId = null;

    const drawRect = (x, top, width, height, fillColor, strokeColor = null, lineWidth = 1) => {
        const bottom = pageHeight - top - height;
        if (fillColor) commands.push(`${rgb(fillColor)} rg`);
        if (strokeColor) commands.push(`${rgb(strokeColor)} RG`);
        if (strokeColor) commands.push(`${lineWidth} w`);
        commands.push(`${x} ${bottom} ${width} ${height} re ${fillColor && strokeColor ? 'B' : fillColor ? 'f' : 'S'}`);
    };
    const drawText = (text, x, top, options = {}) => {
        const {
            font = 'F1',
            size = 12,
            color = [15, 23, 42]
        } = options;
        const baseline = pageHeight - top - size;
        commands.push('BT');
        commands.push(`/${font} ${size} Tf`);
        commands.push(`${rgb(color)} rg`);
        commands.push(`1 0 0 1 ${x} ${baseline} Tm`);
        commands.push(`(${escapePdfTextForClient(text)}) Tj`);
        commands.push('ET');
    };
    const drawWrappedText = (text, x, top, width, options = {}) => {
        const { font = 'F1', size = 10, color = [15, 23, 42], lineHeight = size + 3 } = options;
        const lines = wrapPdfTextForClient(text, width, size);
        lines.forEach((line, index) => {
            drawText(line, x, top + (index * lineHeight), { font, size, color });
        });
        return lines.length * lineHeight;
    };
    const formatDateValue = (value) => {
        if (!value) return 'N/A';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });
    };

    const drawImage = (resourceName, x, top, width, height) => {
        if (!resourceName) return;
        const bottom = pageHeight - top - height;
        commands.push('q');
        commands.push(`${width} 0 0 ${height} ${x} ${bottom} cm`);
        commands.push(`/${resourceName} Do`);
        commands.push('Q');
    };

    const statusColor = String(gatePass.status || '').toLowerCase() === 'approved'
        ? [22, 163, 74]
        : String(gatePass.status || '').toLowerCase() === 'rejected'
            ? [220, 38, 38]
            : [202, 138, 4];
    const imageAsset = await getPdfImageAssetFromDataUrl(gatePass.studentPhoto);

    drawRect(0, 0, pageWidth, 78, [37, 99, 235]);
    drawText('HOSTEL GATE PASS', margin, 20, { font: 'F2', size: 20, color: [255, 255, 255] });
    drawText('Submitted request details', margin, 46, { size: 10, color: [219, 234, 254] });

    drawRect(margin, 96, pageWidth - (margin * 2), 56, [248, 250, 252], [203, 213, 225], 0.8);
    drawText('Gate Pass ID', margin + 14, 111, { font: 'F2', size: 9, color: [71, 85, 105] });
    drawText(gatePass.id || 'N/A', margin + 14, 126, { font: 'F2', size: 13, color: [15, 23, 42] });
    drawText('Submitted On', margin + 14, 139, { size: 8, color: [100, 116, 139] });
    drawText(new Date(gatePass.createdAt || Date.now()).toLocaleString('en-IN'), margin + 86, 139, {
        size: 8,
        color: [100, 116, 139]
    });
    drawText('Status', pageWidth - margin - 118, 111, { font: 'F2', size: 9, color: [71, 85, 105] });
    drawText(gatePass.status || 'Pending', pageWidth - margin - 118, 126, {
        font: 'F2',
        size: 13,
        color: statusColor
    });

    const fields = [
        ['Student Name', gatePass.student || 'N/A'],
        ['Register Number', gatePass.registrationNumber || 'N/A'],
        ['Hostel Block', gatePass.hostelBlock || 'N/A'],
        ['Room Number', gatePass.roomNumber || 'N/A'],
        ['Gate Pass Date', formatDateValue(gatePass.gateDate)],
        ['Return Date', formatDateValue(gatePass.returnDate)],
        ['Session', gatePass.session || 'N/A'],
        ['Approved By', gatePass.approvedBy || 'Pending']
    ];

    let top = 172;
    const boxWidth = 250;
    const boxHeight = 52;
    for (let index = 0; index < fields.length; index += 2) {
        const row = [fields[index], fields[index + 1]].filter(Boolean);
        let left = margin;
        row.forEach(([label, value]) => {
            drawRect(left, top, boxWidth, boxHeight, [255, 255, 255], [217, 229, 251], 0.8);
            drawText(label, left + 12, top + 10, { font: 'F2', size: 8, color: [95, 115, 152] });
            drawWrappedText(String(value), left + 12, top + 23, boxWidth - 24, { font: 'F2', size: 10.5, color: [17, 32, 63], lineHeight: 12 });
            left += boxWidth + 12;
        });
        top += boxHeight + 12;
    }

    const photoTop = top;
    const photoBoxWidth = 110;
    const photoBoxHeight = 112;
    const photoLeft = pageWidth - margin - photoBoxWidth;
    drawRect(photoLeft, photoTop, photoBoxWidth, photoBoxHeight, [255, 255, 255], [217, 229, 251], 0.8);
    drawText('Student Photo', photoLeft + 12, photoTop + 10, { font: 'F2', size: 8, color: [95, 115, 152] });
    if (imageAsset) {
        const fitRatio = Math.min(84 / imageAsset.width, 72 / imageAsset.height, 1);
        const drawWidth = Math.max(1, Math.round(imageAsset.width * fitRatio));
        const drawHeight = Math.max(1, Math.round(imageAsset.height * fitRatio));
        const drawLeft = photoLeft + Math.round((photoBoxWidth - drawWidth) / 2);
        const drawTop = photoTop + 28 + Math.round((70 - drawHeight) / 2);
        drawImage('StudentPhoto', drawLeft, drawTop, drawWidth, drawHeight);
    } else {
        drawText('No photo uploaded', photoLeft + 16, photoTop + 56, { size: 8, color: [148, 163, 184] });
    }

    const reasonTop = top + 124;
    drawRect(margin, reasonTop, pageWidth - (margin * 2), 82, [255, 255, 255], [217, 229, 251], 0.8);
    drawText('Reason for Gate Pass', margin + 12, reasonTop + 10, { font: 'F2', size: 8, color: [95, 115, 152] });
    drawWrappedText(String(gatePass.reason || 'N/A'), margin + 14, reasonTop + 38, pageWidth - (margin * 2) - 28, {
        font: 'F1',
        size: 10,
        color: [17, 32, 63],
        lineHeight: 13
    });

    drawRect(margin, reasonTop + 98, pageWidth - (margin * 2), 32, [248, 250, 252], [217, 229, 251], 0.8);
    drawText('Downloaded from HostelFix', margin + 12, reasonTop + 109, { size: 8, color: [100, 116, 139] });
    drawText(`Status: ${gatePass.status || 'Pending'}`, pageWidth - margin - 100, reasonTop + 109, { size: 8, color: statusColor, font: 'F2' });

    const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    if (imageAsset) {
        const imageBinary = Array.from(imageAsset.bytes, (byte) => String.fromCharCode(byte)).join('');
        imageObjectId = addObject(`<< /Type /XObject /Subtype /Image /Width ${imageAsset.width} /Height ${imageAsset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageAsset.bytes.length} >>\nstream\n${imageBinary}\nendstream`);
    }

    const stream = commands.join('\n');
    const contentObjectId = addObject(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
    const imageResource = imageObjectId ? ` /XObject << /StudentPhoto ${imageObjectId} 0 R >>` : '';
    const pageObjectId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${imageResource} >> >>`);
    const pagesObjectId = addObject(`<< /Type /Pages /Count 1 /Kids [${pageObjectId} 0 R] >>`);
    objects[pageObjectId - 1] = objects[pageObjectId - 1].replace('/Parent 0 0 R', `/Parent ${pagesObjectId} 0 R`);
    const catalogObjectId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(new TextEncoder().encode(pdf).length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = new TextEncoder().encode(pdf).length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1) {
        pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
}

async function downloadGatePassPdf(gatePassId) {
    const gatePass = latestGatePasses.find((entry) => entry.id === gatePassId);
    if (!gatePass) {
        showToast('That gate pass record could not be found.', 'warning');
        return;
    }

    if (currentUser?.role === 'student' && !isGatePassForCurrentUser(gatePass)) {
        showToast('You can only download your own gate pass record.', 'warning');
        return;
    }

    try {
        const response = await apiRequest(`/api/gate-passes/${encodeURIComponent(gatePassId)}/pdf`);
        if (!response.ok) {
            if (response.status === 404) {
                const pdfBlob = await createGatePassPdfBlob(gatePass);
                const url = URL.createObjectURL(pdfBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${gatePass.id || 'gate-pass'}.pdf`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast('Gate pass PDF downloaded successfully.', 'success');
                return;
            }

            const errorData = await parseJsonResponse(response);
            throw new Error(errorData.error || 'Unable to generate the gate pass PDF.');
        }

        const pdfBlob = await response.blob();
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${gatePass.id || 'gate-pass'}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Gate pass PDF downloaded successfully.', 'success');
    } catch (error) {
        console.error('Single gate pass PDF download failed:', error);
        showToast('Unable to download that gate pass PDF.', 'error');
    }
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
    const adminTotalWardens = document.getElementById('adminTotalWardens');

    const techCount = users.filter(u => u.role === 'technician').length;
    const wardenCount = users.filter(u => u.role === 'warden').length;

    if (adminTotal) adminTotal.textContent = String(summary.total || complaints.length || 0).toLocaleString();
    if (adminPending) adminPending.textContent = String(summary.pending || 0).toLocaleString();
    if (adminCompleted) adminCompleted.textContent = String(summary.completed || 0).toLocaleString();
    if (adminActiveTechnicians) adminActiveTechnicians.textContent = String(summary.activeTechnicians || techCount || 0).toLocaleString();
    if (adminTotalWardens) adminTotalWardens.textContent = String(wardenCount || 0).toLocaleString();
}

function renderAdminStudents(users = [], complaints = []) {
    const tbody = document.getElementById('adminStudentsTableBody');
    if (!tbody) return;
    const students = users.filter((u) => u.role === 'student');
    if (!students.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-6 text-center text-sm text-text-secondary">No registered students found.</td></tr>';
        return;
    }
    tbody.innerHTML = students.map((s) => {
        const studentComplaints = complaints.filter((c) => c.userEmail === s.email || c.student === s.name).length;
        const initials = (s.name || 'ST').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
        return `
            <tr class="table-row">
                <td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">${initials}</div><span class="font-medium text-sm">${s.name || 'Student'}</span></div></td>
                <td class="px-6 py-4 text-sm">${s.registrationNumber || 'REG-2024001'}</td>
                <td class="px-6 py-4 text-sm">${s.roomNumber || 'A-204'}</td>
                <td class="px-6 py-4 text-sm font-medium">${studentComplaints}</td>
                <td class="px-6 py-4"><span class="badge-completed px-2.5 py-1 rounded-full text-xs font-medium">Active</span></td>
            </tr>
        `;
    }).join('');
}

function renderAdminWardens(users = []) {
    const container = document.getElementById('adminWardensGrid');
    if (!container) return;
    const wardens = Array.isArray(users) ? users.filter((u) => u.role === 'warden' || u.hostelBlock || u.id?.startsWith('W-')) : [];
    window.currentWardensList = wardens;
    if (!wardens.length) {
        container.innerHTML = '<div class="col-span-3 glass p-6 rounded-2xl text-sm text-text-secondary text-center">No registered wardens found. Click "Add New Warden" above to add one.</div>';
        return;
    }
    container.innerHTML = wardens.map((w) => {
        const initials = (w.name || 'WD').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
        return `
            <div class="glass rounded-2xl border border-border p-5 card-hover relative group">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-600 to-primary flex items-center justify-center text-white font-bold text-sm shadow-md">${initials}</div>
                        <div>
                            <h4 class="font-bold text-sm text-text">${w.name}</h4>
                            <p class="text-xs text-text-secondary">${w.email}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button onclick="openEditWardenModal('${w.id || w.email}')" title="Edit Warden" class="w-8 h-8 rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="deleteWarden('${w.id || w.email}')" title="Remove Warden" class="w-8 h-8 rounded-xl bg-danger/10 text-danger hover:bg-danger hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="p-3 rounded-xl bg-surface-alt border border-border/60 space-y-2 mb-4 text-xs">
                    <div class="flex items-center justify-between">
                        <span class="text-text-secondary">Assigned Block</span>
                        <span class="font-semibold text-text">${w.hostelBlock || 'Block A'}</span>
                    </div>
                    <div class="flex items-center justify-between">
                        <span class="text-text-secondary">Phone</span>
                        <span class="font-medium text-text">${w.phone || '+91 98765 43210'}</span>
                    </div>
                </div>
                <div class="flex items-center justify-between">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">Active Oversight</span>
                    <span class="text-[11px] text-text-muted">Live Warden</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminTechnicians(users = [], complaints = []) {
    const container = document.getElementById('adminTechniciansGrid');
    if (!container) return;
    const technicians = Array.isArray(users) ? users.filter((u) => u.role === 'technician' || u.specialization || u.id?.startsWith('T-')) : [];
    window.currentTechniciansList = technicians;
    if (!technicians.length) {
        container.innerHTML = '<div class="col-span-3 glass p-6 rounded-2xl text-sm text-text-secondary text-center">No active technicians found. Click "Add New Technician" above to add one.</div>';
        return;
    }
    container.innerHTML = technicians.map((t) => {
        const initials = (t.name || 'TC').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
        const done = complaints.filter((c) => c.technician === t.name || c.assignedTo === t.name).filter((c) => String(c.status).toLowerCase() === 'completed').length;
        return `
            <div class="glass rounded-2xl border border-border p-5 card-hover relative group">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-info flex items-center justify-center text-white font-bold text-sm shadow-md">${initials}</div>
                        <div>
                            <h4 class="font-bold text-sm text-text">${t.name}</h4>
                            <p class="text-xs text-primary font-medium">${t.specialization || 'General Maintenance'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button onclick="openEditTechnicianModal('${t.id || t.email}')" title="Edit Technician" class="w-8 h-8 rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="deleteTechnician('${t.id || t.email}')" title="Remove Technician" class="w-8 h-8 rounded-xl bg-danger/10 text-danger hover:bg-danger hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center mb-4">
                    <div class="bg-surface-alt rounded-xl p-2 border border-border/60"><p class="font-bold text-sm text-text">${t.completedCount || done}</p><p class="text-[10px] text-text-secondary">Done</p></div>
                    <div class="bg-surface-alt rounded-xl p-2 border border-border/60"><p class="font-bold text-sm text-amber-500">${t.rating || 4.9}</p><p class="text-[10px] text-text-secondary">Rating</p></div>
                    <div class="bg-surface-alt rounded-xl p-2 border border-border/60"><p class="font-bold text-sm text-text">${t.avgRepairTime || '2.5h'}</p><p class="text-[10px] text-text-secondary">Avg</p></div>
                </div>
                <div class="flex items-center justify-between">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/30">${t.status || 'Active Duty'}</span>
                    <span class="text-[11px] text-text-muted">${t.phone || t.email || ''}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminFullComplaintsTable(complaints = []) {
    const tbody = document.getElementById('adminFullComplaintsTableBody');
    if (!tbody) return;
    if (!complaints.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-6 text-center text-sm text-text-secondary">No complaints registered yet.</td></tr>';
        return;
    }
    tbody.innerHTML = complaints.map((c) => `
        <tr class="table-row">
            <td class="px-6 py-4 text-sm font-medium">${c.id}</td>
            <td class="px-6 py-4 text-sm">${c.student || 'John Doe'}</td>
            <td class="px-6 py-4 text-sm">${c.roomNumber || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${c.category || 'General'}</td>
            <td class="px-6 py-4"><span class="${getPriorityBadgeClass(c.priority)} px-2.5 py-1 rounded-full text-xs font-medium">${c.priority || 'Low'}</span></td>
            <td class="px-6 py-4"><span class="${getStatusBadgeClass(c.status)} px-2.5 py-1 rounded-full text-xs font-medium">${c.status || 'Pending'}</span></td>
            <td class="px-6 py-4 text-sm text-text-secondary">${formatComplaintDate(c.createdAt)}</td>
        </tr>
    `).join('');
}

function renderTechInventoryGrid(inventory = []) {
    const container = document.getElementById('technicianInventoryGrid');
    if (!container) return;
    if (!inventory.length) {
        container.innerHTML = '<div class="col-span-3 glass p-6 rounded-2xl text-sm text-text-secondary">No inventory items.</div>';
        return;
    }
    container.innerHTML = inventory.map((item) => `
        <div class="glass rounded-2xl border border-border p-5 card-hover">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><i class="fa-solid ${item.icon || 'fa-box'} text-primary"></i></div>
                <div><h4 class="font-semibold text-sm">${item.name}</h4><p class="text-xs text-text-secondary">${item.category}</p></div>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-2xl font-bold">${item.stock}</span>
                <button onclick="restockInventory('${item.id}')" class="px-3 py-1 rounded-lg bg-surface border border-border text-xs font-medium hover:bg-surface-alt transition-all">Restock +10</button>
            </div>
        </div>
    `).join('');
}

async function restockInventory(id) {
    try {
        const response = await apiRequest('/api/inventory/restock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, amount: 10 })
        });
        if (response.ok) {
            showToast('Item restocked successfully!', 'success');
            await loadDashboardData();
        }
    } catch (e) {
        console.error(e);
    }
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
        admin: 'Administrator',
        warden: 'Hostel Warden',
        security: 'Gate Security Guard'
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
    studentNotifications = [];
    localStorage.removeItem(USER_SESSION_KEY);
    updateNotificationBadge();
    renderDashboardAnnouncements();
    resetNavAfterLogout();
    navigateTo('login', { skipHistory: true });
    showToast('You have been logged out successfully.', 'success');
}

function getCurrentUserDashboard() {
    if (currentUser?.role === 'technician') return 'technician-dashboard';
    if (currentUser?.role === 'admin') return 'admin-dashboard';
    if (currentUser?.role === 'warden') return 'warden-dashboard';
    if (currentUser?.role === 'security') return 'security-dashboard';
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
        admin: 'Administrator',
        warden: 'Hostel Warden',
        security: 'Gate Security Guard'
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
        syncGatePassPhotoFromProfile(true);
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
        studentNotifications = [];
        showToast(`Welcome back, ${data.name}!`, 'success');

        const userRole = data.role || role;
        if (userRole === 'technician') {
            const techSidebarName = document.getElementById('techSidebarName');
            const techSidebarRole = document.getElementById('techSidebarRole');
            const techWelcomeText = document.getElementById('techWelcomeText');
            if (techSidebarName) techSidebarName.textContent = data.name || 'Technician';
            if (techSidebarRole) techSidebarRole.textContent = 'Technician';
            if (techWelcomeText) techWelcomeText.textContent = `Welcome back, ${data.name || 'Technician'}! Here are your tasks for today.`;
        }

        if (userRole === 'student') {
            fillStudentForm(data);
            await Promise.all([fetchAnnouncements(), fetchStudentNotifications()]);
            navigateTo('student-dashboard');
        } else if (userRole === 'technician') {
            navigateTo('technician-dashboard');
        } else if (userRole === 'admin') {
            navigateTo('admin-dashboard');
        } else if (userRole === 'warden') {
            navigateTo('warden-dashboard');
        } else if (userRole === 'security') {
            navigateTo('security-dashboard');
        } else {
            navigateTo(getCurrentUserDashboard());
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
    const profile = getComplaintStudentProfile();
    const studentName = profile.name;
    const registrationNumber = profile.registrationNumber;
    const hostelBlock = profile.hostelBlock;
    const roomNumber = profile.roomNumber;
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
    const studentName = document.getElementById('gatePassStudentName')?.value.trim() || currentUser?.name || '';
    const registrationNumber = document.getElementById('gatePassRegistrationNumber')?.value.trim() || currentUser?.registrationNumber || '';
    const hostelBlock = document.getElementById('gatePassHostelBlock')?.value || 'Unknown';
    const roomNumber = document.getElementById('gatePassRoomNumber')?.value.trim() || currentUser?.roomNumber || '';
    const reason = document.getElementById('gatePassReason').value.trim();
    const session = document.getElementById('gatePassSession').value || 'Morning';
    const gateDate = document.getElementById('gatePassDate').value;
    const returnDate = document.getElementById('gatePassReturnDate').value;
    const studentPhoto = currentGatePassPhotoDataUrl || getCurrentUserProfileImage();

    if (!studentName || !registrationNumber || !roomNumber || !reason || !gateDate || !returnDate) {
        showToast('Please complete the gate-pass form before submitting.', 'warning');
        return;
    }

    if (!studentPhoto) {
        showToast('Please upload the student photo before submitting the gate pass.', 'warning');
        return;
    }

    if (returnDate < gateDate) {
        showToast('Return date must be the same day or after the gate pass date.', 'warning');
        return;
    }

    showLoading();
    try {
        const response = await apiRequest('/api/gate-passes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser?.userId || '',
                student: studentName,
                email: currentUser?.email || '',
                registrationNumber,
                hostelBlock,
                roomNumber,
                reason,
                session,
                gateDate,
                returnDate,
                studentPhoto
            })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to submit gate pass (${response.status}).`, 'error');
            return;
        }

        latestSubmittedGatePass = data;
        latestGatePasses = [data, ...latestGatePasses.filter((entry) => entry?.id !== data.id)];
        showToast(`Gate pass submitted successfully! ID: ${data.id}`, 'success');
        form.reset();
        clearGatePassPhotoSelection();
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

function downloadGatePassForm() {
    const gatePass = getLatestSubmittedGatePass();
    if (!gatePass) {
        showToast('Submit the gate pass first, then you can download that submitted data.', 'warning');
        return;
    }

    try {
        downloadGatePassPdf(gatePass.id);
    } catch (error) {
        console.error('Gate pass form PDF download failed:', error);
        showToast('Unable to download the gate pass PDF.', 'error');
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

async function searchComplaint(targetId) {
    const queryInput = document.getElementById('complaintSearchInput');
    const searchValue = (targetId || (queryInput ? queryInput.value.trim() : '')).toUpperCase();
    const trackingResult = document.getElementById('trackingResult');

    if (queryInput && targetId) {
        queryInput.value = targetId;
    }

    if (!searchValue) {
        showToast('Please enter a complaint ID to track.', 'warning');
        return;
    }

    if (trackingResult) {
        trackingResult.innerHTML = `
            <div class="text-center py-10">
                <div class="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3 animate-spin">
                    <i class="fa-solid fa-circle-notch text-lg"></i>
                </div>
                <p class="text-xs font-semibold text-text-secondary">Fetching complaint details for ${searchValue}...</p>
            </div>
        `;
    }

    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(searchValue)}`);
        const data = await parseJsonResponse(response);

        if (!response.ok) {
            if (trackingResult) {
                trackingResult.innerHTML = `
                    <div class="text-center py-10">
                        <div class="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto mb-4 text-2xl">
                            <i class="fa-solid fa-circle-exclamation"></i>
                        </div>
                        <h3 class="text-lg font-bold text-text mb-1">Complaint Not Found</h3>
                        <p class="text-sm text-text-secondary max-w-sm mx-auto mb-6">No complaint matching ID "<strong class="text-text">${searchValue}</strong>" was found in the database.</p>
                        <button onclick="prepareComplaintTracking()" class="px-5 py-2.5 rounded-xl bg-surface-alt border border-border text-xs font-semibold text-text hover:bg-border transition-all">
                            View All Complaints
                        </button>
                    </div>
                `;
            }
            return;
        }

        if (trackingResult) {
            trackingResult.innerHTML = renderTrackingResult(data);
        }
    } catch (error) {
        if (trackingResult) {
            trackingResult.innerHTML = `<p class="text-danger font-semibold text-center py-8">Unable to fetch tracking data. Please try again.</p>`;
        }
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function loadDashboardData() {
    try {
        const [summaryResponse, complaintsResponse, techniciansResponse, gatePassesResponse, laundryRequestsResponse, usersResponse, inventoryResponse] = await Promise.all([
            apiRequest('/api/summary'),
            apiRequest('/api/complaints'),
            apiRequest('/api/technicians'),
            apiRequest('/api/gate-passes'),
            apiRequest('/api/laundry-requests'),
            apiRequest('/api/users'),
            apiRequest('/api/inventory')
        ]);

        const summary = await parseJsonResponse(summaryResponse);
        const complaints = await parseJsonResponse(complaintsResponse);
        const technicianList = await parseJsonResponse(techniciansResponse);
        const gatePasses = await parseJsonResponse(gatePassesResponse);
        const laundryRequests = await parseJsonResponse(laundryRequestsResponse);
        const allUsers = usersResponse.ok ? await parseJsonResponse(usersResponse) : [];
        const inventoryList = inventoryResponse.ok ? await parseJsonResponse(inventoryResponse) : [];

        if (!summaryResponse.ok || !complaintsResponse.ok || !techniciansResponse.ok || !gatePassesResponse.ok || !laundryRequestsResponse.ok) {
            const failed = [
                !summaryResponse.ok && summary,
                !complaintsResponse.ok && complaints,
                !techniciansResponse.ok && technicianList,
                !gatePassesResponse.ok && gatePasses,
                !laundryRequestsResponse.ok && laundryRequests
            ].find(Boolean);
            throw new Error(failed?.error || 'Failed to load dashboard data.');
        }

        latestComplaints = Array.isArray(complaints) ? complaints.slice() : [];
        latestGatePasses = Array.isArray(gatePasses) ? gatePasses.slice() : [];
        latestLaundryRequests = Array.isArray(laundryRequests) ? laundryRequests.slice() : [];
        syncCurrentUserStudentProfile();
        prepareComplaintForm();
        prepareLaundryForm();

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
        renderAdminSummary(summary, complaints, allUsers);
        renderGatePassTable(gatePasses);
        renderAdminStudents(allUsers, complaints);
        renderAdminWardens(allUsers);
        renderAdminTechnicians(allUsers, complaints);
        renderAdminFullComplaintsTable(complaints);
        renderTechInventoryGrid(inventoryList);
        renderWardenDashboard();
        renderSecurityDashboard();

        const gatePassCount = document.getElementById('adminGatePassCount');
        if (gatePassCount) gatePassCount.textContent = `${gatePasses.length}`;

        if (document.getElementById('page-landing')?.classList.contains('active')) {
            animateNumbers();
        }
    } catch (error) {
        console.error('Unable to load dashboard data:', error);
    }
}

function renderWardenDashboard() {
    const pendingCount = document.getElementById('wardenPendingCount');
    const approvedCount = document.getElementById('wardenApprovedCount');
    const outCount = document.getElementById('wardenOutCount');
    const list = document.getElementById('wardenGatePassList');

    const pendingPasses = latestGatePasses.filter(p => !p.status || p.status === 'REQUESTED' || p.status === 'Pending');
    const approvedPasses = latestGatePasses.filter(p => p.status === 'QR GENERATED' || p.status === 'Approved');
    const outPasses = latestGatePasses.filter(p => p.status === 'OUT');

    if (pendingCount) pendingCount.textContent = pendingPasses.length;
    if (approvedCount) approvedCount.textContent = approvedPasses.length;
    if (outCount) outCount.textContent = outPasses.length;

    if (!list) return;

    if (!latestGatePasses.length) {
        list.innerHTML = '<div class="text-sm text-text-secondary py-6 text-center">No gate pass requests recorded yet.</div>';
        return;
    }

    list.innerHTML = latestGatePasses.map((pass) => {
        const status = pass.status || 'REQUESTED';
        const isPending = status === 'REQUESTED' || status === 'Pending';
        const isApproved = status === 'QR GENERATED' || status === 'Approved';

        let badgeClass = 'bg-amber-100 text-amber-800';
        if (isApproved) badgeClass = 'bg-emerald/10 text-emerald border border-emerald/20';
        if (status === 'OUT') badgeClass = 'bg-blue-100 text-blue-800';
        if (status === 'RETURNED' || status === 'COMPLETED') badgeClass = 'bg-purple-100 text-purple-800';
        if (status === 'Rejected') badgeClass = 'bg-danger/10 text-danger';

        return `
            <div class="rounded-2xl border border-border p-4 bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-sm text-text">${pass.student || 'Student'}</span>
                        <span class="text-xs text-text-secondary">• ${pass.registrationNumber || 'REG-N/A'}</span>
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${status}</span>
                    </div>
                    <p class="text-xs text-text-secondary">Hostel: ${pass.hostelBlock || 'N/A'} • Room: ${pass.roomNumber || 'N/A'} • Date: ${pass.gateDate || '—'} to ${pass.returnDate || '—'}</p>
                    <p class="text-xs text-text-muted italic">Reason: "${pass.reason || 'Not specified'}"</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    ${isPending ? `
                        <button onclick="updateGatePassStatus('${pass.id}', 'QR GENERATED')" class="px-3 py-1.5 rounded-xl bg-emerald text-white text-xs font-semibold hover:bg-emerald/90 transition-all flex items-center gap-1">
                            <i class="fa-solid fa-check"></i> Approve
                        </button>
                        <button onclick="updateGatePassStatus('${pass.id}', 'Rejected')" class="px-3 py-1.5 rounded-xl bg-danger/10 text-danger hover:bg-danger hover:text-white text-xs font-semibold transition-all flex items-center gap-1">
                            <i class="fa-solid fa-xmark"></i> Reject
                        </button>
                    ` : `
                        <span class="text-xs font-mono text-text-muted">ID: ${pass.id}</span>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function renderSecurityDashboard() {
    const list = document.getElementById('securityGatePassList');
    if (!list) return;

    const gatePasses = latestGatePasses.filter(p => p.status && p.status !== 'Pending' && p.status !== 'REQUESTED');

    if (!gatePasses.length) {
        list.innerHTML = '<div class="text-sm text-text-secondary py-6 text-center">No active approved gate passes to display.</div>';
        return;
    }

    list.innerHTML = gatePasses.map((pass) => {
        const status = pass.status || 'QR GENERATED';
        const isApproved = status === 'QR GENERATED';
        const isOut = status === 'OUT';

        return `
            <div class="rounded-2xl border border-border p-4 bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-sm text-text">${pass.student || 'Student'}</span>
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${isOut ? 'bg-amber-100 text-amber-800' : 'bg-emerald/10 text-emerald'}">${status}</span>
                    </div>
                    <p class="text-xs text-text-secondary">Pass ID: <span class="font-mono font-semibold">${pass.id}</span> • Room: ${pass.roomNumber || 'N/A'}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    ${isApproved ? `
                        <button onclick="updateGatePassStatus('${pass.id}', 'OUT')" class="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-all">
                            Mark OUT
                        </button>
                    ` : ''}
                    ${isOut ? `
                        <button onclick="updateGatePassStatus('${pass.id}', 'RETURNED')" class="px-3 py-1.5 rounded-xl bg-emerald hover:bg-emerald/90 text-white text-xs font-semibold transition-all">
                            Mark RETURNED
                        </button>
                    ` : ''}
                    ${(!isApproved && !isOut) ? `<span class="text-xs font-mono text-text-muted">${status}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function handleSecurityScanSubmit(targetStatus) {
    const input = document.getElementById('securityScanInput');
    if (!input) return;
    const passId = input.value.trim();
    if (!passId) {
        showToast('Please enter or scan a Gate Pass ID first.', 'warning');
        return;
    }
    const pass = latestGatePasses.find(p => p.id === passId || p.id.toLowerCase() === passId.toLowerCase());
    if (!pass) {
        showToast(`Gate Pass ID '${passId}' not found.`, 'error');
        return;
    }
    updateGatePassStatus(pass.id, targetStatus);
    input.value = '';
}

function loadLandingStats() {
    return loadDashboardData();
}

async function prepareComplaintTracking() {
    const trackingResult = document.getElementById('trackingResult');
    const queryInput = document.getElementById('complaintSearchInput');
    if (!trackingResult) return;

    // Check if search input has value
    if (queryInput && queryInput.value.trim()) {
        searchComplaint(queryInput.value.trim());
        return;
    }

    try {
        const response = await apiRequest('/api/complaints');
        const complaints = await parseJsonResponse(response);

        if (response.ok && Array.isArray(complaints) && complaints.length > 0) {
            let targetComplaint = null;
            if (currentUser && currentUser.email) {
                targetComplaint = complaints.find(c => (c.email && c.email.toLowerCase() === currentUser.email.toLowerCase()) || (c.student && c.student.toLowerCase() === currentUser.name?.toLowerCase()));
            }
            if (!targetComplaint) targetComplaint = complaints[0];

            if (targetComplaint && targetComplaint.id) {
                if (queryInput) queryInput.value = targetComplaint.id;
                trackingResult.innerHTML = renderTrackingResult(targetComplaint);

                const chipsHtml = complaints.slice(0, 6).map(c => `
                    <button onclick="searchComplaint('${c.id}')" class="px-3 py-1.5 rounded-full text-xs font-semibold border ${c.id === targetComplaint.id ? 'bg-primary text-white border-primary shadow-xs' : 'bg-surface-alt text-text-secondary border-border hover:border-primary hover:text-primary'} transition-all flex items-center gap-1.5 shrink-0">
                        <i class="fa-solid fa-hashtag text-[10px]"></i> ${c.id} (${c.category || 'General'})
                    </button>
                `).join('');

                trackingResult.insertAdjacentHTML('afterbegin', `
                    <div class="mb-6 pb-6 border-b border-border">
                        <p class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2.5">Recent Complaints Live Quick Switch:</p>
                        <div class="flex items-center gap-2 overflow-x-auto pb-1">
                            ${chipsHtml}
                        </div>
                    </div>
                `);
                return;
            }
        }
    } catch (e) {
        console.error('Error loading complaints for tracking:', e);
    }

    trackingResult.innerHTML = `
        <div class="text-center py-10">
            <div class="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4 text-2xl">
                <i class="fa-solid fa-route"></i>
            </div>
            <h3 class="text-lg font-bold text-text mb-1">Live Maintenance Tracking</h3>
            <p class="text-sm text-text-secondary max-w-sm mx-auto mb-6">Enter a complaint ID above (e.g. <strong>CMP-2026-001</strong>) to view its real-time progress, technician assignment, and repair status history.</p>
        </div>
    `;
}

function renderTrackingResult(complaint) {
    if (!complaint) {
        return `<div class="text-center py-8 text-text-secondary">No complaint data found.</div>`;
    }

    const statusMap = {
        'Pending': 1,
        'Assigned': 2,
        'Accepted': 3,
        'In Progress': 4,
        'Completed': 5,
        'Resolved': 5
    };

    const currentStepIndex = statusMap[complaint.status] || (complaint.assignedTo && complaint.assignedTo !== 'Unassigned' ? 2 : 1);
    const createdDateStr = complaint.createdAt ? new Date(complaint.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

    const priorityColors = {
        'High': 'bg-rose-500/10 text-rose-600 border-rose-500/30',
        'Emergency': 'bg-rose-600/20 text-rose-600 border-rose-600/40 animate-pulse',
        'Medium': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        'Low': 'bg-sky-500/10 text-sky-600 border-sky-500/30'
    };
    const priorityBadge = priorityColors[complaint.priority] || priorityColors['Low'];

    const statusBadges = {
        'Completed': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
        'In Progress': 'bg-blue-500/10 text-blue-600 border-blue-500/30',
        'Accepted': 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
        'Assigned': 'bg-purple-500/10 text-purple-600 border-purple-500/30',
        'Pending': 'bg-amber-500/10 text-amber-600 border-amber-500/30'
    };
    const statusBadgeStyle = statusBadges[complaint.status] || statusBadges['Pending'];

    const categoryIcons = {
        'Electrical': 'fa-bolt text-amber-500',
        'Plumbing': 'fa-faucet-drip text-blue-500',
        'Furniture': 'fa-chair text-amber-700',
        'Carpentry': 'fa-hammer text-amber-600',
        'Appliance': 'fa-plug text-purple-500',
        'Cleaning': 'fa-broom text-emerald-500',
        'General': 'fa-wrench text-primary'
    };
    const catIcon = categoryIcons[complaint.category] || categoryIcons['General'];

    const steps = [
        {
            title: 'Complaint Submitted',
            desc: `Registered by ${complaint.student || 'Student'} (${complaint.roomNumber || 'Room N/A'}, ${complaint.hostelBlock || 'Hostel'}).`,
            time: createdDateStr,
            icon: 'fa-paper-plane',
            completed: currentStepIndex >= 1
        },
        {
            title: 'Assigned to Technician',
            desc: complaint.assignedTo && complaint.assignedTo !== 'Unassigned' 
                ? `Assigned to technician <strong class="text-primary">${complaint.assignedTo}</strong> (${complaint.category || 'Maintenance'} Specialist).`
                : 'Awaiting admin assignment to designated block technician.',
            time: currentStepIndex >= 2 ? 'Assigned' : 'Pending',
            icon: 'fa-user-gear',
            completed: currentStepIndex >= 2
        },
        {
            title: 'Technician Accepted Job',
            desc: currentStepIndex >= 3 
                ? `Technician ${complaint.assignedTo || 'Specialist'} acknowledged work order and scheduled repair visit.`
                : 'Technician will confirm job acceptance upon dispatch.',
            time: currentStepIndex >= 3 ? 'Accepted' : 'Awaiting',
            icon: 'fa-user-check',
            completed: currentStepIndex >= 3
        },
        {
            title: 'Repair Work In Progress',
            desc: currentStepIndex >= 4 
                ? `Technician actively servicing complaint in ${complaint.roomNumber || 'room'}. Estimated completion: ~1-2 hours.`
                : 'Repair work will begin once technician arrives at room.',
            time: currentStepIndex === 4 ? 'Active Now' : (currentStepIndex > 4 ? 'Done' : 'Scheduled'),
            icon: 'fa-wrench',
            completed: currentStepIndex >= 4,
            current: currentStepIndex === 4
        },
        {
            title: 'Resolution & Quality Verification',
            desc: currentStepIndex >= 5 
                ? 'Maintenance resolved successfully! Work order verified and closed.'
                : 'Work will be closed and verified upon final testing.',
            time: currentStepIndex >= 5 ? 'Resolved' : 'Final Step',
            icon: 'fa-circle-check',
            completed: currentStepIndex >= 5
        }
    ];

    const progressPercent = Math.min(100, Math.max(20, currentStepIndex * 20));

    return `
        <!-- Complaint Summary Banner -->
        <div class="glass rounded-2xl border border-border p-5 sm:p-6 mb-8 shadow-xs">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-border">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-xl shrink-0">
                        <i class="fa-solid ${catIcon}"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2 flex-wrap mb-1">
                            <span class="font-extrabold text-lg tracking-tight text-text">${complaint.id}</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border ${priorityBadge}">${complaint.priority} Priority</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusBadgeStyle}">${complaint.status}</span>
                        </div>
                        <p class="text-xs text-text-secondary font-medium">${complaint.category || 'General'} Repair • Room ${complaint.roomNumber || 'N/A'} (${complaint.hostelBlock || 'Hostel'})</p>
                    </div>
                </div>
                <div class="text-left md:text-right">
                    <p class="text-xs text-text-muted">Reported Date</p>
                    <p class="text-xs font-semibold text-text">${createdDateStr}</p>
                </div>
            </div>

            <!-- Description & Dynamic Progress Bar -->
            <div class="pt-5 space-y-4">
                <div>
                    <p class="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1">Issue Description</p>
                    <p class="text-sm text-text leading-relaxed bg-surface-alt/70 p-3.5 rounded-xl border border-border/60">${complaint.description || 'No detailed description provided.'}</p>
                </div>

                <div>
                    <div class="flex items-center justify-between text-xs font-semibold mb-1.5">
                        <span class="text-text-secondary">Overall Resolution Progress</span>
                        <span class="text-primary">${progressPercent}% Completed</span>
                    </div>
                    <div class="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                        <div class="bg-gradient-to-r from-primary to-emerald h-2.5 rounded-full transition-all duration-500" style="width: ${progressPercent}%;"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Dynamic Timeline Steps -->
        <div class="relative pl-6 sm:pl-8">
            <div class="absolute left-[19px] sm:left-[27px] top-6 bottom-6 w-0.5 bg-slate-200 dark:bg-slate-800"></div>
            <div class="space-y-6">
                ${steps.map((step) => {
                    const isCompleted = step.completed;
                    const isCurrent = step.current;
                    
                    let badgeClass = 'bg-slate-200 text-slate-500 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
                    if (isCompleted) {
                        badgeClass = 'bg-emerald text-white shadow-md shadow-emerald/20';
                    } else if (isCurrent) {
                        badgeClass = 'bg-primary text-white shadow-md shadow-primary/30 ring-4 ring-primary/20 animate-pulse';
                    }

                    return `
                        <div class="relative flex items-start gap-4">
                            <div class="absolute left-[-19px] sm:left-[-27px] w-9 h-9 sm:w-10 sm:h-10 rounded-full ${badgeClass} flex items-center justify-center font-bold text-sm shrink-0 z-10 transition-all">
                                <i class="fa-solid ${isCompleted ? 'fa-check' : (isCurrent ? step.icon : 'fa-circle-dot')}"></i>
                            </div>
                            <div class="ml-6 sm:ml-8 flex-1">
                                <div class="glass rounded-2xl p-4 sm:p-5 border ${isCurrent ? 'border-primary/40 bg-primary/5 shadow-md shadow-primary/5' : (isCompleted ? 'border-border bg-surface' : 'border-border/60 bg-surface/50 opacity-75')}">
                                    <div class="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                                        <h4 class="font-bold text-sm sm:text-base ${isCurrent ? 'text-primary' : 'text-text'}">${step.title}</h4>
                                        <span class="text-xs font-semibold ${isCurrent ? 'text-primary bg-primary/10 px-2.5 py-0.5 rounded-full' : (isCompleted ? 'text-emerald font-medium' : 'text-text-muted')}">${step.time}</span>
                                    </div>
                                    <p class="text-xs sm:text-sm text-text-secondary leading-relaxed">${step.desc}</p>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
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

    try {
        const stream = await requestCameraStream();
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
        const details = describeCameraError(error);
        showWarning(details.warning);
        if (statusEl) {
            statusEl.textContent = details.status;
        }
    }
}

function setupGatePassDateValidation() {
    const gateDateInput = document.getElementById('gatePassDate');
    const returnDateInput = document.getElementById('gatePassReturnDate');
    if (!gateDateInput || !returnDateInput) return;

    const syncReturnDateMin = () => {
        const selectedGateDate = gateDateInput.value;
        returnDateInput.min = selectedGateDate || '';
        if (selectedGateDate && returnDateInput.value && returnDateInput.value < selectedGateDate) {
            returnDateInput.value = selectedGateDate;
        }
    };

    gateDateInput.addEventListener('change', syncReturnDateMin);
    syncReturnDateMin();
}

// ===== CUSTOM PROFESSIONAL DATE PICKER WIDGET =====
let activeDatePickerInput = null;
let activeDatePickerPopover = null;
let customDatePickerDate = new Date();

function setupCustomDatePickers() {
    const inputs = document.querySelectorAll('input[type="date"], input.custom-datepicker');
    inputs.forEach((input) => {
        if (input.dataset.customDatepickerInitialized) return;
        input.dataset.customDatepickerInitialized = 'true';
        
        input.type = 'text';
        input.readOnly = true;
        input.classList.add('custom-datepicker', 'cursor-pointer');
        if (!input.placeholder) input.placeholder = 'YYYY-MM-DD';

        const wrapper = input.closest('.date-pill-wrapper') || input.parentElement;
        
        const openPicker = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openCustomDatePicker(input);
        };

        input.addEventListener('click', openPicker);
        if (wrapper && wrapper.classList.contains('date-pill-wrapper')) {
            wrapper.addEventListener('click', (e) => {
                if (e.target !== input) openPicker(e);
            });
        }
    });
}

function openCustomDatePicker(input) {
    if (activeDatePickerPopover) {
        closeCustomDatePicker();
    }

    activeDatePickerInput = input;
    const initialVal = input.value ? new Date(input.value) : new Date();
    customDatePickerDate = isNaN(initialVal.getTime()) ? new Date() : initialVal;

    const popover = document.createElement('div');
    popover.id = 'customDatePickerPopover';
    popover.className = 'absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-border bg-surface p-4 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150';
    
    const parent = input.closest('.date-pill-wrapper') || input.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
    }
    (parent || document.body).appendChild(popover);
    activeDatePickerPopover = popover;

    renderCustomDatePickerContent();

    setTimeout(() => {
        document.addEventListener('click', handleOutsideDatePickerClick);
    }, 10);
}

function handleOutsideDatePickerClick(e) {
    if (!activeDatePickerPopover) return;
    if (!activeDatePickerPopover.contains(e.target) && e.target !== activeDatePickerInput) {
        closeCustomDatePicker();
    }
}

function closeCustomDatePicker() {
    if (activeDatePickerPopover) {
        activeDatePickerPopover.remove();
        activeDatePickerPopover = null;
    }
    activeDatePickerInput = null;
    document.removeEventListener('click', handleOutsideDatePickerClick);
}

function renderCustomDatePickerContent() {
    if (!activeDatePickerPopover || !activeDatePickerInput) return;

    const year = customDatePickerDate.getFullYear();
    const month = customDatePickerDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let selectedStr = activeDatePickerInput.value || '';
    if (selectedStr && !selectedStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const d = new Date(selectedStr);
        if (!isNaN(d.getTime())) {
            selectedStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDateOfMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDate = new Date(year, month, 0).getDate();

    let daysHtml = '';

    for (let i = firstDayIndex; i > 0; i--) {
        daysHtml += `<div class="py-2 text-xs text-text-secondary/40 font-normal cursor-default text-center">${prevMonthLastDate - i + 1}</div>`;
    }

    for (let day = 1; day <= lastDateOfMonth; day++) {
        const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dayStr === todayStr;
        const isSelected = dayStr === selectedStr;

        let dayClass = 'cursor-pointer py-1.5 text-xs font-medium text-text rounded-xl transition-all flex items-center justify-center ';
        if (isSelected) {
            dayClass += 'bg-primary text-white font-bold shadow-md scale-105';
        } else if (isToday) {
            dayClass += 'ring-1 ring-primary text-primary font-bold hover:bg-primary/10';
        } else {
            dayClass += 'hover:bg-primary/10 hover:text-primary';
        }

        daysHtml += `<div onclick="selectCustomDate('${dayStr}')" class="${dayClass}">${day}</div>`;
    }

    activeDatePickerPopover.innerHTML = `
        <div class="flex items-center justify-between mb-3 pb-2 border-b border-border/60">
            <button type="button" onclick="changeCustomDateMonth(-1)" class="w-8 h-8 rounded-xl bg-surface-alt hover:bg-primary/10 hover:text-primary border border-border/60 transition-all flex items-center justify-center text-xs text-text-secondary">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span class="text-sm font-bold text-text">${monthNames[month]} ${year}</span>
            <button type="button" onclick="changeCustomDateMonth(1)" class="w-8 h-8 rounded-xl bg-surface-alt hover:bg-primary/10 hover:text-primary border border-border/60 transition-all flex items-center justify-center text-xs text-text-secondary">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="grid grid-cols-7 gap-1 mb-2 text-center">
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Su</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Mo</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Tu</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">We</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Th</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Fr</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Sa</span>
        </div>
        <div class="grid grid-cols-7 gap-1 mb-3">
            ${daysHtml}
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
            <button type="button" onclick="clearCustomDate()" class="text-text-secondary hover:text-danger font-medium transition-colors">Clear</button>
            <button type="button" onclick="selectTodayCustomDate()" class="text-primary font-semibold hover:underline">Today</button>
        </div>
    `;
}

function changeCustomDateMonth(delta) {
    customDatePickerDate.setMonth(customDatePickerDate.getMonth() + delta);
    renderCustomDatePickerContent();
}

function selectCustomDate(dateStr) {
    if (!activeDatePickerInput) return;
    activeDatePickerInput.value = dateStr;
    activeDatePickerInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeDatePickerInput.dispatchEvent(new Event('change', { bubbles: true }));
    closeCustomDatePicker();
}

function selectTodayCustomDate() {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    selectCustomDate(todayStr);
}

function clearCustomDate() {
    if (!activeDatePickerInput) return;
    activeDatePickerInput.value = '';
    activeDatePickerInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeDatePickerInput.dispatchEvent(new Event('change', { bubbles: true }));
    closeCustomDatePicker();
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
    video.style.visibility = 'visible';
    video.style.backgroundColor = '#000';
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
    cctvFireHazardStartedAt = null;
    cctvSmokeHazardStartedAt = null;
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
            const fireHazardPrediction = getFireHazardPrediction(predictionEntries);
            const smokeHazardPrediction = getSmokeHazardPrediction(predictionEntries);
            const hazardPrediction = fireHazardPrediction || smokeHazardPrediction || null;
            const bestPrediction = predictionEntries.slice().sort((a, b) => b.confidence - a.confidence)[0];
            const confidence = hazardCandidate ? hazardCandidate.confidence : (bestPrediction ? bestPrediction.confidence : 0);
            if (fireHazardPrediction) {
                if (!cctvFireHazardStartedAt) cctvFireHazardStartedAt = Date.now();
            } else {
                cctvFireHazardStartedAt = null;
            }
            if (smokeHazardPrediction) {
                if (!cctvSmokeHazardStartedAt) cctvSmokeHazardStartedAt = Date.now();
            } else {
                cctvSmokeHazardStartedAt = null;
            }

            const firePersisted = Boolean(fireHazardPrediction && cctvFireHazardStartedAt && Date.now() - cctvFireHazardStartedAt >= CCTV_FIRE_EMERGENCY_PERSIST_MS);
            const smokePersisted = Boolean(smokeHazardPrediction && cctvSmokeHazardStartedAt && Date.now() - cctvSmokeHazardStartedAt >= CCTV_SMOKE_EMERGENCY_PERSIST_MS);
            const emergencyPrediction = firePersisted ? fireHazardPrediction : (smokePersisted ? smokeHazardPrediction : null);

            if (emergencyPrediction) {
                cctvFireStableCount = Math.floor(((firePersisted ? cctvFireHazardStartedAt : cctvSmokeHazardStartedAt) ? (Date.now() - (firePersisted ? cctvFireHazardStartedAt : cctvSmokeHazardStartedAt)) : 0) / 1000);
                cctvNoFireStableCount = 0;
            } else {
                cctvNoFireStableCount += 1;
                cctvFireStableCount = 0;
            }
            if (emergencyPrediction) {
                cctvFireDetectedState = true;
                sendTelegramEmergencyAlert(emergencyPrediction, imageDataUrl);
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
                    statusEl.textContent = `Emergency alert sent: ${emergencyPrediction ? (emergencyPrediction.detectionLabel || emergencyPrediction.label) : 'fire or smoke'} detected (${Math.round((emergencyPrediction?.confidence || confidence) * 100)}%).`;
                } else if (hazardCandidate) {
                    if (fireHazardPrediction) {
                        statusEl.textContent = `Possible fire detected (${Math.round(fireHazardPrediction.confidence * 100)}%). Fast emergency verification in progress.`;
                    } else if (smokeHazardPrediction) {
                        statusEl.textContent = `Possible smoke detected (${Math.round(smokeHazardPrediction.confidence * 100)}%). Telegram alert will send after 65% stable confidence.`;
                    } else {
                        statusEl.textContent = `Possible ${hazardCandidate.detectionLabel || hazardCandidate.label} detected (${Math.round(hazardCandidate.confidence * 100)}%).`;
                    }
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
                    ? `${emergencyPrediction?.detectionType || 'Fire or smoke'} detected in frame.`
                    : hazardCandidate
                        ? fireHazardPrediction
                            ? 'Possible fire detected. Prioritizing fast emergency trigger.'
                            : smokeHazardPrediction
                                ? 'Possible smoke detected. Waiting for stable 65% confidence before Telegram alert.'
                                : `Possible ${hazardCandidate.detectionLabel || hazardCandidate.label} detected. Watching for a stable high-confidence signal.`
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

function getFireHazardPrediction(predictions) {
    return FireDetectionUtils.getHazardPrediction(
        Array.isArray(predictions) ? predictions.filter((item) => FireDetectionUtils.isFireLabel(item?.label)) : [],
        CCTV_FIRE_ALERT_CONFIDENCE
    );
}

function getSmokeHazardPrediction(predictions) {
    return FireDetectionUtils.getHazardPrediction(
        Array.isArray(predictions) ? predictions.filter((item) => FireDetectionUtils.isSmokeLabel(item?.label)) : [],
        CCTV_SMOKE_ALERT_CONFIDENCE
    );
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

function openFaceAuthMonitoring() {
    const secureWarning = !window.isSecureContext ? '<div class="rounded-2xl border border-danger/20 bg-danger/5 p-4 text-danger text-sm">Camera access is blocked on file:// pages or insecure origins. Open the app from <strong>http://localhost:5000</strong> and reload this modal.</div>' : '';
    const content = `
        <div class="space-y-5 cctv-modal">
            <div class="modal-card rounded-[2rem] border border-border bg-surface-alt shadow-xl overflow-hidden">
                <div class="modal-card-header flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 class="font-semibold text-2xl">Face Authentication Monitoring</h4>
                        <p class="text-sm text-text-secondary mt-2 max-w-xl">Verify saved hostel faces from webcam or uploaded video. Trained profiles show <strong>Authorized</strong>; unknown faces show <strong>Unauthorized</strong>.</p>
                    </div>
                    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end w-full">
                        <button type="button" onclick="startLiveFaceAuth()" class="btn btn-primary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[11rem]">Start Live Camera</button>
                        <label class="btn btn-secondary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[11rem] text-center cursor-pointer">
                            Upload Video
                            <input id="faceAuthVideoUpload" type="file" accept="video/*" class="hidden" onchange="handleFaceAuthUpload(event)">
                        </label>
                        <button type="button" onclick="stopFaceAuthMonitoring()" class="btn btn-secondary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[11rem]">Stop Monitoring</button>
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
                        <video id="faceAuthVideoPlayer" class="w-full h-full object-cover" autoplay muted playsinline></video>
                        <div id="faceAuthOverlay" class="pointer-events-none absolute inset-0"></div>
                        <div id="faceAuthVideoWarning" class="absolute inset-0 flex items-center justify-center text-white text-center px-4 text-sm bg-black/70" style="display:none;">
                            Choose Start Live Camera or Upload Video.
                        </div>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Status</h5>
                        <p class="text-sm text-text-secondary" id="faceAuthModelStatus">Face authentication ready. Click Start Live Camera to begin verification.</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Authorized Faces</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="faceAuthAuthorizedCount">0</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Unauthorized Faces</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="faceAuthUnauthorizedCount">0</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Verification Confidence</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="faceAuthAccuracy">N/A</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Speed</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="faceAuthSpeed">N/A</p>
                    </div>
                </div>
            </div>
            <div class="cctv-card rounded-[1.75rem] border border-border bg-surface-alt shadow-lg p-5">
                <div class="flex flex-col gap-3 mb-3 sm:flex-row sm:items-center sm:justify-between">
                    <h5 class="font-semibold">Verification Log</h5>
                    <span class="text-xs text-text-secondary">Authorized profiles currently loaded from <code>face_auth/face_auth/embeddings</code>.</span>
                </div>
                <pre id="faceAuthInferenceOutput" class="whitespace-pre-wrap text-sm text-text-secondary bg-white/90 rounded-2xl p-4 h-48 overflow-auto border border-border">Start face authentication monitoring to see verification results here.</pre>
            </div>
        </div>
    `;
    showModal('Face Authentication Monitoring', content);
    updateFaceAuthDetectionLogOutput();
}

async function startLiveFaceAuth() {
    const statusEl = document.getElementById('faceAuthModelStatus');
    const warningEl = document.getElementById('faceAuthVideoWarning');
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
    stopFaceAuthInference();
    releaseFaceAuthVideoUpload();

    faceAuthVideoElement = document.getElementById('faceAuthVideoPlayer');

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

    try {
        const stream = await requestCameraStream();
        if (!stream) {
            throw new Error('No camera stream returned.');
        }

        if (faceAuthVideoElement) {
            faceAuthVideoElement.muted = true;
            faceAuthVideoElement.playsInline = true;
            faceAuthVideoElement.autoplay = true;
            faceAuthVideoElement.srcObject = stream;
            faceAuthVideoElement.style.backgroundColor = '#000';
            faceAuthVideoElement.style.visibility = 'visible';

            const track = stream.getVideoTracks()[0];
            if (track) {
                track.onended = () => {
                    showWarning('Camera stopped unexpectedly. Reopen the camera to continue verification.');
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

            faceAuthVideoElement.onpause = () => {
                if (faceAuthVideoElement && faceAuthVideoElement.srcObject) {
                    faceAuthVideoElement.play().catch((pauseError) => {
                        console.warn('Face authentication feed paused, retrying playback:', pauseError);
                        showWarning('Camera paused unexpectedly. Click Start Live Camera again.');
                    });
                }
            };

            const onReady = async () => {
                if (faceAuthVideoElement.readyState < 2) {
                    return;
                }

                try {
                    await faceAuthVideoElement.play();
                } catch (playError) {
                    console.warn('Face authentication video playback failed:', playError);
                }

                hideWarning();
                if (statusEl) {
                    statusEl.textContent = 'Camera feed active. Checking faces against authorized profiles...';
                }
                startFaceAuthInference(faceAuthVideoElement, document.getElementById('faceAuthInferenceOutput'), statusEl, { reloadKnownFaces: true });
            };

            faceAuthVideoElement.removeEventListener('loadeddata', onReady);
            faceAuthVideoElement.removeEventListener('canplay', onReady);
            faceAuthVideoElement.removeEventListener('playing', onReady);

            faceAuthVideoElement.addEventListener('loadeddata', onReady, { once: true });
            faceAuthVideoElement.addEventListener('canplay', onReady, { once: true });
            faceAuthVideoElement.addEventListener('playing', onReady, { once: true });

            setTimeout(() => {
                if (faceAuthVideoElement && faceAuthVideoElement.readyState < 2) {
                    showWarning('Still waiting for camera feed. Please allow webcam permission or close other apps using the camera.');
                    if (statusEl) {
                        statusEl.textContent = 'Waiting for camera feed to start.';
                    }
                }
            }, 6000);
        }

        if (statusEl) {
            statusEl.textContent = 'Camera permission granted. Starting face authentication feed...';
        }
    } catch (error) {
        console.error('Face authentication camera access failed:', error);
        const details = describeCameraError(error);
        showWarning(details.warning);
        if (statusEl) {
            statusEl.textContent = details.status;
        }
    }
}

function releaseFaceAuthVideoUpload() {
    if (faceAuthVideoSourceUrl) {
        URL.revokeObjectURL(faceAuthVideoSourceUrl);
        faceAuthVideoSourceUrl = '';
    }
    if (faceAuthVideoElement && !faceAuthVideoElement.srcObject) {
        faceAuthVideoElement.removeAttribute('src');
        faceAuthVideoElement.load();
    }
}

function stopFaceAuthMonitoring() {
    stopFaceAuthInference();
    releaseFaceAuthVideoUpload();
    if (faceAuthVideoElement) {
        faceAuthVideoElement.pause();
        faceAuthVideoElement.style.visibility = 'hidden';
    }
    const statusEl = document.getElementById('faceAuthModelStatus');
    if (statusEl) {
        statusEl.textContent = 'Face authentication monitoring stopped.';
    }
    appendFaceAuthDetectionLogEntry({
        sourceLabel: 'System',
        summary: 'Monitoring stopped by user.',
        confidenceText: 'N/A',
        speedText: 'N/A',
        faceCount: 0,
        authorizedCount: 0,
        unauthorizedCount: 0
    });
}

function handleFaceAuthUpload(event) {
    const file = event.target.files && event.target.files[0];
    const statusEl = document.getElementById('faceAuthModelStatus');
    const warningEl = document.getElementById('faceAuthVideoWarning');
    const video = document.getElementById('faceAuthVideoPlayer');
    event.target.value = '';

    if (!file || !video) {
        return;
    }
    if (!file.type.startsWith('video/')) {
        if (statusEl) statusEl.textContent = 'Please select a valid video file.';
        return;
    }

    stopFaceAuthInference();
    faceAuthVideoElement = video;
    releaseFaceAuthVideoUpload();
    faceAuthVideoSourceUrl = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = faceAuthVideoSourceUrl;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.style.visibility = 'visible';
    video.style.backgroundColor = '#000';
    video.onpause = null;

    if (warningEl) warningEl.style.display = 'none';
    if (statusEl) statusEl.textContent = `Loading ${file.name} for face authentication...`;

    video.onloadeddata = async () => {
        try {
            await video.play();
            if (statusEl) statusEl.textContent = 'Uploaded video active. Verifying faces against authorized profiles...';
            startFaceAuthInference(video, document.getElementById('faceAuthInferenceOutput'), statusEl, { sourceType: 'upload', reloadKnownFaces: true });
        } catch (error) {
            console.error('Uploaded face authentication video playback failed:', error);
            if (statusEl) statusEl.textContent = 'Unable to play the uploaded video.';
        }
    };
    video.onended = () => {
        stopFaceAuthInference(false);
        if (statusEl) statusEl.textContent = 'Uploaded video finished. Face authentication stopped.';
    };
    video.onerror = () => {
        stopFaceAuthInference(false);
        if (statusEl) statusEl.textContent = 'Unable to load this video file.';
    };
}

function getFaceAuthFrameCaptureConfig(video, sourceType = 'live') {
    const maxWidth = sourceType === 'upload' ? FACE_AUTH_UPLOAD_CAPTURE_MAX_WIDTH : FACE_AUTH_LIVE_CAPTURE_MAX_WIDTH;
    const quality = sourceType === 'upload' ? 0.92 : 0.85;
    const intervalMs = sourceType === 'upload' ? FACE_AUTH_UPLOAD_INFERENCE_INTERVAL_MS : FACE_AUTH_LIVE_INFERENCE_INTERVAL_MS;
    const sourceWidth = Math.max(1, Number(video?.videoWidth) || 480);
    const sourceHeight = Math.max(1, Number(video?.videoHeight) || 360);
    const width = Math.min(maxWidth, sourceWidth);
    const height = Math.max(1, Math.round(width * (sourceHeight / sourceWidth)));
    return { width, height, quality, intervalMs };
}

function startFaceAuthInference(video, resultEl, statusEl, options = {}) {
    if (!video) return;
    stopFaceAuthInference(false);
    faceAuthInferenceInProgress = false;
    faceAuthUnauthorizedAlertShown = false;
    resetFaceAuthDetectionLogs();

    const sourceType = options.sourceType === 'upload' ? 'upload' : 'live';
    const captureConfig = getFaceAuthFrameCaptureConfig(video, sourceType);
    const sourceLabel = sourceType === 'upload' ? 'Uploaded video' : 'Live camera';
    let reloadKnownFacesPending = options.reloadKnownFaces === true;

    if (!faceAuthCanvas) {
        faceAuthCanvas = document.createElement('canvas');
    }
    faceAuthCanvas.width = captureConfig.width;
    faceAuthCanvas.height = captureConfig.height;

    const accuracyEl = document.getElementById('faceAuthAccuracy');
    const speedEl = document.getElementById('faceAuthSpeed');
    const authorizedCountEl = document.getElementById('faceAuthAuthorizedCount');
    const unauthorizedCountEl = document.getElementById('faceAuthUnauthorizedCount');
    if (authorizedCountEl) authorizedCountEl.textContent = '0';
    if (unauthorizedCountEl) unauthorizedCountEl.textContent = '0';

    faceAuthInferenceInterval = setInterval(async () => {
        if (faceAuthInferenceInProgress || video.readyState < 2) {
            return;
        }
        faceAuthInferenceInProgress = true;

        const ctx = faceAuthCanvas.getContext('2d');
        if (!ctx) {
            faceAuthInferenceInProgress = false;
            return;
        }

        ctx.drawImage(video, 0, 0, faceAuthCanvas.width, faceAuthCanvas.height);
        const imageDataUrl = faceAuthCanvas.toDataURL('image/jpeg', captureConfig.quality);
        const startTime = performance.now();

        try {
            const result = await requestFaceAuthInference(imageDataUrl, { reloadKnownFaces: reloadKnownFacesPending });
            reloadKnownFacesPending = false;
            const elapsed = performance.now() - startTime;
            const faces = Array.isArray(result?.faces) ? result.faces.map((face) => ({
                label: face.label || 'Unauthorized',
                confidence: Number(face.confidence) || 0,
                box: face.box || null,
                authorized: Boolean(face.authorized)
            })) : [];
            const faceCount = faces.length;
            const authorizedCount = Number(result?.authorizedCount) || faces.filter((face) => face.authorized).length;
            const unauthorizedCount = Number(result?.unauthorizedCount) || faces.filter((face) => !face.authorized).length;
            const confidence = Number(result?.topConfidence) || 0;

            renderFaceAuthBoxes(faces);

            if (authorizedCountEl) authorizedCountEl.textContent = String(authorizedCount);
            if (unauthorizedCountEl) unauthorizedCountEl.textContent = String(unauthorizedCount);
            if (accuracyEl) accuracyEl.textContent = `${Math.round(confidence * 100)}%`;
            if (speedEl) speedEl.textContent = `${Math.round(elapsed)} ms per frame`;

            if (statusEl) {
                statusEl.textContent = result?.summary || (faceCount > 0 ? 'Face authentication active.' : 'No face detected in the current frame.');
            }

            if (unauthorizedCount > 0 && !faceAuthUnauthorizedAlertShown) {
                faceAuthUnauthorizedAlertShown = true;
                showToast('Unauthorized face detected in the camera feed.', 'error');
            } else if (unauthorizedCount === 0) {
                faceAuthUnauthorizedAlertShown = false;
            }

            appendFaceAuthDetectionLogEntry({
                sourceLabel,
                summary: result?.summary || 'Face authentication active.',
                confidenceText: `${Math.round(confidence * 100)}%`,
                speedText: `${Math.round(elapsed)} ms per frame`,
                faceCount,
                authorizedCount,
                unauthorizedCount
            });
        } catch (error) {
            console.error('Face authentication request failed:', error);
            const message = error instanceof TypeError && error.message === 'Failed to fetch'
                ? 'Cannot reach the face authentication server. Run npm start, then open http://localhost:5000.'
                : error.message;
            if (statusEl) {
                statusEl.textContent = message;
            }
            if (resultEl) {
                resultEl.textContent = message;
            }
            if (accuracyEl) accuracyEl.textContent = 'N/A';
            if (speedEl) speedEl.textContent = 'N/A';
            if (authorizedCountEl) authorizedCountEl.textContent = '0';
            if (unauthorizedCountEl) unauthorizedCountEl.textContent = '0';
            appendFaceAuthDetectionLogEntry({
                sourceLabel,
                summary: message,
                confidenceText: 'N/A',
                speedText: 'N/A',
                faceCount: 0,
                authorizedCount: 0,
                unauthorizedCount: 0
            });
        } finally {
            faceAuthInferenceInProgress = false;
        }
    }, captureConfig.intervalMs);
}

function renderFaceAuthBoxes(faces) {
    const overlay = document.getElementById('faceAuthOverlay');
    if (!overlay) return;

    overlay.replaceChildren();
    const frameWidth = faceAuthCanvas?.width || 480;
    const frameHeight = faceAuthCanvas?.height || 360;

    faces.forEach((face) => {
        if (!Array.isArray(face.box) || face.box.length < 4) return;
        const [rawX, rawY, rawWidth, rawHeight] = face.box.map(Number);
        if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) || rawWidth <= 0 || rawHeight <= 0) return;

        const normalized = Math.max(rawX, rawY, rawWidth, rawHeight) <= 1;
        const left = normalized ? rawX * 100 : (rawX / frameWidth) * 100;
        const top = normalized ? rawY * 100 : (rawY / frameHeight) * 100;
        const width = normalized ? rawWidth * 100 : (rawWidth / frameWidth) * 100;
        const height = normalized ? rawHeight * 100 : (rawHeight / frameHeight) * 100;
        const safeLeft = Math.max(0, left);
        const safeTop = Math.max(0, top);
        const color = face.authorized ? '#16a34a' : '#dc2626';

        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${safeLeft}%;top:${safeTop}%;width:${Math.min(100 - safeLeft, width)}%;height:${Math.min(100 - safeTop, height)}%;border:3px solid ${color};box-shadow:0 0 0 1px rgba(255,255,255,.9);`;

        const label = document.createElement('span');
        label.textContent = `${face.label} ${Math.round(face.confidence * 100)}%`;
        label.style.cssText = `position:absolute;left:-3px;top:-28px;background:${color};color:#fff;padding:4px 7px;border-radius:6px 6px 6px 0;font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;`;
        box.appendChild(label);
        overlay.appendChild(box);
    });
}

function stopFaceAuthInference(stopStream = true) {
    if (faceAuthInferenceInterval) {
        clearInterval(faceAuthInferenceInterval);
        faceAuthInferenceInterval = null;
    }

    if (stopStream && faceAuthVideoElement && faceAuthVideoElement.srcObject) {
        const tracks = faceAuthVideoElement.srcObject.getTracks();
        tracks.forEach((track) => track.stop());
        faceAuthVideoElement.srcObject = null;
    }

    if (stopStream && faceAuthVideoElement && !faceAuthVideoElement.srcObject) {
        releaseFaceAuthVideoUpload();
    }

    faceAuthInferenceInProgress = false;
    renderFaceAuthBoxes([]);
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
        if (currentUser.role === 'student') {
            fetchStudentNotifications();
        }
    } else {
        resetNavAfterLogout();
    }

    loadDashboardData();
    fetchAnnouncements();
    setupAnnouncementSocket();
    setupGatePassDateValidation();
    setupCustomDatePickers();
    if (window.location.protocol === 'file:') {
        setTimeout(() => {
            showToast('Open HostelFix from http://localhost:5000 instead of the local file so gate pass photos and downloads work correctly.', 'warning');
        }, 700);
    }
    if (landing && landing.classList.contains('active')) {
        setTimeout(animateNumbers, 500);
    }
});

// Warden & Technician Admin Modal & CRUD Handlers
async function loadWardensList() {
    const container = document.getElementById('adminWardensGrid');
    if (!container) return;
    try {
        const response = await apiRequest('/api/wardens');
        if (!response.ok) throw new Error('Failed to fetch wardens');
        const wardens = await parseJsonResponse(response);
        const wardenArray = Array.isArray(wardens) ? wardens : [];
        renderAdminWardens(wardenArray);
        
        const countEl = document.getElementById('adminTotalWardens');
        if (countEl) countEl.textContent = String(wardenArray.length);
    } catch (error) {
        console.error('Error loading wardens:', error);
        container.innerHTML = `<div class="col-span-3 glass p-6 rounded-2xl text-center text-danger font-medium">Unable to load wardens list. Please check server connection.</div>`;
    }
}

async function loadTechniciansList() {
    const container = document.getElementById('adminTechniciansGrid');
    if (!container) return;
    try {
        const [techRes, compRes] = await Promise.all([
            apiRequest('/api/technicians'),
            apiRequest('/api/complaints')
        ]);
        if (!techRes.ok) throw new Error('Failed to fetch technicians');
        const technicians = await parseJsonResponse(techRes);
        const complaints = compRes.ok ? await parseJsonResponse(compRes) : [];
        const techArray = Array.isArray(technicians) ? technicians : [];
        renderAdminTechnicians(techArray, complaints);
        populateTechnicianDropdown(techArray);
        
        const countEl = document.getElementById('adminActiveTechnicians');
        if (countEl) countEl.textContent = String(techArray.length);
    } catch (error) {
        console.error('Error loading technicians:', error);
        container.innerHTML = `<div class="col-span-3 glass p-6 rounded-2xl text-center text-danger font-medium">Unable to load technicians list. Please check server connection.</div>`;
    }
}

function openAddWardenModal() {
    const modal = document.getElementById('addWardenModal');
    if (modal) modal.classList.remove('hidden');
}

function closeAddWardenModal() {
    const modal = document.getElementById('addWardenModal');
    if (modal) modal.classList.add('hidden');
}

async function handleAddWarden(event) {
    event.preventDefault();
    const name = document.getElementById('wardenName')?.value.trim();
    const email = document.getElementById('wardenEmail')?.value.trim();
    const hostelBlock = document.getElementById('wardenHostelBlock')?.value;
    const phone = document.getElementById('wardenPhone')?.value.trim();
    const password = document.getElementById('wardenPassword')?.value;

    if (!name || !email) {
        showToast('Please enter both name and email.', 'warning');
        return;
    }

    try {
        const response = await apiRequest('/api/wardens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, hostelBlock, phone })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to create warden');

        showToast(`Warden ${data.name} added successfully!`, 'success');
        closeAddWardenModal();
        event.target.reset();
        await loadWardensList();
        loadDashboardData().catch(e=>console.error(e));
    } catch (error) {
        showToast(error.message || 'Error creating warden account.', 'error');
    }
}

async function deleteWarden(id) {
    if (!confirm('Are you sure you want to remove this warden account?')) return;
    try {
        const response = await apiRequest(`/api/wardens/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to delete warden');
        showToast('Warden removed successfully.', 'success');
        await loadWardensList();
        loadDashboardData().catch(e=>console.error(e));
    } catch (error) {
        showToast(error.message || 'Error deleting warden.', 'error');
    }
}

function openAddTechnicianModal() {
    const modal = document.getElementById('addTechnicianModal');
    if (modal) modal.classList.remove('hidden');
}

function closeAddTechnicianModal() {
    const modal = document.getElementById('addTechnicianModal');
    if (modal) modal.classList.add('hidden');
}

async function handleAddTechnician(event) {
    event.preventDefault();
    const name = document.getElementById('techName')?.value.trim();
    const email = document.getElementById('techEmail')?.value.trim();
    const specialization = document.getElementById('techSpecialization')?.value;
    const phone = document.getElementById('techPhone')?.value.trim();
    const password = document.getElementById('techPassword')?.value;

    if (!name || !email) {
        showToast('Please enter both name and email.', 'warning');
        return;
    }

    try {
        const response = await apiRequest('/api/technicians', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, specialization, phone })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to create technician');

        showToast(`Technician ${data.name} added successfully!`, 'success');
        closeAddTechnicianModal();
        event.target.reset();
        await loadTechniciansList();
        loadDashboardData().catch(e=>console.error(e));
    } catch (error) {
        showToast(error.message || 'Error creating technician account.', 'error');
    }
}

async function deleteTechnician(id) {
    if (!confirm('Are you sure you want to remove this technician account?')) return;
    try {
        const response = await apiRequest(`/api/technicians/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to delete technician');
        showToast('Technician removed successfully.', 'success');
        await loadTechniciansList();
        loadDashboardData().catch(e=>console.error(e));
    } catch (error) {
        showToast(error.message || 'Error deleting technician.', 'error');
    }
}

function openEditWardenModal(id) {
    const wardens = window.currentWardensList || [];
    const warden = wardens.find(w => w.id === id || w.email === id);
    if (!warden) return;
    document.getElementById('editWardenId').value = warden.id || warden.email;
    document.getElementById('editWardenName').value = warden.name || '';
    document.getElementById('editWardenEmail').value = warden.email || '';
    document.getElementById('editWardenHostelBlock').value = warden.hostelBlock || 'Block A';
    document.getElementById('editWardenPhone').value = warden.phone || '+91 98765 43210';
    
    const modal = document.getElementById('editWardenModal');
    if (modal) modal.classList.remove('hidden');
}

function closeEditWardenModal() {
    const modal = document.getElementById('editWardenModal');
    if (modal) modal.classList.add('hidden');
}

async function handleEditWarden(event) {
    event.preventDefault();
    const id = document.getElementById('editWardenId')?.value;
    const name = document.getElementById('editWardenName')?.value.trim();
    const email = document.getElementById('editWardenEmail')?.value.trim();
    const hostelBlock = document.getElementById('editWardenHostelBlock')?.value;
    const phone = document.getElementById('editWardenPhone')?.value.trim();

    if (!id || !name || !email) return;

    try {
        const response = await apiRequest(`/api/wardens/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, hostelBlock, phone })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to update warden');

        showToast(`Warden ${data.name} updated successfully!`, 'success');
        closeEditWardenModal();
        await loadWardensList();
    } catch (error) {
        showToast(error.message || 'Error updating warden.', 'error');
    }
}

function openEditTechnicianModal(id) {
    const techs = window.currentTechniciansList || [];
    const tech = techs.find(t => t.id === id || t.email === id);
    if (!tech) return;
    document.getElementById('editTechId').value = tech.id || tech.email;
    document.getElementById('editTechName').value = tech.name || '';
    document.getElementById('editTechEmail').value = tech.email || '';
    document.getElementById('editTechSpecialization').value = tech.specialization || 'General Maintenance';
    document.getElementById('editTechPhone').value = tech.phone || '+91 98765 12345';
    
    const modal = document.getElementById('editTechnicianModal');
    if (modal) modal.classList.remove('hidden');
}

function closeEditTechnicianModal() {
    const modal = document.getElementById('editTechnicianModal');
    if (modal) modal.classList.add('hidden');
}

async function handleEditTechnician(event) {
    event.preventDefault();
    const id = document.getElementById('editTechId')?.value;
    const name = document.getElementById('editTechName')?.value.trim();
    const email = document.getElementById('editTechEmail')?.value.trim();
    const specialization = document.getElementById('editTechSpecialization')?.value;
    const phone = document.getElementById('editTechPhone')?.value.trim();

    if (!id || !name || !email) return;

    try {
        const response = await apiRequest(`/api/technicians/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, specialization, phone })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to update technician');

        showToast(`Technician ${data.name} updated successfully!`, 'success');
        closeEditTechnicianModal();
        await loadTechniciansList();
    } catch (error) {
        showToast(error.message || 'Error updating technician.', 'error');
    }
}


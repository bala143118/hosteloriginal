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
const CCTV_REVIEW_CONFIDENCE = 0.55;
const CCTV_FIRE_ALERT_CONFIDENCE = 0.65;
const CCTV_SMOKE_ALERT_CONFIDENCE = 0.65;
const CCTV_FIRE_EMERGENCY_PERSIST_MS = 3000;
const CCTV_SMOKE_EMERGENCY_PERSIST_MS = 3500;
const CROWD_ALERT_THRESHOLD = 20;
const CROWD_ALERT_STABLE_FRAMES = 3;
const CCTV_LIVE_CAPTURE_MAX_WIDTH = 640;
const CCTV_UPLOAD_CAPTURE_MAX_WIDTH = 960;
const CCTV_LIVE_INFERENCE_INTERVAL_MS = 700;
const CCTV_UPLOAD_INFERENCE_INTERVAL_MS = 350;
let cctvEmergencyAlertCooldownUntil = 0;
let lastEmergencyModalAlertId = '';
let lastEmergencyModalShownAt = 0;
let lastToastMap = new Map();
const handledSurveillanceEventIds = new Set();
let websiteSurveillanceStatusTimer = null;
const FACE_AUTH_INFERENCE_API = '/api/face-auth-inference';
const FACE_AUTH_LIVE_CAPTURE_MAX_WIDTH = 640;
const FACE_AUTH_UPLOAD_CAPTURE_MAX_WIDTH = 960;
const FACE_AUTH_LIVE_INFERENCE_INTERVAL_MS = 280;
const FACE_AUTH_UPLOAD_INFERENCE_INTERVAL_MS = 180;
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
let adminGatePassSearchQuery = '';
let currentAdminGatePassFilter = 'all';
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
    const alertMinConfidence = Math.min(99, Math.max(50, Math.round(Number.isFinite(alertMinConfidenceValue) ? alertMinConfidenceValue : (cctvAlertConfidenceThreshold * 100))));
    const telegramBotToken = document.getElementById('adminTelegramBotToken')?.value.trim() || '';
    const telegramChatId = document.getElementById('adminTelegramChatId')?.value.trim() || '';

    try {
        const response = await apiRequest('/api/admin-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alertCameraName, alertCameraLocation, alertMinConfidence, telegramBotToken, telegramChatId })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Unable to save emergency settings.');
        emergencyAlertCameraName = data.alertCameraName;
        emergencyAlertCameraLocation = data.alertCameraLocation;
        cctvAlertConfidenceThreshold = (Number(data.alertMinConfidence) || 75) / 100;
        updateTelegramStatusBadge(data.telegramConfigured);
        showToast('Emergency alert and Telegram settings saved successfully.', 'success');
    } catch (error) {
        showToast(error.message || 'Unable to save emergency settings.', 'error');
    }
}

function updateTelegramStatusBadge(isConfigured) {
    const badge = document.getElementById('adminTelegramStatusBadge');
    if (!badge) return;
    if (isConfigured) {
        badge.className = 'badge-completed px-3 py-1 rounded-full text-xs font-semibold';
        badge.textContent = 'Telegram Configured';
    } else {
        badge.className = 'badge-pending px-3 py-1 rounded-full text-xs font-semibold';
        badge.textContent = 'Not Configured';
    }
}

async function testTelegramAlertConnection() {
    const tokenInput = document.getElementById('adminTelegramBotToken');
    const chatIdInput = document.getElementById('adminTelegramChatId');
    const telegramBotToken = tokenInput?.value.trim() || '';
    const telegramChatId = chatIdInput?.value.trim() || '';
    const testBtn = document.getElementById('testTelegramAlertBtn');

    if (testBtn) {
        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> Testing...';
    }

    try {
        const response = await apiRequest('/api/test-telegram-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramBotToken, telegramChatId })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Telegram test failed.');
        updateTelegramStatusBadge(true);
        showToast(`Telegram verified! Test message sent to @${data.botUsername || 'Bot'}.`, 'success');
    } catch (error) {
        showToast(error.message || 'Telegram test failed. Check Bot Token and Chat ID.', 'error');
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i> Test Telegram Alert';
        }
    }
}

async function loadEmergencyAlertSettings() {
    const cameraInput = document.getElementById('emergencyAlertCamera');
    const locationInput = document.getElementById('emergencyAlertLocation');
    const confidenceInput = document.getElementById('emergencyAlertConfidence');
    const tokenInput = document.getElementById('adminTelegramBotToken');
    const chatIdInput = document.getElementById('adminTelegramChatId');
    if (!cameraInput && !locationInput && !confidenceInput) return;

    try {
        const response = await apiRequest('/api/admin-settings');
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Unable to load emergency settings.');
        if (cameraInput) cameraInput.value = data.alertCameraName || emergencyAlertCameraName;
        if (locationInput) locationInput.value = data.alertCameraLocation || emergencyAlertCameraLocation;
        if (confidenceInput) confidenceInput.value = Number(data.alertMinConfidence) || 75;
        if (tokenInput && data.telegramBotToken) tokenInput.value = data.telegramBotToken;
        if (chatIdInput && data.telegramChatId) chatIdInput.value = data.telegramChatId;
        emergencyAlertCameraName = data.alertCameraName || emergencyAlertCameraName;
        emergencyAlertCameraLocation = data.alertCameraLocation || emergencyAlertCameraLocation;
        cctvAlertConfidenceThreshold = (Number(data.alertMinConfidence) || 75) / 100;
        updateTelegramStatusBadge(data.telegramConfigured);
    } catch (error) {
        console.warn('Unable to load emergency settings:', error.message);
    }
}

function renderAlertHistory(alerts) {
    const body = document.getElementById('alertHistoryTableBody');
    const mobileList = document.getElementById('alertHistoryMobileList');
    const alertList = Array.isArray(alerts) ? alerts : [];
    const statusClass = (alert) => alert.telegramStatus === 'Sent' ? 'badge-completed' : alert.telegramStatus === 'Not Configured' ? 'badge-pending' : 'badge-high';

    if (body) {
        body.innerHTML = alertList.length ? alertList.map((alert) => `<tr>
            <td class="px-4 py-3 whitespace-nowrap">${escapeHtml(alert.date || '-')}<br><span class="text-xs text-text-secondary">${escapeHtml(alert.time || '-')}</span></td>
            <td class="px-4 py-3 font-medium whitespace-nowrap">${escapeHtml(alert.detectionType || '-')}</td>
            <td class="px-4 py-3 whitespace-nowrap">${escapeHtml(alert.confidence ?? '-')}%</td>
            <td class="px-4 py-3">${escapeHtml(alert.cameraName || alert.camera || '-')}<br><span class="text-xs text-text-secondary">${escapeHtml(alert.location || '')}</span></td>
            <td class="px-4 py-3 whitespace-nowrap"><span class="${statusClass(alert)} px-2.5 py-0.5 rounded-full text-xs">${escapeHtml(alert.telegramStatus || alert.status || '-')}</span></td>
            <td class="px-4 py-3">${alert.imagePath ? `<a href="${escapeHtml(alert.imagePath)}" target="_blank" rel="noopener"><img src="${escapeHtml(alert.imagePath)}" alt="Emergency screenshot" class="h-12 w-16 rounded-lg object-cover border border-border"></a>` : '-'}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="py-5 text-center text-text-secondary">No alerts have been logged yet.</td></tr>';
    }

    if (mobileList) {
        mobileList.innerHTML = alertList.length ? alertList.map((alert) => `
            <article class="rounded-xl border border-border bg-surface-alt p-4 space-y-3">
                <div class="flex items-start justify-between gap-3">
                    <div><p class="font-semibold text-text">${escapeHtml(alert.detectionType || 'Emergency Alert')}</p><p class="mt-0.5 text-xs text-text-secondary">${escapeHtml(alert.date || '-')} · ${escapeHtml(alert.time || '-')}</p></div>
                    <span class="${statusClass(alert)} shrink-0 px-2.5 py-0.5 rounded-full text-xs">${escapeHtml(alert.telegramStatus || alert.status || '-')}</span>
                </div>
                <div class="grid grid-cols-2 gap-3 text-xs">
                    <div><p class="text-text-muted">Confidence</p><p class="mt-1 font-semibold text-text">${escapeHtml(alert.confidence ?? '-')}%</p></div>
                    <div><p class="text-text-muted">Camera</p><p class="mt-1 font-semibold text-text break-words">${escapeHtml(alert.cameraName || alert.camera || '-')}</p></div>
                </div>
                ${alert.location ? `<p class="border-t border-border pt-3 text-xs text-text-secondary"><i class="fa-solid fa-location-dot mr-1 text-primary"></i>${escapeHtml(alert.location)}</p>` : ''}
            </article>`).join('') : '<div class="rounded-xl border border-border bg-surface-alt px-4 py-5 text-center text-sm text-text-secondary">No alerts have been logged yet.</div>';
    }
}

async function loadAlertHistory() {
    const response = await apiRequest('/api/alert-history');
    const data = await parseJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Unable to load alert history.');
    renderAlertHistory(data);
}

function showEmergencyBrowserNotification(alert) {
    const now = Date.now();
    const alertKey = `${alert.id || ''}::${alert.cameraName || alert.camera || ''}::${alert.detectionType || ''}`;
    if (lastEmergencyModalAlertId === alertKey && now - lastEmergencyModalShownAt < 30000) {
        return; // Prevent duplicate overlapping emergency modals
    }
    lastEmergencyModalAlertId = alertKey;
    lastEmergencyModalShownAt = now;

    playNotificationTone();
    const camera = alert.cameraName || alert.camera;
    showToast(`Emergency: ${alert.detectionType} detected at ${camera} (${alert.confidence}%).`, 'error');
    const feed = document.getElementById('cctvVideoPlayer')?.parentElement;
    if (feed) {
        feed.style.boxShadow = 'inset 0 0 0 5px #ef4444, 0 0 32px rgba(239,68,68,.85)';
        setTimeout(() => { feed.style.boxShadow = ''; }, 30000);
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
    if (cctvEmergencyAlertSent || cctvEmergencyAlertInFlight || Date.now() < cctvEmergencyAlertCooldownUntil) return;
    cctvEmergencyAlertInFlight = true;
    cctvEmergencyAlertSent = true;
    cctvEmergencyAlertCooldownUntil = Date.now() + 60000;

    try {
        const response = await apiRequest('/api/send-telegram-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: prediction.detectionType || (FireDetectionUtils.isFireLabel(prediction.label) ? 'Fire' : 'Smoke'),
                confidence: prediction.confidence,
                camera: emergencyAlertCameraName,
                location: emergencyAlertCameraLocation,
                image: imageDataUrl
            })
        });
        const data = await parseJsonResponse(response);
        if (response.status === 202 && data.status === 'cooldown') {
            return;
        }
        if (data.telegramConfigured === false) {
            showToast('Emergency alert logged. Telegram is not configured in Admin Settings.', 'warning');
            return;
        }
        if (data.success === false && data.warning) {
            showToast(data.warning, 'warning');
            return;
        }
        if (response.ok && data.message) {
            showToast(data.message || 'Telegram emergency alert sent successfully.', 'success');
        }
    } catch (error) {
        console.warn('Telegram emergency alert request error:', error.message);
        showToast('Emergency alert recorded locally.', 'info');
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

    const navProfileBtn = document.getElementById('navProfileBtn');
    if (navProfileBtn) {
        if (!currentUser || pageId === 'login' || pageId === 'register') {
            navProfileBtn.classList.add('hidden');
        } else {
            navProfileBtn.classList.remove('hidden');
            navProfileBtn.innerHTML = `<i class="fa-solid fa-user"></i><span>${currentUser?.name || 'Profile'}</span>`;
            navProfileBtn.onclick = () => navigateTo('profile');
        }
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

    if (pageId.startsWith('admin-') || pageId.startsWith('technician-') || pageId === 'warden-dashboard' || pageId === 'security-dashboard') {
        loadDashboardData().then(() => {
            if (pageId === 'warden-dashboard') renderWardenDashboard();
            if (pageId === 'security-dashboard') renderSecurityDashboard();
            if (pageId === 'admin-gate-passes') renderAdminGatePassLogsPage();
            if (pageId === 'admin-laundry') renderAdminLaundryRequests();
        }).catch((error) => console.error(error));
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
        (currentEmail && (normalizeText(notification.targetEmail) === currentEmail || normalizeText(notification.email) === currentEmail))
        || (currentName && (normalizeText(notification.targetName) === currentName || normalizeText(notification.student) === currentName))
        || (currentRegistrationNumber && (normalizeText(notification.targetRegistrationNumber) === currentRegistrationNumber || normalizeText(notification.registrationNumber) === currentRegistrationNumber))
        || (currentUserId && (normalizeText(notification.targetUserId) === currentUserId || normalizeText(notification.userId) === currentUserId))
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

async function prepareComplaintForm() {
    const studentNameInput = document.getElementById('complaintStudentName');
    const regInput = document.getElementById('complaintRegistrationNumber');
    const roomInput = document.getElementById('complaintRoomNumber');
    const hostelBlockInput = document.getElementById('complaintHostelBlock');

    if (studentNameInput) {
        studentNameInput.readOnly = false;
        studentNameInput.value = currentUser?.name || '';
    }
    if (regInput) {
        regInput.readOnly = false;
        regInput.value = currentUser?.registrationNumber || '';
    }
    if (roomInput) {
        roomInput.readOnly = false;
        roomInput.value = currentUser?.roomNumber || '';
    }
    if (hostelBlockInput) {
        hostelBlockInput.disabled = false;
        if (currentUser?.hostelBlock) hostelBlockInput.value = currentUser.hostelBlock;
    }

    try {
        const res = await apiRequest('/api/technicians');
        if (res.ok) {
            const techList = await parseJsonResponse(res);
            populateTechnicianDropdown(techList);
        }
    } catch (e) {
        console.warn('Unable to load technician list in complaint form:', e);
    }
}

let selectedLaundryPhotos = [];

async function handleLaundryPhotoSelect(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    showLoading();
    try {
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                showToast('Please select valid image files (PNG, JPG, JPEG).', 'warning');
                continue;
            }
            if (selectedLaundryPhotos.length >= 6) {
                showToast('Maximum 6 laundry photos allowed per request.', 'warning');
                break;
            }
            const dataUrl = await resizeImageToJpeg(file, 800, 0.82);
            selectedLaundryPhotos.push(dataUrl);
        }
        renderLaundryPhotoPreviews();
    } catch (err) {
        console.error('Error processing laundry photo:', err);
        showToast('Could not process selected image file.', 'error');
    } finally {
        hideLoading();
        if (event.target) event.target.value = '';
    }
}

function removeLaundryPhoto(index) {
    if (index >= 0 && index < selectedLaundryPhotos.length) {
        selectedLaundryPhotos.splice(index, 1);
        renderLaundryPhotoPreviews();
    }
}

function renderLaundryPhotoPreviews() {
    const container = document.getElementById('laundryPhotoPreviewList');
    if (!container) return;

    if (!selectedLaundryPhotos.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = selectedLaundryPhotos.map((imgSrc, idx) => `
        <div class="relative group rounded-xl overflow-hidden border border-border bg-surface shadow-xs aspect-square">
            <img src="${imgSrc}" alt="Laundry dress photo ${idx + 1}" class="w-full h-full object-cover cursor-pointer" onclick="showLaundryImageModal('${imgSrc}')">
            <button type="button" onclick="removeLaundryPhoto(${idx})" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center text-xs hover:bg-danger transition-colors">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <span class="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">#${idx + 1}</span>
        </div>
    `).join('');
}

function showLaundryImageModal(src) {
    const modal = document.getElementById('laundryPhotoModal');
    const modalImg = document.getElementById('laundryPhotoModalImg');
    if (modal && modalImg) {
        modalImg.src = src;
        modal.classList.remove('hidden');
    } else {
        showModal('Laundry Photo Preview', `<div class="text-center p-4"><img src="${src}" class="max-h-[70vh] mx-auto rounded-xl shadow-lg border border-border"></div>`);
    }
}

function closeLaundryPhotoModal() {
    const modal = document.getElementById('laundryPhotoModal');
    if (modal) modal.classList.add('hidden');
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

    selectedLaundryPhotos = [];
    renderLaundryPhotoPreviews();
    renderStudentLaundryHistory();
}

function renderStudentLaundryHistory() {
    const container = document.getElementById('studentLaundryHistoryList');
    if (!container) return;

    const myRequests = (latestLaundryRequests || []).filter(req => {
        if (!currentUser) return true;
        const studentEmail = (currentUser.email || '').toLowerCase();
        const reqEmail = (req.email || '').toLowerCase();
        const studentName = (currentUser.name || '').toLowerCase();
        const reqStudent = (req.student || '').toLowerCase();
        return (studentEmail && reqEmail === studentEmail) || (studentName && reqStudent === studentName);
    });

    if (!myRequests.length) {
        container.innerHTML = '<div class="rounded-2xl border border-dashed border-border bg-surface-alt p-6 text-center text-text-secondary text-sm">You have not submitted any laundry requests yet.</div>';
        return;
    }

    container.innerHTML = myRequests.map(request => {
        const photos = Array.isArray(request.photos) ? request.photos : (request.photo ? [request.photo] : []);
        const formattedPickup = request.pickupDate ? formatGatePassDate(request.pickupDate) : '⏳ Not assigned yet (Admin will specify pickup date)';
        
        let statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">Pending</span>';
        if (request.status === 'Pickup Scheduled') statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">Pickup Scheduled</span>';
        if (request.status === 'Picked Up') statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">Picked Up</span>';
        if (request.status === 'Completed') statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald/20 text-emerald-800 border border-emerald/30">Completed</span>';
        if (request.status === 'Cancelled') statusBadge = '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">Cancelled</span>';

        return `
            <div class="glass rounded-2xl border border-border p-5 space-y-3 bg-surface/90">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                    <div>
                        <span class="text-xs font-mono font-bold text-primary mr-2">${request.id || ''}</span>
                        <span class="text-xs text-text-secondary">${formatGatePassDate(request.createdAt || new Date().toISOString())}</span>
                    </div>
                    <div>${statusBadge}</div>
                </div>

                <div class="grid sm:grid-cols-2 gap-4 text-xs">
                    <div>
                        <p class="text-text-secondary">Dress Count: <strong class="text-text font-bold">${request.dressCount || 0} items</strong></p>
                        <p class="text-text-secondary mt-1">Room & Block: <strong class="text-text">${request.hostelBlock || ''} • Room ${request.roomNumber || ''}</strong></p>
                        <p class="text-text-secondary mt-1">Details: <span class="text-text">${request.details || 'None'}</span></p>
                    </div>
                    <div class="bg-surface-alt/70 p-3 rounded-xl border border-border">
                        <p class="text-xs font-semibold text-text mb-1 flex items-center gap-1.5">
                            <i class="fa-solid fa-calendar-day text-emerald"></i> Pickup Date:
                        </p>
                        <p class="text-xs ${request.pickupDate ? 'font-bold text-emerald' : 'text-amber-600 font-medium'}">
                            ${formattedPickup}
                        </p>
                    </div>
                </div>

                ${photos.length ? `
                    <div class="pt-2">
                        <p class="text-[11px] font-medium text-text-secondary mb-1.5">Uploaded Dress Photos (${photos.length}):</p>
                        <div class="flex flex-wrap gap-2">
                            ${photos.map((src, i) => `
                                <img src="${src}" alt="Dress photo ${i+1}" onclick="showLaundryImageModal('${src}')" class="w-14 h-14 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-opacity">
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
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

        const isLaundry = String(announcement.type || '').startsWith('laundry') || String(announcement.title || '').toLowerCase().includes('laundry');
        const iconClass = isEmergency
            ? 'fa-triangle-exclamation text-danger bg-danger/10'
            : isLaundry
                ? 'fa-shirt text-indigo-600 bg-indigo-50 border border-indigo-200'
                : isImportant
                    ? 'fa-circle-exclamation text-amber-600 bg-amber-500/10'
                    : 'fa-bell text-primary bg-primary/10';

        const iconName = isEmergency ? 'fa-triangle-exclamation' : isLaundry ? 'fa-shirt' : isImportant ? 'fa-circle-exclamation' : 'fa-bell';

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

function playChimeSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.08, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.25);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.1);
        gain2.gain.setValueAtTime(0.08, now + 0.1);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.1);
        osc2.stop(now + 0.35);

        setTimeout(() => { ctx.close().catch(() => {}); }, 400);
    } catch (err) {
        // Safe silent fail for browser audio policies
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
        const handleSurveillanceAlert = (event) => {
            if (!event || !['admin', 'warden'].includes(currentUser?.role)) return;
            if (event.event_id && handledSurveillanceEventIds.has(event.event_id)) return;
            if (event.event_id) handledSurveillanceEventIds.add(event.event_id);
            playNotificationTone();
            showToast(`🚨 Unauthorized night activity: ${event.student_name || 'Unknown person'} • ${event.camera_id || 'CCTV'}`, 'error');
            loadSecurityAlertStats().catch(console.error);
            if (getActivePageId() === 'admin-dashboard' || getActivePageId() === 'warden-dashboard') {
                showModal('🚨 NIGHT RESTRICTION ALERT', `<div class="space-y-4"><div class="rounded-2xl border border-rose-300 bg-rose-500/10 p-4"><p class="font-bold text-rose-700">Unauthorized activity detected</p><p class="text-sm text-text-secondary mt-1">Evidence captured from ${escapeHtml(event.camera_id || 'Hostel CCTV')}</p></div><div class="grid sm:grid-cols-2 gap-3 text-sm"><div><p class="text-xs text-text-secondary">Student</p><p class="font-semibold">${escapeHtml(event.student_name || 'Unknown person')}</p></div><div><p class="text-xs text-text-secondary">ID</p><p class="font-semibold">${escapeHtml(event.student_id || 'Unknown')}</p></div><div><p class="text-xs text-text-secondary">Time</p><p class="font-semibold">${escapeHtml(new Date(event.timestamp).toLocaleString())}</p></div><div><p class="text-xs text-text-secondary">Status</p><p class="font-semibold text-rose-600">UNAUTHORIZED</p></div></div><div class="flex gap-2"><button onclick='openSecurityEvidence(${JSON.stringify(event)})' class="flex-1 px-4 py-3 rounded-xl bg-primary text-white font-semibold">View Evidence</button><button onclick="acknowledgeSecurityEvent('${event.event_id}')" class="flex-1 px-4 py-3 rounded-xl bg-emerald text-white font-semibold">Acknowledge</button></div></div>`);
            }
        };
        announcementSocket.on('security_alert', handleSurveillanceAlert);
        announcementSocket.on('surveillance_alert', handleSurveillanceAlert);
        announcementSocket.on('surveillance_status_changed', () => {
            refreshWebsiteSurveillanceStatus().catch(() => null);
        });
        announcementSocket.on('disconnect', () => {
            if (['admin', 'warden'].includes(currentUser?.role)) showToast('🔴 REAL-TIME CONNECTION LOST', 'warning');
        });
        announcementSocket.on('reconnect', () => {
            if (['admin', 'warden'].includes(currentUser?.role)) {
                showToast('🟢 REAL-TIME CONNECTED', 'success');
                loadSecurityAlertStats().catch(console.error);
            }
        });
        announcementSocket.on('security_alert.acknowledged', () => loadSecurityAlertStats().catch(console.error));
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
        announcementSocket.on('gate-pass.created', (payload) => {
            const gatePass = payload?.gatePass || payload;
            if (!gatePass || !gatePass.id) return;
            latestGatePasses = [gatePass, ...latestGatePasses.filter((entry) => entry?.id !== gatePass.id)];
            renderGatePassTable(latestGatePasses);
            renderWardenDashboard();
            renderSecurityDashboard();
            const gatePassCount = document.getElementById('adminGatePassCount');
            if (gatePassCount) gatePassCount.textContent = `${latestGatePasses.length}`;
            if (currentUser?.role === 'admin' || currentUser?.role === 'warden') {
                playNotificationTone();
                const retInfo = gatePass.returnDate ? ` — Expected Return: ${formatGatePassDate(gatePass.returnDate)}` : '';
                showToast(`🔔 New Gate Pass: ${gatePass.student || 'Student'} (${gatePass.hostelBlock || 'Hostel'})${retInfo}`, 'info');
            }
        });
        announcementSocket.on('warden-notification.created', (notification) => {
            if (!notification || (currentUser?.role !== 'warden' && currentUser?.role !== 'admin')) return;
            playNotificationTone();
            showToast(`📢 ${notification.title || 'Warden Alert'}: ${notification.message || ''}`, 'info');
            renderWardenDashboard();
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

function confirmEmergencyCall(event, number, label) {
    event.preventDefault();
    if (confirm(`Do you want to initiate an emergency call to ${label} (${number})?`)) {
        window.location.href = `tel:${number}`;
    }
}

function getStatusBadgeClass(status = 'Pending') {
    const lower = String(status).toLowerCase();
    if (lower === 'completed' || lower === 'resolved') return 'badge-completed';
    if (lower === 'in progress' || lower === 'progress') return 'badge-progress';
    if (lower === 'pending') return 'badge-pending';
    return 'badge-pending';
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
    const trimmed = String(dateString).trim();
    const parts = trimmed.split('T')[0].split('-');
    if (parts.length === 3 && parts[0].length === 4) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const date = new Date(year, month, day);
        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }
    }
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
    const liveCard = document.getElementById('studentGatePassLiveCard');
    const legacyCard = document.getElementById('gatePassQrCard');
    const pass = latestGatePasses.find(isGatePassForCurrentUser);

    if (!pass) {
        if (liveCard) liveCard.classList.add('hidden');
        if (legacyCard) legacyCard.classList.add('hidden');
        return;
    }

    const rawStatus = String(pass.status || 'PENDING_WARDEN').toUpperCase();
    const isPendingWarden = ['PENDING_WARDEN', 'PENDING_ADMIN', 'REQUESTED', 'PENDING'].includes(rawStatus);
    const isSecurityPending = rawStatus === 'SECURITY_PENDING' || rawStatus === 'QR GENERATED' || rawStatus === 'APPROVED';
    const isOutside = rawStatus === 'OUTSIDE' || rawStatus === 'OUT';
    const isOutsideNotReturned = rawStatus === 'OUTSIDE_NOT_RETURNED';
    const isCompleted = rawStatus === 'COMPLETED';
    const isRejected = rawStatus.includes('REJECTED');

    let badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
    let badgeText = 'Pending Warden Approval';

    if (isSecurityPending) {
        badgeClass = 'bg-emerald/10 text-emerald border border-emerald/20';
        badgeText = 'Approved • Ready for Security Scan';
    } else if (isOutside) {
        badgeClass = 'bg-blue-100 text-blue-800 border border-blue-200';
        badgeText = 'Outside • Gate Crossed';
    } else if (isOutsideNotReturned) {
        badgeClass = 'bg-amber-100 text-amber-900 border border-amber-300';
        badgeText = '⚠️ Outside — Not Returned';
    } else if (isCompleted) {
        badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
        badgeText = '✅ Completed & Returned';
    } else if (isRejected) {
        badgeClass = 'bg-danger/10 text-danger border border-danger/20';
        badgeText = rawStatus === 'SECURITY_REJECTED' ? '❌ Security Exit Rejected' : '❌ Pass Rejected';
    }

    if (liveCard) {
        liveCard.classList.remove('hidden');
        const badgeEl = document.getElementById('studentLivePassBadge');
        const idEl = document.getElementById('studentLivePassId');
        const datesEl = document.getElementById('studentLivePassDates');
        const roomEl = document.getElementById('studentLivePassRoom');
        const sessionEl = document.getElementById('studentLivePassSession');
        const wardenEl = document.getElementById('studentLivePassWarden');
        const qrImg = document.getElementById('studentLiveQrImg');
        const qrPlaceholder = document.getElementById('studentLiveQrPlaceholder');

        if (badgeEl) {
            badgeEl.className = `px-3 py-1 rounded-full text-xs font-bold ${badgeClass}`;
            badgeEl.textContent = badgeText;
        }
        if (idEl) {
            idEl.innerHTML = `ID: <span class="font-mono font-bold">${pass.id || 'N/A'}</span>${pass.certificateId ? ` • <span class="text-xs text-primary font-mono">${pass.certificateId}</span>` : ''}`;
        }
        if (datesEl) datesEl.textContent = `Valid: ${formatGatePassDate(pass.gateDate)} ➔ ${formatGatePassDate(pass.returnDate)}`;
        if (roomEl) roomEl.textContent = `${pass.hostelBlock || 'Block A'} • Room ${pass.roomNumber || 'N/A'}`;
        if (sessionEl) sessionEl.textContent = pass.session || 'General';
        if (wardenEl) wardenEl.textContent = pass.approvedBy ? `Approved by ${pass.approvedBy}` : 'Warden Review Pending';

        if (qrImg && qrPlaceholder) {
            const hasApprovedQr = pass.qrImage && !isPendingWarden && !isRejected;
            if (hasApprovedQr) {
                qrImg.src = pass.qrImage;
                qrImg.classList.remove('hidden');
                qrPlaceholder.classList.add('hidden');
            } else {
                qrImg.classList.add('hidden');
                qrPlaceholder.classList.remove('hidden');
                qrPlaceholder.innerHTML = isRejected ? `
                    <div class="space-y-1">
                        <i class="fa-solid fa-ban text-2xl text-danger block mb-1"></i>
                        <p class="font-bold text-danger text-xs">Pass Rejected</p>
                        <p class="text-[9px] text-text-muted leading-tight">${pass.securityRejectionReason || pass.facultyRemarks || 'Request was not approved.'}</p>
                    </div>
                ` : `
                    <div class="space-y-1">
                        <i class="fa-solid fa-hourglass-half text-2xl text-amber-500 block mb-1"></i>
                        <p class="font-bold text-amber-800 text-xs">Pending Warden Approval</p>
                        <p class="text-[9px] text-text-muted leading-tight">One unique QR code will be generated upon warden approval</p>
                    </div>
                `;
            }
        }
    }

    if (legacyCard) {
        legacyCard.classList.remove('hidden');
        const statusText = document.getElementById('gatePassQrStatus');
        const image = document.getElementById('gatePassQrImage');
        const expiry = document.getElementById('gatePassQrExpiry');
        const download = document.getElementById('downloadGatePassQrButton');
        const timeline = document.getElementById('gatePassTimeline');
        if (statusText) statusText.textContent = `${pass.id} · ${pass.status || 'Pending'}`;
        if (image) { image.src = pass.qrImage || ''; image.classList.toggle('hidden', !pass.qrImage); }
        if (expiry) expiry.textContent = pass.expiryDate ? `Valid until ${new Date(pass.expiryDate).toLocaleString()}` : 'QR appears after faculty approval.';
        if (download) download.classList.toggle('hidden', !pass.qrImage);
        if (timeline) {
            const steps = ['REQUESTED', 'QR GENERATED', 'OUT', 'RETURNED', 'COMPLETED'];
            const current = steps.indexOf(pass.status || 'REQUESTED');
            timeline.innerHTML = steps.map((step, index) => `<span class="px-2.5 py-1 rounded-full ${index <= current ? 'bg-primary/10 text-primary font-semibold' : 'bg-surface-alt text-text-secondary'}">${step}</span>`).join('');
        }
    }
}

function downloadCurrentUserGatePassPdf() {
    const pass = latestGatePasses.find(isGatePassForCurrentUser);
    if (!pass || !pass.id) {
        showToast('No active gate pass found for your account.', 'warning');
        return;
    }
    downloadGatePassPdf(pass.id);
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

function handleAdminGatePassSearch(query) {
    adminGatePassSearchQuery = String(query || '').trim().toLowerCase();
    showAllAdminGatePassRows = Boolean(adminGatePassSearchQuery);
    renderGatePassTable(latestGatePasses);
}

function renderGatePassTable(gatePasses = []) {
    const tableBody = document.getElementById('adminGatePassTableBody');
    const seeAllButton = document.getElementById('adminGatePassSeeAllButton');
    const countBadge = document.getElementById('adminGatePassCount');
    const sidebarBadge = document.getElementById('adminSidebarGatePassBadge');

    if (countBadge) countBadge.textContent = String(gatePasses.length || 0);
    if (sidebarBadge) sidebarBadge.textContent = String(gatePasses.length || 0);
    document.querySelectorAll('.admin-gate-pass-badge').forEach(el => el.textContent = String(gatePasses.length || 0));

    renderStudentGatePassQr();
    if (!tableBody) return;

    const defaultVisibleRows = 4;
    const filteredGatePasses = gatePasses.filter((entry) => {
        if (!adminGatePassSearchQuery) return true;
        const searchableText = [
            entry.id,
            entry.certificateId,
            entry.student,
            entry.registrationNumber,
            entry.reason,
            entry.session,
            entry.status,
            entry.gateDate,
            entry.returnDate
        ].filter(Boolean).join(' ').toLowerCase();
        return searchableText.includes(adminGatePassSearchQuery);
    });

    if (!filteredGatePasses.length) {
        tableBody.innerHTML = `<tr><td colspan="10" class="px-6 py-8 text-sm text-text-secondary text-center">${gatePasses.length ? 'No gate pass requests match your search.' : 'No gate pass requests recorded yet.'}</td></tr>`;
        if (seeAllButton) seeAllButton.classList.add('hidden');
        return;
    }

    if (seeAllButton) {
        if (filteredGatePasses.length > defaultVisibleRows && !adminGatePassSearchQuery) {
            seeAllButton.classList.remove('hidden');
            seeAllButton.textContent = showAllAdminGatePassRows ? `Show less (${defaultVisibleRows})` : `See all (${filteredGatePasses.length})`;
        } else {
            seeAllButton.classList.add('hidden');
        }
    }

    const visibleGatePasses = showAllAdminGatePassRows ? filteredGatePasses : filteredGatePasses.slice(0, defaultVisibleRows);

    tableBody.innerHTML = visibleGatePasses.map((entry) => {
        const rawStatus = String(entry.status || 'PENDING_WARDEN').toUpperCase();
        const isPendingWarden = ['PENDING_WARDEN', 'PENDING_ADMIN', 'PENDING', 'REQUESTED'].includes(rawStatus);
        const isApproved = ['SECURITY_PENDING', 'APPROVED', 'QR GENERATED'].includes(rawStatus);
        const isOutside = rawStatus === 'OUTSIDE' || rawStatus === 'OUT';
        const isOutsideNotReturned = rawStatus === 'OUTSIDE_NOT_RETURNED';
        const isCompleted = rawStatus === 'COMPLETED';
        const isRejected = rawStatus.includes('REJECTED');

        let statusBadgeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs"><i class="fa-solid fa-clock text-amber-600"></i> Pending Warden</span>`;

        if (isApproved) {
            statusBadgeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald/10 text-emerald border border-emerald/30 shadow-2xs"><i class="fa-solid fa-qrcode text-emerald"></i> Approved (QR Ready)</span>`;
        } else if (isOutside) {
            statusBadgeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300 shadow-2xs"><i class="fa-solid fa-door-open text-blue-600"></i> Outside (Gate Crossed)</span>`;
        } else if (isOutsideNotReturned) {
            statusBadgeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-900 border border-rose-300 shadow-2xs"><i class="fa-solid fa-triangle-exclamation text-rose-600"></i> Outside (Not Returned)</span>`;
        } else if (isCompleted) {
            statusBadgeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs"><i class="fa-solid fa-circle-check text-emerald-600"></i> Completed</span>`;
        } else if (isRejected) {
            statusBadgeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-danger/10 text-danger border border-danger/30 shadow-2xs"><i class="fa-solid fa-circle-xmark text-danger"></i> Rejected</span>`;
        }

        return `
            <tr class="table-row hover:bg-surface-alt/50 transition-colors">
                <td class="px-6 py-4 text-xs font-mono font-bold text-primary cursor-pointer hover:underline" onclick="viewGatePassDetailsModal('${entry.id}')" title="Click to view full details">
                    ${entry.id || 'N/A'}
                    ${entry.certificateId ? `<span class="block text-[10px] text-text-muted font-normal">${entry.certificateId.slice(0, 14)}...</span>` : ''}
                </td>
                <td class="px-6 py-4 text-sm font-semibold text-text">${entry.student || 'Anonymous'}</td>
                <td class="px-6 py-4 text-xs font-mono text-text-secondary">${entry.registrationNumber || 'N/A'}</td>
                <td class="px-6 py-4 text-xs text-text-secondary max-w-[160px] truncate" title="${entry.reason || 'General'}">${entry.reason || 'General'}</td>
                <td class="px-6 py-4 text-xs font-medium">${entry.session || 'Morning'}</td>
                <td class="px-6 py-4 text-xs text-text-secondary">${formatGatePassDate(entry.gateDate)}</td>
                <td class="px-6 py-4 text-xs font-medium text-amber-700">${formatGatePassDate(entry.returnDate)}</td>
                <td class="px-6 py-4">${statusBadgeHtml}</td>
                <td class="px-6 py-4 text-sm text-text-secondary">
                    ${entry.studentPhoto
                        ? `<img src="${entry.studentPhoto}" alt="Student photo" class="w-10 h-10 rounded-xl object-cover border border-border shadow-2xs cursor-pointer hover:scale-110 transition-transform" onclick="viewGatePassDetailsModal('${entry.id}')">`
                        : `<div class="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-xs text-indigo-600">${(entry.student || 'S').slice(0, 2).toUpperCase()}</div>`}
                </td>
                <td class="px-6 py-4 text-xs">
                    ${isPendingWarden ? `
                        <div class="flex flex-wrap items-center gap-1.5">
                            <button onclick="approveGatePass('${entry.id}', 'Approved')" class="px-3 py-1.5 rounded-lg bg-emerald hover:bg-emerald/90 text-white font-bold shadow-2xs transition-all flex items-center gap-1">
                                <i class="fa-solid fa-check"></i> Approve
                            </button>
                            <button onclick="approveGatePass('${entry.id}', 'Rejected')" class="px-2.5 py-1.5 rounded-lg bg-danger/10 hover:bg-danger hover:text-white text-danger font-semibold transition-all">
                                Reject
                            </button>
                            <button onclick="viewGatePassDetailsModal('${entry.id}')" class="px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-alt text-text transition-all" title="View details">
                                <i class="fa-solid fa-eye text-primary"></i>
                            </button>
                            <button onclick="downloadGatePassPdf('${entry.id}')" class="px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-alt text-text transition-all" title="Download PDF">
                                <i class="fa-solid fa-file-pdf text-danger"></i>
                            </button>
                        </div>
                    ` : `
                        <div class="flex flex-wrap items-center gap-1.5">
                            <button onclick="viewGatePassDetailsModal('${entry.id}')" class="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-text font-medium shadow-2xs transition-all flex items-center gap-1.5">
                                <i class="fa-solid fa-eye text-primary"></i> Details
                            </button>
                            <button onclick="downloadGatePassPdf('${entry.id}')" class="px-2.5 py-1.5 rounded-lg border border-border hover:bg-surface-alt text-text-secondary hover:text-text transition-all" title="Download PDF">
                                <i class="fa-solid fa-file-pdf text-danger"></i>
                            </button>
                        </div>
                    `}
                </td>
            </tr>
        `;
    }).join('');
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

    // Executive Navy Header
    drawRect(0, 0, pageWidth, 86, [15, 23, 42]);
    drawRect(0, 84, pageWidth, 4, [79, 70, 229]);

    drawText('HOSTEL RESIDENCE GATE PASS', margin, 22, { font: 'F2', size: 18, color: [255, 255, 255] });
    drawText('Campus Digital Security & Student Movement Authorization', margin, 46, { size: 9, color: [148, 163, 184] });
    drawText('OFFICIAL VERIFIED DOCUMENT', margin, 62, { font: 'F2', size: 8, color: [56, 189, 248] });

    // Right Side Header Metadata
    drawText('PASS ID', pageWidth - margin - 180, 24, { size: 8, color: [203, 213, 225] });
    drawText(gatePass.id || 'N/A', pageWidth - margin - 180, 36, { font: 'F2', size: 12, color: [255, 255, 255] });
    drawText(`● ${(gatePass.status || 'Pending').toUpperCase()}`, pageWidth - margin - 180, 54, {
        font: 'F2',
        size: 10,
        color: statusColor
    });

    const contentWidth = pageWidth - (margin * 2);

    // Top Student Bar
    drawRect(margin, 102, contentWidth, 38, [248, 250, 252], [226, 232, 240], 0.8);
    drawText('STUDENT NAME', margin + 14, 112, { size: 8, color: [100, 116, 139] });
    drawText(gatePass.student || 'N/A', margin + 14, 124, { font: 'F2', size: 12, color: [15, 23, 42] });

    drawText('REGISTER NUMBER', margin + 200, 112, { size: 8, color: [100, 116, 139] });
    drawText(gatePass.registrationNumber || 'N/A', margin + 200, 124, { font: 'F2', size: 12, color: [15, 23, 42] });

    drawText('SUBMITTED DATE', margin + 370, 112, { size: 8, color: [100, 116, 139] });
    drawText(new Date(gatePass.createdAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), margin + 370, 124, {
        size: 10,
        color: [15, 23, 42]
    });

    // Details Grid (Left 2 cols) and Student Photo (Right)
    const startY = 150;
    const gridFields = [
        ['Hostel Block', gatePass.hostelBlock || 'Block A'],
        ['Room Number', gatePass.roomNumber || 'N/A'],
        ['Gate Pass Date', formatDateValue(gatePass.gateDate)],
        ['Return Date', formatDateValue(gatePass.returnDate)],
        ['Session Timing', gatePass.session || 'General'],
        ['Authorized By', gatePass.approvedBy || 'Warden (Pending)']
    ];

    const colWidth = 176;
    const rowHeight = 44;
    gridFields.forEach((field, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = margin + (col * (colWidth + 10));
        const y = startY + (row * (rowHeight + 8));

        drawRect(x, y, colWidth, rowHeight, [255, 255, 255], [226, 232, 240], 0.8);
        drawText(field[0].toUpperCase(), x + 10, y + 8, { size: 7.5, color: [100, 116, 139] });
        drawText(String(field[1]), x + 10, y + 22, { font: 'F2', size: 10, color: [15, 23, 42] });
    });

    // Student Photo Box
    const photoX = margin + (colWidth * 2) + 24;
    const photoWidth = 145;
    const photoHeight = 148;
    drawRect(photoX, startY, photoWidth, photoHeight, [248, 250, 252], [203, 213, 225], 0.8);
    drawText('STUDENT PHOTO', photoX + 10, startY + 10, { font: 'F2', size: 8, color: [71, 85, 105] });

    if (imageAsset) {
        const fitRatio = Math.min(115 / imageAsset.width, 110 / imageAsset.height, 1);
        const drawWidth = Math.max(1, Math.round(imageAsset.width * fitRatio));
        const drawHeight = Math.max(1, Math.round(imageAsset.height * fitRatio));
        const drawLeft = photoX + Math.round((photoWidth - drawWidth) / 2);
        const drawTop = startY + 26 + Math.round((110 - drawHeight) / 2);
        drawImage('StudentPhoto', drawLeft, drawTop, drawWidth, drawHeight);
    } else {
        drawText('No Photo Uploaded', photoX + 16, startY + 70, { size: 8, color: [148, 163, 184] });
    }

    // Reason Box
    const reasonY = startY + (3 * (rowHeight + 8)) + 6;
    drawRect(margin, reasonY, contentWidth, 54, [248, 250, 252], [226, 232, 240], 0.8);
    drawText('REASON FOR LEAVE / PURPOSE', margin + 14, reasonY + 10, { font: 'F2', size: 8, color: [71, 85, 105] });
    drawWrappedText(String(gatePass.reason || 'Not specified'), margin + 14, reasonY + 24, contentWidth - 28, {
        font: 'F1',
        size: 9.5,
        color: [30, 41, 59],
        lineHeight: 12
    });

    // QR Verification & Security Section
    const qrSectionY = reasonY + 66;
    const qrBoxHeight = 160;
    drawRect(margin, qrSectionY, contentWidth, qrBoxHeight, [255, 255, 255], [203, 213, 225], 0.8);

    drawText('Digital Security & Verification QR', margin + 20, qrSectionY + 18, { font: 'F2', size: 12, color: [15, 23, 42] });
    drawWrappedText('Security officers must scan this QR code at campus entry/exit points. This document is non-transferable and valid only for the approved movement window.', margin + 20, qrSectionY + 36, 330, {
        font: 'F1',
        size: 8.5,
        color: [71, 85, 105],
        lineHeight: 11
    });

    drawRect(margin + 20, qrSectionY + 84, 330, 52, [241, 245, 249], [226, 232, 240], 0.8);
    drawText('OFFICIAL VERIFICATION CODE', margin + 30, qrSectionY + 92, { font: 'F2', size: 7.5, color: [71, 85, 105] });
    drawText(gatePass.id || 'N/A', margin + 30, qrSectionY + 105, { font: 'F2', size: 11, color: [15, 23, 42] });
    drawText(`STATUS: ${(gatePass.status || 'Pending').toUpperCase()}`, margin + 30, qrSectionY + 122, {
        font: 'F2',
        size: 8,
        color: statusColor
    });

    // Security Footer
    const footerY = 574;
    drawRect(margin, footerY, contentWidth, 1, [226, 232, 240]);
    drawText('Generated securely via HostelFix Student Residence System • Valid with institutional ID', margin, footerY + 8, { size: 7.5, color: [148, 163, 184] });
    drawText(`CONFIDENTIAL • ${new Date().getFullYear()}`, pageWidth - margin - 120, footerY + 8, { font: 'F2', size: 7.5, color: [100, 116, 139] });

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
    if (!technicians.length) {
        techSelect.innerHTML = '<option value="">No technicians registered yet</option>';
        return;
    }

    techSelect.innerHTML = '<option value="">Select technician (optional)</option>' + technicians
        .map((tech) => {
            const spec = tech.specialization ? ` (${tech.specialization})` : '';
            return `<option value="${tech.name}">${tech.name}${spec}</option>`;
        })
        .join('');
}

function handleComplaintCategoryChange() {
    const catSelect = document.getElementById('complaintCategory');
    const techSelect = document.getElementById('complaintAssignedTo');
    if (!catSelect || !techSelect || !technicians || !technicians.length) return;

    const cat = (catSelect.value || '').toLowerCase();
    if (!cat) return;

    const matchingTech = technicians.find(t => {
        const spec = (t.specialization || '').toLowerCase();
        if (cat === 'electrical' && (spec.includes('electr') || spec.includes('light'))) return true;
        if (cat === 'plumbing' && (spec.includes('plumb') || spec.includes('water'))) return true;
        if (cat === 'furniture' && (spec.includes('furn') || spec.includes('carpent') || spec.includes('door'))) return true;
        if (cat === 'door' && (spec.includes('door') || spec.includes('lock') || spec.includes('carpent'))) return true;
        if (cat === 'ac' && (spec.includes('ac') || spec.includes('hvac'))) return true;
        if (cat === 'lighting' && (spec.includes('light') || spec.includes('electr'))) return true;
        return false;
    });

    if (matchingTech) {
        techSelect.value = matchingTech.name;
    }
}

function getVisibleTechnicianComplaints(complaints = [], includeCompleted = false) {
    if (!currentUser || currentUser.role !== 'technician') {
        return complaints;
    }

    const currentName = normalizeText(currentUser.name || '');
    const currentEmail = normalizeText(currentUser.email || '');
    const currentId = normalizeText(currentUser.userId || currentUser.id || '');

    return complaints.filter((complaint) => {
        const cStatus = String(complaint.status || '').toLowerCase();
        if (!includeCompleted && (cStatus === 'completed' || cStatus === 'resolved')) {
            return false;
        }

        const cAssigned = normalizeText(complaint.assignedTo || '');
        const cTech = normalizeText(complaint.technician || '');

        // 1. Direct assignment match
        const isDirectMatch = (
            (cAssigned && (cAssigned === currentName || cAssigned === currentEmail || cAssigned === currentId)) ||
            (cTech && (cTech === currentName || cTech === currentEmail || cTech === currentId))
        );

        // 2. Unassigned or general queue complaints available for all technicians to claim & resolve
        const isUnassignedQueue = (
            !cAssigned || cAssigned === 'unassigned' || cAssigned === 'none' || cAssigned === 'pending'
        ) && (
            !cTech || cTech === 'unassigned' || cTech === 'none'
        );

        // 3. Fallback demo match
        const isDemoMatch = (cAssigned === 'mike johnson' || cTech === 'mike johnson');

        return isDirectMatch || isUnassignedQueue || isDemoMatch;
    });
}

async function claimTechJob(complaintId) {
    if (!complaintId) return;
    const actorName = currentUser?.name || 'Technician';
    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignedTo: actorName,
                technician: actorName,
                status: 'In Progress'
            })
        });
        hideLoading();
        if (!response.ok) {
            showToast('Unable to accept job.', 'error');
            return;
        }
        showToast('Job claimed and assigned to you!', 'success');
        await loadDashboardData();
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server.', 'error');
    }
}

async function startTechJob(complaintId) {
    if (!complaintId) return;
    const actorName = currentUser?.name || 'Technician';
    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assignedTo: actorName,
                technician: actorName,
                status: 'In Progress'
            })
        });
        hideLoading();
        if (!response.ok) {
            showToast('Unable to start work.', 'error');
            return;
        }
        showToast('Work started on this job! Status updated to In Progress.', 'info');
        await loadDashboardData();
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server.', 'error');
    }
}

async function markComplaintComplete(complaintId) {
    if (!complaintId) return;
    const actorName = currentUser?.name || 'Technician';
    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'Completed',
                technician: actorName
            })
        });
        hideLoading();

        if (!response.ok) {
            showToast('Unable to complete the job.', 'error');
            return;
        }

        showToast('Complaint marked complete and student notified!', 'success');
        await loadDashboardData();
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
    const isAssignedToMe = normalizeText(complaint.assignedTo) === normalizeText(currentUser?.name) || normalizeText(complaint.technician) === normalizeText(currentUser?.name);
    const isInProgress = String(complaint.status).toLowerCase() === 'in progress';

    return `
        <div class="glass rounded-2xl border border-border overflow-hidden card-hover shadow-xs">
            <div class="p-6">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <i class="fa-solid ${getCategoryIcon(complaint.category)} text-primary text-base"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h4 class="font-bold text-sm text-text">${complaint.category || 'General Complaint'}</h4>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isAssignedToMe ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-surface-alt text-text-muted'}">
                                    ${isAssignedToMe ? 'Assigned to You' : 'Queue Job'}
                                </span>
                            </div>
                            <p class="text-xs text-text-secondary mt-0.5">${complaint.hostelBlock || 'Block A'} • ${complaint.roomNumber || 'Room N/A'} | <strong class="text-text">${complaint.student || 'Student'}</strong></p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="${getPriorityBadgeClass(complaint.priority)} px-2.5 py-1 rounded-full text-xs font-semibold">${complaint.priority || 'Medium'}</span>
                        <button onclick="deleteComplaint('${complaint.id}')" class="w-8 h-8 rounded-xl bg-surface-alt border border-border text-text-secondary hover:bg-danger hover:text-white transition-all flex items-center justify-center text-xs" title="Delete job">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="p-3.5 rounded-xl bg-surface-alt/70 border border-border/60 mb-4 text-xs">
                    <p class="text-text font-medium leading-relaxed">${complaint.title || complaint.description || 'No description provided yet.'}</p>
                    <div class="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-text-muted">
                        <span>Ticket ID: <strong class="font-mono text-text">${complaint.id}</strong></span>
                        <span>Registered: ${formatComplaintDate(complaint.createdAt)}</span>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button onclick="claimTechJob('${complaint.id}')" class="flex-1 py-2 px-3 rounded-xl bg-emerald hover:bg-emerald-dark text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-check"></i> ${isAssignedToMe ? 'Re-Claim' : 'Accept Job'}
                    </button>
                    <button onclick="startTechJob('${complaint.id}')" class="flex-1 py-2 px-3 rounded-xl bg-primary hover:bg-primary-dark text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-play"></i> ${isInProgress ? 'Working...' : 'Start Work'}
                    </button>
                    <button onclick="markComplaintComplete('${complaint.id}')" class="flex-1 py-2 px-3 rounded-xl border border-border bg-surface hover:bg-surface-alt text-text text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-flag-checkered text-emerald"></i> Complete
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

    const noDataMarkup = '<div class="glass rounded-2xl border border-border p-6 text-sm text-text-secondary text-center">No active jobs in your queue right now.</div>';

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
        .filter((complaint) => String(complaint.status || '').toLowerCase() === 'completed' || String(complaint.status || '').toLowerCase() === 'resolved');

    if (!completedComplaints.length) {
        container.innerHTML = '<div class="glass rounded-2xl border border-border p-6 text-sm text-text-secondary text-center">No completed jobs recorded yet.</div>';
        return;
    }

    container.innerHTML = `
        <div class="glass rounded-2xl border border-border overflow-hidden">
            <table class="w-full">
                <thead class="bg-surface-alt">
                    <tr>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">ID</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Category</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Room & Block</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Student</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Completed Date</th>
                        <th class="text-left px-6 py-4 text-xs font-semibold text-text-secondary uppercase">Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-border">
                    ${completedComplaints.map((complaint) => `
                        <tr class="table-row hover:bg-surface-alt/40 transition-colors">
                            <td class="px-6 py-4 text-xs font-mono font-bold text-primary">${complaint.id || 'N/A'}</td>
                            <td class="px-6 py-4 text-sm font-semibold">${complaint.category || 'General Complaint'}</td>
                            <td class="px-6 py-4 text-xs">${complaint.hostelBlock || 'Block A'} • ${complaint.roomNumber || 'N/A'}</td>
                            <td class="px-6 py-4 text-xs font-medium">${complaint.student || 'Student'}</td>
                            <td class="px-6 py-4 text-xs text-text-secondary">${formatComplaintDate(complaint.createdAt)}</td>
                            <td class="px-6 py-4"><span class="${getStatusBadgeClass(complaint.status)} px-2.5 py-1 rounded-full text-xs font-semibold">${complaint.status || 'Completed'}</span></td>
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

    const visibleComplaints = getVisibleTechnicianComplaints(complaints, false);
    const total = visibleComplaints.length;
    const pending = visibleComplaints.filter((item) => !item.status || ['Pending', 'Assigned', 'Accepted', 'In Progress'].includes(item.status)).length;
    const completed = getVisibleTechnicianComplaints(complaints, true).filter((item) => item.status === 'Completed' || item.status === 'Resolved').length;
    const urgent = visibleComplaints.filter((item) => String(item.priority).toLowerCase() === 'high' || String(item.priority).toLowerCase() === 'emergency').length;

    if (techJobs) techJobs.textContent = total.toLocaleString();
    if (techPending) techPending.textContent = pending.toLocaleString();
    if (techCompleted) techCompleted.textContent = completed.toLocaleString();
    if (techUrgent) techUrgent.textContent = urgent.toLocaleString();

    // Update Sidebar badges for technician
    document.querySelectorAll('.tech-sidebar-assigned-badge').forEach(badge => {
        badge.textContent = String(total);
    });

    // Update technician sidebar user header
    if (currentUser && currentUser.role === 'technician') {
        const initials = (currentUser.name || 'TC').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        document.querySelectorAll('.tech-sidebar-initials').forEach(el => {
            el.textContent = initials;
        });
        document.querySelectorAll('.tech-sidebar-name').forEach(el => {
            el.textContent = currentUser.name;
        });
    }
}

function renderAdminSummary(summary, complaints = [], allUsers = []) {
    const adminTotal = document.getElementById('adminTotalComplaints');
    const adminPending = document.getElementById('adminPendingComplaints');
    const adminCompleted = document.getElementById('adminCompletedComplaints');
    const adminActiveTechnicians = document.getElementById('adminActiveTechnicians');
    const adminTotalWardens = document.getElementById('adminTotalWardens');

    const techCount = (allUsers || users || []).filter(u => u.role === 'technician').length;
    const wardenCount = (allUsers || users || []).filter(u => u.role === 'warden').length;
    const pendingCount = (complaints || []).filter(c => !c.status || c.status === 'Pending' || c.status === 'In Progress').length;
    const resolvedCount = (complaints || []).filter(c => c.status === 'Resolved' || c.status === 'Completed').length;

    if (adminTotal) adminTotal.textContent = String(summary?.total || complaints.length || 0).toLocaleString();
    if (adminPending) adminPending.textContent = String(summary?.pending || pendingCount || 0).toLocaleString();
    if (adminCompleted) adminCompleted.textContent = String(summary?.completed || summary?.resolvedToday || resolvedCount || 0).toLocaleString();
    if (adminActiveTechnicians) adminActiveTechnicians.textContent = String(summary?.activeTechnicians || techCount || 3).toLocaleString();
    if (adminTotalWardens) adminTotalWardens.textContent = String(wardenCount || 3).toLocaleString();

    // Dynamic Sidebar Badges
    document.querySelectorAll('.admin-gate-pass-badge, #adminSidebarGatePassBadge').forEach(el => el.textContent = String(latestGatePasses.length || 0));
    document.querySelectorAll('.admin-complaints-badge, #adminSidebarComplaintBadge').forEach(el => el.textContent = String(complaints.length || 0));

    // Render Dynamic Visuals & Tables
    renderAdminCategoryChart(complaints);
    renderAdminMonthlyChart(complaints);
    renderAdminDashboardTechTable(allUsers, complaints);
    renderAdminDashboardComplaints(complaints);
}

// 1. Dynamic Complaint Categories Donut Chart & Legend
function renderAdminCategoryChart(complaints = []) {
    const pieChart = document.getElementById('adminCategoryPieChart');
    const totalCountEl = document.getElementById('adminCategoryTotalCount');
    const legendEl = document.getElementById('adminCategoryLegend');
    if (!pieChart || !legendEl) return;

    if (!complaints.length) {
        pieChart.style.background = 'conic-gradient(#3b82f6 0deg 360deg)';
        if (totalCountEl) totalCountEl.textContent = '0';
        legendEl.innerHTML = '<div class="col-span-2 text-xs text-text-secondary text-center py-2">No complaints recorded yet.</div>';
        return;
    }

    const categoryCounts = {};
    complaints.forEach((c) => {
        const cat = (c.category || 'Other').trim();
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const categories = Object.keys(categoryCounts);
    const total = complaints.length;
    if (totalCountEl) totalCountEl.textContent = String(categories.length);

    const palette = [
        { color: '#2563EB', bgClass: 'bg-primary' },
        { color: '#10B981', bgClass: 'bg-emerald' },
        { color: '#F59E0B', bgClass: 'bg-warning' },
        { color: '#EF4444', bgClass: 'bg-danger' },
        { color: '#06B6D4', bgClass: 'bg-info' },
        { color: '#8B5CF6', bgClass: 'bg-indigo-500' },
        { color: '#EC4899', bgClass: 'bg-pink-500' },
        { color: '#64748B', bgClass: 'bg-slate-500' }
    ];

    let gradientParts = [];
    let currentAngle = 0;

    const legendItems = categories.map((cat, idx) => {
        const count = categoryCounts[cat];
        const pct = Math.round((count / total) * 100);
        const colObj = palette[idx % palette.length];
        const nextAngle = currentAngle + (count / total) * 360;
        gradientParts.push(`${colObj.color} ${currentAngle.toFixed(1)}deg ${nextAngle.toFixed(1)}deg`);
        currentAngle = nextAngle;

        return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-surface-alt/70 border border-border/50 text-xs">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${colObj.color}"></span>
                    <span class="text-text font-medium truncate max-w-[100px] sm:max-w-[130px]">${cat}</span>
                </div>
                <span class="font-bold text-text">${pct}% <span class="text-text-muted text-[10px]">(${count})</span></span>
            </div>
        `;
    });

    pieChart.style.background = `conic-gradient(${gradientParts.join(', ')})`;
    legendEl.innerHTML = legendItems.join('');
}

// 2. Dynamic Monthly Ticket Volume Bar Chart
function renderAdminMonthlyChart(complaints = []) {
    const chartContainer = document.getElementById('adminMonthlyComplaintsChart');
    const peakStats = document.getElementById('adminMonthlyPeakStats');
    if (!chartContainer) return;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const last6Months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        last6Months.push({
            monthIndex: d.getMonth(),
            year: d.getFullYear(),
            label: monthNames[d.getMonth()],
            count: 0
        });
    }

    complaints.forEach((c) => {
        const cDate = new Date(c.createdAt || c.date || Date.now());
        if (!isNaN(cDate.getTime())) {
            const m = cDate.getMonth();
            const y = cDate.getFullYear();
            const target = last6Months.find(item => item.monthIndex === m && item.year === y);
            if (target) {
                target.count += 1;
            }
        }
    });

    const maxCount = Math.max(...last6Months.map(m => m.count), 1);
    const peakMonth = last6Months.reduce((prev, curr) => (curr.count > prev.count ? curr : prev), last6Months[0]);

    chartContainer.innerHTML = last6Months.map((m) => {
        const heightPct = Math.max(15, Math.round((m.count / maxCount) * 100));
        const isPeak = m.count === maxCount && m.count > 0;
        return `
            <div class="flex-1 flex flex-col items-center gap-2 group relative">
                <div class="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-lg bg-text text-surface text-[10px] font-bold pointer-events-none whitespace-nowrap shadow-md z-10">
                    ${m.count} ${m.count === 1 ? 'ticket' : 'tickets'}
                </div>
                <div class="w-full ${isPeak ? 'bg-primary shadow-sm' : 'bg-primary/30 group-hover:bg-primary/50'} rounded-t-xl transition-all chart-bar" style="height: ${heightPct}%"></div>
                <span class="text-xs ${isPeak ? 'font-bold text-primary' : 'text-text-secondary'}">${m.label}</span>
            </div>
        `;
    }).join('');

    if (peakStats) {
        const resolved = complaints.filter(c => c.status === 'Completed' || c.status === 'Resolved').length;
        const rate = complaints.length ? Math.round((resolved / complaints.length) * 100) : 100;
        peakStats.innerHTML = `
            <span>Peak Month: <strong class="text-text">${peakMonth.label} (${peakMonth.count} tickets)</strong></span>
            <span class="text-emerald font-semibold"><i class="fa-solid fa-bolt"></i> ${rate}% Dynamic Resolution Rate</span>
        `;
    }
}

// 3. Dynamic Technician Performance Table on Admin Dashboard
function renderAdminDashboardTechTable(allUsers = [], complaints = []) {
    const tbody = document.getElementById('adminDashboardTechTableBody');
    if (!tbody) return;

    const technicians = Array.isArray(allUsers) ? allUsers.filter((u) => u.role === 'technician' || u.specialization || u.id?.startsWith('T-')) : [];
    if (!technicians.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-6 text-center text-sm text-text-secondary">No technicians registered. Click "Add Technician" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = technicians.map((t) => {
        const initials = (t.name || 'TC').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
        const completed = complaints.filter((c) => (c.technician === t.name || c.assignedTo === t.name) && (String(c.status).toLowerCase() === 'completed' || String(c.status).toLowerCase() === 'resolved')).length;
        const rating = t.rating || 4.9;
        const avgTime = t.avgRepairTime || '2.4h';
        const statusClass = t.status === 'On Leave' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';

        return `
            <tr class="table-row hover:bg-surface-alt/40 transition-colors">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs">${initials}</div>
                        <div>
                            <p class="font-semibold text-sm text-text">${t.name || 'Technician'}</p>
                            <p class="text-[11px] text-text-muted font-mono">${t.phone || t.email || ''}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-xs font-semibold text-primary">${t.specialization || 'General Maintenance'}</td>
                <td class="px-6 py-4 text-sm font-bold text-text">${t.completedCount || completed}</td>
                <td class="px-6 py-4 text-xs font-mono text-text-secondary">${avgTime}</td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-1 text-warning text-xs">
                        <i class="fa-solid fa-star"></i>
                        <span class="font-bold text-text ml-0.5">${rating}</span>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusClass}">${t.status || 'Active Duty'}</span>
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        <button onclick="openEditTechnicianModal('${t.id || t.userId || t.email}')" class="px-2.5 py-1 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs font-semibold text-text hover:text-primary transition-all">
                            Edit
                        </button>
                        <button onclick="deleteTechnician('${t.id || t.userId || t.email}')" class="px-2.5 py-1 rounded-lg bg-danger/10 hover:bg-danger hover:text-white text-xs font-semibold text-danger transition-all">
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 4. Dynamic Recent Complaints Table with Real-time Search
let adminComplaintSearchTerm = '';
function handleAdminComplaintSearch(val) {
    adminComplaintSearchTerm = (val || '').toLowerCase().trim();
    renderAdminDashboardComplaints(latestComplaints);
}

function renderAdminDashboardComplaints(complaints = []) {
    const tbody = document.getElementById('adminComplaintsTableBody');
    if (!tbody) return;

    let list = Array.isArray(complaints) ? complaints.slice() : [];
    if (adminComplaintSearchTerm) {
        list = list.filter(c => {
            const student = String(c.student || '').toLowerCase();
            const room = String(c.roomNumber || '').toLowerCase();
            const block = String(c.hostelBlock || '').toLowerCase();
            const title = String(c.title || c.description || '').toLowerCase();
            const cat = String(c.category || '').toLowerCase();
            const id = String(c.id || '').toLowerCase();
            return student.includes(adminComplaintSearchTerm) ||
                   room.includes(adminComplaintSearchTerm) ||
                   block.includes(adminComplaintSearchTerm) ||
                   title.includes(adminComplaintSearchTerm) ||
                   cat.includes(adminComplaintSearchTerm) ||
                   id.includes(adminComplaintSearchTerm);
        });
    }

    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-sm text-text-secondary">No matching complaints found.</td></tr>';
        return;
    }

    tbody.innerHTML = list.slice(0, 10).map((c) => {
        const priorityClass = getPriorityBadgeClass(c.priority);
        const statusClass = getStatusBadgeClass(c.status);
        const isPending = !c.status || c.status === 'Pending' || c.status === 'In Progress';

        return `
            <tr class="table-row hover:bg-surface-alt/40 transition-colors">
                <td class="px-6 py-4 text-xs font-mono font-bold text-primary">${c.id || 'N/A'}</td>
                <td class="px-6 py-4">
                    <p class="font-semibold text-sm text-text">${c.student || 'Student'}</p>
                    <p class="text-[11px] text-text-muted truncate max-w-[150px]">${c.title || c.description || 'Maintenance issue'}</p>
                </td>
                <td class="px-6 py-4 text-xs text-text">${c.hostelBlock || 'Block A'} • ${c.roomNumber || 'N/A'}</td>
                <td class="px-6 py-4 text-xs font-medium text-text">${c.category || 'General'}</td>
                <td class="px-6 py-4"><span class="${priorityClass} px-2.5 py-0.5 rounded-full text-[11px] font-semibold">${c.priority || 'Low'}</span></td>
                <td class="px-6 py-4"><span class="${statusClass} px-2.5 py-0.5 rounded-full text-[11px] font-semibold">${c.status || 'Pending'}</span></td>
                <td class="px-6 py-4 text-xs font-medium text-text-secondary">${c.technician || c.assignedTo || 'Unassigned'}</td>
                <td class="px-6 py-4">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <button onclick="openEditComplaintModal('${c.id}')" class="px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white text-xs font-semibold transition-all">Edit</button>
                        ${isPending ? `
                            <button onclick="updateComplaintStatus('${c.id}', 'Completed')" class="px-2.5 py-1 rounded-lg bg-emerald/10 text-emerald hover:bg-emerald hover:text-white text-xs font-semibold transition-all">Resolve</button>
                        ` : ''}
                        <button onclick="deleteComplaint('${c.id}')" class="px-2.5 py-1 rounded-lg bg-danger/10 text-danger hover:bg-danger hover:text-white text-xs font-semibold transition-all">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 5. Full Interactive Dynamic CRUD Modals & Handlers
function openEditComplaintModal(complaintId) {
    const complaint = latestComplaints.find(c => c.id === complaintId);
    if (!complaint) return showToast('Complaint not found.', 'error');

    let modal = document.getElementById('dynamicEditComplaintModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dynamicEditComplaintModal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="glass w-full max-w-lg rounded-3xl border border-border p-6 shadow-2xl animate-scale-up">
            <div class="flex items-center justify-between mb-5 pb-4 border-b border-border">
                <div class="flex items-center gap-2.5">
                    <div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-text">Edit Maintenance Ticket</h3>
                        <p class="text-xs text-text-secondary font-mono">${complaint.id}</p>
                    </div>
                </div>
                <button onclick="document.getElementById('dynamicEditComplaintModal').remove()" class="w-8 h-8 rounded-full border border-border flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-alt">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <form id="editComplaintForm" onsubmit="handleSaveComplaintEdit(event, '${complaint.id}')" class="space-y-4 text-xs">
                <div>
                    <label class="block font-semibold text-text mb-1">Issue Title / Description</label>
                    <input id="editComplaintTitle" type="text" value="${(complaint.title || complaint.description || '').replace(/"/g, '&quot;')}" required class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold text-text mb-1">Category</label>
                        <select id="editComplaintCategory" class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text font-semibold">
                            <option value="Electrical" ${complaint.category === 'Electrical' ? 'selected' : ''}>⚡ Electrical</option>
                            <option value="Plumbing" ${complaint.category === 'Plumbing' ? 'selected' : ''}>💧 Plumbing</option>
                            <option value="Wi-Fi" ${complaint.category === 'Wi-Fi' ? 'selected' : ''}>📶 Wi-Fi / Network</option>
                            <option value="Furniture" ${complaint.category === 'Furniture' ? 'selected' : ''}>🪑 Furniture</option>
                            <option value="Appliances" ${complaint.category === 'Appliances' ? 'selected' : ''}>🔌 Appliances</option>
                            <option value="Carpentry" ${complaint.category === 'Carpentry' ? 'selected' : ''}>🔨 Carpentry</option>
                            <option value="Cleaning" ${complaint.category === 'Cleaning' ? 'selected' : ''}>🧹 Cleaning</option>
                            <option value="Others" ${complaint.category === 'Others' ? 'selected' : ''}>📦 Others</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-semibold text-text mb-1">Priority</label>
                        <select id="editComplaintPriority" class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text font-semibold">
                            <option value="Low" ${complaint.priority === 'Low' ? 'selected' : ''}>🟢 Low</option>
                            <option value="Medium" ${complaint.priority === 'Medium' ? 'selected' : ''}>🟡 Medium</option>
                            <option value="High" ${complaint.priority === 'High' ? 'selected' : ''}>🔴 High</option>
                            <option value="Emergency" ${complaint.priority === 'Emergency' ? 'selected' : ''}>🚨 Emergency</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold text-text mb-1">Hostel Block</label>
                        <input id="editComplaintBlock" type="text" value="${complaint.hostelBlock || 'Block A'}" class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text">
                    </div>
                    <div>
                        <label class="block font-semibold text-text mb-1">Room Number</label>
                        <input id="editComplaintRoom" type="text" value="${complaint.roomNumber || '101'}" class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold text-text mb-1">Status</label>
                        <select id="editComplaintStatus" class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text font-semibold">
                            <option value="Pending" ${complaint.status === 'Pending' ? 'selected' : ''}>Pending</option>
                            <option value="In Progress" ${complaint.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                            <option value="Completed" ${complaint.status === 'Completed' || complaint.status === 'Resolved' ? 'selected' : ''}>Completed / Resolved</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-semibold text-text mb-1">Assigned Technician</label>
                        <input id="editComplaintTech" type="text" value="${complaint.technician || complaint.assignedTo || ''}" placeholder="e.g. Mike Johnson" class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text">
                    </div>
                </div>
                <div>
                    <label class="block font-semibold text-text mb-1">Maintenance Notes</label>
                    <textarea id="editComplaintNotes" rows="2" placeholder="Add resolution comments or diagnostic notes..." class="input-focus w-full px-3.5 py-2 rounded-xl border border-border bg-surface-alt text-text">${complaint.notes || ''}</textarea>
                </div>
                <div class="flex items-center justify-end gap-3 pt-3 border-t border-border">
                    <button type="button" onclick="document.getElementById('dynamicEditComplaintModal').remove()" class="px-4 py-2.5 rounded-xl border border-border text-text-secondary hover:text-text hover:bg-surface-alt font-semibold transition-all">Cancel</button>
                    <button type="submit" class="btn-primary px-5 py-2.5 rounded-xl text-white font-bold shadow-md">Save Changes</button>
                </div>
            </form>
        </div>
    `;
}

async function handleSaveComplaintEdit(e, complaintId) {
    e.preventDefault();
    const title = document.getElementById('editComplaintTitle')?.value;
    const category = document.getElementById('editComplaintCategory')?.value;
    const priority = document.getElementById('editComplaintPriority')?.value;
    const hostelBlock = document.getElementById('editComplaintBlock')?.value;
    const roomNumber = document.getElementById('editComplaintRoom')?.value;
    const status = document.getElementById('editComplaintStatus')?.value;
    const technician = document.getElementById('editComplaintTech')?.value;
    const notes = document.getElementById('editComplaintNotes')?.value;

    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description: title, category, priority, hostelBlock, roomNumber, status, technician, assignedTo: technician, notes })
        });
        hideLoading();
        if (!response.ok) {
            showToast('Failed to update complaint details.', 'error');
            return;
        }
        showToast('Complaint updated successfully!', 'success');
        document.getElementById('dynamicEditComplaintModal')?.remove();
        await loadDashboardData();
    } catch (err) {
        hideLoading();
        showToast('Unable to connect to server.', 'error');
        console.error(err);
    }
}

async function deleteComplaint(complaintId) {
    if (!confirm(`Are you sure you want to delete complaint ${complaintId}?`)) return;
    showLoading();
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}`, { method: 'DELETE' });
        hideLoading();
        if (!response.ok) {
            showToast('Failed to delete complaint.', 'error');
            return;
        }
        showToast('Complaint deleted successfully.', 'success');
        await loadDashboardData();
    } catch (err) {
        hideLoading();
        showToast('Unable to connect to server.', 'error');
    }
}

function renderAdminStudents(users = [], complaints = []) {
    const tbody = document.getElementById('adminStudentsTableBody');
    if (!tbody) return;
    const students = users.filter((u) => u.role === 'student');
    if (!students.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-6 text-center text-sm text-text-secondary">No registered students found.</td></tr>';
        return;
    }
    tbody.innerHTML = students.map((s) => {
        const studentComplaints = complaints.filter((c) => c.userEmail === s.email || c.student === s.name).length;
        const initials = (s.name || 'ST').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
        return `
            <tr class="table-row hover:bg-surface-alt/40 transition-colors">
                <td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">${initials}</div><span class="font-medium text-sm">${s.name || 'Student'}</span></div></td>
                <td class="px-6 py-4 text-xs font-mono">${s.registrationNumber || 'REG-2024001'}</td>
                <td class="px-6 py-4 text-xs">${s.hostelBlock || 'Block A'} • ${s.roomNumber || 'A-204'}</td>
                <td class="px-6 py-4 text-xs font-mono text-text-secondary">${s.phone || '+91 98765 00000'}</td>
                <td class="px-6 py-4 text-sm font-bold text-primary">${studentComplaints}</td>
                <td class="px-6 py-4">
                    <button onclick="deleteStudent('${s.userId || s.id || s.email}')" class="px-2.5 py-1 rounded-lg bg-danger/10 text-danger hover:bg-danger hover:text-white text-xs font-semibold transition-all">Remove</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function deleteStudent(studentId) {
    if (!confirm('Are you sure you want to remove this student record?')) return;
    showLoading();
    try {
        const response = await apiRequest(`/api/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
        hideLoading();
        if (!response.ok) {
            showToast('Failed to delete student.', 'error');
            return;
        }
        showToast('Student deleted successfully.', 'success');
        await loadDashboardData();
    } catch (err) {
        hideLoading();
        showToast('Unable to connect to server.', 'error');
    }
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
            <div class="glass rounded-2xl border border-border p-5 card-hover relative group shadow-xs">
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
            <div class="glass rounded-2xl border border-border p-5 card-hover relative group shadow-xs">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-info flex items-center justify-center text-white font-bold text-sm shadow-md">${initials}</div>
                        <div>
                            <h4 class="font-bold text-sm text-text">${t.name}</h4>
                            <p class="text-xs text-primary font-medium">${t.specialization || 'General Maintenance'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button type="button" data-technician-action="edit" data-technician-id="${escapeHtml(getTechnicianIdentifier(t))}" title="Edit Technician" aria-label="Edit ${escapeHtml(t.name || 'technician')}" class="w-8 h-8 rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" data-technician-action="delete" data-technician-id="${escapeHtml(getTechnicianIdentifier(t))}" title="Remove Technician" aria-label="Remove ${escapeHtml(t.name || 'technician')}" class="w-8 h-8 rounded-xl bg-danger/10 text-danger hover:bg-danger hover:text-white flex items-center justify-center text-xs transition-all">
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
                    <span class="text-[11px] text-text-muted font-mono">${t.phone || t.email || ''}</span>
                </div>
            </div>
        `;
    }).join('');
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getTechnicianIdentifier(technician = {}) {
    return String(technician.id || technician.userId || technician.email || '');
}

function findTechnicianByIdentifier(identifier) {
    const normalizedId = String(identifier || '').trim();
    return (window.currentTechniciansList || []).find((technician) => (
        getTechnicianIdentifier(technician) === normalizedId
        || String(technician.email || '').trim().toLowerCase() === normalizedId.toLowerCase()
    ));
}

document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-technician-action]');
    if (!button) return;

    const technicianId = button.dataset.technicianId;
    if (button.dataset.technicianAction === 'edit') openEditTechnicianModal(technicianId);
    if (button.dataset.technicianAction === 'delete') deleteTechnician(technicianId);
});

let adminComplaintsState = {
    page: 1,
    pageSize: 8,
    search: '',
    status: 'all',
    category: 'all',
    priority: 'all'
};

function handleAdminComplaintsFilter() {
    const searchEl = document.getElementById('adminComplaintsSearchInput');
    const statusEl = document.getElementById('adminComplaintsStatusFilter');
    const catEl = document.getElementById('adminComplaintsCategoryFilter');
    const prioEl = document.getElementById('adminComplaintsPriorityFilter');

    adminComplaintsState.search = (searchEl?.value || '').toLowerCase().trim();
    adminComplaintsState.status = statusEl?.value || 'all';
    adminComplaintsState.category = catEl?.value || 'all';
    adminComplaintsState.priority = prioEl?.value || 'all';
    adminComplaintsState.page = 1;
    renderAdminFullComplaintsTable(latestComplaints);
}

function filterComplaintsByQuickStatus(status) {
    const statusEl = document.getElementById('adminComplaintsStatusFilter');
    if (statusEl) statusEl.value = status;
    adminComplaintsState.status = status;
    adminComplaintsState.page = 1;
    renderAdminFullComplaintsTable(latestComplaints);
}

function resetAdminComplaintsFilters() {
    const searchEl = document.getElementById('adminComplaintsSearchInput');
    const statusEl = document.getElementById('adminComplaintsStatusFilter');
    const catEl = document.getElementById('adminComplaintsCategoryFilter');
    const prioEl = document.getElementById('adminComplaintsPriorityFilter');

    if (searchEl) searchEl.value = '';
    if (statusEl) statusEl.value = 'all';
    if (catEl) catEl.value = 'all';
    if (prioEl) prioEl.value = 'all';

    adminComplaintsState = { page: 1, pageSize: 8, search: '', status: 'all', category: 'all', priority: 'all' };
    renderAdminFullComplaintsTable(latestComplaints);
}

function changeAdminComplaintsPage(newPage) {
    adminComplaintsState.page = Math.max(1, newPage);
    renderAdminFullComplaintsTable(latestComplaints);
}

function renderAdminFullComplaintsTable(complaints = []) {
    const list = Array.isArray(complaints) ? complaints : latestComplaints || [];
    const tbody = document.getElementById('adminFullComplaintsTableBody');
    const totalCountEl = document.getElementById('adminComplaintsTotalCount');
    const pendingCountEl = document.getElementById('adminComplaintsPendingCount');
    const progressCountEl = document.getElementById('adminComplaintsProgressCount');
    const completedCountEl = document.getElementById('adminComplaintsCompletedCount');
    const paginationInfoEl = document.getElementById('adminComplaintsPaginationInfo');
    const paginationControlsEl = document.getElementById('adminComplaintsPaginationControls');

    // 1. Dynamic counters
    if (totalCountEl) totalCountEl.textContent = `${list.length}`;
    if (pendingCountEl) pendingCountEl.textContent = `${list.filter(c => !c.status || c.status === 'Pending').length}`;
    if (progressCountEl) progressCountEl.textContent = `${list.filter(c => c.status === 'In Progress' || c.status === 'Assigned' || c.status === 'Accepted').length}`;
    if (completedCountEl) completedCountEl.textContent = `${list.filter(c => c.status === 'Completed').length}`;

    if (!tbody) return;

    // 2. Dynamic multi-criteria filtering
    let filtered = list.filter(c => {
        const matchesSearch = !adminComplaintsState.search || (
            String(c.id || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.student || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.email || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.registrationNumber || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.roomNumber || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.hostelBlock || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.category || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.description || '').toLowerCase().includes(adminComplaintsState.search) ||
            String(c.assignedTo || c.technician || '').toLowerCase().includes(adminComplaintsState.search)
        );

        const matchesStatus = adminComplaintsState.status === 'all' || (c.status || 'Pending') === adminComplaintsState.status;
        const matchesCategory = adminComplaintsState.category === 'all' || String(c.category || '').toLowerCase().includes(adminComplaintsState.category.toLowerCase());
        const matchesPriority = adminComplaintsState.priority === 'all' || (c.priority || 'Low') === adminComplaintsState.priority;

        return matchesSearch && matchesStatus && matchesCategory && matchesPriority;
    });

    // 3. Dynamic pagination
    const totalMatching = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalMatching / adminComplaintsState.pageSize));
    if (adminComplaintsState.page > totalPages) {
        adminComplaintsState.page = totalPages;
    }
    const startIndex = (adminComplaintsState.page - 1) * adminComplaintsState.pageSize;
    const endIndex = Math.min(startIndex + adminComplaintsState.pageSize, totalMatching);
    const paginatedItems = filtered.slice(startIndex, endIndex);

    if (paginationInfoEl) {
        paginationInfoEl.textContent = totalMatching > 0
            ? `Showing ${startIndex + 1}-${endIndex} of ${totalMatching} complaints`
            : 'No matching complaints found';
    }

    if (paginationControlsEl) {
        if (totalPages <= 1) {
            paginationControlsEl.innerHTML = '';
        } else {
            let pagesHtml = `
                <button onclick="changeAdminComplaintsPage(${adminComplaintsState.page - 1})" ${adminComplaintsState.page === 1 ? 'disabled' : ''} class="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-xs text-text-secondary hover:bg-surface-alt disabled:opacity-40 disabled:pointer-events-none transition-all">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
            `;
            for (let p = 1; p <= totalPages; p++) {
                if (p === 1 || p === totalPages || (p >= adminComplaintsState.page - 1 && p <= adminComplaintsState.page + 1)) {
                    pagesHtml += `
                        <button onclick="changeAdminComplaintsPage(${p})" class="w-8 h-8 rounded-lg text-xs font-semibold ${p === adminComplaintsState.page ? 'bg-primary text-white shadow-xs' : 'border border-border text-text-secondary hover:bg-surface-alt'} transition-all">
                            ${p}
                        </button>
                    `;
                } else if (p === adminComplaintsState.page - 2 || p === adminComplaintsState.page + 2) {
                    pagesHtml += `<span class="px-1 text-xs text-text-muted">...</span>`;
                }
            }
            pagesHtml += `
                <button onclick="changeAdminComplaintsPage(${adminComplaintsState.page + 1})" ${adminComplaintsState.page === totalPages ? 'disabled' : ''} class="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-xs text-text-secondary hover:bg-surface-alt disabled:opacity-40 disabled:pointer-events-none transition-all">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            `;
            paginationControlsEl.innerHTML = pagesHtml;
        }
    }

    // 4. Render rows
    if (!paginatedItems.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-12 text-center text-sm text-text-secondary">
                    <i class="fa-solid fa-inbox text-3xl mb-2 text-text-muted block"></i>
                    No complaints matching current filters.
                    <button onclick="resetAdminComplaintsFilters()" class="block mx-auto mt-2 text-xs font-semibold text-primary hover:underline">Reset Filters</button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = paginatedItems.map((c) => {
        const priorityClass = getPriorityBadgeClass(c.priority);
        const statusClass = getStatusBadgeClass(c.status);
        const techName = c.technician || c.assignedTo || '';
        const isResolved = c.status === 'Completed';

        return `
            <tr class="table-row hover:bg-surface-alt/40 transition-colors">
                <td class="px-6 py-4 font-mono font-bold text-xs text-primary">
                    <button onclick="openComplaintDetailsModal('${c.id}')" class="hover:underline font-bold text-left">${c.id || 'N/A'}</button>
                </td>
                <td class="px-6 py-4">
                    <p class="font-semibold text-xs text-text">${c.student || 'Student'}</p>
                    <p class="text-[11px] text-text-muted">${c.hostelBlock || 'Block A'} • Room ${c.roomNumber || 'N/A'}</p>
                </td>
                <td class="px-6 py-4">
                    <p class="font-medium text-xs text-text">${c.category || 'General'}</p>
                    <p class="text-[11px] text-text-muted truncate max-w-[180px]">${c.description || 'No details provided'}</p>
                </td>
                <td class="px-6 py-4">
                    <span class="${priorityClass} px-2.5 py-0.5 rounded-full text-[11px] font-semibold">${c.priority || 'Low'}</span>
                </td>
                <td class="px-6 py-4">
                    <span class="${statusClass} px-2.5 py-0.5 rounded-full text-[11px] font-semibold">${c.status || 'Pending'}</span>
                </td>
                <td class="px-6 py-4 text-xs">
                    ${techName && techName !== 'Unassigned' ? `
                        <div class="flex items-center gap-1.5">
                            <span class="font-medium text-text">${techName}</span>
                            <button onclick="openAssignTechnicianModal('${c.id}')" title="Reassign" class="text-text-muted hover:text-primary transition-all text-[11px]"><i class="fa-solid fa-arrows-rotate"></i></button>
                        </div>
                    ` : `
                        <button onclick="openAssignTechnicianModal('${c.id}')" class="px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white text-[11px] font-semibold transition-all flex items-center gap-1">
                            <i class="fa-solid fa-user-plus text-[10px]"></i> Assign
                        </button>
                    `}
                </td>
                <td class="px-6 py-4 text-xs text-text-secondary whitespace-nowrap">${formatComplaintDate(c.createdAt)}</td>
                <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                        <button onclick="openComplaintDetailsModal('${c.id}')" title="View Full Details" class="w-7 h-7 rounded-lg bg-surface-alt border border-border text-text hover:bg-primary hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        ${!isResolved ? `
                            <button onclick="quickUpdateComplaintStatus('${c.id}', 'Completed')" title="Mark as Resolved" class="w-7 h-7 rounded-lg bg-emerald/10 text-emerald hover:bg-emerald hover:text-white flex items-center justify-center text-xs transition-all font-bold">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        ` : `
                            <button onclick="quickUpdateComplaintStatus('${c.id}', 'In Progress')" title="Reopen Request" class="w-7 h-7 rounded-lg bg-warning/10 text-warning hover:bg-warning hover:text-white flex items-center justify-center text-xs transition-all font-bold">
                                <i class="fa-solid fa-rotate-left"></i>
                            </button>
                        `}
                        <button onclick="deleteComplaint('${c.id}')" title="Delete Request" class="w-7 h-7 rounded-lg bg-danger/10 text-danger hover:bg-danger hover:text-white flex items-center justify-center text-xs transition-all">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function openComplaintDetailsModal(complaintId) {
    const complaint = (latestComplaints || []).find(c => c.id === complaintId);
    if (!complaint) return showToast('Complaint not found.', 'error');

    const priorityClass = getPriorityBadgeClass(complaint.priority);
    const statusClass = getStatusBadgeClass(complaint.status);
    const createdStr = new Date(complaint.createdAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    const content = `
        <div class="space-y-6">
            <div class="flex items-center justify-between pb-4 border-b border-border">
                <div>
                    <span class="text-xs font-mono font-bold text-primary">${complaint.id}</span>
                    <h3 class="text-lg font-bold text-text mt-0.5">${complaint.category || 'General'} Maintenance</h3>
                    <p class="text-xs text-text-secondary">${complaint.hostelBlock || 'Block A'} • Room ${complaint.roomNumber || 'N/A'}</p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="${priorityClass} px-3 py-1 rounded-full text-xs font-semibold">${complaint.priority || 'Low'} Priority</span>
                    <span class="${statusClass} px-3 py-1 rounded-full text-xs font-semibold">${complaint.status || 'Pending'}</span>
                </div>
            </div>

            <!-- Student Info & Technician -->
            <div class="grid sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-surface-alt border border-border/70 text-xs">
                <div class="space-y-1">
                    <p class="text-text-muted font-medium uppercase text-[10px] tracking-wider">Reported By</p>
                    <p class="font-bold text-sm text-text">${complaint.student || 'Student'}</p>
                    <p class="text-text-secondary">${complaint.email || 'No email provided'}</p>
                    ${complaint.registrationNumber ? `<p class="font-mono text-text-muted">Reg: ${complaint.registrationNumber}</p>` : ''}
                </div>
                <div class="space-y-1">
                    <p class="text-text-muted font-medium uppercase text-[10px] tracking-wider">Assigned Technician</p>
                    <p class="font-bold text-sm text-text">${complaint.technician || complaint.assignedTo || 'Unassigned'}</p>
                    <p class="text-text-secondary">Logged on: ${createdStr}</p>
                    <button onclick="closeModal(); openAssignTechnicianModal('${complaint.id}');" class="text-primary font-semibold hover:underline mt-1 inline-block">Change Technician →</button>
                </div>
            </div>

            <!-- Issue Description -->
            <div>
                <p class="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">Issue Description</p>
                <div class="p-4 rounded-2xl bg-surface border border-border text-sm text-text leading-relaxed">
                    ${complaint.description || 'No description provided.'}
                </div>
            </div>

            <!-- Actions Bar -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-text-secondary">Change Status:</span>
                    <button onclick="quickUpdateComplaintStatus('${complaint.id}', 'In Progress'); closeModal();" class="px-3 py-1.5 rounded-xl bg-info/10 text-info hover:bg-info hover:text-white text-xs font-semibold transition-all">In Progress</button>
                    <button onclick="quickUpdateComplaintStatus('${complaint.id}', 'Completed'); closeModal();" class="px-3 py-1.5 rounded-xl bg-emerald/10 text-emerald hover:bg-emerald hover:text-white text-xs font-semibold transition-all">Resolved</button>
                </div>
                <button onclick="deleteComplaint('${complaint.id}'); closeModal();" class="px-3 py-1.5 rounded-xl bg-danger/10 text-danger hover:bg-danger hover:text-white text-xs font-semibold transition-all flex items-center gap-1.5">
                    <i class="fa-solid fa-trash text-xs"></i> Delete
                </button>
            </div>
        </div>
    `;

    showModal('Complaint Details & Resolution', content);
}

function openAssignTechnicianModal(complaintId) {
    const complaint = (latestComplaints || []).find(c => c.id === complaintId);
    if (!complaint) return showToast('Complaint not found.', 'error');

    const technicians = Array.isArray(allUsers) ? allUsers.filter(u => u.role === 'technician') : [];
    const currentTech = complaint.technician || complaint.assignedTo || '';

    const content = `
        <div class="space-y-5">
            <div>
                <h4 class="font-bold text-sm text-text">Assign Technician for ${complaint.id}</h4>
                <p class="text-xs text-text-secondary">${complaint.category} issue in ${complaint.hostelBlock} • Room ${complaint.roomNumber}</p>
            </div>

            <div class="space-y-2">
                <label class="block text-xs font-semibold uppercase tracking-wider text-text-secondary">Select Technician</label>
                <select id="assignTechSelectInput" class="input-focus w-full px-4 py-3 rounded-xl border border-border bg-surface-alt text-sm">
                    <option value="">-- Choose available technician --</option>
                    ${technicians.map(t => `<option value="${t.name}" ${t.name === currentTech ? 'selected' : ''}>${t.name} (${t.email})</option>`).join('')}
                </select>
            </div>

            <div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button onclick="closeModal()" class="px-4 py-2.5 rounded-xl border border-border text-xs font-semibold text-text-secondary hover:bg-surface-alt transition-all">Cancel</button>
                <button onclick="submitAssignTechnician('${complaint.id}')" class="btn-primary px-5 py-2.5 rounded-xl text-white text-xs font-semibold shadow-xs">Save Assignment</button>
            </div>
        </div>
    `;

    showModal('Assign Maintenance Technician', content);
}

async function submitAssignTechnician(complaintId) {
    const select = document.getElementById('assignTechSelectInput');
    const technicianName = select?.value?.trim();
    if (!technicianName) return showToast('Please select a technician.', 'warning');

    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Assigned', technician: technicianName })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to assign technician.');
        closeModal();
        showToast(`Assigned ${technicianName} to #${complaintId} successfully!`, 'success');
        await loadDashboardData();
    } catch (e) {
        showToast(e.message || 'Unable to assign technician.', 'error');
    }
}

async function quickUpdateComplaintStatus(complaintId, newStatus) {
    try {
        const response = await apiRequest(`/api/complaints/${encodeURIComponent(complaintId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Failed to update status.');
        showToast(`Complaint #${complaintId} status updated to ${newStatus}`, 'success');
        await loadDashboardData();
    } catch (e) {
        showToast(e.message || 'Unable to update status.', 'error');
    }
}

function openNewComplaintModal() {
    const content = `
        <form onsubmit="submitNewComplaintFromModal(event)" class="space-y-4 text-xs">
            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Student Name</label>
                    <input id="modalCompStudent" type="text" required placeholder="e.g. John Doe" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                </div>
                <div>
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Student Email</label>
                    <input id="modalCompEmail" type="email" required placeholder="student@hostelfix.edu" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                </div>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Hostel Block</label>
                    <input id="modalCompBlock" type="text" required placeholder="Block A" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                </div>
                <div>
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Room Number</label>
                    <input id="modalCompRoom" type="text" required placeholder="A-204" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                </div>
                <div class="col-span-2 sm:col-span-1">
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Reg Number</label>
                    <input id="modalCompReg" type="text" placeholder="REG-2024001" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                </div>
            </div>
            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Category</label>
                    <select id="modalCompCategory" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                        <option value="Electrical">Electrical</option>
                        <option value="Plumbing">Plumbing</option>
                        <option value="Carpentry">Carpentry</option>
                        <option value="Furniture">Furniture</option>
                        <option value="Appliances">Appliances</option>
                        <option value="Wi-Fi">Wi-Fi & Network</option>
                        <option value="Cleaning">Cleaning</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <div>
                    <label class="block font-semibold text-text-secondary uppercase mb-1">Priority</label>
                    <select id="modalCompPriority" class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs">
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High" selected>High</option>
                        <option value="Urgent">Urgent</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="block font-semibold text-text-secondary uppercase mb-1">Issue Description</label>
                <textarea id="modalCompDesc" rows="3" required placeholder="Describe the maintenance problem..." class="input-focus w-full px-3.5 py-2.5 rounded-xl border border-border bg-surface-alt text-xs resize-none"></textarea>
            </div>
            <div class="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl border border-border text-xs font-semibold text-text-secondary hover:bg-surface-alt transition-all">Cancel</button>
                <button type="submit" class="btn-primary px-5 py-2.5 rounded-xl text-white text-xs font-semibold shadow-xs">Create Complaint</button>
            </div>
        </form>
    `;
    showModal('Log New Maintenance Complaint', content);
}

async function submitNewComplaintFromModal(event) {
    event.preventDefault();
    const student = document.getElementById('modalCompStudent')?.value.trim();
    const email = document.getElementById('modalCompEmail')?.value.trim();
    const hostelBlock = document.getElementById('modalCompBlock')?.value.trim();
    const roomNumber = document.getElementById('modalCompRoom')?.value.trim();
    const registrationNumber = document.getElementById('modalCompReg')?.value.trim();
    const category = document.getElementById('modalCompCategory')?.value;
    const priority = document.getElementById('modalCompPriority')?.value;
    const description = document.getElementById('modalCompDesc')?.value.trim();

    try {
        const response = await apiRequest('/api/complaints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student, email, hostelBlock, roomNumber, registrationNumber, category, priority, description })
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) throw new Error(data.error || 'Unable to create complaint.');
        closeModal();
        showToast(`Complaint #${data.id} registered dynamically!`, 'success');
        await loadDashboardData();
    } catch (e) {
        showToast(e.message || 'Failed to submit complaint.', 'error');
    }
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
    if (navProfileBtn) {
        const activePage = getActivePageId();
        if (!currentUser || activePage === 'login' || activePage === 'register') {
            navProfileBtn.classList.add('hidden');
        } else {
            navProfileBtn.classList.remove('hidden');
            navProfileBtn.innerHTML = `<i class="fa-solid fa-user"></i><span>${currentUser?.name || 'Profile'}</span>`;
            navProfileBtn.onclick = () => navigateTo('profile');
        }
    }
    updateSidebarIdentity();
    requestAnimationFrame(updateSidebarIdentity);
    window.setTimeout(updateSidebarIdentity, 100);
}

function resetNavAfterLogout() {
    const navProfileBtn = document.getElementById('navProfileBtn');
    if (navProfileBtn) {
        navProfileBtn.classList.add('hidden');
    }
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

function validateStudentIdentityFields(studentName, registrationNumber, roomNumber) {
    const student = String(studentName || '').trim();
    const regNo = String(registrationNumber || '').trim();
    const room = String(roomNumber || '').trim();

    if (!student || !/^[A-Za-z ]+$/.test(student)) {
        showToast('Student name must contain letters and spaces only.', 'warning');
        return false;
    }
    if (!regNo || !/^\d+$/.test(regNo)) {
        showToast('Registration number must contain numbers only.', 'warning');
        return false;
    }
    if (room && !/^\d+$/.test(room)) {
        showToast('Room number must contain numbers only.', 'warning');
        return false;
    }
    return true;
}

async function handleLaundrySubmit(e) {
    e.preventDefault();
    const form = e.target;
    const studentName = document.getElementById('laundryStudentName').value.trim();
    const registrationNumber = document.getElementById('laundryRegistrationNumber').value.trim();
    const hostelBlock = document.getElementById('laundryHostelBlock').value.trim();
    const roomNumber = document.getElementById('laundryRoomNumber').value.trim();
    const dressCount = parseInt(document.getElementById('laundryDressCount').value, 10);
    const details = document.getElementById('laundryDetails').value.trim();

    if (!studentName || !registrationNumber || !dressCount || !details) {
        showToast('Please complete the laundry request form before submitting.', 'warning');
        return;
    }
    if (!validateStudentIdentityFields(studentName, registrationNumber, roomNumber)) return;

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
                pickupDate: '',
                photos: selectedLaundryPhotos,
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
        selectedLaundryPhotos = [];
        renderLaundryPhotoPreviews();
        await loadDashboardData();
        navigateTo('student-dashboard');
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function approveGatePass(gatePassId, status, actorRole = 'Admin') {
    if (!gatePassId) return;
    showLoading();
    try {
        const response = await apiRequest(`/api/gate-passes/${encodeURIComponent(gatePassId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, approvedBy: currentUser?.name || actorRole })
        });
        const data = await parseJsonResponse(response);
        hideLoading();

        if (!response.ok) {
            showToast(data.error || `Failed to update gate pass (${response.status}).`, 'error');
            return;
        }

        showToast(`Gate pass ${status.toLowerCase()} successfully.`, 'success');
        await loadDashboardData();
        const activePage = getActivePageId();
        if (activePage === 'warden-dashboard') {
            renderWardenDashboard();
        } else if (activePage === 'security-dashboard') {
            renderSecurityDashboard();
        } else {
            renderGatePassTable(latestGatePasses);
        }
    } catch (error) {
        hideLoading();
        showToast('Unable to reach server. Please try again.', 'error');
        console.error(error);
    }
}

async function updateGatePassStatus(gatePassId, status) {
    if (!gatePassId) return;
    const actorRole = currentUser?.role === 'warden' ? 'Warden' : (currentUser?.name || 'Admin');
    
    if (status === 'COMPLETED') {
        showLoading();
        try {
            const response = await apiRequest('/api/gatepass/warden/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: gatePassId,
                    wardenId: currentUser?.userId || currentUser?.email || 'warden',
                    wardenName: currentUser?.name || 'Warden',
                    approved: true
                })
            });
            hideLoading();
            const data = await parseJsonResponse(response);
            if (!response.ok) {
                showToast(data.error || 'Failed to complete warden verification.', 'error');
                return;
            }
            showToast('Student return verified and gate pass completed!', 'success');
            await loadDashboardData();
            renderWardenDashboard();
        } catch (err) {
            hideLoading();
            showToast('Unable to complete verification.', 'error');
            console.error(err);
        }
        return;
    }

    if (status === 'OUT' || status === 'RETURNED') {
        showLoading();
        try {
            const response = await apiRequest(`/api/gate-passes/${encodeURIComponent(gatePassId)}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status === 'OUT' ? 'OUT' : 'RETURNED', approvedBy: currentUser?.name || 'Security' })
            });
            hideLoading();
            const data = await parseJsonResponse(response);
            if (!response.ok) {
                showToast(data.error || 'Failed to update gate pass movement.', 'error');
                return;
            }
            showToast(`Gate pass marked ${status}.`, 'success');
            await loadDashboardData();
            renderSecurityDashboard();
            renderWardenDashboard();
        } catch (err) {
            hideLoading();
            showToast('Failed to update status.', 'error');
            console.error(err);
        }
        return;
    }

    return approveGatePass(gatePassId, status === 'Rejected' ? 'Rejected' : 'Approved', actorRole);
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
        const [
            summaryRes,
            complaintsRes,
            techniciansRes,
            gatePassesRes,
            laundryRequestsRes,
            usersRes,
            inventoryRes
        ] = await Promise.allSettled([
            apiRequest('/api/summary'),
            apiRequest('/api/complaints'),
            apiRequest('/api/technicians'),
            apiRequest('/api/gate-passes'),
            apiRequest('/api/laundry-requests'),
            apiRequest('/api/users'),
            apiRequest('/api/inventory')
        ]);

        const summary = summaryRes.status === 'fulfilled' && summaryRes.value.ok ? await parseJsonResponse(summaryRes.value) : { total: 0, resolvedToday: 0, pending: 0, activeTechnicians: 0 };
        const complaints = complaintsRes.status === 'fulfilled' && complaintsRes.value.ok ? await parseJsonResponse(complaintsRes.value) : [];
        const technicianList = techniciansRes.status === 'fulfilled' && techniciansRes.value.ok ? await parseJsonResponse(techniciansRes.value) : [];
        const gatePasses = gatePassesRes.status === 'fulfilled' && gatePassesRes.value.ok ? await parseJsonResponse(gatePassesRes.value) : [];
        const laundryRequests = laundryRequestsRes.status === 'fulfilled' && laundryRequestsRes.value.ok ? await parseJsonResponse(laundryRequestsRes.value) : [];
        const allUsers = usersRes.status === 'fulfilled' && usersRes.value.ok ? await parseJsonResponse(usersRes.value) : [];
        const inventoryList = inventoryRes.status === 'fulfilled' && inventoryRes.value.ok ? await parseJsonResponse(inventoryRes.value) : [];

        latestComplaints = Array.isArray(complaints) ? complaints.slice() : [];
        latestGatePasses = Array.isArray(gatePasses) ? gatePasses.slice() : [];
        latestLaundryRequests = Array.isArray(laundryRequests) ? laundryRequests.slice() : [];
        
        syncCurrentUserStudentProfile();
        prepareComplaintForm();
        prepareLaundryForm();
        populateTechnicianDropdown(technicianList);

        const values = {
            landingTotalComplaints: summary?.total || 0,
            landingResolvedToday: summary?.resolvedToday || 0,
            landingPendingRequests: summary?.pending || 0,
            landingActiveTechnicians: summary?.activeTechnicians || 0
        };

        Object.entries(values).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) {
                el.dataset.value = value;
                el.textContent = Number(value || 0).toLocaleString();
            }
        });

        updateStudentDashboardStats(summary);
        updateStudentRecentComplaints(complaints);
        renderTechAssignedComplaints(complaints);
        renderTechCompletedComplaints(complaints);
        renderTechSummary(complaints);
        renderAdminSummary(summary, complaints, allUsers);
        renderGatePassTable(latestGatePasses);
        renderAdminStudents(allUsers, complaints);
        renderAdminWardens(allUsers);
        renderAdminTechnicians(allUsers, complaints);
        renderAdminFullComplaintsTable(complaints);
        renderTechInventoryGrid(inventoryList);
        loadSecurityAlertStats().catch((securityError) => console.warn('Security alert stats unavailable:', securityError));
        renderWardenDashboard();
        renderSecurityDashboard();
        renderAdminGatePassLogsPage();

        const gatePassCount = document.getElementById('adminGatePassCount');
        if (gatePassCount) gatePassCount.textContent = `${latestGatePasses.length}`;

        if (document.getElementById('page-landing')?.classList.contains('active')) {
            animateNumbers();
        }
    } catch (error) {
        console.error('Unable to load dashboard data:', error);
    }
}

let showAllWardenGatePassRows = false;
let showAllWardenReturnRows = false;
let currentWardenFilter = 'all';
let wardenGatePassSearchQuery = '';
let currentWardenReturnFilter = 'all';
let wardenReturnSearchQuery = '';
let currentSecurityFilter = 'all';
let securityGatePassSearchQuery = '';

async function refreshWardenDashboardData(buttonElement) {
    const icon = buttonElement?.querySelector('i.fa-rotate, i.fa-solid') || buttonElement?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    try {
        await loadDashboardData();
        renderWardenDashboard();
        renderWardenReturnSchedule(latestGatePasses);
        showToast('Warden dashboard & student returns refreshed!', 'success');
    } catch (e) {
        console.error(e);
        showToast('Dashboard data reloaded.', 'info');
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
    }
}

async function refreshSecurityDashboardData(buttonElement) {
    const icon = buttonElement?.querySelector('i.fa-rotate, i.fa-solid') || buttonElement?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    try {
        await loadDashboardData();
        renderSecurityDashboard();
        showToast('Security gate dashboard refreshed!', 'success');
    } catch (e) {
        console.error(e);
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
    }
}

async function refreshAdminGatePassesData(buttonElement) {
    const icon = buttonElement?.querySelector('i.fa-rotate, i.fa-solid') || buttonElement?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    try {
        await loadDashboardData();
        renderAdminGatePassLogsPage();
        showToast('Gate pass monitoring matrix refreshed!', 'success');
    } catch (e) {
        console.error(e);
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
    }
}

async function refreshDashboardData(buttonElement) {
    const icon = buttonElement?.querySelector('i.fa-rotate, i.fa-solid') || buttonElement?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    try {
        await loadDashboardData();
        
        if (!currentUser) return;
        
        if (currentUser.role === 'admin') {
            const pageId = getActivePageId();
            if (pageId === 'admin-dashboard') renderAdminDashboard();
            else if (pageId === 'admin-students') renderAdminStudentsPage();
            else if (pageId === 'admin-technicians') renderAdminTechniciansPage();
            else if (pageId === 'admin-complaints') renderAdminComplaintsPage();
            else if (pageId === 'admin-reports') renderAdminReportsPage();
        } else if (currentUser.role === 'student') {
            renderStudentDashboard();
        } else if (currentUser.role === 'technician') {
            renderTechnicianDashboard();
        } else if (currentUser.role === 'warden') {
            renderWardenDashboard();
            renderWardenReturnSchedule(latestGatePasses);
        } else if (currentUser.role === 'security') {
            renderSecurityDashboard();
        }
        
        showToast('Data refreshed successfully!', 'success');
    } catch (e) {
        console.error(e);
        showToast('Failed to refresh data.', 'error');
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
    }
}

function toggleWardenGatePassSeeAll() {
    showAllWardenGatePassRows = !showAllWardenGatePassRows;
    renderWardenDashboard();
}

function toggleWardenReturnSeeAll() {
    showAllWardenReturnRows = !showAllWardenReturnRows;
    renderWardenReturnSchedule(latestGatePasses);
}

function setWardenGatePassFilter(filterType) {
    currentWardenFilter = filterType;
    document.querySelectorAll('.warden-filter-btn').forEach((btn) => {
        const active = btn.dataset.filter === filterType;
        if (active) {
            btn.className = 'warden-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-primary text-white transition-all shadow-sm';
        } else {
            btn.className = 'warden-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-border bg-surface text-text-secondary hover:text-text transition-all';
        }
    });
    renderWardenDashboard();
}

function handleWardenGatePassSearch(query) {
    wardenGatePassSearchQuery = (query || '').toLowerCase().trim();
    renderWardenDashboard();
}

function setWardenReturnFilter(filterType) {
    currentWardenReturnFilter = filterType;
    document.querySelectorAll('.warden-return-filter-btn').forEach((btn) => {
        const active = btn.dataset.returnFilter === filterType;
        if (active) {
            btn.className = 'warden-return-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white transition-all shadow-xs flex items-center gap-1';
        } else {
            btn.className = 'warden-return-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-border bg-surface text-text-secondary hover:text-text transition-all flex items-center gap-1';
        }
    });
    renderWardenReturnSchedule(latestGatePasses);
}

function handleWardenReturnSearch(query) {
    wardenReturnSearchQuery = (query || '').toLowerCase().trim();
    renderWardenReturnSchedule(latestGatePasses);
}

function setAdminGatePassFilter(filterType) {
    currentAdminGatePassFilter = filterType;
    document.querySelectorAll('.admin-pass-filter-btn').forEach((btn) => {
        const active = btn.dataset.adminFilter === filterType;
        if (active) {
            btn.className = 'admin-pass-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-primary text-white transition-all shadow-sm';
        } else {
            btn.className = 'admin-pass-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-border bg-surface text-text-secondary hover:text-text transition-all';
        }
    });
    renderAdminGatePassLogsPage();
}

function handleAdminGatePassSearch(query) {
    adminGatePassSearchQuery = (query || '').toLowerCase().trim();
    renderGatePassTable(latestGatePasses);
    renderAdminGatePassLogsPage();
}

function handleAdminGatePassLogSearch(query) {
    adminGatePassSearchQuery = (query || '').toLowerCase().trim();
    renderAdminGatePassLogsPage();
}

function setSecurityPassFilter(filterType) {
    currentSecurityFilter = filterType;
    document.querySelectorAll('.sec-pass-filter-btn').forEach((btn) => {
        const active = btn.dataset.secFilter === filterType;
        if (active) {
            btn.className = 'sec-pass-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white transition-all shadow-xs';
        } else {
            btn.className = 'sec-pass-filter-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-border bg-surface text-text-secondary hover:text-text transition-all';
        }
    });
    renderSecurityDashboard();
}

function handleSecurityPassSearch(query) {
    securityGatePassSearchQuery = (query || '').toLowerCase().trim();
    renderSecurityDashboard();
}

function calculateGatePassReturnInfo(pass) {
    const todayStr = new Date().toISOString().split('T')[0];
    const returnStr = String(pass.returnDate || '').slice(0, 10);
    const rawStatus = String(pass.status || 'REQUESTED').toUpperCase();

    if (rawStatus === 'COMPLETED') {
        return {
            category: 'completed',
            label: 'Completed & Returned',
            badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
            icon: 'fa-solid fa-circle-check text-emerald',
            isOverdue: false,
            isToday: false,
            isUpcoming: false,
            isReturned: false,
            diffDays: 0
        };
    }

    if (rawStatus === 'REJECTED' || rawStatus === 'WARDEN VERIFICATION REJECTED') {
        return {
            category: 'rejected',
            label: 'Rejected',
            badgeClass: 'bg-danger/10 text-danger border border-danger/20',
            icon: 'fa-solid fa-ban text-danger',
            isOverdue: false,
            isToday: false,
            isUpcoming: false,
            isReturned: false,
            diffDays: 0
        };
    }

    if (rawStatus === 'RETURNED' || (pass.inTime && !pass.wardenVerified)) {
        return {
            category: 'returned',
            label: '🟣 Returned (Arrival Verification Needed)',
            badgeClass: 'bg-purple-100 text-purple-800 border border-purple-200 animate-pulse',
            icon: 'fa-solid fa-clipboard-check text-purple-600',
            isOverdue: false,
            isToday: false,
            isUpcoming: false,
            isReturned: true,
            diffDays: 0
        };
    }

    if (!returnStr) {
        return {
            category: 'unknown',
            label: 'Return Date Not Specified',
            badgeClass: 'bg-surface-alt text-text-secondary border border-border',
            icon: 'fa-solid fa-calendar text-text-muted',
            isOverdue: false,
            isToday: false,
            isUpcoming: false,
            isReturned: false,
            diffDays: 0
        };
    }

    const todayParts = todayStr.split('-');
    const returnParts = returnStr.split('-');
    const todayDate = new Date(parseInt(todayParts[0], 10), parseInt(todayParts[1], 10) - 1, parseInt(todayParts[2], 10));
    const returnDate = new Date(parseInt(returnParts[0], 10), parseInt(returnParts[1], 10) - 1, parseInt(returnParts[2], 10));
    const diffTime = returnDate.getTime() - todayDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return {
            category: 'today',
            label: `🟢 Expected Return TODAY (${formatGatePassDate(returnStr)})`,
            badgeClass: 'bg-emerald text-white border border-emerald shadow-xs font-bold',
            icon: 'fa-solid fa-bell text-emerald animate-bounce',
            isOverdue: false,
            isToday: true,
            isUpcoming: false,
            isReturned: false,
            diffDays: 0
        };
    } else if (diffDays === 1) {
        return {
            category: 'upcoming',
            label: `🔵 Returning Tomorrow (${formatGatePassDate(returnStr)})`,
            badgeClass: 'bg-blue-100 text-blue-800 border border-blue-200 font-semibold',
            icon: 'fa-solid fa-calendar-day text-blue-600',
            isOverdue: false,
            isToday: false,
            isUpcoming: true,
            isReturned: false,
            diffDays: 1
        };
    } else if (diffDays > 1) {
        return {
            category: 'upcoming',
            label: `🟡 Returning in ${diffDays} days (${formatGatePassDate(returnStr)})`,
            badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200 font-medium',
            icon: 'fa-solid fa-calendar-days text-amber-600',
            isOverdue: false,
            isToday: false,
            isUpcoming: true,
            isReturned: false,
            diffDays
        };
    } else {
        const overdueDays = Math.abs(diffDays);
        return {
            category: 'overdue',
            label: `🔴 Overdue by ${overdueDays} day${overdueDays > 1 ? 's' : ''}! (Was due ${formatGatePassDate(returnStr)})`,
            badgeClass: 'bg-danger text-white border border-danger/80 shadow-xs font-bold animate-pulse',
            icon: 'fa-solid fa-triangle-exclamation text-danger',
            isOverdue: true,
            isToday: false,
            isUpcoming: false,
            isReturned: false,
            diffDays
        };
    }
}

function renderWardenReturnSchedule(passes) {
    const list = document.getElementById('wardenReturnScheduleList');
    if (!list) return;

    let activePasses = (passes || latestGatePasses || []).filter(p => {
        const status = String(p.status || 'REQUESTED').toUpperCase();
        return status !== 'REJECTED' && status !== 'WARDEN VERIFICATION REJECTED';
    });

    if (currentWardenReturnFilter === 'today') {
        activePasses = activePasses.filter(p => calculateGatePassReturnInfo(p).category === 'today');
    } else if (currentWardenReturnFilter === 'upcoming') {
        activePasses = activePasses.filter(p => calculateGatePassReturnInfo(p).category === 'upcoming');
    } else if (currentWardenReturnFilter === 'overdue') {
        activePasses = activePasses.filter(p => calculateGatePassReturnInfo(p).category === 'overdue');
    } else if (currentWardenReturnFilter === 'returned') {
        activePasses = activePasses.filter(p => calculateGatePassReturnInfo(p).category === 'returned');
    }

    if (wardenReturnSearchQuery) {
        activePasses = activePasses.filter(p => {
            const student = String(p.student || '').toLowerCase();
            const reg = String(p.registrationNumber || '').toLowerCase();
            const id = String(p.id || '').toLowerCase();
            const room = String(p.roomNumber || '').toLowerCase();
            const block = String(p.hostelBlock || '').toLowerCase();
            const reason = String(p.reason || '').toLowerCase();
            return student.includes(wardenReturnSearchQuery) ||
                   reg.includes(wardenReturnSearchQuery) ||
                   id.includes(wardenReturnSearchQuery) ||
                   room.includes(wardenReturnSearchQuery) ||
                   block.includes(wardenReturnSearchQuery) ||
                   reason.includes(wardenReturnSearchQuery);
        });
    }

    if (!activePasses.length) {
        list.innerHTML = `
            <div class="text-sm text-text-secondary py-8 text-center bg-surface-alt/60 rounded-2xl border border-dashed border-border">
                <i class="fa-solid fa-calendar-check text-2xl mb-2 text-indigo-400 block"></i>
                No students match the return filter <strong>"${currentWardenReturnFilter}"</strong>.
            </div>`;
        return;
    }

    activePasses.sort((a, b) => {
        const infoA = calculateGatePassReturnInfo(a);
        const infoB = calculateGatePassReturnInfo(b);
        const priority = { overdue: 1, today: 2, returned: 3, upcoming: 4, completed: 5, unknown: 6, rejected: 7 };
        const prioA = priority[infoA.category] || 10;
        const prioB = priority[infoB.category] || 10;
        if (prioA !== prioB) return prioA - prioB;
        return new Date(a.returnDate || 0) - new Date(b.returnDate || 0);
    });

    const seeAllBtn = document.getElementById('wardenReturnSeeAllBtn');
    const defaultVisible = 4;

    if (seeAllBtn) {
        if (activePasses.length > defaultVisible) {
            seeAllBtn.classList.remove('hidden');
            seeAllBtn.textContent = showAllWardenReturnRows ? `Show Less (${activePasses.length})` : `See All (${activePasses.length})`;
        } else {
            seeAllBtn.classList.add('hidden');
        }
    }

    const displayPasses = showAllWardenReturnRows ? activePasses : activePasses.slice(0, defaultVisible);

    let html = displayPasses.map((pass) => {
        const returnInfo = calculateGatePassReturnInfo(pass);
        const rawStatus = String(pass.status || 'REQUESTED').toUpperCase();
        const isPending = rawStatus === 'REQUESTED' || rawStatus === 'PENDING';
        const isReturned = rawStatus === 'RETURNED';

        let borderCardClass = 'border-border bg-surface hover:border-indigo-300';
        if (returnInfo.isToday) {
            borderCardClass = 'border-emerald/40 bg-emerald/[0.02] shadow-sm';
        } else if (returnInfo.isOverdue) {
            borderCardClass = 'border-danger/40 bg-danger/[0.02] shadow-sm';
        } else if (returnInfo.isReturned) {
            borderCardClass = 'border-purple-300 bg-purple-500/[0.02] shadow-sm';
        }

        return `
            <div class="rounded-2xl border ${borderCardClass} p-4 sm:p-5 hover:shadow-md transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div class="flex items-start gap-4">
                    ${pass.studentPhoto ? `
                        <img src="${pass.studentPhoto}" alt="${pass.student || 'Student'}" class="w-14 h-14 rounded-2xl object-cover border border-border shadow-xs shrink-0">
                    ` : `
                        <div class="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 text-xl font-bold shrink-0">
                            ${(pass.student || 'S').slice(0, 2).toUpperCase()}
                        </div>
                    `}
                    <div class="space-y-1.5 min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-bold text-base text-text">${pass.student || 'Student'}</span>
                            <span class="text-xs text-text-secondary font-mono">(${pass.registrationNumber || 'N/A'})</span>
                            <span class="px-3 py-1 rounded-full text-xs font-semibold ${returnInfo.badgeClass}">
                                ${returnInfo.label}
                            </span>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                            <span><strong class="text-text">Hostel:</strong> ${pass.hostelBlock || 'Block A'} • <strong>Room:</strong> ${pass.roomNumber || 'N/A'}</span>
                            <span><strong class="text-text">Session:</strong> ${pass.session || 'General'}</span>
                            <span class="text-text-muted font-mono">Pass: ${pass.id}</span>
                        </div>
                        <div class="flex flex-wrap items-center gap-3 text-xs">
                            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-alt border border-border/80">
                                <i class="fa-solid fa-arrow-right-from-bracket text-text-muted"></i>
                                <span class="text-text-secondary font-medium">Out: <strong>${formatGatePassDate(pass.gateDate)}</strong></span>
                            </div>
                            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${returnInfo.isToday ? 'bg-emerald/10 text-emerald font-bold border border-emerald/30' : returnInfo.isOverdue ? 'bg-danger/10 text-danger font-bold border border-danger/30' : 'bg-surface-alt border border-border/80'}">
                                <i class="fa-solid fa-calendar-check ${returnInfo.isToday ? 'text-emerald' : returnInfo.isOverdue ? 'text-danger' : 'text-primary'}"></i>
                                <span>Expected Return: <strong>${formatGatePassDate(pass.returnDate)}</strong></span>
                            </div>
                        </div>
                        <p class="text-xs text-text-muted italic bg-surface-alt/70 px-2.5 py-1 rounded-lg">
                            <i class="fa-solid fa-comment-dots text-primary/70 mr-1"></i> "${pass.reason || 'No reason provided'}"
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0 self-end lg:self-center">
                    ${isPending ? `
                        <button onclick="updateGatePassStatus('${pass.id}', 'Approved')" class="px-3.5 py-2 rounded-xl bg-emerald hover:bg-emerald/90 text-white text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-check"></i> Approve Departure
                        </button>
                    ` : ''}
                    ${(rawStatus === 'OUTSIDE' || rawStatus === 'OUT' || rawStatus === 'RETURNED' || rawStatus === 'OUTSIDE_NOT_RETURNED') && !pass.wardenVerified ? `
                        <button onclick="submitWardenVerificationAction('${pass.id}', 'APPROVE')" class="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-hotel"></i> Confirm Hostel Arrival
                        </button>
                    ` : ''}
                    <button onclick="viewGatePassDetailsModal('${pass.id}')" class="px-3.5 py-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text hover:text-primary transition-all flex items-center gap-1.5">
                        <i class="fa-solid fa-eye text-primary"></i> Details
                    </button>
                    <button onclick="downloadGatePassPdf('${pass.id}')" class="px-3 py-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text-secondary hover:text-text transition-all flex items-center gap-1.5">
                        <i class="fa-solid fa-file-pdf text-danger"></i> PDF
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (activePasses.length > defaultVisible) {
        html += `
            <div class="pt-3 text-center">
                <button onclick="toggleWardenReturnSeeAll()" class="w-full sm:w-auto px-6 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 mx-auto">
                    <i class="fa-solid ${showAllWardenReturnRows ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>
                    ${showAllWardenReturnRows ? `Show Less (${defaultVisible} items)` : `See All (${activePasses.length} Scheduled Returns)`}
                </button>
            </div>
        `;
    }

    list.innerHTML = html;
}

function viewGatePassDetailsModal(passId) {
    const pass = latestGatePasses.find(p => p.id === passId || p.id?.toLowerCase() === passId?.toLowerCase());
    if (!pass) return showToast('Gate pass record not found.', 'error');

    const rawStatus = String(pass.status || 'PENDING_WARDEN').toUpperCase();
    const isApproved = /^(approved|qr generated|security_pending|outside|warden_pending|outside_not_returned|completed)$/i.test(rawStatus);
    const isSecurityPending = rawStatus === 'SECURITY_PENDING' || rawStatus === 'APPROVED' || rawStatus === 'QR GENERATED';
    const isOutside = rawStatus === 'OUTSIDE' || rawStatus === 'OUT';
    const isOutsideNotReturned = rawStatus === 'OUTSIDE_NOT_RETURNED';
    const isCompleted = rawStatus === 'COMPLETED';
    const isRejected = rawStatus.includes('REJECTED');

    let badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
    let badgeText = 'Pending Warden Approval';

    if (isSecurityPending) {
        badgeClass = 'bg-indigo-100 text-indigo-800 border border-indigo-200';
        badgeText = 'Approved • Security Pending';
    } else if (isOutside) {
        badgeClass = 'bg-blue-100 text-blue-800 border border-blue-200';
        badgeText = 'Outside • Gate Crossed';
    } else if (isOutsideNotReturned) {
        badgeClass = 'bg-rose-100 text-rose-900 border border-rose-300';
        badgeText = '⚠️ Outside — Not Returned';
    } else if (isCompleted) {
        badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
        badgeText = '✅ Completed & Verified';
    } else if (isRejected) {
        badgeClass = 'bg-danger/10 text-danger border border-danger/20';
        badgeText = rawStatus === 'SECURITY_REJECTED' ? '❌ Security Exit Rejected' : '❌ Pass Rejected';
    }

    const isSecurityExitDone = Boolean(pass.securityVerified || pass.exitTime || isOutside || rawStatus === 'RETURNED' || isCompleted);
    const isSecurityEntryDone = Boolean(pass.securityReturnVerified || pass.returnTime || rawStatus === 'RETURNED' || isCompleted);
    const isWardenHostelDone = Boolean(pass.wardenVerified || isCompleted);

    const timelineEvents = [
        {
            phase: 'OUT FROM COLLEGE',
            stage: 'Applied',
            title: '1. Gate Pass Applied (Out Request)',
            time: pass.createdAt ? new Date(pass.createdAt).toLocaleString('en-IN') : '—',
            actor: pass.student || 'Student',
            done: true,
            icon: 'fa-solid fa-file-pen text-indigo-500',
            bg: 'bg-indigo-500'
        },
        {
            phase: 'OUT FROM COLLEGE',
            stage: 'Warden Departure',
            title: pass.wardenApproval?.status === 'APPROVED' || isApproved ? '2. Warden Approved Departure' : isRejected ? '2. Warden Rejected Departure' : '2. Warden Departure Approval Pending',
            time: pass.approvedAt || pass.wardenApproval?.approvedAt || pass.adminApproval?.approvedAt ? new Date(pass.approvedAt || pass.wardenApproval?.approvedAt || pass.adminApproval?.approvedAt).toLocaleString('en-IN') : 'Pending',
            actor: pass.approvedBy || pass.wardenApproval?.approvedBy || pass.adminApproval?.approvedBy || 'Hostel Warden',
            done: Boolean(pass.approvedAt || pass.wardenApproval?.approvedAt || pass.adminApproval?.approvedAt || isApproved),
            cert: pass.certificateId || '',
            icon: isApproved ? 'fa-solid fa-user-shield text-emerald' : 'fa-solid fa-clock text-amber-500',
            bg: isApproved ? 'bg-emerald' : 'bg-amber-400'
        },
        {
            phase: 'OUT FROM COLLEGE',
            stage: 'Security Exit',
            title: isSecurityExitDone ? '3. Security Gate Exit Confirmed' : pass.securityStatus === 'REJECTED' ? '3. Security Gate Exit Rejected' : '3. Security Gate Exit Pending',
            time: pass.exitTime || pass.securityVerifiedAt ? new Date(pass.exitTime || pass.securityVerifiedAt).toLocaleString('en-IN') : 'Pending',
            actor: pass.securityName || 'Gate Security',
            done: isSecurityExitDone,
            note: pass.securityRejectionReason ? ('Reason: "' + pass.securityRejectionReason + '"') : (isSecurityExitDone ? 'Student crossed campus gate to exit' : ''),
            icon: isSecurityExitDone ? 'fa-solid fa-door-open text-blue-500' : 'fa-solid fa-shield-halved text-slate-400',
            bg: isSecurityExitDone ? 'bg-blue-500' : 'bg-slate-300'
        },
        {
            phase: 'RETURN TO COLLEGE',
            stage: 'Security Entry',
            title: isSecurityEntryDone ? '4. Security Gate Entry Verified' : isOutsideNotReturned ? '4. Security Gate Entry Overdue' : '4. Security Gate Entry Pending',
            time: pass.returnTime || pass.securityReturnVerifiedAt ? new Date(pass.returnTime || pass.securityReturnVerifiedAt).toLocaleString('en-IN') : 'Pending',
            actor: pass.returnVerifiedBy || pass.securityName || 'Gate Security',
            done: isSecurityEntryDone,
            note: isSecurityEntryDone ? 'Student entered campus gate and verified by security' : 'Step 4: Gate Security approves campus gate entry first',
            icon: isSecurityEntryDone ? 'fa-solid fa-shield-check text-emerald' : isOutsideNotReturned ? 'fa-solid fa-triangle-exclamation text-rose-500' : 'fa-solid fa-shield text-slate-400',
            bg: isSecurityEntryDone ? 'bg-emerald' : isOutsideNotReturned ? 'bg-rose-500' : 'bg-slate-300'
        },
        {
            phase: 'RETURN TO COLLEGE',
            stage: 'Warden Hostel Arrival',
            title: isWardenHostelDone ? '5. Hostel Arrival Confirmed' : isOutsideNotReturned ? '5. Hostel Arrival Overdue (Not Returned)' : '5. Hostel Arrival Verification Pending',
            time: pass.hostelArrivalTime || pass.wardenVerifiedAt ? new Date(pass.hostelArrivalTime || pass.wardenVerifiedAt).toLocaleString('en-IN') : 'Pending',
            actor: pass.wardenName || 'Hostel Warden',
            done: isWardenHostelDone,
            note: pass.wardenRejectionReason ? ('Reason: "' + pass.wardenRejectionReason + '"') : (isWardenHostelDone ? 'Warden confirmed student safe arrival at hostel block' : 'Step 5: Hostel Warden confirms final arrival at hostel'),
            icon: isWardenHostelDone ? 'fa-solid fa-hotel text-emerald' : isOutsideNotReturned ? 'fa-solid fa-triangle-exclamation text-rose-500' : 'fa-solid fa-building-user text-slate-400',
            bg: isWardenHostelDone ? 'bg-emerald' : isOutsideNotReturned ? 'bg-rose-500' : 'bg-slate-300'
        }
    ];

    const content = `
        <div class="space-y-6 text-left">
            <div class="flex items-start gap-4 pb-4 border-b border-border">
                ${pass.studentPhoto ? `
                    <img src="${pass.studentPhoto}" alt="${pass.student || 'Student'}" class="w-20 h-20 rounded-2xl object-cover border-2 border-border shadow-md shrink-0">
                ` : `
                    <div class="w-20 h-20 rounded-2xl bg-surface-alt border-2 border-border flex items-center justify-center text-text-muted text-2xl shrink-0">
                        <i class="fa-solid fa-user"></i>
                    </div>
                `}
                <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-xl font-bold text-text truncate">${pass.student || 'Anonymous'}</h3>
                        <span class="px-3 py-0.5 rounded-full text-xs font-bold ${badgeClass}">${badgeText}</span>
                    </div>
                    <p class="text-xs text-text-secondary font-mono">Register No: <strong class="text-text">${pass.registrationNumber || 'N/A'}</strong></p>
                    <p class="text-xs text-text-secondary">Hostel: <strong class="text-text">${pass.hostelBlock || 'Block A'}</strong> • Room: <strong class="text-text">${pass.roomNumber || 'N/A'}</strong></p>
                    <div class="flex flex-wrap items-center gap-2 pt-0.5">
                        <span class="text-xs font-mono text-primary font-bold">Pass: ${pass.id}</span>
                        ${pass.certificateId ? `<span class="text-xs font-mono text-emerald-600 bg-emerald/10 px-2 py-0.5 rounded-lg border border-emerald/20">Cert: ${pass.certificateId}</span>` : ''}
                    </div>
                </div>
            </div>

            <!-- Two-Phase Gate Pass Verification Cards -->
            <div class="p-4 rounded-2xl bg-surface-alt border border-border/80 space-y-3">
                <p class="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-2">
                    <i class="fa-solid fa-route text-indigo-600"></i> Gate Pass Movement Verification Workflow
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <!-- Phase 1: Out From College -->
                    <div class="p-3.5 rounded-xl bg-surface border border-indigo-500/30 space-y-2">
                        <div class="flex items-center justify-between border-b border-border/60 pb-1.5">
                            <span class="text-xs font-bold text-indigo-600 flex items-center gap-1.5">
                                <i class="fa-solid fa-plane-departure"></i> PHASE 1: OUT FROM COLLEGE
                            </span>
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-700">LEAVING PHASE</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div>
                                <span class="text-[10px] text-text-muted uppercase font-bold block">1. Warden Departure</span>
                                <p class="font-bold mt-0.5 ${isApproved ? 'text-emerald' : isRejected ? 'text-danger' : 'text-amber-600'}">
                                    ${isApproved ? '✅ Approved' : isRejected ? '❌ Rejected' : '⏳ Pending'}
                                </p>
                                <p class="text-[11px] text-text-muted mt-0.5">${pass.approvedBy ? `By: ${pass.approvedBy}` : 'Warden review'}</p>
                            </div>
                            <div>
                                <span class="text-[10px] text-text-muted uppercase font-bold block">2. Security Gate Exit</span>
                                <p class="font-bold mt-0.5 ${isSecurityExitDone ? 'text-blue-600' : pass.securityStatus === 'REJECTED' ? 'text-danger' : 'text-amber-600'}">
                                    ${isSecurityExitDone ? '✅ Gate Exit Verified' : pass.securityStatus === 'REJECTED' ? '❌ Exit Rejected' : '⏳ Pending Exit'}
                                </p>
                                <p class="text-[11px] text-text-muted mt-0.5">${pass.exitTime ? `Exit: ${new Date(pass.exitTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Not crossed yet'}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Phase 2: Return To College -->
                    <div class="p-3.5 rounded-xl bg-surface border border-emerald/30 space-y-2">
                        <div class="flex items-center justify-between border-b border-border/60 pb-1.5">
                            <span class="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                                <i class="fa-solid fa-plane-arrival"></i> PHASE 2: RETURN TO COLLEGE
                            </span>
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald/10 text-emerald-700">RETURN PHASE</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div>
                                <span class="text-[10px] text-text-muted uppercase font-bold block">4. Security Gate Entry</span>
                                <p class="font-bold mt-0.5 ${isSecurityEntryDone ? 'text-emerald' : isOutsideNotReturned ? 'text-rose-600' : 'text-slate-500'}">
                                    ${isSecurityEntryDone ? '✅ Entry Verified' : isOutsideNotReturned ? '⚠️ Overdue' : '⏳ Pending Entry'}
                                </p>
                                <p class="text-[11px] text-text-muted mt-0.5">${pass.returnTime ? `Entry: ${new Date(pass.returnTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Gate security scan'}</p>
                            </div>
                            <div>
                                <span class="text-[10px] text-text-muted uppercase font-bold block">5. Warden Hostel Arrival</span>
                                <p class="font-bold mt-0.5 ${isWardenHostelDone ? 'text-emerald' : isOutsideNotReturned ? 'text-rose-600' : 'text-slate-500'}">
                                    ${isWardenHostelDone ? '✅ Hostel Confirmed' : isOutsideNotReturned ? '⚠️ Overdue' : '⏳ Pending Arrival'}
                                </p>
                                <p class="text-[11px] text-text-muted mt-0.5">${pass.hostelArrivalTime ? `In: ${new Date(pass.hostelArrivalTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Warden hostel check'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div class="p-3 rounded-xl bg-surface-alt border border-border/80">
                    <p class="text-text-muted font-semibold uppercase text-[10px]">Leave Date</p>
                    <p class="font-bold text-text mt-0.5">${formatGatePassDate(pass.gateDate)}</p>
                </div>
                <div class="p-3 rounded-xl bg-surface-alt border border-border/80">
                    <p class="text-text-muted font-semibold uppercase text-[10px]">Expected Return</p>
                    <p class="font-bold text-amber-700 mt-0.5">${formatGatePassDate(pass.returnDate)}</p>
                </div>
                <div class="p-3 rounded-xl bg-surface-alt border border-border/80">
                    <p class="text-text-muted font-semibold uppercase text-[10px]">Session</p>
                    <p class="font-bold text-text mt-0.5">${pass.session || 'General'}</p>
                </div>
                <div class="p-3 rounded-xl bg-surface-alt border border-border/80">
                    <p class="text-text-muted font-semibold uppercase text-[10px]">Gate Crossed</p>
                    <p class="font-bold text-text mt-0.5">${pass.gateCrossed || pass.exitTime ? '🚪 YES (Outside)' : '❌ NO'}</p>
                </div>
            </div>

            <div class="p-3.5 rounded-xl bg-surface-alt border border-border/80 text-xs">
                <p class="text-text-muted font-semibold uppercase text-[10px] mb-1">Reason for Leave & Destination</p>
                <p class="text-text leading-relaxed italic">"${pass.reason || 'No specific reason provided.'}"</p>
            </div>

            <div class="p-5 rounded-2xl bg-surface border border-border space-y-4">
                <h4 class="font-bold text-sm text-text flex items-center gap-2">
                    <i class="fa-solid fa-timeline text-indigo-600"></i> Gate Pass Movement Timeline (Out & Return Phases)
                </h4>
                <div class="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    ${timelineEvents.map((t, idx) => `
                        ${idx === 0 ? `
                            <div class="text-[11px] font-bold text-indigo-600 uppercase tracking-wider bg-indigo-500/10 px-3 py-1 rounded-lg border border-indigo-500/20 w-fit mb-2 flex items-center gap-1.5">
                                <i class="fa-solid fa-plane-departure"></i> PHASE 1: OUT FROM COLLEGE
                            </div>
                        ` : idx === 3 ? `
                            <div class="text-[11px] font-bold text-emerald-600 uppercase tracking-wider bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20 w-fit mt-4 mb-2 flex items-center gap-1.5">
                                <i class="fa-solid fa-plane-arrival"></i> PHASE 2: RETURN TO COLLEGE
                            </div>
                        ` : ''}
                        <div class="relative flex items-start gap-3">
                            <div class="absolute -left-6 top-1 w-5 h-5 rounded-full ${t.bg} text-white flex items-center justify-center text-[9px] shadow-xs ring-4 ring-surface">
                                <i class="${t.done ? 'fa-solid fa-check' : 'fa-solid fa-circle'}"></i>
                            </div>
                            <div class="space-y-0.5">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="font-bold text-xs text-text">${t.title}</span>
                                    <span class="text-[10px] ${t.done ? 'text-emerald-600 font-bold' : 'text-text-muted font-mono'}">${t.time}</span>
                                </div>
                                <p class="text-xs text-text-secondary">Actor: <strong class="text-text">${t.actor}</strong></p>
                                ${t.cert ? `<p class="text-[11px] font-mono text-emerald-600">Certificate: ${t.cert}</p>` : ''}
                                ${t.note ? `<p class="text-[11px] ${t.done ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}">${t.note}</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            ${pass.qrImage ? `
                <div class="p-4 rounded-2xl bg-white border border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
                    <div class="space-y-1">
                        <p class="font-bold text-sm text-slate-900">Unified Digital Verification QR Code</p>
                        <p class="text-xs text-slate-500">Same QR code used for both Security Gate exit and Warden Hostel return.</p>
                        <p class="text-[11px] font-mono text-indigo-600">Code: ${pass.id}</p>
                    </div>
                    <img src="${pass.qrImage}" alt="QR Code" class="w-24 h-24 object-contain rounded-xl border border-slate-200 shadow-sm">
                </div>
            ` : ''}

            <div class="flex flex-wrap gap-2.5 pt-2 border-t border-border">
                ${rawStatus === 'PENDING_WARDEN' || rawStatus === 'PENDING_ADMIN' || rawStatus === 'REQUESTED' || rawStatus === 'PENDING' ? `
                    <button onclick="updateGatePassStatus('${pass.id}', 'Approved'); closeModal();" class="flex-1 py-2.5 rounded-xl bg-emerald hover:bg-emerald/90 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-check"></i> Approve Pass (Generate QR)
                    </button>
                    <button onclick="updateGatePassStatus('${pass.id}', 'Rejected'); closeModal();" class="px-4 py-2.5 rounded-xl bg-danger/10 hover:bg-danger hover:text-white text-danger text-xs font-semibold transition-all">
                        Reject
                    </button>
                ` : ''}
                ${(currentUser?.role === 'security' || currentUser?.role === 'admin') && (rawStatus === 'SECURITY_PENDING' || rawStatus === 'QR GENERATED' || rawStatus === 'APPROVED') ? `
                    <button onclick="executeSecurityVerification('${pass.id}', 'APPROVE'); closeModal();" class="flex-1 py-2.5 rounded-xl bg-emerald hover:bg-emerald/90 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-door-open"></i> Approve Exit
                    </button>
                    <button onclick="executeSecurityVerification('${pass.id}', 'REJECT'); closeModal();" class="px-4 py-2.5 rounded-xl bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white text-xs font-semibold transition-all">
                        Reject Exit
                    </button>
                ` : ''}
                ${(currentUser?.role === 'warden' || currentUser?.role === 'admin') && (rawStatus === 'OUTSIDE' || rawStatus === 'OUT' || rawStatus === 'OUTSIDE_NOT_RETURNED' || rawStatus === 'RETURNED') ? `
                    <button onclick="executeWardenVerification('${pass.id}', 'APPROVE'); closeModal();" class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-hotel"></i> Confirm Hostel Arrival
                    </button>
                    <button onclick="executeWardenVerification('${pass.id}', 'REJECT'); closeModal();" class="px-4 py-2.5 rounded-xl bg-amber-600/10 hover:bg-amber-600 text-amber-700 hover:text-white text-xs font-semibold transition-all">
                        Mark Not Returned
                    </button>
                ` : ''}
                <button onclick="downloadGatePassPdf('${pass.id}')" class="px-4 py-2.5 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text transition-all flex items-center gap-1.5">
                    <i class="fa-solid fa-file-pdf text-danger"></i> Download PDF
                </button>
            </div>
        </div>
    `;

    showModal('Gate Pass Details & Verification Timeline', content);
}

// ============================================================================
// UNIVERSAL QR SCANNER & TWO-STEP VERIFICATION SYSTEM (SECURITY & WARDEN)
// ============================================================================
let activeHtml5QrScanner = null;
let currentScannerRole = 'warden';

function openQrScanModal(role = 'warden') {
    currentScannerRole = role;
    const isSecurity = role === 'security';
    const isWarden = role === 'warden';

    const title = isSecurity 
        ? 'Gate Security • Scan Gate Pass QR' 
        : 'Hostel Warden • Scan Student Return QR';

    // Collect active passes to provide 1-click test pills for convenience
    const activeTestPasses = latestGatePasses.filter(p => {
        const raw = String(p.status || '').toUpperCase();
        if (isSecurity) {
            return raw === 'SECURITY_PENDING' || raw === 'APPROVED' || raw === 'QR GENERATED';
        } else {
            // For Warden: all active/approved passes eligible for return verification
            return raw !== 'REJECTED' && raw !== 'CANCELLED' && raw !== 'COMPLETED';
        }
    }).slice(0, 4);

    const content = `
        <div class="space-y-5 text-left max-w-xl mx-auto">
            <!-- Header Banner (Warden Only or Security Only) -->
            <div class="p-4 rounded-2xl bg-gradient-to-r ${isSecurity ? 'from-indigo-600 via-blue-600 to-cyan-600' : 'from-purple-600 via-indigo-600 to-pink-600'} text-white shadow-md">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-xl backdrop-blur-md shadow-sm shrink-0">
                            <i class="fa-solid ${isSecurity ? 'fa-person-military-safety' : 'fa-building-user'}"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-sm leading-tight">${isSecurity ? 'Gate Security Departure Scan' : 'Warden Hostel Return Scan'}</h4>
                            <p class="text-xs text-white/80 mt-0.5">${isSecurity ? 'Scan student QR to verify approved exit & gate crossing' : 'Scan student QR to confirm hostel arrival & record in database'}</p>
                        </div>
                    </div>
                    <span class="px-3 py-1 rounded-full text-xs font-bold bg-white/25 border border-white/30 uppercase tracking-wider">${isWarden ? 'WARDEN RETURN' : 'SECURITY'}</span>
                </div>
            </div>

            <!-- Live Camera Viewfinder Box -->
            <div class="relative rounded-2xl overflow-hidden bg-slate-950 border-2 border-slate-700 min-h-[260px] flex items-center justify-center shadow-inner">
                <div id="qrInteractiveCameraContainer" class="w-full h-full min-h-[260px]"></div>
                <div id="cameraPlaceholderState" class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-200 space-y-3 bg-slate-950/95 z-10">
                    <div class="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-2xl text-indigo-400">
                        <i class="fa-solid fa-camera"></i>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-white">${isWarden ? 'Scan Student Return QR Code' : 'Live Camera QR Scanner'}</p>
                        <p class="text-xs text-slate-400 mt-1 max-w-xs">Point your device camera at the student's Gate Pass QR code to scan and verify.</p>
                    </div>
                    <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <button onclick="startCameraScanner('${role}')" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2">
                            <i class="fa-solid fa-play"></i> Start Camera Scan
                        </button>
                        <label class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold cursor-pointer transition-all flex items-center gap-2">
                            <i class="fa-solid fa-image text-indigo-400"></i> Upload QR Image
                            <input type="file" accept="image/*" class="hidden" onchange="handleQrImageUpload(event, '${role}')">
                        </label>
                    </div>
                </div>
            </div>

            <!-- Manual Input & Search Fallback -->
            <div class="p-4 rounded-2xl bg-surface-alt border border-border space-y-3">
                <label class="text-xs font-bold text-text flex items-center justify-between">
                    <span class="flex items-center gap-2"><i class="fa-solid fa-keyboard text-indigo-600"></i> Or Enter Pass ID / QR Token Manually</span>
                    <span class="text-[10px] text-text-muted font-normal">Pass ID or Token</span>
                </label>
                <div class="flex gap-2">
                    <input id="modalManualScanInput" type="text" placeholder="e.g. GP-2026-48083721 or paste QR token" class="input-focus flex-1 px-4 py-2.5 rounded-xl border border-border bg-surface text-xs font-mono">
                    <button onclick="handleManualModalScanSubmit('${role}')" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 shrink-0">
                        <i class="fa-solid fa-magnifying-glass"></i> Inspect & Verify
                    </button>
                </div>

                <!-- 1-Click Quick Sample Testing Pills -->
                ${activeTestPasses.length > 0 ? `
                    <div class="pt-2 border-t border-border/70">
                        <p class="text-[11px] font-bold text-text-secondary mb-1.5 flex items-center gap-1.5">
                            <i class="fa-solid fa-bolt text-amber-500"></i> Quick Select Active Pass to Verify Return:
                        </p>
                        <div class="flex flex-wrap gap-1.5">
                            ${activeTestPasses.map(p => `
                                <button onclick="handleQrScannedToken('${p.token || p.qrToken || p.id}', '${role}')" class="px-2.5 py-1 rounded-lg border border-border bg-surface hover:bg-surface-alt hover:border-purple-400 text-[11px] font-medium text-text transition-all flex items-center gap-1.5">
                                    <span class="w-2 h-2 rounded-full bg-purple-500"></span>
                                    <span class="font-bold">${p.student}</span>
                                    <span class="font-mono text-text-muted">(${p.id})</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>

            <!-- Dynamic Scan Result & Action Card Container -->
            <div id="qrScanVerificationResultBox" class="hidden space-y-4"></div>
        </div>
    `;

    showModal(title, content);
}

function startCameraScanner(role = 'warden') {
    const placeholder = document.getElementById('cameraPlaceholderState');
    if (placeholder) placeholder.classList.add('hidden');

    if (typeof Html5Qrcode === 'undefined') {
        showToast('Camera scanner library not loaded. Please use manual ID input.', 'warning');
        if (placeholder) placeholder.classList.remove('hidden');
        return;
    }

    try {
        if (activeHtml5QrScanner) {
            activeHtml5QrScanner.stop().catch(() => {});
            activeHtml5QrScanner = null;
        }

        activeHtml5QrScanner = new Html5Qrcode('qrInteractiveCameraContainer');
        const config = { fps: 10, qrbox: { width: 220, height: 220 } };

        activeHtml5QrScanner.start(
            { facingMode: 'environment' },
            config,
            (decodedText) => {
                if (decodedText) {
                    stopCameraScanner();
                    playChimeSound();
                    handleQrScannedToken(decodedText, role);
                }
            },
            (errorMsg) => {
                // scanning frame in progress...
            }
        ).catch((err) => {
            console.warn('Camera stream error:', err);
            if (placeholder) {
                placeholder.classList.remove('hidden');
                placeholder.innerHTML = `
                    <div class="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-2xl text-amber-400 mb-2">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <p class="text-xs font-bold text-white">Camera Access Notice</p>
                    <p class="text-[11px] text-slate-400 mt-0.5">Direct camera access was not granted or is unavailable on this device.</p>
                    <p class="text-[11px] text-indigo-300 font-medium">You can upload a QR image or type/select the Pass ID below!</p>
                `;
            }
        });
    } catch (e) {
        console.warn('QR scanner initialization error:', e);
    }
}

function stopCameraScanner() {
    if (activeHtml5QrScanner) {
        try {
            activeHtml5QrScanner.stop().catch(() => {});
        } catch (e) {}
        activeHtml5QrScanner = null;
    }
}

function handleQrImageUpload(event, role) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (typeof Html5Qrcode === 'undefined') {
        return showToast('Scanner library loading. Please use manual input.', 'info');
    }

    const scanner = new Html5Qrcode('qrInteractiveCameraContainer');
    scanner.scanFile(file, true)
        .then(decodedText => {
            stopCameraScanner();
            playChimeSound();
            handleQrScannedToken(decodedText, role);
        })
        .catch(err => {
            showToast('Could not detect a valid QR code in this image. Please try another image or manual input.', 'error');
        });
}

function handleManualModalScanSubmit(role) {
    const input = document.getElementById('modalManualScanInput');
    const val = (input?.value || '').trim();
    if (!val) return showToast('Please enter a Pass ID or QR token.', 'warning');
    handleQrScannedToken(val, role);
}

function handleSecurityQuickLookup() {
    const input = document.getElementById('securityScanInput');
    const val = (input?.value || '').trim();
    if (!val) return showToast('Please enter a Gate Pass ID or scan a QR code.', 'warning');
    openQrScanModal('security');
    setTimeout(() => {
        const modalInput = document.getElementById('modalManualScanInput');
        if (modalInput) modalInput.value = val;
        handleQrScannedToken(val, 'security');
    }, 200);
}

async function handleQrScannedToken(rawToken, role = 'warden') {
    let token = String(rawToken || '').trim();
    // Extract token from full URLs (e.g. /qr/TOKEN or /gatepass/verify/TOKEN)
    const qrMatch = token.match(/\/qr\/([^\s/?#]+)/i) || token.match(/\/verify\/([^\s/?#]+)/i);
    if (qrMatch && qrMatch[1]) token = decodeURIComponent(qrMatch[1]);

    const resultBox = document.getElementById('qrScanVerificationResultBox');
    if (!resultBox) return;

    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `
        <div class="p-6 rounded-2xl bg-surface border border-border text-center space-y-2">
            <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-600"></i>
            <p class="text-xs font-semibold text-text">Validating QR Code & fetching student record...</p>
        </div>
    `;

    try {
        const res = await apiRequest('/api/gatepass/verify-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, role, user: currentUser })
        });
        const data = await parseJsonResponse(res);

        if (!res.ok || !data.gatePass) {
            resultBox.innerHTML = `
                <div class="p-5 rounded-2xl bg-danger/10 border-2 border-danger/20 text-danger space-y-3">
                    <div class="flex items-center gap-2.5 font-bold text-sm text-danger">
                        <div class="w-8 h-8 rounded-xl bg-danger text-white flex items-center justify-center text-base shrink-0 shadow-sm">
                            <i class="fa-solid fa-ban"></i>
                        </div>
                        <div>
                            <h4>Verification Blocked</h4>
                            <p class="text-xs font-normal mt-0.5">${data.message || data.error || 'Gate pass verification failed.'}</p>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        const pass = data.gatePass;
        renderScanPreviewCard(pass, role, token);
    } catch (err) {
        resultBox.innerHTML = `
            <div class="p-4 rounded-2xl bg-danger/10 border border-danger/20 text-danger text-xs font-semibold">
                Network error connecting to verification service. Please try again.
            </div>
        `;
    }
}

function renderScanPreviewCard(pass, role, token) {
    const resultBox = document.getElementById('qrScanVerificationResultBox');
    if (!resultBox) return;

    const isSecurity = role === 'security';
    const isWarden = role === 'warden';
    const isCompleted = String(pass.status).toUpperCase() === 'COMPLETED';

    resultBox.innerHTML = `
        <div class="p-5 rounded-2xl bg-surface border-2 ${isSecurity ? 'border-indigo-500/50' : 'border-purple-500/50'} space-y-4 shadow-lg animate-fadeIn">
            <!-- Student Header Banner -->
            <div class="flex items-start gap-4 pb-3 border-b border-border">
                ${pass.studentPhoto ? `
                    <img src="${pass.studentPhoto}" alt="${pass.student}" class="w-16 h-16 rounded-2xl object-cover border-2 border-border shadow-sm shrink-0">
                ` : `
                    <div class="w-16 h-16 rounded-2xl bg-surface-alt border border-border flex items-center justify-center text-text-muted text-2xl shrink-0">
                        <i class="fa-solid fa-user"></i>
                    </div>
                `}
                <div class="min-w-0 flex-1 space-y-0.5">
                    <div class="flex items-center justify-between gap-2">
                        <h4 class="font-bold text-base text-text truncate">${pass.student || 'Student'}</h4>
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'}">
                            ${isCompleted ? 'Returned & Completed' : (pass.status || 'Active')}
                        </span>
                    </div>
                    <p class="text-xs text-text-secondary font-mono">Reg No: <strong class="text-text">${pass.registrationNumber || 'N/A'}</strong></p>
                    <p class="text-xs text-text-secondary">${pass.hostelBlock || 'Block A'} • Room <strong>${pass.roomNumber || 'N/A'}</strong></p>
                    <p class="text-[11px] font-mono text-primary font-bold">Pass ID: ${pass.id} ${pass.certificateId ? `• Cert: ${pass.certificateId}` : ''}</p>
                </div>
            </div>

            <!-- Pass Schedule Info Grid -->
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="p-2.5 rounded-xl bg-surface-alt border border-border/70">
                    <span class="text-text-muted block text-[10px] uppercase font-bold">Departure Date</span>
                    <span class="font-bold text-text">${formatGatePassDate(pass.gateDate)}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-surface-alt border border-border/70">
                    <span class="text-text-muted block text-[10px] uppercase font-bold">Expected Return</span>
                    <span class="font-bold text-purple-700">${formatGatePassDate(pass.returnDate)}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-surface-alt border border-border/70">
                    <span class="text-text-muted block text-[10px] uppercase font-bold">Warden Approval</span>
                    <span class="font-semibold text-emerald">${pass.approvedBy ? `Approved by ${pass.approvedBy}` : 'Approved'}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-surface-alt border border-border/70">
                    <span class="text-text-muted block text-[10px] uppercase font-bold">Hostel Arrival</span>
                    <span class="font-semibold ${isCompleted ? 'text-emerald' : 'text-purple-600'}">${isCompleted ? 'Verified at ' + (pass.hostelArrivalTime ? new Date(pass.hostelArrivalTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '') : 'Pending Confirmation'}</span>
                </div>
            </div>

            <div class="p-3 rounded-xl bg-surface-alt border border-border/70 text-xs">
                <span class="text-text-muted block text-[10px] uppercase font-bold mb-0.5">Reason for Gate Pass</span>
                <p class="text-text italic">"${pass.reason || 'General'}"</p>
            </div>

            <!-- Verification Action Buttons (ACCEPT / REJECT) -->
            ${isCompleted ? `
                <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-1">
                    <i class="fa-solid fa-circle-check text-2xl text-emerald-600"></i>
                    <p class="font-bold text-xs text-emerald-800">Hostel Return Already Confirmed</p>
                    <p class="text-[11px] text-emerald-700">This gate pass is marked as completed in the database.</p>
                </div>
            ` : isWarden ? `
                <div class="space-y-2 pt-2 border-t border-border">
                    <button onclick="submitWardenVerificationAction('${token}', 'APPROVE')" class="w-full py-3.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5">
                        <i class="fa-solid fa-hotel text-base"></i> APPROVE HOSTEL RETURN (Confirm Student Arrival)
                    </button>
                    <button onclick="promptWardenRejection('${token}')" class="w-full py-2.5 rounded-xl bg-amber-600/10 hover:bg-amber-600 hover:text-white text-amber-700 font-semibold text-xs transition-all flex items-center justify-center gap-2">
                        <i class="fa-solid fa-circle-xmark"></i> REJECT RETURN (Mark Not Returned)
                    </button>
                </div>
            ` : isSecurity ? `
                <div class="space-y-2 pt-2 border-t border-border">
                    ${String(pass.status || '').toUpperCase() === 'OUTSIDE' || String(pass.status || '').toUpperCase() === 'OUT' || (pass.securityVerified && !pass.wardenVerified) ? `
                        <button onclick="submitSecurityVerificationAction('${token}', 'APPROVE')" class="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5">
                            <i class="fa-solid fa-plane-arrival text-base"></i> ACCEPT RETURN (Student Entering Gate)
                        </button>
                        <button onclick="promptSecurityRejection('${token}')" class="w-full py-2.5 rounded-xl bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-600 font-semibold text-xs transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-ban"></i> REJECT RETURN
                        </button>
                    ` : `
                        <button onclick="submitSecurityVerificationAction('${token}', 'APPROVE')" class="w-full py-3.5 rounded-xl bg-emerald hover:bg-emerald/90 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5">
                            <i class="fa-solid fa-door-open text-base"></i> APPROVE EXIT (Student Crossing Gate)
                        </button>
                        <button onclick="promptSecurityRejection('${token}')" class="w-full py-2.5 rounded-xl bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-600 font-semibold text-xs transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-ban"></i> REJECT EXIT
                        </button>
                    `}
                </div>
            ` : ''}
        </div>
    `;
}

function promptSecurityRejection(token) {
    const reasons = [
        'Invalid Gate Pass',
        'Student details mismatch',
        'Expired Gate Pass',
        'Unauthorized request',
        'Other reason'
    ];
    const inputReason = prompt(`Please enter reason for security rejection:\n(Presets: ${reasons.join(', ')})`, 'Student details mismatch');
    if (inputReason !== null && inputReason.trim()) {
        submitSecurityVerificationAction(token, 'REJECT', inputReason.trim());
    }
}

function promptWardenRejection(token) {
    const inputReason = prompt('Please enter reason for hostel arrival rejection:\n(Student will be marked as OUTSIDE_NOT_RETURNED in database)', 'Student did not arrive at hostel.');
    if (inputReason !== null && inputReason.trim()) {
        submitWardenVerificationAction(token, 'REJECT', inputReason.trim());
    }
}

async function executeSecurityVerification(tokenOrId, action, reason = '') {
    submitSecurityVerificationAction(tokenOrId, action, reason);
}

async function executeWardenVerification(tokenOrId, action, reason = '') {
    submitWardenVerificationAction(tokenOrId, action, reason);
}

async function submitSecurityVerificationAction(token, action, reason = '') {
    try {
        const res = await apiRequest('/api/gatepass/security/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                action,
                role: 'security',
                rejectionReason: reason,
                guardName: currentUser?.name || 'Gate Security Officer',
                guardId: currentUser?.userId || 'SEC-001',
                location: 'Main Campus Gate'
            })
        });
        const data = await parseJsonResponse(res);
        if (!res.ok) {
            alert('Error: ' + (data.message || data.error || 'Security verification failed.'));
            return;
        }

        playChimeSound();
        showToast(data.message || 'Security verification updated successfully in database!', action === 'APPROVE' ? 'success' : 'warning');
        closeModal();
        await loadDashboardData();
        renderSecurityDashboard();
    } catch (err) {
        console.error('Security verification error:', err);
        showToast('Network error processing security verification: ' + (err.message || 'Server unreachable'), 'error');
    }
}

async function submitWardenVerificationAction(token, action, reason = '') {
    try {
        const res = await apiRequest('/api/gatepass/warden/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                action,
                role: 'warden',
                rejectionReason: reason,
                wardenName: currentUser?.name || 'Hostel Warden',
                wardenId: currentUser?.userId || 'WRD-001'
            })
        });
        const data = await parseJsonResponse(res);
        if (!res.ok) {
            alert('Error: ' + (data.message || data.error || 'Warden verification failed.'));
            return;
        }

        playChimeSound();
        showToast(data.message || 'Hostel arrival verification updated in database!', action === 'APPROVE' ? 'success' : 'warning');
        closeModal();
        await loadDashboardData();
        renderWardenDashboard();
    } catch (err) {
        console.error('Warden verification error:', err);
        showToast('Network error processing warden verification: ' + (err.message || 'Server unreachable'), 'error');
    }
}

function renderWardenDashboard() {
    const pendingCount = document.getElementById('wardenPendingCount');
    const approvedCount = document.getElementById('wardenApprovedCount');
    const outCount = document.getElementById('wardenOutCount');
    const totalCount = document.getElementById('wardenTotalPassCount');
    const seeAllBtn = document.getElementById('wardenGatePassSeeAllBtn');
    const list = document.getElementById('wardenGatePassList');

    const returningTodayEl = document.getElementById('wardenReturningTodayCount');
    const returningUpcomingEl = document.getElementById('wardenReturningUpcomingCount');
    const overdueEl = document.getElementById('wardenOverdueCount');
    const tabTodayEl = document.getElementById('tabReturningTodayCount');
    const tabUpcomingEl = document.getElementById('tabReturningUpcomingCount');
    const tabOverdueEl = document.getElementById('tabOverdueCount');
    const totalReturnBadge = document.getElementById('wardenReturnTotalBadge');

    const pendingPasses = latestGatePasses.filter(p => !p.status || ['REQUESTED', 'PENDING', 'PENDING_WARDEN', 'PENDING_ADMIN'].includes(String(p.status).toUpperCase()));
    const approvedPasses = latestGatePasses.filter(p => p.status && ['QR GENERATED', 'APPROVED', 'SECURITY_PENDING', 'OUTSIDE', 'OUT', 'RETURNED', 'COMPLETED'].includes(String(p.status).toUpperCase()));
    const outPasses = latestGatePasses.filter(p => p.status && (String(p.status).toUpperCase() === 'OUTSIDE' || String(p.status).toUpperCase() === 'OUT' || (p.securityVerified && !p.wardenVerified)));

    let returningTodayCount = 0;
    let returningUpcomingCount = 0;
    let overdueCount = 0;
    let awaitingVerificationCount = 0;
    const lateReturnsList = [];

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    latestGatePasses.forEach(p => {
        const info = calculateGatePassReturnInfo(p);
        if (info.category === 'today') returningTodayCount++;
        else if (info.category === 'upcoming') returningUpcomingCount++;
        else if (info.category === 'overdue') overdueCount++;
        else if (info.category === 'returned') awaitingVerificationCount++;

        const isOutside = String(p.status).toUpperCase() === 'OUTSIDE' || String(p.status).toUpperCase() === 'OUT' || (p.securityVerified && !p.wardenVerified && p.status !== 'COMPLETED');
        if (isOutside && p.returnDate) {
            const retDate = new Date(`${p.returnDate}T23:59:59`);
            if (retDate < now) {
                const diffMs = now.getTime() - retDate.getTime();
                const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                lateReturnsList.push({ pass: p, overdueDays: diffDays, returnDate: p.returnDate });
            }
        }
    });

    if (pendingCount) pendingCount.textContent = pendingPasses.length;
    if (approvedCount) approvedCount.textContent = approvedPasses.length;
    if (outCount) outCount.textContent = outPasses.length;
    if (totalCount) totalCount.textContent = `${latestGatePasses.length} Total`;

    if (returningTodayEl) returningTodayEl.textContent = returningTodayCount;
    if (returningUpcomingEl) returningUpcomingEl.textContent = returningUpcomingCount;
    if (overdueEl) overdueEl.textContent = overdueCount;
    if (tabTodayEl) tabTodayEl.textContent = returningTodayCount;
    if (tabUpcomingEl) tabUpcomingEl.textContent = returningUpcomingCount;
    if (tabOverdueEl) tabOverdueEl.textContent = overdueCount;
    if (totalReturnBadge) totalReturnBadge.textContent = `${returningTodayCount + returningUpcomingCount + overdueCount + awaitingVerificationCount} Scheduled`;

    const lateSection = document.getElementById('wardenLateReturnSection');
    const lateListEl = document.getElementById('wardenLateReturnList');
    const lateBadgeEl = document.getElementById('wardenLateReturnCountBadge');

    if (lateSection && lateListEl) {
        if (lateReturnsList.length > 0) {
            lateSection.classList.remove('hidden');
            if (lateBadgeEl) lateBadgeEl.textContent = `${lateReturnsList.length} Student(s) Overdue`;
            lateListEl.innerHTML = lateReturnsList.map(({ pass, overdueDays }) => `
                <div class="rounded-xl border border-rose-300 bg-surface p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                            <i class="fa-solid fa-user-clock"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-xs text-rose-950">${pass.student}</span>
                                <span class="text-[11px] font-mono text-rose-800">(${pass.registrationNumber || 'N/A'})</span>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white">🔴 Overdue by ${overdueDays} day(s)</span>
                            </div>
                            <p class="text-[11px] text-text-secondary mt-0.5">
                                Room: <strong>${pass.roomNumber}</strong>, Block <strong>${pass.hostelBlock}</strong> • Expected: <strong class="text-rose-700">${formatGatePassDate(pass.returnDate)}</strong> • Exit: ${pass.exitTime ? new Date(pass.exitTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button onclick="submitWardenVerificationAction('${pass.id}', 'APPROVE')" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-xs">
                            Verify Arrival
                        </button>
                        <button onclick="promptWardenRejection('${pass.id}')" class="px-2.5 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-semibold transition-all">
                            Mark Not Returned
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            lateSection.classList.add('hidden');
        }
    }

    const alertBanner = document.getElementById('wardenReturnAlertBanner');
    const alertTitle = document.getElementById('wardenReturnAlertBannerTitle');
    const alertMsg = document.getElementById('wardenReturnAlertBannerMessage');
    if (alertBanner && alertTitle && alertMsg) {
        const formattedToday = formatGatePassDate(todayStr);
        if (overdueCount > 0 && returningTodayCount > 0) {
            alertBanner.className = 'mb-6 rounded-2xl border border-danger/30 bg-gradient-to-r from-danger/10 via-amber-500/10 to-indigo-500/10 p-4 sm:p-5 shadow-xs transition-all';
            alertTitle.textContent = `📢 Scheduled Returns & Overdue Notice (${formattedToday})`;
            alertMsg.textContent = `${returningTodayCount} student(s) are expected to return today, and ${overdueCount} student(s) have passed their return date and are overdue!`;
            alertBanner.classList.remove('hidden');
        } else if (overdueCount > 0) {
            alertBanner.className = 'mb-6 rounded-2xl border border-danger/30 bg-gradient-to-r from-danger/10 via-rose-500/10 to-amber-500/10 p-4 sm:p-5 shadow-xs transition-all';
            alertTitle.textContent = `⚠️ Overdue Student Return Alert`;
            alertMsg.textContent = `${overdueCount} student(s) have passed their scheduled return date and are still marked OUT. Please review and verify.`;
            alertBanner.classList.remove('hidden');
        } else if (returningTodayCount > 0) {
            alertBanner.className = 'mb-6 rounded-2xl border border-emerald/30 bg-gradient-to-r from-emerald/10 via-teal-500/10 to-indigo-500/10 p-4 sm:p-5 shadow-xs transition-all';
            alertTitle.textContent = `🟢 Expected Student Returns Today (${formattedToday})`;
            alertMsg.textContent = `${returningTodayCount} student(s) are scheduled to return to the hostel today.`;
            alertBanner.classList.remove('hidden');
        } else {
            alertBanner.classList.add('hidden');
        }
    }

    renderWardenReturnSchedule(latestGatePasses);
    if (!list) return;

    if (!latestGatePasses.length) {
        list.innerHTML = '<div class="text-sm text-text-secondary py-8 text-center bg-surface-alt rounded-2xl border border-dashed border-border"><i class="fa-solid fa-id-card text-2xl mb-2 text-text-muted block"></i>No gate pass requests recorded yet.</div>';
        if (seeAllBtn) seeAllBtn.classList.add('hidden');
        return;
    }

    let filteredPasses = latestGatePasses.slice();
    if (currentWardenFilter === 'pending') {
        filteredPasses = filteredPasses.filter(p => !p.status || ['REQUESTED', 'PENDING', 'PENDING_WARDEN', 'PENDING_ADMIN'].includes(String(p.status).toUpperCase()));
    } else if (currentWardenFilter === 'approved') {
        filteredPasses = filteredPasses.filter(p => p.status && ['QR GENERATED', 'APPROVED', 'SECURITY_PENDING'].includes(String(p.status).toUpperCase()));
    } else if (currentWardenFilter === 'out') {
        filteredPasses = filteredPasses.filter(p => p.status && (String(p.status).toUpperCase() === 'OUTSIDE' || String(p.status).toUpperCase() === 'OUT' || (p.securityVerified && !p.wardenVerified)));
    } else if (currentWardenFilter === 'returned') {
        filteredPasses = filteredPasses.filter(p => p.status && ['RETURNED', 'COMPLETED', 'OUTSIDE_NOT_RETURNED'].includes(String(p.status).toUpperCase()));
    }

    if (wardenGatePassSearchQuery) {
        filteredPasses = filteredPasses.filter(p => {
            const student = String(p.student || '').toLowerCase();
            const reg = String(p.registrationNumber || '').toLowerCase();
            const id = String(p.id || '').toLowerCase();
            const room = String(p.roomNumber || '').toLowerCase();
            const block = String(p.hostelBlock || '').toLowerCase();
            return student.includes(wardenGatePassSearchQuery) ||
                   reg.includes(wardenGatePassSearchQuery) ||
                   id.includes(wardenGatePassSearchQuery) ||
                   room.includes(wardenGatePassSearchQuery) ||
                   block.includes(wardenGatePassSearchQuery);
        });
    }

    const defaultVisible = 4;
    if (seeAllBtn) {
        if (filteredPasses.length > defaultVisible) {
            seeAllBtn.classList.remove('hidden');
            seeAllBtn.textContent = showAllWardenGatePassRows ? `Show Less (${filteredPasses.length})` : `See All (${filteredPasses.length})`;
        } else {
            seeAllBtn.classList.add('hidden');
        }
    }

    const displayPasses = showAllWardenGatePassRows ? filteredPasses : filteredPasses.slice(0, defaultVisible);

    if (!displayPasses.length) {
        list.innerHTML = '<div class="text-sm text-text-secondary py-8 text-center bg-surface-alt rounded-2xl border border-dashed border-border"><i class="fa-solid fa-search text-2xl mb-2 text-text-muted block"></i>No matching gate passes found.</div>';
        return;
    }

    list.innerHTML = displayPasses.map((pass) => {
        const rawStatus = String(pass.status || 'PENDING_WARDEN').toUpperCase();
        const isPending = rawStatus === 'REQUESTED' || rawStatus === 'PENDING' || rawStatus === 'PENDING_WARDEN' || rawStatus === 'PENDING_ADMIN';
        const isApproved = rawStatus === 'QR GENERATED' || rawStatus === 'APPROVED' || rawStatus === 'SECURITY_PENDING';
        const isOut = rawStatus === 'OUT' || rawStatus === 'OUTSIDE' || (pass.securityVerified && !pass.wardenVerified);
        const isCompleted = rawStatus === 'COMPLETED';
        const isOutsideNotReturned = rawStatus === 'OUTSIDE_NOT_RETURNED';
        const isRejected = rawStatus.includes('REJECTED');

        let badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
        let displayStatus = pass.status || 'Pending';

        if (isApproved) {
            badgeClass = 'bg-emerald/10 text-emerald border border-emerald/20';
            displayStatus = 'QR Approved';
        } else if (isOut) {
            badgeClass = 'bg-blue-100 text-blue-800 border border-blue-200';
            displayStatus = 'Student Out (Gate Crossed)';
        } else if (isOutsideNotReturned) {
            badgeClass = 'bg-rose-100 text-rose-900 border border-rose-300';
            displayStatus = '⚠️ Outside — Not Returned';
        } else if (isCompleted) {
            badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
            displayStatus = 'Completed';
        } else if (isRejected) {
            badgeClass = 'bg-danger/10 text-danger border border-danger/20';
            displayStatus = 'Rejected';
        }

        return `
            <div class="rounded-2xl border border-border p-5 bg-surface hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex items-start gap-4">
                    ${pass.studentPhoto ? `
                        <img src="${pass.studentPhoto}" alt="${pass.student || 'Student'}" class="w-14 h-14 rounded-2xl object-cover border border-border shadow-sm shrink-0">
                    ` : `
                        <div class="w-14 h-14 rounded-2xl bg-surface-alt border border-border flex items-center justify-center text-text-muted shrink-0">
                            <i class="fa-solid fa-user text-xl"></i>
                        </div>
                    `}
                    <div class="space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-bold text-base text-text">${pass.student || 'Student'}</span>
                            <span class="text-xs text-text-secondary font-mono">(${pass.registrationNumber || 'N/A'})</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${displayStatus}</span>
                        </div>
                        <p class="text-xs text-text-secondary">
                            <strong>Hostel:</strong> ${pass.hostelBlock || 'Block A'} • <strong>Room:</strong> ${pass.roomNumber || 'N/A'} • 
                            <strong>Session:</strong> ${pass.session || 'General'}
                        </p>
                        <p class="text-xs text-text-secondary">
                            <strong>Dates:</strong> ${formatGatePassDate(pass.gateDate)} ➔ ${formatGatePassDate(pass.returnDate)}
                        </p>
                        <p class="text-xs text-text-muted italic bg-surface-alt/60 px-2 py-1 rounded-lg">
                            <i class="fa-solid fa-comment-dots mr-1"></i> "${pass.reason || 'Not specified'}"
                        </p>
                        <p class="text-[10px] font-mono text-text-muted">Pass ID: ${pass.id} ${pass.certificateId ? `• Cert: ${pass.certificateId}` : ''}</p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    ${isPending ? `
                        <button onclick="updateGatePassStatus('${pass.id}', 'Approved')" class="px-4 py-2 rounded-xl bg-emerald hover:bg-emerald/90 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-check"></i> Approve
                        </button>
                        <button onclick="updateGatePassStatus('${pass.id}', 'Rejected')" class="px-3.5 py-2 rounded-xl bg-danger/10 hover:bg-danger hover:text-white text-danger text-xs font-semibold transition-all">
                            Reject
                        </button>
                    ` : ''}
                    ${isOut ? `
                        <button onclick="submitWardenVerificationAction('${pass.id}', 'APPROVE')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-hotel"></i> Verify Arrival
                        </button>
                        <button onclick="promptWardenRejection('${pass.id}')" class="px-3 py-2 rounded-xl bg-amber-600/10 hover:bg-amber-600 hover:text-white text-amber-700 text-xs font-semibold transition-all">
                            Not Returned
                        </button>
                    ` : ''}
                    <button onclick="viewGatePassDetailsModal('${pass.id}')" class="px-3 py-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-medium text-text hover:text-primary transition-all flex items-center gap-1.5">
                        <i class="fa-solid fa-eye text-primary"></i> View Details
                    </button>
                    <button onclick="downloadGatePassPdf('${pass.id}')" class="px-3 py-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-medium text-text-secondary hover:text-text transition-all flex items-center gap-1.5">
                        <i class="fa-solid fa-file-pdf text-danger"></i> PDF
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderSecurityDashboard() {
    const list = document.getElementById('securityGatePassList');
    const pendingEl = document.getElementById('secStatPending');
    const outsideEl = document.getElementById('secStatOutside');
    const todayExitsEl = document.getElementById('secStatTodayExits');
    const rejectedEl = document.getElementById('secStatRejected');
    const todayStr = new Date().toISOString().split('T')[0];

    const pendingList = latestGatePasses.filter(p => {
        const raw = String(p.status || '').toUpperCase();
        return (raw === 'SECURITY_PENDING' || raw === 'APPROVED' || raw === 'QR GENERATED') && !p.securityVerified;
    });

    const outsideList = latestGatePasses.filter(p => {
        const raw = String(p.status || '').toUpperCase();
        return raw === 'OUTSIDE' || raw === 'OUT' || (p.securityVerified && !p.wardenVerified);
    });

    const todayExits = latestGatePasses.filter(p => {
        const exit = p.exitTime || p.outTime;
        return exit && exit.startsWith(todayStr) && p.securityVerified;
    });

    const rejectedList = latestGatePasses.filter(p => {
        const raw = String(p.status || '').toUpperCase();
        return raw === 'SECURITY_REJECTED';
    });

    if (pendingEl) pendingEl.textContent = pendingList.length;
    if (outsideEl) outsideEl.textContent = outsideList.length;
    if (todayExitsEl) todayExitsEl.textContent = todayExits.length;
    if (rejectedEl) rejectedEl.textContent = rejectedList.length;

    if (!list) return;

    let filtered = latestGatePasses.filter(p => {
        const raw = String(p.status || '').toUpperCase();
        return raw !== 'PENDING_WARDEN' && raw !== 'PENDING_ADMIN' && raw !== 'REQUESTED' && raw !== 'PENDING';
    });

    if (currentSecurityFilter === 'pending_exit') {
        filtered = pendingList;
    } else if (currentSecurityFilter === 'outside') {
        filtered = outsideList;
    } else if (currentSecurityFilter === 'rejected') {
        filtered = rejectedList;
    } else if (currentSecurityFilter === 'completed') {
        filtered = latestGatePasses.filter(p => String(p.status).toUpperCase() === 'COMPLETED');
    }

    if (!filtered.length) {
        list.innerHTML = '<div class="text-sm text-text-secondary py-8 text-center bg-surface-alt rounded-2xl border border-dashed border-border"><i class="fa-solid fa-id-card-clip text-2xl mb-2 text-text-muted block"></i>No active gate passes found for this view.</div>';
        return;
    }

    list.innerHTML = filtered.map((pass) => {
        const rawStatus = String(pass.status || 'SECURITY_PENDING').toUpperCase();
        const isReadyForExit = (rawStatus === 'SECURITY_PENDING' || rawStatus === 'APPROVED' || rawStatus === 'QR GENERATED') && !pass.securityVerified;
        const isOut = rawStatus === 'OUTSIDE' || rawStatus === 'OUT' || (pass.securityVerified && !pass.wardenVerified);
        const isCompleted = rawStatus === 'COMPLETED';
        const isSecRejected = rawStatus === 'SECURITY_REJECTED';

        let badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
        let badgeLabel = pass.status || 'Pending';

        if (isReadyForExit) {
            badgeClass = 'bg-emerald/10 text-emerald border border-emerald/20';
            badgeLabel = 'Ready for Exit';
        } else if (isOut) {
            badgeClass = 'bg-blue-100 text-blue-800 border border-blue-200';
            badgeLabel = 'Outside (Gate Crossed)';
        } else if (isCompleted) {
            badgeClass = 'bg-purple-100 text-purple-800 border border-purple-200';
            badgeLabel = 'Completed';
        } else if (isSecRejected) {
            badgeClass = 'bg-danger/10 text-danger border border-danger/20';
            badgeLabel = 'Exit Rejected';
        }

        return `
            <div class="rounded-2xl border border-border p-4 sm:p-5 bg-surface hover:shadow-xs transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex items-start gap-4">
                    ${pass.studentPhoto ? `
                        <img src="${pass.studentPhoto}" alt="${pass.student}" class="w-14 h-14 rounded-2xl object-cover border border-border shadow-xs shrink-0">
                    ` : `
                        <div class="w-14 h-14 rounded-2xl bg-surface-alt border border-border flex items-center justify-center text-text-muted shrink-0">
                            <i class="fa-solid fa-user text-xl"></i>
                        </div>
                    `}
                    <div class="space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-bold text-base text-text">${pass.student || 'Student'}</span>
                            <span class="text-xs text-text-secondary font-mono">(${pass.registrationNumber || 'N/A'})</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${badgeLabel}</span>
                        </div>
                        <p class="text-xs text-text-secondary">
                            <strong>Hostel:</strong> ${pass.hostelBlock || 'Block A'} • <strong>Room:</strong> ${pass.roomNumber || 'N/A'} • 
                            <strong>Valid:</strong> ${formatGatePassDate(pass.gateDate)} ➔ ${formatGatePassDate(pass.returnDate)}
                        </p>
                        <p class="text-[11px] font-mono text-text-muted">
                            Pass ID: <strong class="text-primary">${pass.id}</strong> ${pass.certificateId ? `• Cert: <strong class="text-emerald-600">${pass.certificateId}</strong>` : ''}
                            ${pass.exitTime ? ` • <span class="text-blue-600 font-sans font-medium">Exit: ${new Date(pass.exitTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    ${isReadyForExit ? `
                        <button onclick="submitSecurityVerificationAction('${pass.id}', 'APPROVE')" class="px-4 py-2 rounded-xl bg-emerald hover:bg-emerald/90 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-door-open"></i> Approve Exit
                        </button>
                        <button onclick="promptSecurityRejection('${pass.id}')" class="px-3 py-2 rounded-xl bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-600 text-xs font-semibold transition-all">
                            Reject
                        </button>
                    ` : isOut ? `
                        <button onclick="submitSecurityVerificationAction('${pass.id}', 'APPROVE')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1.5">
                            <i class="fa-solid fa-plane-arrival"></i> Accept Return
                        </button>
                        <button onclick="promptSecurityRejection('${pass.id}')" class="px-3 py-2 rounded-xl bg-rose-600/10 hover:bg-rose-600 hover:text-white text-rose-600 text-xs font-semibold transition-all">
                            Reject
                        </button>
                    ` : ''}
                    <button onclick="viewGatePassDetailsModal('${pass.id}')" class="px-3.5 py-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text hover:text-primary transition-all flex items-center gap-1.5">
                        <i class="fa-solid fa-eye text-primary"></i> Details
                    </button>
                    <button onclick="downloadGatePassPdf('${pass.id}')" class="px-3 py-2 rounded-xl border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text-secondary hover:text-text transition-all flex items-center gap-1.5">
                        <i class="fa-solid fa-file-pdf text-danger"></i> PDF
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderAdminGatePassLogsPage() {
    const totalEl = document.getElementById('adminLogsTotalPasses');
    const pendingEl = document.getElementById('adminLogsPendingPasses');
    const outEl = document.getElementById('adminLogsOutPasses');
    const completedEl = document.getElementById('adminLogsCompletedPasses');
    const sidebarBadge = document.getElementById('adminSidebarGatePassBadge');
    const tableBody = document.getElementById('adminGatePassLogFullTableBody');

    const pendingList = latestGatePasses.filter(p => !p.status || ['REQUESTED', 'PENDING', 'PENDING_WARDEN', 'PENDING_ADMIN'].includes(String(p.status).toUpperCase()));
    const approvedList = latestGatePasses.filter(p => p.status && ['QR GENERATED', 'APPROVED', 'SECURITY_PENDING'].includes(String(p.status).toUpperCase()));
    const outList = latestGatePasses.filter(p => p.status && (String(p.status).toUpperCase() === 'OUT' || String(p.status).toUpperCase() === 'OUTSIDE' || (p.securityVerified && !p.wardenVerified)));
    const completedList = latestGatePasses.filter(p => p.status && ['RETURNED', 'COMPLETED'].includes(String(p.status).toUpperCase()));

    if (totalEl) totalEl.textContent = latestGatePasses.length;
    if (pendingEl) pendingEl.textContent = pendingList.length;
    if (outEl) outEl.textContent = outList.length;
    if (completedEl) completedEl.textContent = completedList.length;
    if (sidebarBadge) sidebarBadge.textContent = latestGatePasses.length;

    if (!tableBody) return;

    if (!latestGatePasses.length) {
        tableBody.innerHTML = '<tr><td colspan="9" class="px-6 py-10 text-sm text-text-secondary text-center bg-surface-alt/50">No gate pass records or movement logs found.</td></tr>';
        return;
    }

    let filtered = latestGatePasses.slice();
    if (currentAdminGatePassFilter === 'pending') {
        filtered = pendingList;
    } else if (currentAdminGatePassFilter === 'approved') {
        filtered = approvedList;
    } else if (currentAdminGatePassFilter === 'out') {
        filtered = outList;
    } else if (currentAdminGatePassFilter === 'completed') {
        filtered = completedList;
    }

    if (adminGatePassSearchQuery) {
        filtered = filtered.filter(p => {
            const student = String(p.student || '').toLowerCase();
            const reg = String(p.registrationNumber || '').toLowerCase();
            const id = String(p.id || '').toLowerCase();
            const cert = String(p.certificateId || '').toLowerCase();
            const room = String(p.roomNumber || '').toLowerCase();
            const block = String(p.hostelBlock || '').toLowerCase();
            const warden = String(p.approvedBy || '').toLowerCase();
            return student.includes(adminGatePassSearchQuery) ||
                   reg.includes(adminGatePassSearchQuery) ||
                   id.includes(adminGatePassSearchQuery) ||
                   cert.includes(adminGatePassSearchQuery) ||
                   room.includes(adminGatePassSearchQuery) ||
                   block.includes(adminGatePassSearchQuery) ||
                   warden.includes(adminGatePassSearchQuery);
        });
    }

    if (!filtered.length) {
        tableBody.innerHTML = '<tr><td colspan="9" class="px-6 py-10 text-sm text-text-secondary text-center bg-surface-alt/50">No matching gate pass logs found for this filter.</td></tr>';
        return;
    }

    tableBody.innerHTML = filtered.map((entry) => {
        const rawStatus = String(entry.status || 'PENDING_WARDEN').toUpperCase();
        const isAdminApproved = /^(approved|qr generated|security_pending|outside|warden_pending|outside_not_returned|completed)$/i.test(rawStatus);
        const isAdminRejected = rawStatus === 'REJECTED';
        const isSecurityApproved = Boolean(entry.securityVerified || entry.exitTime);
        const isSecurityRejected = rawStatus === 'SECURITY_REJECTED';
        const isWardenApproved = Boolean(entry.wardenVerified || entry.hostelArrivalTime || rawStatus === 'COMPLETED');
        const isWardenRejected = rawStatus === 'OUTSIDE_NOT_RETURNED';

        let finalBadgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
        let finalLabel = entry.status || 'Pending';

        if (rawStatus === 'COMPLETED') {
            finalBadgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold';
            finalLabel = '✅ COMPLETED';
        } else if (rawStatus === 'OUTSIDE' || rawStatus === 'OUT') {
            finalBadgeClass = 'bg-blue-100 text-blue-800 border border-blue-200 font-bold';
            finalLabel = '🔵 OUTSIDE';
        } else if (rawStatus === 'OUTSIDE_NOT_RETURNED') {
            finalBadgeClass = 'bg-rose-100 text-rose-900 border border-rose-300 font-bold';
            finalLabel = '⚠️ NOT RETURNED';
        } else if (isAdminApproved) {
            finalBadgeClass = 'bg-indigo-100 text-indigo-800 border border-indigo-200';
            finalLabel = '🟢 APPROVED';
        } else if (isAdminRejected || isSecurityRejected) {
            finalBadgeClass = 'bg-danger/10 text-danger border border-danger/20 font-bold';
            finalLabel = '🔴 REJECTED';
        }

        const formatTimeOnly = (t) => t ? new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

        return `
            <tr class="table-row hover:bg-surface-alt/40 transition-colors text-xs">
                <td class="px-4 py-3.5">
                    <div class="flex items-center gap-2.5">
                        ${entry.studentPhoto ? `
                            <img src="${entry.studentPhoto}" alt="Photo" class="w-8 h-8 rounded-xl object-cover border border-border shrink-0">
                        ` : '<div class="w-8 h-8 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-text-muted shrink-0"><i class="fa-solid fa-user text-xs"></i></div>'}
                        <div>
                            <p class="font-bold text-text">${entry.student || 'Anonymous'}</p>
                            <p class="text-[11px] font-mono text-text-secondary">${entry.registrationNumber || 'N/A'} • ${entry.hostelBlock || 'A'}-${entry.roomNumber || ''}</p>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3.5">
                    <p class="font-mono font-bold text-primary">${entry.id || 'N/A'}</p>
                    ${entry.certificateId ? `<p class="font-mono text-[10px] text-emerald-600 truncate max-w-[130px]">${entry.certificateId}</p>` : '<span class="text-[10px] text-text-muted">Cert Pending</span>'}
                </td>
                <td class="px-4 py-3.5">
                    ${isAdminApproved ? `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-emerald bg-emerald/10 border border-emerald/20">✅ Approved</span>
                    ` : isAdminRejected ? `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-danger bg-danger/10 border border-danger/20">❌ Rejected</span>
                    ` : `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-amber-700 bg-amber-100 border border-amber-200">⏳ Pending</span>
                    `}
                </td>
                <td class="px-4 py-3.5">
                    ${isSecurityApproved ? `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-blue-700 bg-blue-100 border border-blue-200">✅ Exit Approved</span>
                    ` : isSecurityRejected ? `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-danger bg-danger/10 border border-danger/20">❌ Rejected</span>
                    ` : `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-text-muted bg-surface-alt border border-border">⏳ Pending</span>
                    `}
                </td>
                <td class="px-4 py-3.5">
                    ${isWardenApproved ? `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200">✅ Verified</span>
                    ` : isWardenRejected ? `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-rose-800 bg-rose-100 border border-rose-300">❌ Rejected</span>
                    ` : `
                        <span class="px-2 py-0.5 rounded-md font-semibold text-text-muted bg-surface-alt border border-border">⏳ Pending</span>
                    `}
                </td>
                <td class="px-4 py-3.5 font-mono text-text-secondary">
                    ${formatTimeOnly(entry.exitTime || entry.outTime)}
                </td>
                <td class="px-4 py-3.5 font-mono text-text-secondary">
                    ${formatTimeOnly(entry.hostelArrivalTime || entry.inTime)}
                </td>
                <td class="px-4 py-3.5">
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${finalBadgeClass}">${finalLabel}</span>
                </td>
                <td class="px-4 py-3.5">
                    <div class="flex items-center gap-1.5">
                        <button onclick="viewGatePassDetailsModal('${entry.id}')" class="px-2.5 py-1 rounded-lg border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text hover:text-primary transition-all">Details</button>
                        <button onclick="downloadGatePassPdf('${entry.id}')" class="px-2 py-1 rounded-lg border border-border bg-surface-alt hover:bg-surface text-xs font-semibold text-text-secondary hover:text-text transition-all"><i class="fa-solid fa-file-pdf text-danger"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function exportGatePassesCsv() {
    if (!latestGatePasses.length) {
        showToast('No gate pass logs available to export.', 'warning');
        return;
    }

    const headers = ['Gate Pass ID', 'Student Name', 'Registration Number', 'Hostel Block', 'Room Number', 'Gate Date', 'Return Date', 'Session', 'Reason', 'Status', 'Approved By', 'Created Date'];
    const rows = latestGatePasses.map(p => [
        `"${p.id || ''}"`,
        `"${(p.student || '').replace(/"/g, '""')}"`,
        `"${p.registrationNumber || ''}"`,
        `"${p.hostelBlock || ''}"`,
        `"${p.roomNumber || ''}"`,
        `"${p.gateDate || ''}"`,
        `"${p.returnDate || ''}"`,
        `"${p.session || ''}"`,
        `"${(p.reason || '').replace(/"/g, '""')}"`,
        `"${p.status || 'Pending'}"`,
        `"${p.approvedBy || ''}"`,
        `"${new Date(p.createdAt || Date.now()).toISOString()}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `gate-pass-movement-logs-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Gate pass movement logs exported as CSV successfully.', 'success');
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
    if (!message) return;
    const now = Date.now();
    const cleanMessage = String(message).trim();
    const lastShown = lastToastMap.get(cleanMessage);
    if (lastShown && now - lastShown < 3500) {
        return; // Suppress duplicate toast within 3.5 seconds
    }
    lastToastMap.set(cleanMessage, now);

    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-3 items-end pointer-events-none';
        document.body.appendChild(container);
    }

    // Keep at most 4 toasts visible at a time
    const existingToasts = container.querySelectorAll('.toast');
    if (existingToasts.length >= 4) {
        existingToasts[0].remove();
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
    toast.innerHTML = '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i><span class="toast-message">' + cleanMessage + '</span>';

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function securityRoleQuery() {
    return encodeURIComponent(currentUser?.role || 'warden');
}

function securityEvidenceUrl(event) {
    return `/api/security-events/${encodeURIComponent(event.event_id)}/evidence?role=${securityRoleQuery()}`;
}

async function loadSecurityAlertStats() {
    if (!['admin', 'warden'].includes(currentUser?.role)) return;
    const response = await apiRequest(`/api/security-events/stats?role=${securityRoleQuery()}`);
    if (!response.ok) return;
    const stats = await parseJsonResponse(response);
    [['adminNightAlertsToday', stats.nightAlertsToday], ['adminUnknownPersons', stats.unknownPersons], ['adminUnauthorizedStudents', stats.unauthorizedStudents], ['adminUnacknowledgedAlerts', stats.unacknowledgedAlerts]].forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value ?? 0;
    });
    const badge = document.getElementById('globalNotificationBadge');
    if (badge) badge.textContent = stats.unacknowledgedAlerts ?? 0;
}

async function openSecurityAlertHistory() {
    if (!['admin', 'warden'].includes(currentUser?.role)) return showToast('Security alerts are limited to wardens and administrators.', 'warning');
    const response = await apiRequest(`/api/security-events?role=${securityRoleQuery()}`);
    const events = response.ok ? await parseJsonResponse(response) : [];
    showModal('Security Alert History', `<div class="space-y-4"><div class="flex items-center justify-between"><p class="text-sm text-text-secondary">Evidence-backed night restriction events.</p><button onclick="loadSecurityAlertHistoryIntoModal()" class="px-3 py-2 rounded-xl border border-border text-xs font-semibold"><i class="fa-solid fa-rotate mr-1"></i> Refresh</button></div><div id="securityAlertHistoryTable" class="overflow-x-auto">${renderSecurityAlertTable(Array.isArray(events) ? events : [])}</div></div>`);
}

async function loadSecurityAlertHistoryIntoModal() {
    const response = await apiRequest(`/api/security-events?role=${securityRoleQuery()}`);
    const events = response.ok ? await parseJsonResponse(response) : [];
    const table = document.getElementById('securityAlertHistoryTable');
    if (table) table.innerHTML = renderSecurityAlertTable(Array.isArray(events) ? events : []);
}

function renderSecurityAlertTable(events) {
    if (!events.length) return '<div class="rounded-2xl border border-border p-8 text-center text-sm text-text-secondary">No security events recorded.</div>';
    return `<table class="w-full text-left text-xs"><thead class="bg-surface-alt"><tr>${['Time','Camera','Student','Student ID','Event','Status','Evidence','Acknowledgement','Action'].map(label => `<th class="px-3 py-3 font-semibold text-text-secondary whitespace-nowrap">${label}</th>`).join('')}</tr></thead><tbody class="divide-y divide-border">${events.map(event => `<tr><td class="px-3 py-3 whitespace-nowrap">${escapeHtml(new Date(event.timestamp).toLocaleString())}</td><td class="px-3 py-3">${escapeHtml(event.camera_id)}</td><td class="px-3 py-3">${escapeHtml(event.student_name)}</td><td class="px-3 py-3">${escapeHtml(event.student_id || '—')}</td><td class="px-3 py-3">Night Restriction</td><td class="px-3 py-3"><span class="px-2 py-1 rounded-full bg-rose-500/10 text-rose-600 font-bold">${event.status}</span></td><td class="px-3 py-3">📸</td><td class="px-3 py-3"><span class="${event.acknowledged ? 'text-emerald' : 'text-rose-600'} font-semibold">${event.acknowledged ? 'ACKNOWLEDGED' : 'PENDING'}</span></td><td class="px-3 py-3 whitespace-nowrap"><button onclick='openSecurityEvidence(${JSON.stringify(event).replace(/'/g, '&#39;')})' class="px-2.5 py-1.5 rounded-lg bg-primary text-white font-semibold mr-1">View</button>${event.acknowledged ? '' : `<button onclick="acknowledgeSecurityEvent('${event.event_id}')" class="px-2.5 py-1.5 rounded-lg border border-border font-semibold">Acknowledge</button>`}</td></tr>`).join('')}</tbody></table>`;
}

function openSecurityEvidence(event) {
    const evidenceUrl = securityEvidenceUrl(event);
    showModal('Security Evidence', `<div class="grid lg:grid-cols-[1.35fr_1fr] gap-5"><div class="rounded-2xl overflow-hidden border border-border bg-black"><img src="${evidenceUrl}" alt="CCTV evidence for ${escapeHtml(event.student_name)}" class="w-full max-h-[58vh] object-contain"></div><div class="space-y-3 text-sm"><div><p class="text-xs text-text-secondary">Student</p><p class="font-semibold">${escapeHtml(event.student_name)}</p></div><div><p class="text-xs text-text-secondary">Student ID</p><p class="font-semibold">${escapeHtml(event.student_id || 'Unknown')}</p></div><div><p class="text-xs text-text-secondary">Camera</p><p class="font-semibold">${escapeHtml(event.camera_id)}</p></div><div><p class="text-xs text-text-secondary">Detected</p><p class="font-semibold">${escapeHtml(new Date(event.timestamp).toLocaleString())}</p></div><div><p class="text-xs text-text-secondary">Event / Status</p><p class="font-semibold">Night Restriction · <span class="text-rose-600">${event.status}</span></p></div><div><p class="text-xs text-text-secondary">Reason</p><p class="font-semibold">${escapeHtml(event.reason)}</p></div>${event.acknowledged ? `<div class="rounded-xl bg-emerald/10 p-3 text-emerald text-xs font-semibold">Acknowledged by ${escapeHtml(event.acknowledged_by || 'warden')}</div>` : `<button onclick="acknowledgeSecurityEvent('${event.event_id}')" class="w-full px-4 py-3 rounded-xl bg-emerald text-white font-semibold">Acknowledge</button>`}</div></div>`);
}

async function acknowledgeSecurityEvent(eventId) {
    const response = await apiRequest(`/api/security-events/${encodeURIComponent(eventId)}/acknowledge`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: currentUser?.role, actorName: currentUser?.name || 'Authorized warden' }) });
    if (!response.ok) return showToast('Unable to acknowledge this security event.', 'error');
    showToast('Security alert acknowledged.', 'success');
    closeModal();
    await loadSecurityAlertStats();
    if (getActivePageId() === 'admin-dashboard') openSecurityAlertHistory();
}

async function openNightRestrictionManager() {
    const response = await apiRequest(`/api/surveillance/config?role=${securityRoleQuery()}`);
    const rawConfig = response.ok ? await parseJsonResponse(response) : {};
    const config = { enabled: rawConfig.night_restriction_enabled !== false, startTime: rawConfig.start_time || '22:00', endTime: rawConfig.end_time || '06:00', confirmationFrames: rawConfig.confirmation_frames || 5, cooldownSeconds: rawConfig.cooldown_seconds || 30 };
    const statusResponse = await apiRequest(`/api/surveillance/status?role=${securityRoleQuery()}`);
    const status = statusResponse.ok ? await parseJsonResponse(statusResponse) : { backend: 'DISCONNECTED', surveillance: 'UNKNOWN', camera: 'UNKNOWN', socket: 'UNKNOWN', test_mode: false };
    
    const content = `
        <div class="space-y-5 cctv-modal">
            <!-- Top Header Card (Exact Match to Image 2) -->
            <div class="modal-card rounded-[2rem] border border-border bg-surface-alt shadow-xl overflow-hidden">
                <div class="modal-card-header flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h4 class="font-semibold text-2xl">Hostel CCTV Live Monitoring</h4>
                        <p class="text-sm text-text-secondary mt-2 max-w-xl">Use your webcam for live room and hostel night surveillance with real-time biometric and YOLO person detection.</p>
                    </div>
                    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <button id="btnStartWebsiteSurveillance" type="button" onclick="startWebsiteSurveillance()" class="btn btn-primary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[10.5rem] flex items-center justify-center gap-2">
                            <i class="fa-solid fa-play"></i> Start Live Camera
                        </button>
                        <button type="button" onclick="openLiveFaceEnrollmentModal()" class="btn btn-secondary px-4 py-3 rounded-2xl text-sm font-semibold text-center cursor-pointer flex items-center gap-2 hover:border-indigo-400 transition-all select-none">
                            <i class="fa-solid fa-id-card-clip text-indigo-500"></i>
                            <span>Scan My Face</span>
                        </button>
                        <label class="btn btn-secondary px-4 py-3 rounded-2xl text-sm font-semibold text-center cursor-pointer flex items-center gap-2 select-none">
                            <input id="websiteSurveillanceTestMode" type="checkbox" class="w-4 h-4 text-primary rounded">
                            <span>Test Hours (override)</span>
                        </label>
                        <button id="btnStopWebsiteSurveillance" type="button" onclick="stopWebsiteSurveillance()" class="btn btn-secondary px-5 py-3 rounded-2xl text-sm font-semibold min-w-[10rem] flex items-center justify-center gap-2">
                            <i class="fa-solid fa-stop"></i> Stop Monitoring
                        </button>
                    </div>
                </div>
            </div>

            <!-- Main 2-Column Grid (Exact Match to Image 2) -->
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
                <!-- Left: Video Feed Card -->
                <div class="cctv-card rounded-[1.75rem] border border-border bg-surface-alt shadow-lg overflow-hidden flex flex-col">
                    <div class="px-6 py-5 border-b border-border bg-white/90 flex items-center justify-between">
                        <h5 class="font-semibold text-lg">Camera or Uploaded Video Feed</h5>
                        <span id="websiteSurveillanceFeedStatus" class="cctv-hud-badge bg-slate-800 text-slate-400">OFFLINE</span>
                    </div>
                    <div class="relative bg-black aspect-video flex-1 overflow-hidden flex items-center justify-center">
                        <img id="websiteSurveillanceFeed" alt="Real surveillance camera feed" class="w-full h-full object-cover hidden">
                        <div id="websiteSurveillanceFeedEmpty" class="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-6 bg-black/80">
                            <i id="websiteSurveillanceFeedIcon" class="fa-solid fa-video-slash text-3xl text-slate-500 mb-3"></i>
                            <p id="websiteSurveillanceFeedMsg" class="text-sm text-slate-300 max-w-md">Live camera ready. Click <strong>Start Live Camera</strong> to begin real-time surveillance.</p>
                        </div>
                    </div>
                    <!-- Camera Source Quick Bar -->
                    <div class="px-5 py-3 border-t border-border bg-surface/80 flex items-center gap-3 text-xs">
                        <span class="text-text-secondary font-medium"><i class="fa-solid fa-video mr-1"></i>Camera ID:</span>
                        <input id="websiteSurveillanceCameraId" value="HOSTEL-CCTV-01" class="px-3 py-1.5 rounded-lg border border-border bg-surface-alt text-xs font-semibold text-slate-800 flex-1 min-w-[8rem]" placeholder="Camera ID">
                        <span class="text-text-secondary font-medium ml-2">Source:</span>
                        <input id="websiteSurveillanceSource" value="0" class="w-16 px-2.5 py-1.5 rounded-lg border border-border bg-surface-alt text-xs font-semibold text-slate-800" placeholder="0">
                    </div>
                </div>

                <!-- Right: 4 Stat Widgets (Exact Match to Image 2) -->
                <div class="space-y-4">
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Status</h5>
                        <p class="text-sm text-text-secondary" id="nightSurveillanceStatusText">Live camera ready. Click Start Live Camera to begin biometric surveillance.</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Biometric Authorization</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="nightBiometricMatch">No person detected</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Detection Confidence</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="nightDetectionConfidence">N/A</p>
                    </div>
                    <div class="stat-widget rounded-[1.5rem] p-5 bg-white/95 border border-border shadow-sm">
                        <h5 class="font-semibold mb-2">Speed</h5>
                        <p class="text-xl font-semibold text-slate-900 cctv-stat-value" id="nightCurfewSpeed">N/A</p>
                    </div>
                </div>
            </div>

            <!-- Bottom: Policy Configuration Card -->
            <div class="cctv-card rounded-[1.75rem] border border-border bg-surface-alt shadow-lg p-6">
                <form onsubmit="saveNightRestriction(event)" class="space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border">
                        <div>
                            <h5 class="font-semibold text-base">Night Curfew Restriction Settings</h5>
                            <p class="text-xs text-text-secondary">Configure automatic verification thresholds and active curfew schedule.</p>
                        </div>
                        <label class="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                            <input id="nightRestrictionEnabled" type="checkbox" ${config.enabled !== false ? 'checked' : ''} class="w-4 h-4 text-primary rounded">
                            <span>Restriction Active</span>
                        </label>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                            <label class="block font-semibold text-text-secondary mb-1">Curfew Start</label>
                            <input id="nightRestrictionStart" type="time" value="${escapeHtml(config.startTime || '22:00')}" class="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm font-medium">
                        </div>
                        <div>
                            <label class="block font-semibold text-text-secondary mb-1">Curfew End</label>
                            <input id="nightRestrictionEnd" type="time" value="${escapeHtml(config.endTime || '06:00')}" class="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm font-medium">
                        </div>
                        <div>
                            <label class="block font-semibold text-text-secondary mb-1">Confirmation Frames</label>
                            <input id="nightRestrictionFrames" type="number" min="1" max="30" value="${config.confirmationFrames || 5}" class="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm font-medium">
                        </div>
                        <div>
                            <label class="block font-semibold text-text-secondary mb-1">Cooldown (sec)</label>
                            <input id="nightRestrictionCooldown" type="number" min="5" max="300" value="${config.cooldownSeconds || 30}" class="w-full px-3 py-2 rounded-xl border border-border bg-surface text-sm font-medium">
                        </div>
                    </div>

                    <div class="flex items-center justify-end gap-3 pt-2">
                        <button type="button" onclick="openSecurityAlertHistory()" class="btn btn-secondary px-5 py-2.5 rounded-xl text-sm font-semibold">
                            <i class="fa-solid fa-clock-rotate-left mr-2"></i>View Incident Log
                        </button>
                        <button type="submit" class="btn btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold">
                            <i class="fa-solid fa-check mr-2"></i>Save Policy Settings
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;

    showModal('🌙 Night Restriction & AI Surveillance Monitor', content);
    refreshWebsiteSurveillanceStatus();
}

async function saveNightRestriction(event) {
    event.preventDefault();
    const response = await apiRequest('/api/surveillance/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: currentUser?.role, night_restriction_enabled: document.getElementById('nightRestrictionEnabled')?.checked, start_time: document.getElementById('nightRestrictionStart')?.value, end_time: document.getElementById('nightRestrictionEnd')?.value, confirmation_frames: Number(document.getElementById('nightRestrictionFrames')?.value || 5), cooldown_seconds: Number(document.getElementById('nightRestrictionCooldown')?.value || 30) }) });
    if (!response.ok) return showToast('Unable to save night restriction settings.', 'error');
    closeModal();
    showToast('Night restriction settings saved.', 'success');
}

function showModal(title, content) {
    const overlay = document.getElementById('modalOverlay');
    const modalContent = document.getElementById('modalContent');
    modalContent.innerHTML = '<div class="p-6 border-b border-border flex items-center justify-between"><h3 class="font-semibold text-lg">' + title + '</h3><button onclick="closeModal()" class="w-8 h-8 rounded-lg hover:bg-surface-alt flex items-center justify-center transition-all"><i class="fa-solid fa-xmark text-text-secondary"></i></button></div><div class="p-6">' + content + '</div>';
    modalContent.classList.toggle('night-restriction-modal', title.includes('Night Restriction') || title.includes('Hostel CCTV Live Monitoring'));
    overlay.classList.add('active');
}

const surveillanceStreamController = {
    pollingInterval: null,
    isStreaming: false,
    usePollingFallback: false,
    activeCameraId: 'HOSTEL-CCTV-01',

    start(cameraId) {
        this.activeCameraId = cameraId || 'HOSTEL-CCTV-01';
        const feed = document.getElementById('websiteSurveillanceFeed');
        const empty = document.getElementById('websiteSurveillanceFeedEmpty');
        if (!feed) return;

        const role = securityRoleQuery();
        const safeCameraId = encodeURIComponent(this.activeCameraId);

        if (!this.usePollingFallback) {
            // Attempt standard MJPEG stream
            const streamUrl = `/api/surveillance/live?camera_id=${safeCameraId}&role=${role}&t=${Date.now()}`;
            feed.onerror = () => {
                console.warn('MJPEG stream interrupted or unsupported, falling back to rapid frame polling.');
                this.usePollingFallback = true;
                this.start(this.activeCameraId);
            };
            feed.onload = () => {
                this.isStreaming = true;
                if (empty) empty.classList.add('hidden');
                feed.classList.remove('hidden');
            };
            feed.src = streamUrl;
            feed.classList.remove('hidden');
            if (empty) empty.classList.add('hidden');
            this.isStreaming = true;
        } else {
            // High-compatibility rapid frame polling
            if (this.pollingInterval) clearInterval(this.pollingInterval);
            if (empty) empty.classList.add('hidden');
            feed.classList.remove('hidden');
            const pollFrame = () => {
                if (!this.pollingInterval) return;
                const nextImg = new Image();
                nextImg.onload = () => {
                    if (feed) feed.src = nextImg.src;
                };
                nextImg.src = `/api/surveillance/frame?camera_id=${safeCameraId}&role=${role}&t=${Date.now()}`;
            };
            pollFrame();
            this.pollingInterval = setInterval(pollFrame, 150);
            this.isStreaming = true;
        }
    },

    stop() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.isStreaming = false;
        const feed = document.getElementById('websiteSurveillanceFeed');
        const empty = document.getElementById('websiteSurveillanceFeedEmpty');
        const icon = document.getElementById('websiteSurveillanceFeedIcon');
        const msg = document.getElementById('websiteSurveillanceFeedMsg');
        if (feed) {
            feed.onerror = null;
            feed.onload = null;
            feed.removeAttribute('src');
            feed.classList.add('hidden');
        }
        if (empty) {
            empty.classList.remove('hidden');
            if (icon) icon.className = 'fa-solid fa-video-slash text-3xl text-slate-500 mb-3';
            if (msg) msg.textContent = 'Live camera ready. Click Start Live Camera to begin real-time surveillance.';
        }
    },

    setStarting() {
        const feed = document.getElementById('websiteSurveillanceFeed');
        const empty = document.getElementById('websiteSurveillanceFeedEmpty');
        const icon = document.getElementById('websiteSurveillanceFeedIcon');
        const msg = document.getElementById('websiteSurveillanceFeedMsg');
        if (feed) {
            feed.classList.add('hidden');
            feed.removeAttribute('src');
        }
        if (empty) {
            empty.classList.remove('hidden');
            if (icon) icon.className = 'fa-solid fa-circle-notch fa-spin text-3xl text-amber-400 mb-3';
            if (msg) msg.textContent = 'Camera initializing and loading AI models... (Please wait a moment)';
        }
    }
};

async function refreshWebsiteSurveillanceStatus() {
    const response = await apiRequest(`/api/surveillance/status?role=${securityRoleQuery()}`).catch(() => null);
    if (!response?.ok) return null;
    const status = await parseJsonResponse(response);
    const label = document.getElementById('websiteSurveillanceFeedStatus');
    const cameraId = document.getElementById('websiteSurveillanceCameraId')?.value || 'HOSTEL-CCTV-01';

    // Widget elements matching Image 2
    const statusTextEl = document.getElementById('nightSurveillanceStatusText');
    const biometricEl = document.getElementById('nightBiometricMatch');
    const confidenceEl = document.getElementById('nightDetectionConfidence');
    const speedEl = document.getElementById('nightCurfewSpeed');

    // Update status badge
    if (label) {
        const cam = status.camera || 'OFFLINE';
        label.textContent = cam;
        label.className = `cctv-hud-badge ${
            cam === 'ONLINE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            cam === 'STARTING' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
            'bg-slate-800 text-slate-400 border border-slate-700'
        }`;
    }

    // Update video stream controller state & widgets
    if (status.surveillance === 'RUNNING') {
        if (status.camera === 'ONLINE') {
            if (statusTextEl) statusTextEl.innerHTML = '<span class="text-emerald-600 font-semibold">🟢 Camera Live.</span> AI person detection & biometric facial verification running.';
            if (biometricEl) biometricEl.innerHTML = '<span class="text-slate-700 font-semibold">🛡️ Face verification active</span>';
            if (confidenceEl) confidenceEl.textContent = 'Analyzing live frames...';
            if (speedEl) speedEl.textContent = `${status.target_fps || 10} FPS target • 22:00 – 06:00 (Active)`;

            const feed = document.getElementById('websiteSurveillanceFeed');
            if (feed && (feed.classList.contains('hidden') || !surveillanceStreamController.isStreaming && !surveillanceStreamController.pollingInterval)) {
                surveillanceStreamController.start(cameraId);
            }
        } else {
            if (statusTextEl) statusTextEl.textContent = 'Initializing camera and loading AI models... (Please wait a moment)';
            if (biometricEl) biometricEl.textContent = 'Initializing...';
            if (confidenceEl) confidenceEl.textContent = 'Loading...';
            if (speedEl) speedEl.textContent = 'Starting...';
            surveillanceStreamController.setStarting();
        }
    } else {
        if (statusTextEl) statusTextEl.textContent = 'Live camera ready. Click Start Live Camera to begin fire, smoke, and biometric surveillance.';
        if (biometricEl) biometricEl.textContent = 'No person detected';
        if (confidenceEl) confidenceEl.textContent = 'N/A';
        if (speedEl) speedEl.textContent = 'N/A';
        surveillanceStreamController.stop();
    }
    return status;
}

async function startWebsiteSurveillance() {
    const startBtn = document.getElementById('btnStartWebsiteSurveillance');
    if (startBtn) startBtn.disabled = true;
    showToast('Starting surveillance camera...', 'info');
    surveillanceStreamController.setStarting();

    const response = await apiRequest('/api/surveillance/control/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            role: currentUser?.role,
            camera_id: document.getElementById('websiteSurveillanceCameraId')?.value || 'HOSTEL-CCTV-01',
            source: document.getElementById('websiteSurveillanceSource')?.value || '0',
            test_restricted_hours: Boolean(document.getElementById('websiteSurveillanceTestMode')?.checked),
            confirmation_frames: Number(document.getElementById('nightRestrictionFrames')?.value || 5),
            cooldown_seconds: Number(document.getElementById('nightRestrictionCooldown')?.value || 30),
            minimum_presence_seconds: 60
        })
    });
    if (startBtn) startBtn.disabled = false;

    if (!response.ok) {
        const error = await parseJsonResponse(response).catch(() => ({}));
        surveillanceStreamController.stop();
        return showToast(error.error || 'Unable to start surveillance.', 'error');
    }

    showToast('Real surveillance camera is initializing...', 'success');

    if (websiteSurveillanceStatusTimer) clearInterval(websiteSurveillanceStatusTimer);
    let attempts = 0;
    websiteSurveillanceStatusTimer = setInterval(async () => {
        const status = await refreshWebsiteSurveillanceStatus();
        attempts += 1;
        if (status?.camera === 'ONLINE' || attempts >= 30 || status?.surveillance === 'STOPPED') {
            clearInterval(websiteSurveillanceStatusTimer);
            websiteSurveillanceStatusTimer = null;
        }
    }, 1200);
}

async function stopWebsiteSurveillance() {
    if (websiteSurveillanceStatusTimer) {
        clearInterval(websiteSurveillanceStatusTimer);
        websiteSurveillanceStatusTimer = null;
    }
    surveillanceStreamController.stop();
    const response = await apiRequest('/api/surveillance/control/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: currentUser?.role })
    });
    if (!response.ok) return showToast('Unable to stop surveillance.', 'error');

    const label = document.getElementById('websiteSurveillanceFeedStatus');
    if (label) {
        label.textContent = 'OFFLINE';
        label.className = 'cctv-hud-badge bg-slate-800 text-slate-400 border border-slate-700';
    }
    const statusTextEl = document.getElementById('nightSurveillanceStatusText');
    const biometricEl = document.getElementById('nightBiometricMatch');
    const confidenceEl = document.getElementById('nightDetectionConfidence');
    const speedEl = document.getElementById('nightCurfewSpeed');
    if (statusTextEl) statusTextEl.textContent = 'Live camera ready. Click Start Live Camera to begin surveillance.';
    if (biometricEl) biometricEl.textContent = 'No person detected';
    if (confidenceEl) confidenceEl.textContent = 'N/A';
    if (speedEl) speedEl.textContent = 'N/A';

    showToast('Surveillance stopped.', 'info');
}

let activeFaceEnrollStream = null;

async function openLiveFaceEnrollmentModal() {
    if (surveillanceStreamController && surveillanceStreamController.isStreaming) {
        stopWebsiteSurveillance();
    }

    const defaultStudentId = currentUser?.id || currentUser?.studentId || 'STU-001';
    const defaultName = currentUser?.name || currentUser?.username || 'Balamurugan';

    const content = `
        <div class="space-y-5">
            <!-- Header banner -->
            <div class="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-lg font-bold shadow-md shadow-indigo-500/20">
                    <i class="fa-solid fa-id-badge"></i>
                </div>
                <div>
                    <h4 class="font-bold text-sm text-slate-800">Biometric Facial Scan & Authorization</h4>
                    <p class="text-xs text-text-secondary">Scan your face directly from your camera to enroll or authorize yourself in the AI surveillance database.</p>
                </div>
            </div>

            <!-- Face Scanner Camera Box -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <!-- Left: Live Camera Viewport -->
                <div class="space-y-2">
                    <div class="relative aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-lg flex items-center justify-center">
                        <video id="faceEnrollLiveVideo" autoplay playsinline muted class="w-full h-full object-cover"></video>
                        <canvas id="faceEnrollCanvas" class="hidden"></canvas>
                        
                        <!-- Biometric Scanning Reticle HUD Overlay -->
                        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4">
                            <div class="w-40 h-48 border-2 border-dashed border-emerald-400/80 rounded-[50%] flex items-center justify-center relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                                <div class="absolute inset-x-0 h-0.5 bg-emerald-400 shadow-[0_0_12px_#10B981] animate-pulse"></div>
                                <span class="text-[10px] uppercase tracking-wider font-mono text-emerald-300 bg-slate-950/80 px-2 py-0.5 rounded-full border border-emerald-500/40">Align Face Here</span>
                            </div>
                        </div>

                        <div id="faceEnrollPlaceholder" class="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400 p-4 text-center">
                            <i class="fa-solid fa-camera text-3xl text-indigo-400 mb-2"></i>
                            <p class="text-xs font-semibold text-white">Starting Webcam Scanner...</p>
                            <p class="text-[11px] text-slate-500">Please grant camera permissions if prompted.</p>
                        </div>
                    </div>

                    <div class="flex items-center justify-between text-xs text-text-secondary px-1">
                        <span><i class="fa-solid fa-lightbulb text-amber-500 mr-1"></i> Look directly at the camera in good lighting.</span>
                        <span class="text-emerald-600 font-bold font-mono">128-D ENCODING</span>
                    </div>
                </div>

                <!-- Right: Profile Info Form -->
                <form onsubmit="submitLiveFaceScan(event)" class="space-y-3.5">
                    <div>
                        <label class="block text-xs font-semibold text-text-secondary mb-1">Student / Member ID</label>
                        <div class="relative">
                            <i class="fa-solid fa-hashtag absolute left-3 top-3 text-slate-400 text-xs"></i>
                            <input id="enrollStudentId" required value="${escapeHtml(defaultStudentId)}" class="w-full pl-8 pr-3 py-2 rounded-xl border border-border bg-surface text-sm font-semibold text-slate-800" placeholder="e.g. STU-001">
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-text-secondary mb-1">Full Name</label>
                        <div class="relative">
                            <i class="fa-solid fa-user absolute left-3 top-3 text-slate-400 text-xs"></i>
                            <input id="enrollStudentName" required value="${escapeHtml(defaultName)}" class="w-full pl-8 pr-3 py-2 rounded-xl border border-border bg-surface text-sm font-semibold text-slate-800" placeholder="e.g. Balamurugan">
                        </div>
                    </div>

                    <div class="p-3.5 rounded-xl border border-border bg-surface-alt space-y-2">
                        <label class="flex items-center justify-between cursor-pointer">
                            <div>
                                <span class="text-xs font-bold text-slate-800">Authorize for Night Entry</span>
                                <p class="text-[11px] text-text-secondary">Shows green AUTHORIZED badge during restricted hours.</p>
                            </div>
                            <input id="enrollAuthorizedCheck" type="checkbox" checked class="w-4 h-4 text-emerald-600 rounded cursor-pointer">
                        </label>
                    </div>

                    <div class="flex items-center gap-2 pt-2">
                        <button id="btnCaptureFaceScan" type="submit" class="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-sm shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-camera-retro"></i> Capture Face Scan
                        </button>
                        <label class="btn btn-secondary px-3 py-3 rounded-xl text-xs font-bold text-center cursor-pointer flex items-center gap-1.5" title="Or upload a face photo file">
                            <i class="fa-solid fa-upload"></i>
                            <span>Upload Photo</span>
                            <input id="enrollPhotoFileInput" type="file" accept="image/*" class="hidden" onchange="handleFacePhotoUpload(event)">
                        </label>
                    </div>
                </form>
            </div>

            <!-- Enrolled Students Directory -->
            <div class="rounded-2xl border border-border bg-surface-alt p-4 space-y-3">
                <div class="flex items-center justify-between">
                    <h5 class="text-xs font-bold text-slate-700 uppercase tracking-wider">Currently Enrolled Faces in Biometric DB</h5>
                    <button type="button" onclick="loadEnrolledStudentsList()" class="text-xs text-primary font-semibold hover:underline">Refresh List</button>
                </div>
                <div id="enrolledStudentsListContainer" class="max-h-36 overflow-y-auto space-y-2">
                    <p class="text-xs text-slate-400">Loading enrolled records...</p>
                </div>
            </div>
        </div>
    `;

    showModal('📸 Biometric Face Enrollment Scanner', content);
    startFaceEnrollWebcam();
    loadEnrolledStudentsList();
}

async function startFaceEnrollWebcam() {
    const video = document.getElementById('faceEnrollLiveVideo');
    const placeholder = document.getElementById('faceEnrollPlaceholder');
    if (!video) return;

    try {
        if (activeFaceEnrollStream) {
            activeFaceEnrollStream.getTracks().forEach(track => track.stop());
            activeFaceEnrollStream = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        activeFaceEnrollStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play().catch(() => {});
            if (placeholder) placeholder.classList.add('hidden');
        };
    } catch (err) {
        console.warn('Unable to open enrollment webcam:', err);
        if (placeholder) {
            placeholder.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation text-3xl text-amber-400 mb-2"></i>
                <p class="text-xs font-bold text-white">Camera Access Error</p>
                <p class="text-[11px] text-slate-400 mt-1 max-w-xs">${escapeHtml(err.message || 'Please check camera permissions in your browser.')}</p>
            `;
        }
    }
}

function stopFaceEnrollWebcam() {
    if (activeFaceEnrollStream) {
        activeFaceEnrollStream.getTracks().forEach(track => track.stop());
        activeFaceEnrollStream = null;
    }
}

async function handleFacePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const studentId = document.getElementById('enrollStudentId')?.value?.trim();
    const name = document.getElementById('enrollStudentName')?.value?.trim();
    const authorized = Boolean(document.getElementById('enrollAuthorizedCheck')?.checked);
    const btn = document.getElementById('btnCaptureFaceScan');

    if (!studentId || !name) {
        showToast('Please enter both Student ID and Full Name before uploading photo.', 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i> Extracting Biometrics...';
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        try {
            const response = await apiRequest('/api/surveillance/enroll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: securityRoleQuery(),
                    student_id: studentId,
                    name: name,
                    image: dataUrl,
                    authorized: authorized,
                    access_level: 'standard'
                })
            });

            const resData = await parseJsonResponse(response).catch(() => ({}));
            if (!response.ok) {
                throw new Error(resData.error || 'Failed to detect or enroll face. Please ensure your face is clearly visible.');
            }

            showToast(`🎉 Success! Face enrolled & authorized for ${name} (${studentId})!`, 'success');
            stopFaceEnrollWebcam();
            closeModal();

        } catch (err) {
            showToast(err.message || 'Face enrollment failed.', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-camera-retro mr-1.5"></i> Capture Face Scan';
            }
        }
    };
    reader.readAsDataURL(file);
}

async function submitLiveFaceScan(event) {
    if (event) event.preventDefault();
    const video = document.getElementById('faceEnrollLiveVideo');
    const canvas = document.getElementById('faceEnrollCanvas');
    const btn = document.getElementById('btnCaptureFaceScan');
    const studentId = document.getElementById('enrollStudentId')?.value?.trim();
    const name = document.getElementById('enrollStudentName')?.value?.trim();
    const authorized = Boolean(document.getElementById('enrollAuthorizedCheck')?.checked);

    if (!studentId || !name) {
        showToast('Please enter both Student ID and Full Name.', 'warning');
        return;
    }

    if (!video || !canvas) return;

    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
        showToast('Camera is initializing. Please wait a second and click capture again.', 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1.5"></i> Scanning & Extracting Biometrics...';
    }

    try {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

        const response = await apiRequest('/api/surveillance/enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                role: securityRoleQuery(),
                student_id: studentId,
                name: name,
                image: dataUrl,
                authorized: authorized,
                access_level: 'standard'
            })
        });

        const resData = await parseJsonResponse(response).catch(() => ({}));
        if (!response.ok) {
            throw new Error(resData.error || 'Failed to detect or enroll face. Please ensure your face is clearly visible.');
        }

        showToast(`🎉 Success! Face enrolled & authorized for ${name} (${studentId})!`, 'success');
        stopFaceEnrollWebcam();
        closeModal();

    } catch (err) {
        showToast(err.message || 'Face scanning failed.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-camera-retro mr-1.5"></i> Capture Face Scan';
        }
    }
}

async function loadEnrolledStudentsList() {
    const container = document.getElementById('enrolledStudentsListContainer');
    if (!container) return;

    const response = await apiRequest(`/api/surveillance/students?role=${securityRoleQuery()}`).catch(() => null);
    if (!response?.ok) {
        container.innerHTML = '<p class="text-xs text-slate-400">Unable to load enrolled faces.</p>';
        return;
    }

    const { students = [] } = await parseJsonResponse(response);
    if (!students.length) {
        container.innerHTML = '<p class="text-xs text-slate-400">No faces enrolled yet. Use the camera above to scan your face.</p>';
        return;
    }

    container.innerHTML = students.map(s => `
        <div class="flex items-center justify-between p-2.5 rounded-xl border border-border bg-surface text-xs">
            <div class="flex items-center gap-2.5">
                <div class="w-7 h-7 rounded-lg ${s.authorized ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'} flex items-center justify-center font-bold">
                    <i class="fa-solid ${s.authorized ? 'fa-shield-check' : 'fa-shield-xmark'}"></i>
                </div>
                <div>
                    <span class="font-bold text-slate-800">${escapeHtml(s.name)}</span>
                    <span class="text-slate-400 ml-1 font-mono">(${escapeHtml(s.student_id)})</span>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.authorized ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}">
                    ${s.authorized ? 'AUTHORIZED' : 'UNAUTHORIZED'}
                </span>
                <button type="button" onclick="toggleStudentAuthorization('${escapeHtml(s.student_id)}', ${!s.authorized})" class="px-2 py-1 rounded-lg border border-border hover:bg-surface-alt text-[10px] font-semibold text-slate-600">
                    ${s.authorized ? 'Revoke' : 'Authorize'}
                </button>
            </div>
        </div>
    `).join('');
}

async function toggleStudentAuthorization(studentId, newAuthStatus) {
    const res = await apiRequest(`/api/surveillance/students/${encodeURIComponent(studentId)}/authorize`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: currentUser?.role, authorized: newAuthStatus })
    });
    if (res.ok) {
        showToast(`Authorization status updated for ${studentId}.`, 'success');
        loadEnrolledStudentsList();
    } else {
        showToast('Unable to update authorization.', 'error');
    }
}

function openHostelEmergencyModal() {
    showModal('Hostel 24/7 Emergency & Safety Hotline', `
        <div class="space-y-4">
            <div class="flex items-center gap-3 p-4 rounded-2xl bg-danger/10 border border-danger/25">
                <div class="w-12 h-12 rounded-2xl bg-danger text-white flex items-center justify-center text-xl shadow-md">
                    <i class="fa-solid fa-shield-heart"></i>
                </div>
                <div>
                    <h4 class="font-bold text-sm text-text">Hostel Rapid Emergency & Safety Desk</h4>
                    <p class="text-xs text-text-secondary">Instant one-touch helpline dispatch & anti-ragging support</p>
                </div>
            </div>

            <div class="space-y-2.5 text-xs">
                <!-- Anti-Ragging -->
                <a href="tel:18001805522" class="flex items-center justify-between p-3.5 rounded-2xl bg-surface-alt hover:bg-surface border border-border transition-all group">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-phone-volume"></i>
                        </div>
                        <div>
                            <p class="font-bold text-text group-hover:text-primary transition-colors">National Anti-Ragging Helpline</p>
                            <p class="text-[11px] text-text-muted">Toll-free 24/7 UGC National Cell</p>
                        </div>
                    </div>
                    <span class="font-mono font-bold text-rose-600 px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">1800-180-5522</span>
                </a>

                <!-- Security Desk -->
                <a href="tel:+919876500100" class="flex items-center justify-between p-3.5 rounded-2xl bg-surface-alt hover:bg-surface border border-border transition-all group">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-shield"></i>
                        </div>
                        <div>
                            <p class="font-bold text-text group-hover:text-primary transition-colors">Main Gate Security Control</p>
                            <p class="text-[11px] text-text-muted">Campus CCTV & gate access desk</p>
                        </div>
                    </div>
                    <span class="font-mono font-bold text-indigo-600 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20">+91 98765 00100</span>
                </a>

                <!-- Chief Warden -->
                <a href="tel:+919876543210" class="flex items-center justify-between p-3.5 rounded-2xl bg-surface-alt hover:bg-surface border border-border transition-all group">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-emerald/10 text-emerald flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-user-shield"></i>
                        </div>
                        <div>
                            <p class="font-bold text-text group-hover:text-primary transition-colors">Hostel Warden On Duty</p>
                            <p class="text-[11px] text-text-muted">Hostel Block emergency escalations</p>
                        </div>
                    </div>
                    <span class="font-mono font-bold text-emerald px-3 py-1 rounded-lg bg-emerald/10 border border-emerald/20">+91 98765 43210</span>
                </a>

                <!-- WhatsApp Community -->
                <a href="https://chat.whatsapp.com/JMnabXfkSoXBy2ywCEClyA" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3.5 rounded-2xl bg-emerald/5 hover:bg-emerald/10 border border-emerald/20 transition-all group">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-emerald text-white flex items-center justify-center text-sm font-bold">
                            <i class="fa-brands fa-whatsapp"></i>
                        </div>
                        <div>
                            <p class="font-bold text-text group-hover:text-emerald transition-colors">Hostel Community Group</p>
                            <p class="text-[11px] text-text-muted">Official student broadcast & peer updates</p>
                        </div>
                    </div>
                    <span class="text-xs font-bold text-emerald">Join ➔</span>
                </a>
            </div>
        </div>
    `);
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

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    gateDateInput.min = todayStr;

    const syncReturnDateMin = () => {
        const selectedGateDate = gateDateInput.value || todayStr;
        returnDateInput.min = selectedGateDate;
        if (returnDateInput.value && returnDateInput.value < selectedGateDate) {
            returnDateInput.value = selectedGateDate;
        }
    };

    gateDateInput.addEventListener('change', syncReturnDateMin);
    gateDateInput.addEventListener('input', syncReturnDateMin);
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

function updateCustomDatePickerPosition() {
    if (!activeDatePickerPopover || !activeDatePickerInput) return;
    const rect = activeDatePickerInput.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        closeCustomDatePicker();
        return;
    }

    const popoverHeight = activeDatePickerPopover.offsetHeight || 330;
    const spaceBelow = window.innerHeight - rect.bottom;

    if (spaceBelow < popoverHeight && rect.top > popoverHeight) {
        activeDatePickerPopover.style.top = `${Math.max(8, rect.top - popoverHeight - 8)}px`;
    } else {
        activeDatePickerPopover.style.top = `${rect.bottom + 8}px`;
    }

    let left = rect.left;
    const popoverWidth = activeDatePickerPopover.offsetWidth || 288;
    if (left + popoverWidth > window.innerWidth - 16) {
        left = window.innerWidth - popoverWidth - 16;
    }
    if (left < 16) left = 16;
    activeDatePickerPopover.style.left = `${left}px`;
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
    popover.className = 'fixed z-[99999] w-72 rounded-2xl border border-border bg-surface p-4 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150';
    
    document.body.appendChild(popover);
    activeDatePickerPopover = popover;

    renderCustomDatePickerContent();
    updateCustomDatePickerPosition();

    setTimeout(() => {
        document.addEventListener('click', handleOutsideDatePickerClick);
        window.addEventListener('scroll', updateCustomDatePickerPosition, true);
        window.addEventListener('resize', updateCustomDatePickerPosition);
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
    window.removeEventListener('scroll', updateCustomDatePickerPosition, true);
    window.removeEventListener('resize', updateCustomDatePickerPosition);
}

function renderCustomDatePickerContent() {
    if (!activeDatePickerPopover || !activeDatePickerInput) return;

    const year = customDatePickerDate.getFullYear();
    const month = customDatePickerDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const minDateStr = activeDatePickerInput.min || '';
    const maxDateStr = activeDatePickerInput.max || '';

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
        const isDisabled = (minDateStr && dayStr < minDateStr) || (maxDateStr && dayStr > maxDateStr);

        if (isDisabled) {
            daysHtml += `<div class="py-1.5 text-xs text-text-secondary/30 font-normal cursor-not-allowed opacity-30 text-center select-none" title="Date unavailable">${day}</div>`;
        } else {
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
            const confidence = hazardCandidate ? hazardCandidate.confidence : (hazardPrediction ? hazardPrediction.confidence : 0);
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
                    statusEl.textContent = `🚨 Emergency alert sent: ${emergencyPrediction ? (emergencyPrediction.detectionLabel || emergencyPrediction.label) : 'fire or smoke'} detected (${Math.round((emergencyPrediction?.confidence || confidence) * 100)}%).`;
                } else if (hazardCandidate) {
                    if (fireHazardPrediction) {
                        statusEl.textContent = `⚠️ Possible fire detected (${Math.round(fireHazardPrediction.confidence * 100)}%). Fast emergency verification in progress.`;
                    } else if (smokeHazardPrediction) {
                        statusEl.textContent = `⚠️ Possible smoke detected (${Math.round(smokeHazardPrediction.confidence * 100)}%). Verifying stability before alert.`;
                    } else {
                        statusEl.textContent = `⚠️ Possible ${hazardCandidate.detectionLabel || hazardCandidate.label} detected (${Math.round(hazardCandidate.confidence * 100)}%).`;
                    }
                } else if (includeCrowd && cctvCrowdAlertState) {
                    statusEl.textContent = `⚠️ Crowd alert: ${personCount} people detected (threshold ${CROWD_ALERT_THRESHOLD}).`;
                } else if (personCount > 0) {
                    statusEl.textContent = `🟢 Room normal. ${personCount} person detected in frame. No fire or smoke hazards.`;
                } else {
                    statusEl.textContent = '🟢 Room normal. No fire or smoke hazards detected. Feed is clear.';
                }
            }
            if (accuracyEl) {
                if (hazardCandidate) {
                    accuracyEl.textContent = `${Math.round(hazardCandidate.confidence * 100)}% (Hazard)`;
                } else if (personCount > 0) {
                    const topPersonConf = Math.max(...people.map(p => p.confidence || 0), 0.85);
                    accuracyEl.textContent = `${Math.round(topPersonConf * 100)}% (Person)`;
                } else {
                    accuracyEl.textContent = '99% (Clear)';
                }
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

        const isFire = FireDetectionUtils.isFireLabel(prediction.label);
        const isSmoke = FireDetectionUtils.isSmokeLabel(prediction.label);
        const isPerson = String(prediction.label || '').toLowerCase() === 'person';

        // Filter out false positive noise
        // Smoke requires >= 50% confidence (eliminates wall/gradient false positives)
        // Fire requires >= 50% confidence
        // Person requires >= 35% confidence
        if (isSmoke && prediction.confidence < 0.50) return;
        if (isFire && prediction.confidence < 0.50) return;
        if (isPerson && prediction.confidence < 0.35) return;
        if (!isFire && !isSmoke && !isPerson && prediction.confidence < 0.45) return;

        const normalized = Math.max(rawX, rawY, rawWidth, rawHeight) <= 1;
        const left = normalized ? rawX * 100 : (rawX / frameWidth) * 100;
        const top = normalized ? rawY * 100 : (rawY / frameHeight) * 100;
        const width = normalized ? rawWidth * 100 : (rawWidth / frameWidth) * 100;
        const height = normalized ? rawHeight * 100 : (rawHeight / frameHeight) * 100;
        const safeLeft = Math.max(0, left);
        const safeTop = Math.max(0, top);
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
    if (websiteSurveillanceStatusTimer) {
        clearInterval(websiteSurveillanceStatusTimer);
        websiteSurveillanceStatusTimer = null;
    }
    const feed = document.getElementById('websiteSurveillanceFeed');
    if (feed) feed.removeAttribute('src');
    stopCameraScanner();
    stopCCTVInference();
    stopFaceEnrollWebcam();
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
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('wardenName')?.focus(), 50);
    }
}

function closeAddWardenModal() {
    const modal = document.getElementById('addWardenModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
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
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
            const pwd = document.getElementById('techPassword');
            if (pwd) pwd.value = 'tech123';
        }
        setTimeout(() => document.getElementById('techName')?.focus(), 50);
    }
}

function closeAddTechnicianModal() {
    const modal = document.getElementById('addTechnicianModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
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
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }
}

function closeEditWardenModal() {
    const modal = document.getElementById('editWardenModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
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
    const tech = findTechnicianByIdentifier(id);
    if (!tech) {
        showToast('Technician details are unavailable. Please refresh the list and try again.', 'error');
        return;
    }
    document.getElementById('editTechId').value = getTechnicianIdentifier(tech);
    document.getElementById('editTechName').value = tech.name || '';
    document.getElementById('editTechEmail').value = tech.email || '';
    document.getElementById('editTechSpecialization').value = tech.specialization || 'General Maintenance';
    document.getElementById('editTechPhone').value = tech.phone || '+91 98765 12345';
    
    const modal = document.getElementById('editTechnicianModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }
}

function closeEditTechnicianModal() {
    const modal = document.getElementById('editTechnicianModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

async function handleEditTechnician(event) {
    event.preventDefault();
    const id = document.getElementById('editTechId')?.value;
    const name = document.getElementById('editTechName')?.value.trim();
    const email = document.getElementById('editTechEmail')?.value.trim();
    const specialization = document.getElementById('editTechSpecialization')?.value;
    const phone = document.getElementById('editTechPhone')?.value.trim();

    if (!id || !name || !email) {
        showToast('Please complete the technician name and email.', 'warning');
        return;
    }

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

function renderAdminLaundryRequests() {
    const list = document.getElementById('adminLaundryRequestList');
    const badges = document.querySelectorAll('.adminSidebarLaundryBadge, #adminSidebarLaundryBadge');
    badges.forEach(badge => badge.textContent = String(latestLaundryRequests.length || 0));
    if (!list) return;
    if (!latestLaundryRequests.length) {
        list.innerHTML = '<div class="rounded-2xl border border-dashed border-border bg-surface-alt p-10 text-center text-text-secondary">No student laundry requests yet.</div>';
        return;
    }

    const pendingCount = latestLaundryRequests.filter(r => !r.pickupDate).length;
    const scheduledCount = latestLaundryRequests.filter(r => r.status === 'Pickup Scheduled' || r.status === 'Picked Up').length;
    const completedCount = latestLaundryRequests.filter(r => r.status === 'Completed').length;

    list.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div class="glass p-4 rounded-2xl border border-border flex items-center justify-between">
                <div><p class="text-xs text-text-secondary">Total Requests</p><p class="text-xl font-bold text-text">${latestLaundryRequests.length}</p></div>
                <div class="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><i class="fa-solid fa-shirt text-lg"></i></div>
            </div>
            <div class="glass p-4 rounded-2xl border border-border flex items-center justify-between">
                <div><p class="text-xs text-text-secondary">Pending Pickup Date</p><p class="text-xl font-bold text-amber-600">${pendingCount}</p></div>
                <div class="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center" role="img" aria-label="Pickup date pending">
                    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="14" height="15" rx="2"></rect>
                        <path d="M7 2v4M13 2v4M3 9h14"></path>
                        <circle cx="18" cy="17" r="4"></circle>
                        <path d="M18 15v2l1.4 1"></path>
                    </svg>
                </div>
            </div>
            <div class="glass p-4 rounded-2xl border border-border flex items-center justify-between">
                <div><p class="text-xs text-text-secondary">Completed</p><p class="text-xl font-bold text-emerald">${completedCount}</p></div>
                <div class="w-10 h-10 rounded-xl bg-emerald/10 text-emerald flex items-center justify-center"><i class="fa-solid fa-circle-check text-lg"></i></div>
            </div>
        </div>

        <div class="space-y-4">
            ${latestLaundryRequests.map((request) => {
                const photos = Array.isArray(request.photos) ? request.photos : (request.photo ? [request.photo] : []);
                return `
                    <div class="glass rounded-2xl border border-border p-5 space-y-4 bg-surface hover:shadow-md transition-all">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/70 pb-3">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-emerald/10 text-emerald flex items-center justify-center font-bold text-base">
                                    <i class="fa-solid fa-shirt"></i>
                                </div>
                                <div>
                                    <div class="flex items-center gap-2">
                                        <span class="text-sm font-bold text-text">${request.student || 'Unknown Student'}</span>
                                        <span class="text-xs font-mono px-2 py-0.5 rounded-md bg-surface-alt font-bold text-primary">${request.id || ''}</span>
                                    </div>
                                    <p class="text-xs text-text-secondary">Reg No: <strong>${request.registrationNumber || 'N/A'}</strong> • ${request.hostelBlock || ''} Room ${request.roomNumber || ''}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs text-text-secondary">Status:</span>
                                <select onchange="updateLaundryStatus('${request.id}', this.value)" class="text-xs font-bold px-3 py-1.5 rounded-xl border border-border bg-surface-alt text-text focus:outline-none">
                                    <option value="Pending" ${request.status === 'Pending' ? 'selected' : ''}>Pending</option>
                                    <option value="Pickup Scheduled" ${request.status === 'Pickup Scheduled' ? 'selected' : ''}>Pickup Scheduled</option>
                                    <option value="Picked Up" ${request.status === 'Picked Up' ? 'selected' : ''}>Picked Up</option>
                                    <option value="Processing" ${request.status === 'Processing' ? 'selected' : ''}>Processing</option>
                                    <option value="Completed" ${request.status === 'Completed' ? 'selected' : ''}>Completed</option>
                                    <option value="Cancelled" ${request.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                                </select>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                            <div>
                                <p class="text-text-secondary font-semibold mb-1">Laundry Details:</p>
                                <p class="text-text bg-surface-alt/60 p-2.5 rounded-xl border border-border/60">${request.details || 'No special details.'}</p>
                                <p class="text-text-secondary mt-2">Dresses Count: <strong class="text-text font-bold text-sm">${request.dressCount || 0}</strong></p>
                            </div>

                            <div>
                                <p class="text-text-secondary font-semibold mb-1">Dress Photos (${photos.length}):</p>
                                ${photos.length ? `
                                    <div class="flex flex-wrap gap-2">
                                        ${photos.map((src, idx) => `
                                            <div class="relative group cursor-pointer" onclick="showLaundryImageModal('${src}')">
                                                <img src="${src}" alt="Dress photo ${idx+1}" class="w-16 h-16 object-cover rounded-xl border border-border hover:scale-105 transition-transform shadow-xs">
                                                <span class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs rounded-xl transition-opacity"><i class="fa-solid fa-expand"></i></span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : '<p class="text-text-secondary italic bg-surface-alt/40 p-2.5 rounded-xl">No photos uploaded by student.</p>'}
                            </div>

                            <div class="bg-emerald/5 border border-emerald/20 p-3.5 rounded-2xl flex flex-col justify-between space-y-2">
                                <div>
                                    <label class="block text-xs font-bold text-emerald mb-1">
                                        <i class="fa-solid fa-calendar-check mr-1"></i> Admin Assign Pickup Date:
                                    </label>
                                    <input type="date" id="adminPickupDate_${request.id}" value="${request.pickupDate || ''}" class="w-full px-3 py-2 text-xs rounded-xl border border-border bg-surface text-text font-semibold">
                                </div>
                                <button onclick="saveAdminLaundryPickupDate('${request.id}')" class="w-full py-2 bg-emerald hover:bg-emerald-dark text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5">
                                    <i class="fa-solid fa-floppy-disk"></i> Save / Assign Pickup Date
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
    setTimeout(setupCustomDatePickers, 50);
}

async function saveAdminLaundryPickupDate(requestId) {
    const dateInput = document.getElementById('adminPickupDate_' + requestId);
    if (!dateInput) return;
    const newDate = dateInput.value;
    if (!newDate) {
        showToast('Please select a valid pickup date first.', 'warning');
        return;
    }

    showLoading();
    try {
        const res = await apiRequest('/api/laundry-requests/' + requestId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pickupDate: newDate, status: 'Pickup Scheduled' })
        });
        hideLoading();

        if (res.ok) {
            const updated = await parseJsonResponse(res);
            const idx = latestLaundryRequests.findIndex(r => r.id === requestId);
            if (idx !== -1) {
                latestLaundryRequests[idx] = updated;
            }
            showToast(`Pickup date assigned (${newDate}) for request ${requestId}!`, 'success');
            renderAdminLaundryRequests();
        } else {
            showToast('Failed to update pickup date.', 'error');
        }
    } catch (err) {
        hideLoading();
        console.error(err);
        showToast('Error updating pickup date.', 'error');
    }
}

async function updateLaundryStatus(requestId, newStatus) {
    try {
        const res = await apiRequest('/api/laundry-requests/' + requestId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
            const updated = await parseJsonResponse(res);
            const idx = latestLaundryRequests.findIndex(r => r.id === requestId);
            if (idx !== -1) {
                latestLaundryRequests[idx] = updated;
            }
            showToast(`Request ${requestId} status updated to ${newStatus}.`, 'success');
            renderAdminLaundryRequests();
        }
    } catch (err) {
        console.error(err);
        showToast('Error updating request status.', 'error');
    }
}


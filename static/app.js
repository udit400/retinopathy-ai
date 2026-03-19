'use strict';

const STORAGE_KEY = 'mediSightToken';
const API_BASE = window.location.origin;
const MIN_MOBILE_LENGTH = 7;
const OTP_COUNTDOWN_SECONDS = 300; // 5 minutes

const globalLoader = document.getElementById('globalLoader');
const globalLoaderText = document.getElementById('globalLoaderText');

function showGlobalLoader(message = 'Please wait…') {
    if (!globalLoader) return;
    globalLoaderText.textContent = message;
    globalLoader.classList.remove('hidden');
}

function hideGlobalLoader() {
    if (!globalLoader) return;
    globalLoader.classList.add('hidden');
}

const authSection    = document.getElementById('authSection');
const appSection     = document.getElementById('appSection');
const patientSection = document.getElementById('patientSection');
const userBadge      = document.getElementById('userBadge');
const userNameEl     = document.getElementById('userName');
const logoutBtn      = document.getElementById('logoutBtn');
const authError      = document.getElementById('authError');
const authRegisterHint     = document.getElementById('authRegisterHint');
const authRegisterHintText = document.getElementById('authRegisterHintText');
const paymentSuccess = document.getElementById('paymentSuccess');
const paymentError   = document.getElementById('paymentError');
const patientList    = document.getElementById('patientList');
const patientName    = document.getElementById('patientName');
const patientStatus  = document.getElementById('patientStatus');
const vitalsGrid     = document.getElementById('vitalsGrid');
const alertList      = document.getElementById('alertList');

let currentPatientId = null;
let currentFile      = null;
let isAnalyzing      = false;

const patients = [
    {
        id: 'p1',
        name: 'Evelyn Shaw',
        age: 71,
        condition: 'Type 2 Diabetes',
        vitals: {
            heartRate: 78,
            systolic: 132,
            diastolic: 82,
            spO2: 95,
            glucose: 116,
        },
        alerts: [
            { level: 'warning', message: 'Blood sugar trending high (T+1h).' },
            { level: 'info', message: 'Next telecheck scheduled in 2 days.' },
        ],
    },
    {
        id: 'p2',
        name: 'Jamal Rivera',
        age: 64,
        condition: 'Hypertension',
        vitals: {
            heartRate: 72,
            systolic: 142,
            diastolic: 88,
            spO2: 97,
            glucose: 104,
        },
        alerts: [
            { level: 'critical', message: 'BP spike detected (> 140/90).' },
        ],
    },
    {
        id: 'p3',
        name: 'Maya Chen',
        age: 59,
        condition: 'Diabetic Retinopathy (Stage 1)',
        vitals: {
            heartRate: 76,
            systolic: 128,
            diastolic: 80,
            spO2: 96,
            glucose: 109,
        },
        alerts: [
            { level: 'info', message: 'Scheduled retinal scan in 3 days.' },
        ],
    },
];

document.addEventListener('DOMContentLoaded', () => {
    init();

    // ── TOP TAB: Login / Register / Forgot ────────────────────
    const tabLogin    = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const tabForgot   = document.getElementById('tabForgot');

    const loginPanel    = document.getElementById('loginPanel');
    const registerPanel = document.getElementById('registerPanel');
    const forgotPanel   = document.getElementById('forgotPanel');

    function showAuthPanel(panel) {
        [loginPanel, registerPanel, forgotPanel].forEach(p => p && p.classList.add('hidden'));
        [tabLogin, tabRegister, tabForgot].forEach(t => t && t.classList.remove('active'));
        if (panel === 'login')    { loginPanel   && loginPanel.classList.remove('hidden');    tabLogin   && tabLogin.classList.add('active'); }
        if (panel === 'register') { registerPanel && registerPanel.classList.remove('hidden'); tabRegister && tabRegister.classList.add('active'); }
        if (panel === 'forgot')   { forgotPanel  && forgotPanel.classList.remove('hidden');   tabForgot  && tabForgot.classList.add('active'); }
        hideAuthError();
    }

    tabLogin    && tabLogin.addEventListener('click',    () => showAuthPanel('login'));
    tabRegister && tabRegister.addEventListener('click', () => showAuthPanel('register'));
    tabForgot   && tabForgot.addEventListener('click',   () => showAuthPanel('forgot'));

    // ── REGISTER: Doctor / Patient sub-toggle ─────────────────
    const tabDoctorReg   = document.getElementById('tabDoctorReg');
    const tabPatientReg  = document.getElementById('tabPatientReg');
    const doctorRegPanel = document.getElementById('doctorRegPanel');
    const patientRegPanel= document.getElementById('patientRegPanel');

    tabDoctorReg && tabDoctorReg.addEventListener('click', () => {
        doctorRegPanel  && doctorRegPanel.classList.remove('hidden');
        patientRegPanel && patientRegPanel.classList.add('hidden');
        tabDoctorReg.classList.add('active');
        tabPatientReg && tabPatientReg.classList.remove('active');
        hideAuthError();
    });

    tabPatientReg && tabPatientReg.addEventListener('click', () => {
        patientRegPanel && patientRegPanel.classList.remove('hidden');
        doctorRegPanel  && doctorRegPanel.classList.add('hidden');
        tabPatientReg.classList.add('active');
        tabDoctorReg && tabDoctorReg.classList.remove('active');
        hideAuthError();
    });

    // ── OTP buttons ───────────────────────────────────────────
    const sendOtpDrBtn     = document.getElementById('sendOtpDrBtn');
    const sendOtpPtBtn     = document.getElementById('sendOtpPtBtn');
    const sendOtpForgotBtn = document.getElementById('sendOtpForgotBtn');

    sendOtpDrBtn     && sendOtpDrBtn.addEventListener('click',     () => sendOtp('dr'));
    sendOtpPtBtn     && sendOtpPtBtn.addEventListener('click',     () => sendOtp('pt'));
    sendOtpForgotBtn && sendOtpForgotBtn.addEventListener('click', () => sendOtp('forgot'));

    // ── FORM submissions ──────────────────────────────────────
    const loginForm    = document.getElementById('loginForm');
    const doctorRegForm= document.getElementById('doctorRegForm');
    const patientRegForm=document.getElementById('patientRegForm');
    const forgotForm   = document.getElementById('forgotForm');

    loginForm     && loginForm.addEventListener('submit',    (e) => { e.preventDefault(); login(); });
    doctorRegForm && doctorRegForm.addEventListener('submit',(e) => { e.preventDefault(); registerDoctor(); });
    patientRegForm&& patientRegForm.addEventListener('submit',(e)=> { e.preventDefault(); registerPatient(); });
    forgotForm    && forgotForm.addEventListener('submit',   (e) => { e.preventDefault(); forgotPassword(); });

    // ── LOGOUT ────────────────────────────────────────────────
    logoutBtn && logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await logout();
    });
});

async function init() {
    if (patientList) renderPatientList();
    const token = getToken();
    await checkAPIStatus();

    if (token) {
        try {
            const user = await fetchMe();
            showApp(user);
        } catch (err) {
            clearToken();
            showAuth();
        }
    } else {
        showAuth();
    }
}

function renderPatientList() {
    patientList.innerHTML = '';
    patients.forEach((patient) => {
        const li = document.createElement('li');
        li.className = 'patient-item';
        li.dataset.id = patient.id;
        li.innerHTML = `
            <div class="patient-name">${patient.name}</div>
            <div class="patient-sub">${patient.condition}</div>
        `;
        li.addEventListener('click', () => selectPatient(patient.id));
        patientList.appendChild(li);
    });

    if (!currentPatientId && patients.length) {
        selectPatient(patients[0].id);
    }
}

function selectPatient(id) {
    currentPatientId = id;
    const patient = patients.find((p) => p.id === id);
    if (!patient) return;

    document.querySelectorAll('.patient-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.id === id);
    });

    patientName.textContent = `${patient.name} (age ${patient.age})`;
    patientStatus.textContent = `${patient.condition} • Last updated just now`;
    renderVitals(patient.vitals);
    renderAlerts(patient.alerts);
}

function renderVitals(vitals) {
    vitalsGrid.innerHTML = '';
    const cards = [
        { label: 'Heart Rate', value: `${vitals.heartRate} bpm`, icon: 'fas fa-heartbeat' },
        { label: 'Blood Pressure', value: `${vitals.systolic}/${vitals.diastolic} mmHg`, icon: 'fas fa-tachometer-alt' },
        { label: 'SpO₂', value: `${vitals.spO2}%`, icon: 'fas fa-lungs' },
        { label: 'Glucose', value: `${vitals.glucose} mg/dL`, icon: 'fas fa-prescription-bottle-alt' },
    ];
    cards.forEach((card) => {
        const div = document.createElement('div');
        div.className = 'vital-card';
        div.innerHTML = `
            <div class="vital-icon"><i class="${card.icon}"></i></div>
            <div>
                <div class="vital-value">${card.value}</div>
                <div class="vital-label">${card.label}</div>
            </div>
        `;
        vitalsGrid.appendChild(div);
    });
}

function renderAlerts(alerts) {
    alertList.innerHTML = '';
    if (!alerts || alerts.length === 0) {
        alertList.innerHTML = '<li class="alert-item">No active alerts.</li>';
        return;
    }
    alerts.forEach((alert) => {
        const li = document.createElement('li');
        li.className = `alert-item alert-${alert.level}`;
        li.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${alert.message}`;
        alertList.appendChild(li);
    });
}

function refreshVitals() {
    const patient = patients.find((p) => p.id === currentPatientId);
    if (!patient) return;
    // simulate small variation
    patient.vitals.heartRate += Number((Math.random() * 4 - 2).toFixed(0));
    patient.vitals.glucose += Number((Math.random() * 5 - 2.5).toFixed(0));
    renderVitals(patient.vitals);
    showGlobalLoader('Refreshing vitals…');
    setTimeout(() => hideGlobalLoader(), 600);
}

function getToken() {
    return localStorage.getItem(STORAGE_KEY);
}

function setToken(token) {
    localStorage.setItem(STORAGE_KEY, token);
}

function clearToken() {
    localStorage.removeItem(STORAGE_KEY);
}

function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function showAuth() {
    if (authSection)    authSection.classList.remove('hidden');
    if (appSection)     appSection.classList.add('hidden');
    if (patientSection) patientSection.classList.add('hidden');
    if (userBadge)      userBadge.classList.add('hidden');
    if (logoutBtn)      logoutBtn.classList.add('hidden');
}

function showApp(user) {
    if (authSection) authSection.classList.add('hidden');
    const role = user && user.role;

    // Hide both dashboards first, then show the right one
    if (appSection)     appSection.classList.add('hidden');
    if (patientSection) patientSection.classList.add('hidden');

    if (role === 'doctor') {
        if (appSection) appSection.classList.remove('hidden');
        if (patientList) renderPatientList();
    } else {
        // patient (or unknown role) → patient dashboard
        if (patientSection) {
            patientSection.classList.remove('hidden');
            renderPatientDashboard(user);
        }
    }

    if (userBadge) {
        if (user) {
            userBadge.classList.remove('hidden');
            const roleBadge = `<span class="role-badge">${role || 'user'}</span>`;
            if (userNameEl) userNameEl.innerHTML = (user.name || user.full_name || 'Member') + roleBadge;
        } else {
            userBadge.classList.add('hidden');
        }
    }
    if (logoutBtn) {
        if (user) logoutBtn.classList.remove('hidden');
        else      logoutBtn.classList.add('hidden');
    }
}

function renderPatientDashboard(user) {
    const grid = document.getElementById('patientInfoGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const items = [
        { label: 'Patient ID',   value: user.user_id  || '—' },
        { label: 'Name',         value: user.name || user.full_name || '—' },
        { label: 'Mobile',       value: user.mobile   || '—' },
        { label: 'Account Type', value: 'Patient' },
    ];
    items.forEach(({ label, value }) => {
        const div = document.createElement('div');
        div.className = 'patient-info-item';
        div.innerHTML = `<div class="pi-label">${label}</div><div class="pi-value">${value}</div>`;
        grid.appendChild(div);
    });
}

async function checkAPIStatus() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        const data = await response.json();
        const online = data.status === 'healthy' && data.model_loaded;
        updateStatusBadge(online ? 'Model ready' : 'Model loading', online);
    } catch (err) {
        updateStatusBadge('API offline', false);
    }
}

function updateStatusBadge(text, online) {
    const statusDot  = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    if (statusDot) {
        statusDot.style.background  = online ? '#34d399' : '#f87171';
        statusDot.style.boxShadow   = online ? '0 0 0 4px rgba(52,211,153,.25)' : '0 0 0 4px rgba(248,113,113,.25)';
    }
    if (statusText) statusText.textContent = text;
}

// ── OTP helper ────────────────────────────────────────────────

async function sendOtp(context) {
    const mobileId  = context === 'dr' ? 'drMobile' : context === 'pt' ? 'ptMobile' : 'forgotMobile';
    const otpGroupId= context === 'dr' ? 'drOtpGroup' : context === 'pt' ? 'ptOtpGroup' : 'forgotOtpGroup';
    const hintId    = context === 'dr' ? 'drOtpHint' : context === 'pt' ? 'ptOtpHint' : 'forgotOtpHint';
    const btnId     = context === 'dr' ? 'sendOtpDrBtn' : context === 'pt' ? 'sendOtpPtBtn' : 'sendOtpForgotBtn';

    const mobile  = (document.getElementById(mobileId) || {}).value || '';
    if (!mobile || mobile.trim().length < MIN_MOBILE_LENGTH) {
        showAuthError('Please enter a valid mobile number before sending OTP.');
        return;
    }

    const btn = document.getElementById(btnId);
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    hideAuthError();

    try {
        const result = await apiFetch('/send-otp', {
            method: 'POST',
            body: JSON.stringify({ mobile: mobile.trim() }),
        });

        const otpGroup = document.getElementById(otpGroupId);
        if (otpGroup) otpGroup.classList.remove('hidden');

        const hint = document.getElementById(hintId);
        if (hint) {
            // otp_demo is returned for development/demo purposes
            hint.textContent = result.otp_demo
                ? `OTP sent (demo: ${result.otp_demo})`
                : 'OTP sent to your mobile number.';
        }

        // Start countdown on button
        if (btn) {
            btn.textContent = `Resend (${Math.floor(OTP_COUNTDOWN_SECONDS / 60)}:00)`;
            let remaining = OTP_COUNTDOWN_SECONDS;
            const countdown = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(countdown);
                    btn.disabled = false;
                    btn.textContent = 'Resend OTP';
                } else {
                    const m = String(Math.floor(remaining / 60)).padStart(1, '0');
                    const s = String(remaining % 60).padStart(2, '0');
                    btn.textContent = `Resend (${m}:${s})`;
                }
            }, 1000);
        }
    } catch (err) {
        showAuthError(err.message || 'Failed to send OTP.');
        if (btn) { btn.disabled = false; btn.textContent = 'Send OTP'; }
    }
}

// ── Login ──────────────────────────────────────────────────────

async function login() {
    hideAuthError();

    const userId   = (document.getElementById('loginId')       || {}).value || '';
    const name     = (document.getElementById('loginName')     || {}).value || '';
    const password = (document.getElementById('loginPassword') || {}).value || '';

    if (!userId || !name || !password) {
        showAuthError('Please fill in all fields: ID, Name, and Password.');
        return;
    }

    showGlobalLoader('Signing in…');
    try {
        const result = await apiFetch('/login', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId.trim(), name: name.trim(), password }),
        });
        setToken(result.access_token);
        const user = await fetchMe();
        showApp(user);
    } catch (err) {
        showAuthError(err.message || 'Login failed.');
    } finally {
        hideGlobalLoader();
    }
}

// ── Register ───────────────────────────────────────────────────

async function registerDoctor() {
    hideAuthError();

    const name     = (document.getElementById('drName')     || {}).value || '';
    const dept     = (document.getElementById('drDept')     || {}).value || '';
    const mobile   = (document.getElementById('drMobile')   || {}).value || '';
    const otp      = (document.getElementById('drOtp')      || {}).value || '';
    const password = (document.getElementById('drPassword') || {}).value || '';

    if (!name || !dept || !mobile || !otp || !password) {
        showAuthError('Please fill in all fields and verify your OTP.');
        return;
    }

    showGlobalLoader('Creating doctor account…');
    try {
        const result = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ role: 'doctor', name: name.trim(), department: dept.trim(), mobile: mobile.trim(), otp: otp.trim(), password }),
        });
        if (authRegisterHint) authRegisterHint.classList.remove('hidden');
        if (authRegisterHintText) authRegisterHintText.textContent = result.message || `Your Doctor ID is: ${result.user_id}`;
        setToken(result.access_token);
        const user = await fetchMe();
        showApp(user);
    } catch (err) {
        showAuthError(err.message || 'Registration failed.');
    } finally {
        hideGlobalLoader();
    }
}

async function registerPatient() {
    hideAuthError();

    const name     = (document.getElementById('ptName')     || {}).value || '';
    const mobile   = (document.getElementById('ptMobile')   || {}).value || '';
    const otp      = (document.getElementById('ptOtp')      || {}).value || '';
    const password = (document.getElementById('ptPassword') || {}).value || '';

    if (!name || !mobile || !otp || !password) {
        showAuthError('Please fill in all fields and verify your OTP.');
        return;
    }

    showGlobalLoader('Creating patient account…');
    try {
        const result = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ role: 'patient', name: name.trim(), mobile: mobile.trim(), otp: otp.trim(), password }),
        });
        if (authRegisterHint) authRegisterHint.classList.remove('hidden');
        if (authRegisterHintText) authRegisterHintText.textContent = result.message || `Your Patient ID is: ${result.user_id}`;
        setToken(result.access_token);
        const user = await fetchMe();
        showApp(user);
    } catch (err) {
        showAuthError(err.message || 'Registration failed.');
    } finally {
        hideGlobalLoader();
    }
}

// ── Forgot Password ────────────────────────────────────────────

async function forgotPassword() {
    hideAuthError();

    const mobile   = (document.getElementById('forgotMobile') || {}).value || '';
    const otp      = (document.getElementById('forgotOtp')    || {}).value || '';
    const newPwd   = (document.getElementById('forgotNewPwd') || {}).value || '';

    if (!mobile || !otp || !newPwd) {
        showAuthError('Please fill in all fields and verify your OTP.');
        return;
    }

    showGlobalLoader('Resetting password…');
    try {
        const result = await apiFetch('/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ mobile: mobile.trim(), otp: otp.trim(), new_password: newPwd }),
        });
        if (authRegisterHint) authRegisterHint.classList.remove('hidden');
        if (authRegisterHintText) authRegisterHintText.textContent = result.message || 'Password reset successful!';
        // Switch to login tab
        const tabLogin = document.getElementById('tabLogin');
        if (tabLogin) tabLogin.click();
    } catch (err) {
        showAuthError(err.message || 'Password reset failed.');
    } finally {
        hideGlobalLoader();
    }
}

async function logout() {
    showGlobalLoader('Signing out…');
    try {
        await apiFetch('/logout', { method: 'POST' });
    } catch (_) {
        // ignore
    } finally {
        hideGlobalLoader();
    }
    clearToken();
    showAuth();
}

async function fetchMe() {
    return apiFetch('/me', { method: 'GET' });
}

function showAuthError(message) {
    if (!authError) return;
    authError.style.display = 'flex';
    authError.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
}

function hideAuthError() {
    if (!authError) return;
    authError.style.display = 'none';
    authError.innerHTML = '';
}

async function apiFetch(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options.headers || {}),
    };

    const response = await fetch(url, { ...options, headers });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.detail || data.message || 'Request failed');
    }

    return data;
}

function setupEventListeners() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    uploadZone.addEventListener('click', () => fileInput.click());
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showError('Please select a valid image file.');
        return;
    }

    currentFile = file;
    showImagePreview(file);
    analyzeImage();
}

function showImagePreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const previewImg = document.getElementById('previewImg');
        const imagePreview = document.getElementById('imagePreview');
        previewImg.src = e.target.result;
        imagePreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

async function analyzeImage() {
    if (!currentFile || isAnalyzing) return;
    isAnalyzing = true;
    showLoading();
    showGlobalLoader('Analyzing image…');

    try {
        const formData = new FormData();
        formData.append('file', currentFile);
        const response = await fetch(`${API_BASE}/predict`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || 'Analysis failed');
        }

        showResults(result);
    } catch (err) {
        showError(err.message || 'Network error. Please check your connection.');
    } finally {
        isAnalyzing = false;
        hideGlobalLoader();
    }
}

function showLoading() {
    const resultsContent = document.getElementById('resultsContent');
    resultsContent.innerHTML = `
        <div class="loading">
            <i class="fas fa-spinner"></i>
            <p style="color: #0f172a; font-size: 1.1rem; margin-top: 10px;">
                Analyzing retinal image...
            </p>
            <p style="color: rgba(15, 23, 42, 0.65); font-size: 0.9rem; margin-top: 8px;">
                Powered by ONNX and MediSight AI pipeline.
            </p>
        </div>
    `;
}

function showResults(result) {
    const resultsContent = document.getElementById('resultsContent');

    resultsContent.innerHTML = `
        <div class="prediction-card">
            <div class="prediction-class">
                <i class="fas fa-diagnoses"></i> ${result.predicted_class_name}
            </div>
            <div class="confidence">
                Confidence: ${result.confidence}%
            </div>
        </div>

        <div class="info-card">
            <h4><i class="fas fa-info-circle"></i> Severity Assessment</h4>
            <p>${result.severity_level}</p>
        </div>

        <div class="info-card recommendations">
            <h4><i class="fas fa-notes-medical"></i> Medical Recommendations</h4>
            <ul>
                ${result.recommendations.map((rec) => `<li>${rec}</li>`).join('')}
            </ul>
        </div>

        <div class="probability-bars">
            <h4 style="color: #0f172a; margin-bottom: 15px;">
                <i class="fas fa-chart-bar"></i> Probability Dashboard
            </h4>
            ${Object.entries(result.all_probabilities)
                .sort((a, b) => b[1] - a[1])
                .map(
                    ([name, prob]) => `
                        <div class="probability-item">
                            <span class="probability-label">${name}</span>
                            <div class="probability-bar">
                                <div class="probability-fill" style="width: ${prob}%"></div>
                            </div>
                            <span class="probability-value">${prob}%</span>
                        </div>
                    `
                )
                .join('')}
        </div>
    `;
}

function showError(message) {
    const resultsContent = document.getElementById('resultsContent');
    resultsContent.innerHTML = `
        <div class="message message--error">
            <i class="fas fa-exclamation-triangle"></i>
            ${message}
        </div>
    `;
}

setInterval(checkAPIStatus, 30000);
setupEventListeners();

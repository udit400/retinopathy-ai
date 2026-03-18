'use strict';

const STORAGE_KEY = 'mediSightToken';
const API_BASE = window.location.origin;

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

const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const dashboardSection = document.getElementById('dashboardSection') || appSection;
const userBadge = document.getElementById('userBadge');
const userNameEl = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const authError = document.getElementById('authError');
const authHint = document.getElementById('authHint');
const authRegisterHint = document.getElementById('authRegisterHint');
const paymentSuccess = document.getElementById('paymentSuccess');
const paymentError = document.getElementById('paymentError');
const patientList = document.getElementById('patientList');
const patientName = document.getElementById('patientName');
const patientStatus = document.getElementById('patientStatus');
const vitalsGrid = document.getElementById('vitalsGrid');
const alertList = document.getElementById('alertList');

let currentPatientId = null;
let currentFile = null;
let isAnalyzing = false;
let authMode = 'login';

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

    // Single-form auth UI: login/register toggle
    const authForm = document.getElementById('authForm');
    const showLoginBtn = document.getElementById('showLogin');
    const showRegisterBtn = document.getElementById('showRegister');
    const fullNameGroup = document.getElementById('fullNameGroup');

    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            authMode = 'login';
            showLoginBtn.classList.add('active');
            if (showRegisterBtn) showRegisterBtn.classList.remove('active');
            if (fullNameGroup) fullNameGroup.classList.add('hidden');
        });
    }

    if (showRegisterBtn) {
        showRegisterBtn.addEventListener('click', () => {
            authMode = 'register';
            showRegisterBtn.classList.add('active');
            if (showLoginBtn) showLoginBtn.classList.remove('active');
            if (fullNameGroup) fullNameGroup.classList.remove('hidden');
        });
    }

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (authMode === 'login') {
                await login();
            } else {
                await registerFromAuthForm();
            }
        });
    }

    // Wire logout button on the main page
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await logout();
        });
    }
});

async function init() {
    setAuthTab('login');
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
    if (authSection) authSection.classList.remove('hidden');
    if (dashboardSection) dashboardSection.classList.add('hidden');
    if (userBadge) userBadge.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
}

function showApp(user) {
    if (authSection) authSection.classList.add('hidden');
    if (dashboardSection) dashboardSection.classList.remove('hidden');
    if (userBadge) {
        if (user) userBadge.classList.remove('hidden');
        else userBadge.classList.add('hidden');
    }
    if (logoutBtn) {
        if (user) logoutBtn.classList.remove('hidden');
        else logoutBtn.classList.add('hidden');
    }
    if (userNameEl && user) userNameEl.textContent = user.full_name || user.username || 'Member';
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
    const statusDot = document.querySelector('.badge .dot');
    const statusText = document.getElementById('statusText');

    if (statusDot) {
        statusDot.style.background = online ? '#34d399' : '#f87171';
        statusDot.style.boxShadow = online ? '0 0 0 4px rgba(52, 211, 153, 0.25)' : '0 0 0 4px rgba(248, 113, 113, 0.25)';
    }

    if (statusText) {
        statusText.textContent = text;
    }
}

function setAuthTab(tab) {
    const loginFormEl = document.getElementById('loginForm');
    const registerFormEl = document.getElementById('registerForm');
    const tabLoginEl = document.getElementById('tabLogin');
    const tabSignupEl = document.getElementById('tabSignup');

    if (loginFormEl) loginFormEl.classList.toggle('hidden', tab !== 'login');
    if (registerFormEl) registerFormEl.classList.toggle('hidden', tab !== 'register');
    if (tabLoginEl) tabLoginEl.classList.toggle('btn-primary', tab === 'login');
    if (tabLoginEl) tabLoginEl.classList.toggle('btn-ghost', tab !== 'login');
    if (tabSignupEl) tabSignupEl.classList.toggle('btn-primary', tab === 'register');
    if (tabSignupEl) tabSignupEl.classList.toggle('btn-ghost', tab !== 'register');
    if (authError) authError.style.display = 'none';
    if (paymentError) paymentError.style.display = 'none';
    if (paymentSuccess) paymentSuccess.style.display = 'none';
}

async function login() {
    if (authError) authError.style.display = 'none';
    if (authHint) authHint.style.display = 'none';

    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value.trim();

    if (!username || !password) {
        showAuthError('Please enter both username and password.');
        return;
    }

    showGlobalLoader('Signing in…');
    try {
        const result = await apiFetch('/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
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

async function registerFromAuthForm() {
    if (authError) authError.style.display = 'none';
    if (authRegisterHint) authRegisterHint.style.display = 'none';

    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const fullNameEl = document.getElementById('authFullName');
    const fullName = fullNameEl ? fullNameEl.value.trim() : '';

    if (!username || !password) {
        showAuthError('Username and password are required.');
        return;
    }

    showGlobalLoader('Creating account…');
    try {
        const result = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ username, full_name: fullName, password }),
        });

        setToken(result.access_token);
        const user = await fetchMe();
        showApp(user);
    } catch (err) {
        showAuthError(err.message || 'Registration failed.');
    } finally {
        hideGlobalLoader();
    }
}

async function register() {
    if (authError) authError.style.display = 'none';
    if (authHint) authHint.style.display = 'none';
    if (authRegisterHint) authRegisterHint.style.display = 'none';

    const usernameEl = document.getElementById('registerUsername');
    const fullNameEl = document.getElementById('registerFullName');
    const passwordEl = document.getElementById('registerPassword');
    const username = usernameEl ? usernameEl.value.trim() : '';
    const fullName = fullNameEl ? fullNameEl.value.trim() : '';
    const password = passwordEl ? passwordEl.value.trim() : '';

    if (!username || !password) {
        showAuthError('Username and password are required.');
        return;
    }

    showGlobalLoader('Creating account…');
    try {
        const result = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ username, full_name: fullName, password }),
        });

        setToken(result.access_token);
        if (authRegisterHint) authRegisterHint.style.display = 'flex';
        const user = await fetchMe();
        showApp(user);
    } catch (err) {
        showAuthError(err.message || 'Registration failed.');
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

async function pay() {
    paymentError.style.display = 'none';
    paymentSuccess.style.display = 'none';

    const planSelect = document.getElementById('planSelect');
    const plan = planSelect.value;
    const amount = parseFloat(planSelect.selectedOptions[0].dataset.amount || 0);

    showGlobalLoader('Processing payment…');
    try {
        const result = await apiFetch('/payment', {
            method: 'POST',
            body: JSON.stringify({ plan, amount, currency: 'USD' }),
        });

        paymentSuccess.style.display = 'flex';
        paymentSuccess.innerHTML = `<i class="fas fa-check-circle"></i> Payment confirmed (ID: ${result.transaction_id})`;
    } catch (err) {
        paymentError.style.display = 'flex';
        paymentError.textContent = err.message || 'Payment failed. Please try again.';
    } finally {
        hideGlobalLoader();
    }
}

function showAuthError(message) {
    authError.style.display = 'flex';
    authError.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
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

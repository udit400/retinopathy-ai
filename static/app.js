'use strict';

const STORAGE_KEY = 'mediSightToken';
const API_BASE = window.location.origin;
const MIN_MOBILE_LENGTH = 7;
const OTP_COUNTDOWN_SECONDS = 300;

const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const patientSection = document.getElementById('patientSection');
const logoutBtn = document.getElementById('logoutBtn');
const authError = document.getElementById('authError');
const authRegisterHint = document.getElementById('authRegisterHint');
const authRegisterHintText = document.getElementById('authRegisterHintText');
const doctorDashboardRoot = document.getElementById('doctorDashboardRoot');
const patientDashboardRoot = document.getElementById('patientDashboardRoot');

let currentUser = null;
let patientDashboardData = null;
let doctorDashboardData = null;
let doctorDirectory = [];
let patientDoctorSearch = '';
let selectedPatientDoctorId = '';
let selectedSubmissionId = '';
let selectedDoctorChatId = '';
let doctorProfileOpen = false;

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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
    const amount = Number(value || 0);
    return `₹${amount.toFixed(2)}`;
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString();
}

function toListMarkup(items) {
    if (!items || !items.length) return '<div class="empty-state">No items yet.</div>';
    return `<ul class="stack-sm">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function getSelectedDoctorName() {
    return (doctorDirectory.find((doctor) => doctor.user_id === selectedPatientDoctorId) || {}).name || 'None';
}

function getDefaultTreatments(aiResult) {
    return aiResult && aiResult.predicted_class_name === 'DR'
        ? ['Blood sugar optimization plan', 'Retina specialist treatment review']
        : ['Continue regular retinal monitoring'];
}

function getDefaultSuggestions(aiResult) {
    return (aiResult && aiResult.recommendations) || ['Follow diabetic eye care advice'];
}

function avatarMarkup(user, interactive = false) {
    const text = escapeHtml(user?.avatar_text || (user?.name || '?').slice(0, 2).toUpperCase());
    if (interactive) {
        return `<button type="button" class="avatar-button" id="doctorAvatarButton" aria-label="Open doctor profile">${text}</button>`;
    }
    return `<div class="avatar">${text}</div>`;
}

function showAuth() {
    if (authSection) authSection.classList.remove('hidden');
    if (appSection) appSection.classList.add('hidden');
    if (patientSection) patientSection.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
}

async function showApp(user) {
    currentUser = user;
    if (authSection) authSection.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (user.role === 'doctor') {
        if (appSection) appSection.classList.remove('hidden');
        if (patientSection) patientSection.classList.add('hidden');
        await loadDoctorDashboard();
    } else {
        if (patientSection) patientSection.classList.remove('hidden');
        if (appSection) appSection.classList.add('hidden');
        await loadPatientDashboard();
    }
}

function showAuthError(message) {
    if (!authError) return;
    authError.style.display = 'flex';
    authError.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${escapeHtml(message)}`;
}

function hideAuthError() {
    if (!authError) return;
    authError.style.display = 'none';
    authError.innerHTML = '';
}

async function apiFetch(path, options = {}) {
    const headers = {
        ...authHeaders(),
        ...(options.headers || {}),
    };
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new Error(data.detail || data.message || 'Request failed');
    }
    return data;
}

async function fetchMe() {
    return apiFetch('/me', { method: 'GET' });
}

function updateStatusBadge(text, online) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    if (statusDot) {
        statusDot.style.background = online ? '#34d399' : '#f87171';
        statusDot.style.boxShadow = online ? '0 0 0 4px rgba(52,211,153,.25)' : '0 0 0 4px rgba(248,113,113,.25)';
    }
    if (statusText) statusText.textContent = text;
}

async function checkAPIStatus() {
    try {
        const result = await apiFetch('/health', { method: 'GET', headers: {} });
        updateStatusBadge(result.model_loaded ? 'Model ready' : 'Model loading', !!result.model_loaded);
    } catch (_) {
        updateStatusBadge('API offline', false);
    }
}

async function sendOtp(context) {
    const mobileId = context === 'dr' ? 'drMobile' : context === 'pt' ? 'ptMobile' : 'forgotMobile';
    const otpGroupId = context === 'dr' ? 'drOtpGroup' : context === 'pt' ? 'ptOtpGroup' : 'forgotOtpGroup';
    const hintId = context === 'dr' ? 'drOtpHint' : context === 'pt' ? 'ptOtpHint' : 'forgotOtpHint';
    const btnId = context === 'dr' ? 'sendOtpDrBtn' : context === 'pt' ? 'sendOtpPtBtn' : 'sendOtpForgotBtn';
    const mobile = (document.getElementById(mobileId)?.value || '').trim();
    if (mobile.length < MIN_MOBILE_LENGTH) {
        showAuthError('Please enter a valid mobile number before sending OTP.');
        return;
    }

    const btn = document.getElementById(btnId);
    hideAuthError();
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }

    try {
        const result = await apiFetch('/send-otp', {
            method: 'POST',
            body: JSON.stringify({ mobile }),
        });
        document.getElementById(otpGroupId)?.classList.remove('hidden');
        const hint = document.getElementById(hintId);
        if (hint) {
            hint.textContent = result.otp_demo ? `OTP sent (demo: ${result.otp_demo})` : 'OTP sent.';
        }
        if (btn) {
            let remaining = OTP_COUNTDOWN_SECONDS;
            btn.textContent = `Resend (${Math.floor(remaining / 60)}:00)`;
            const timer = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(timer);
                    btn.disabled = false;
                    btn.textContent = 'Resend OTP';
                    return;
                }
                const mins = Math.floor(remaining / 60);
                const secs = String(remaining % 60).padStart(2, '0');
                btn.textContent = `Resend (${mins}:${secs})`;
            }, 1000);
        }
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send OTP';
        }
        showAuthError(error.message || 'Failed to send OTP.');
    }
}

async function login() {
    hideAuthError();
    const user_id = (document.getElementById('loginId')?.value || '').trim();
    const name = (document.getElementById('loginName')?.value || '').trim();
    const password = document.getElementById('loginPassword')?.value || '';
    if (!user_id || !name || !password) {
        showAuthError('Please fill in all fields: ID, Name, and Password.');
        return;
    }
    try {
        const result = await apiFetch('/login', {
            method: 'POST',
            body: JSON.stringify({ user_id, name, password }),
        });
        setToken(result.access_token);
        const user = await fetchMe();
        await showApp(user);
    } catch (error) {
        showAuthError(error.message || 'Login failed.');
    }
}

async function registerDoctor() {
    hideAuthError();
    const payload = {
        role: 'doctor',
        name: (document.getElementById('drName')?.value || '').trim(),
        department: (document.getElementById('drDept')?.value || '').trim(),
        mobile: (document.getElementById('drMobile')?.value || '').trim(),
        otp: (document.getElementById('drOtp')?.value || '').trim(),
        password: document.getElementById('drPassword')?.value || '',
    };
    if (!payload.name || !payload.department || !payload.mobile || !payload.otp || !payload.password) {
        showAuthError('Please fill in all fields and verify your OTP.');
        return;
    }
    try {
        const result = await apiFetch('/register', { method: 'POST', body: JSON.stringify(payload) });
        setToken(result.access_token);
        if (authRegisterHint) authRegisterHint.classList.remove('hidden');
        if (authRegisterHintText) authRegisterHintText.textContent = result.message || `Doctor ID: ${result.user_id}`;
        await showApp(await fetchMe());
    } catch (error) {
        showAuthError(error.message || 'Registration failed.');
    }
}

async function registerPatient() {
    hideAuthError();
    const payload = {
        role: 'patient',
        name: (document.getElementById('ptName')?.value || '').trim(),
        mobile: (document.getElementById('ptMobile')?.value || '').trim(),
        otp: (document.getElementById('ptOtp')?.value || '').trim(),
        password: document.getElementById('ptPassword')?.value || '',
    };
    if (!payload.name || !payload.mobile || !payload.otp || !payload.password) {
        showAuthError('Please fill in all fields and verify your OTP.');
        return;
    }
    try {
        const result = await apiFetch('/register', { method: 'POST', body: JSON.stringify(payload) });
        setToken(result.access_token);
        if (authRegisterHint) authRegisterHint.classList.remove('hidden');
        if (authRegisterHintText) authRegisterHintText.textContent = result.message || `Patient ID: ${result.user_id}`;
        await showApp(await fetchMe());
    } catch (error) {
        showAuthError(error.message || 'Registration failed.');
    }
}

async function forgotPassword() {
    hideAuthError();
    const payload = {
        mobile: (document.getElementById('forgotMobile')?.value || '').trim(),
        otp: (document.getElementById('forgotOtp')?.value || '').trim(),
        new_password: document.getElementById('forgotNewPwd')?.value || '',
    };
    if (!payload.mobile || !payload.otp || !payload.new_password) {
        showAuthError('Please fill in all fields and verify your OTP.');
        return;
    }
    try {
        const result = await apiFetch('/forgot-password', { method: 'POST', body: JSON.stringify(payload) });
        if (authRegisterHint) authRegisterHint.classList.remove('hidden');
        if (authRegisterHintText) authRegisterHintText.textContent = result.message || 'Password reset successful.';
        document.getElementById('tabLogin')?.click();
    } catch (error) {
        showAuthError(error.message || 'Password reset failed.');
    }
}

async function logout() {
    try {
        await apiFetch('/logout', { method: 'POST' });
    } catch (_) {
        // ignore logout errors on expired sessions
    }
    clearToken();
    currentUser = null;
    patientDashboardData = null;
    doctorDashboardData = null;
    showAuth();
}

function setupAuthTabs() {
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const tabForgot = document.getElementById('tabForgot');
    const loginPanel = document.getElementById('loginPanel');
    const registerPanel = document.getElementById('registerPanel');
    const forgotPanel = document.getElementById('forgotPanel');

    function showPanel(name) {
        [loginPanel, registerPanel, forgotPanel].forEach((panel) => panel?.classList.add('hidden'));
        [tabLogin, tabRegister, tabForgot].forEach((tab) => tab?.classList.remove('active'));
        if (name === 'login') {
            loginPanel?.classList.remove('hidden');
            tabLogin?.classList.add('active');
        }
        if (name === 'register') {
            registerPanel?.classList.remove('hidden');
            tabRegister?.classList.add('active');
        }
        if (name === 'forgot') {
            forgotPanel?.classList.remove('hidden');
            tabForgot?.classList.add('active');
        }
        hideAuthError();
    }

    tabLogin?.addEventListener('click', () => showPanel('login'));
    tabRegister?.addEventListener('click', () => showPanel('register'));
    tabForgot?.addEventListener('click', () => showPanel('forgot'));

    const tabDoctorReg = document.getElementById('tabDoctorReg');
    const tabPatientReg = document.getElementById('tabPatientReg');
    const doctorRegPanel = document.getElementById('doctorRegPanel');
    const patientRegPanel = document.getElementById('patientRegPanel');

    tabDoctorReg?.addEventListener('click', () => {
        doctorRegPanel?.classList.remove('hidden');
        patientRegPanel?.classList.add('hidden');
        tabDoctorReg.classList.add('active');
        tabPatientReg?.classList.remove('active');
    });

    tabPatientReg?.addEventListener('click', () => {
        patientRegPanel?.classList.remove('hidden');
        doctorRegPanel?.classList.add('hidden');
        tabPatientReg.classList.add('active');
        tabDoctorReg?.classList.remove('active');
    });
}

async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function profileHeaderMarkup(title, user, extras = []) {
    return `
        <div class="profile-card">
            <div class="profile-head">
                <div class="profile-summary">
                    ${avatarMarkup(user, title === 'Doctor Dashboard')}
                    <div>
                        <h2>${escapeHtml(title)}</h2>
                        <p><strong>${escapeHtml(user.name || '')}</strong></p>
                        <div class="meta-list">
                            <span class="meta-pill"><i class="fas fa-id-card"></i> ID ${escapeHtml(user.user_id || '')}</span>
                            ${extras.join('')}
                        </div>
                    </div>
                </div>
            </div>
            ${title === 'Doctor Dashboard' ? `
                <div id="doctorProfilePanel" class="${doctorProfileOpen ? '' : 'hidden'}" style="margin-top:16px;">
                    <form id="doctorFeeForm" class="inline-form">
                        <label for="doctorFeeInput">Consultation fee</label>
                        <div class="row-between">
                            <input id="doctorFeeInput" type="number" min="1" step="0.01" value="${escapeHtml(user.fees || 1)}">
                            <button class="action-btn" type="submit">Save fee</button>
                        </div>
                        <p class="muted tiny">Default doctor fee is ₹1.00 and can be changed here.</p>
                    </form>
                </div>` : ''}
        </div>
    `;
}

function renderPatientDashboard() {
    if (!patientDashboardRoot || !currentUser || !patientDashboardData) return;
    const patient = patientDashboardData.patient || currentUser;
    const reports = patientDashboardData.reports || [];
    const appointments = patientDashboardData.appointments || [];
    const importantReports = patientDashboardData.important_reports || [];
    const filteredDoctors = doctorDirectory.filter((doctor) => {
        const q = patientDoctorSearch.trim().toLowerCase();
        if (!q) return true;
        return [doctor.name, doctor.user_id, doctor.department].some((value) => String(value || '').toLowerCase().includes(q));
    });
    const selectedDoctorName = getSelectedDoctorName();

    patientDashboardRoot.innerHTML = `
        <div class="dashboard-topbar">
            ${profileHeaderMarkup('Patient Dashboard', patient, [
                `<span class="meta-pill"><i class="fas fa-phone"></i> ${escapeHtml(patient.mobile || '—')}</span>`
            ])}
            <div class="section-card">
                <div class="section-head">
                    <h3><i class="fas fa-user-doctor"></i> Doctors</h3>
                    <span class="muted tiny">Search before sending</span>
                </div>
                <div class="inline-form" style="margin-top:14px;">
                    <input id="patientDoctorSearch" type="text" placeholder="Search by doctor ID, name, or department" value="${escapeHtml(patientDoctorSearch)}">
                    <div class="list-stack" id="patientDoctorList">
                        ${filteredDoctors.map((doctor) => `
                            <button type="button" class="list-item-card ${selectedPatientDoctorId === doctor.user_id ? 'active' : ''}" data-doctor-select="${escapeHtml(doctor.user_id)}">
                                <div class="row-between">
                                    <div class="profile-summary">
                                        ${avatarMarkup(doctor)}
                                        <div style="text-align:left;">
                                            <strong>${escapeHtml(doctor.name)}</strong>
                                            <div class="muted tiny">ID ${escapeHtml(doctor.user_id)} • ${escapeHtml(doctor.department || 'General')}</div>
                                        </div>
                                    </div>
                                    <span class="chip">Fee ${escapeHtml(formatCurrency(doctor.fees))}</span>
                                </div>
                            </button>
                        `).join('') || '<div class="empty-state">No doctors matched your search.</div>'}
                    </div>
                </div>
            </div>
        </div>

        <div class="dashboard-grid">
            <div>
                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-paper-plane"></i> Send image and note to doctor</h3>
                        <span class="muted tiny">Doctor selection is required</span>
                    </div>
                    <form id="patientSubmissionForm" class="inline-form" style="margin-top:14px;">
                        <div class="muted tiny">Selected doctor: <strong>${escapeHtml(selectedDoctorName)}</strong></div>
                        <textarea id="patientNoteInput" rows="4" placeholder="Describe your current problem or note for the doctor"></textarea>
                        <input id="patientImageInput" type="file" accept="image/*">
                        <button class="action-btn" type="submit">Send to doctor</button>
                    </form>
                </div>

                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-inbox"></i> Reports, treatments and suggestions</h3>
                        <span class="muted tiny">Loaded automatically by patient ID and date</span>
                    </div>
                    <div class="list-stack" style="margin-top:14px;">
                        ${reports.map((report) => `
                            <div class="list-item-card">
                                <div class="row-between">
                                    <div>
                                        <strong>${escapeHtml(report.doctor_name)}</strong>
                                        <div class="muted tiny">${escapeHtml(formatDateTime(report.sent_at))}</div>
                                    </div>
                                    <div class="chip-row">
                                        <span class="severity-pill ${escapeHtml(report.severity || 'normal')}">${escapeHtml((report.severity || 'normal').toUpperCase())}</span>
                                        <button type="button" class="ghost-btn" data-important-toggle="${escapeHtml(report.report_id)}">${report.important ? 'Marked important' : 'Mark important'}</button>
                                    </div>
                                </div>
                                <p style="margin-top:12px;"><strong>Report summary:</strong> ${escapeHtml(report.report_summary || '—')}</p>
                                <p style="margin-top:8px;"><strong>Note:</strong> ${escapeHtml(report.note || '—')}</p>
                                <div class="two-col" style="margin-top:12px;">
                                    <div>
                                        <strong>Treatments</strong>
                                        ${toListMarkup(report.treatments)}
                                    </div>
                                    <div>
                                        <strong>Suggestions</strong>
                                        ${toListMarkup(report.suggestions)}
                                    </div>
                                </div>
                                <div class="meta-list" style="margin-top:12px;">
                                    <span class="meta-pill"><i class="fas fa-calendar"></i> Appointment ${escapeHtml(formatDate(report.appointment?.appointment_date))}</span>
                                    <span class="meta-pill"><i class="fas fa-stethoscope"></i> Fee ${escapeHtml(formatCurrency(report.doctor_fee || 1))}</span>
                                </div>
                            </div>
                        `).join('') || '<div class="empty-state">No reports received yet.</div>'}
                    </div>
                </div>
            </div>

            <div>
                <div class="section-card">
                    <details open>
                        <summary><i class="fas fa-bell"></i> Important messages (${importantReports.length})</summary>
                        <div class="list-stack" style="margin-top:14px;">
                            ${importantReports.map((report) => `
                                <div class="list-item-card">
                                    <strong>${escapeHtml(report.doctor_name)}</strong>
                                    <div class="muted tiny">${escapeHtml(formatDateTime(report.sent_at))}</div>
                                    <p style="margin-top:8px;">${escapeHtml(report.report_summary || report.note || 'Important doctor update')}</p>
                                </div>
                            `).join('') || '<div class="empty-state">No important messages yet.</div>'}
                        </div>
                    </details>
                </div>

                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-calendar-check"></i> Appointments</h3>
                        <span class="muted tiny">Date-wise updates</span>
                    </div>
                    <div class="list-stack" style="margin-top:14px;">
                        ${appointments.map((appointment) => `
                            <div class="list-item-card">
                                <div class="row-between">
                                    <strong>${escapeHtml(formatDate(appointment.appointment_date))}</strong>
                                    <span class="severity-pill ${escapeHtml(appointment.appointment_type || 'normal')}">${escapeHtml((appointment.appointment_type || 'normal').toUpperCase())}</span>
                                </div>
                                <div class="muted tiny" style="margin-top:8px;">Doctor ${escapeHtml(appointment.doctor_name)} • Slot ${escapeHtml(appointment.slot_number || 0)}</div>
                                <p style="margin-top:8px;">${escapeHtml(appointment.summary || '')}</p>
                            </div>
                        `).join('') || '<div class="empty-state">No appointments booked yet.</div>'}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('patientDoctorSearch')?.addEventListener('input', (event) => {
        patientDoctorSearch = event.target.value;
        renderPatientDashboard();
    });
    patientDashboardRoot.querySelectorAll('[data-doctor-select]').forEach((button) => {
        button.addEventListener('click', () => {
            selectedPatientDoctorId = button.getAttribute('data-doctor-select') || '';
            renderPatientDashboard();
        });
    });
    document.getElementById('patientSubmissionForm')?.addEventListener('submit', submitPatientSubmission);
    patientDashboardRoot.querySelectorAll('[data-important-toggle]').forEach((button) => {
        button.addEventListener('click', async () => {
            const reportId = button.getAttribute('data-important-toggle');
            const report = reports.find((item) => item.report_id === reportId);
            if (!report) return;
            await apiFetch(`/patient/reports/${reportId}/importance`, {
                method: 'POST',
                body: JSON.stringify({ report_id: reportId, important: !report.important }),
            });
            await loadPatientDashboard();
        });
    });
}

function groupAppointments(appointments) {
    return appointments.reduce((groups, appointment) => {
        const key = appointment.appointment_date || 'Undated';
        groups[key] = groups[key] || [];
        groups[key].push(appointment);
        return groups;
    }, {});
}

function renderDoctorDashboard() {
    if (!doctorDashboardRoot || !currentUser || !doctorDashboardData) return;
    const doctor = doctorDashboardData.doctor || currentUser;
    const patientMessages = doctorDashboardData.patient_messages || [];
    const doctorChats = doctorDashboardData.doctor_chats || [];
    const appointments = doctorDashboardData.appointments || [];
    const selectedSubmission = patientMessages.find((item) => item.submission_id === selectedSubmissionId) || patientMessages[0] || null;
    const aiResult = selectedSubmission?.ai_result || null;
    const defaultTreatments = getDefaultTreatments(aiResult);
    const defaultSuggestions = getDefaultSuggestions(aiResult);
    const activeChatId = selectedDoctorChatId || doctorChats[0]?.doctor?.user_id || '';
    selectedDoctorChatId = activeChatId;
    const activeChat = doctorChats.find((chat) => chat.doctor.user_id === activeChatId) || null;
    const groupedAppointments = groupAppointments(appointments);

    doctorDashboardRoot.innerHTML = `
        <div class="dashboard-topbar">
            ${profileHeaderMarkup('Doctor Dashboard', doctor, [
                `<span class="meta-pill"><i class="fas fa-money-bill-wave"></i> Fee ${escapeHtml(formatCurrency(doctor.fees || 1))}</span>`,
                `<span class="meta-pill"><i class="fas fa-building"></i> ${escapeHtml(doctor.department || 'General')}</span>`
            ])}
            <div class="section-card">
                <div class="section-head">
                    <h3><i class="fas fa-user-doctor"></i> Doctor tab</h3>
                    <span class="muted tiny">Image, ID, name and fee</span>
                </div>
                <div class="list-stack" style="margin-top:14px; max-height:300px; overflow:auto;">
                    ${doctorDirectory.filter((item) => item.user_id !== doctor.user_id).map((item) => `
                        <button type="button" class="list-item-card ${activeChatId === item.user_id ? 'active' : ''}" data-chat-select="${escapeHtml(item.user_id)}">
                            <div class="row-between">
                                <div class="profile-summary">
                                    ${avatarMarkup(item)}
                                    <div style="text-align:left;">
                                        <strong>${escapeHtml(item.name)}</strong>
                                        <div class="muted tiny">ID ${escapeHtml(item.user_id)}</div>
                                    </div>
                                </div>
                                <span class="chip">${escapeHtml(formatCurrency(item.fees))}</span>
                            </div>
                        </button>
                    `).join('') || '<div class="empty-state">No other doctors registered yet.</div>'}
                </div>
            </div>
        </div>

        <div class="dashboard-grid">
            <div>
                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-envelope-open-text"></i> Patient messages</h3>
                        <span class="muted tiny">Newest retinal submissions first</span>
                    </div>
                    <div class="list-stack" style="margin-top:14px;">
                        ${patientMessages.map((item) => `
                            <button type="button" class="list-item-card ${selectedSubmission?.submission_id === item.submission_id ? 'active' : ''}" data-submission-select="${escapeHtml(item.submission_id)}">
                                <div class="row-between">
                                    <div style="text-align:left;">
                                        <strong>${escapeHtml(item.patient_name)}</strong>
                                        <div class="muted tiny">Patient ID ${escapeHtml(item.patient_id)} • ${escapeHtml(formatDateTime(item.created_at))}</div>
                                    </div>
                                    <span class="chip">${escapeHtml(item.status || 'new')}</span>
                                </div>
                                <p class="muted tiny" style="margin-top:8px;">${escapeHtml(item.note || 'Image shared for doctor review.')}</p>
                            </button>
                        `).join('') || '<div class="empty-state">No patient messages received yet.</div>'}
                    </div>
                </div>

                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-comments"></i> Doctor chat</h3>
                        <span class="muted tiny">Date-wise conversation</span>
                    </div>
                    ${activeChat ? `
                        <div class="list-stack" style="margin-top:14px; max-height:300px; overflow:auto;">
                            ${activeChat.messages.map((message) => `
                                <div class="list-item-card ${message.from_doctor_id === doctor.user_id ? 'active' : ''}">
                                    <strong>${escapeHtml(message.from_doctor_name)}</strong>
                                    <div class="muted tiny">${escapeHtml(formatDateTime(message.created_at))}</div>
                                    <p style="margin-top:8px;">${escapeHtml(message.message)}</p>
                                </div>
                            `).join('')}
                        </div>
                        <form id="doctorChatForm" class="inline-form" style="margin-top:14px;">
                            <textarea id="doctorChatMessage" rows="3" placeholder="Send a message to ${escapeHtml(activeChat.doctor.name)}"></textarea>
                            <button class="action-btn" type="submit">Send message</button>
                        </form>
                    ` : '<div class="empty-state" style="margin-top:14px;">Select a doctor from the doctor tab to start chatting.</div>'}
                </div>
            </div>

            <div>
                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-file-medical"></i> Selected patient case</h3>
                        <span class="muted tiny">Past summary and current problem</span>
                    </div>
                    ${selectedSubmission ? `
                        <div class="list-stack" style="margin-top:14px;">
                            <div class="list-item-card">
                                <div class="profile-summary">
                                    ${avatarMarkup(selectedSubmission.patient_profile || {})}
                                    <div>
                                        <strong>${escapeHtml(selectedSubmission.patient_name)}</strong>
                                        <div class="muted tiny">ID ${escapeHtml(selectedSubmission.patient_id)} • ${escapeHtml(selectedSubmission.patient_mobile || selectedSubmission.patient_profile?.mobile || '—')}</div>
                                    </div>
                                </div>
                                <p style="margin-top:12px;"><strong>Current problem:</strong> ${escapeHtml(selectedSubmission.note || 'Retinopathy image shared')}</p>
                                ${selectedSubmission.image_data_url ? `<img src="${escapeHtml(selectedSubmission.image_data_url)}" alt="Patient retinal upload" style="margin-top:12px; width:100%; border-radius:18px; max-height:240px; object-fit:cover;">` : ''}
                                <div class="chip-row" style="margin-top:12px;">
                                    <button type="button" class="ghost-btn" id="analyzeSubmissionBtn">${selectedSubmission.ai_result ? 'Refresh AI summary' : 'Analyze image with AI'}</button>
                                </div>
                            </div>
                            <div class="list-item-card">
                                <strong>Past patient summary</strong>
                                ${selectedSubmission.patient_history?.length ? selectedSubmission.patient_history.map((report) => `
                                    <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(0,0,0,.08);">
                                        <div class="muted tiny">${escapeHtml(formatDateTime(report.sent_at))}</div>
                                        <div>${escapeHtml(report.report_summary || 'Doctor update')}</div>
                                    </div>
                                `).join('') : '<div class="empty-state">No past summary available.</div>'}
                            </div>
                            <form id="doctorReportForm" class="list-item-card inline-form">
                                <strong>Appointments, treatments, suggestions and report</strong>
                                <textarea id="reportSummaryInput" rows="3" placeholder="Report summary">${escapeHtml((aiResult && aiResult.diagnosis) || selectedSubmission.report_summary || '')}</textarea>
                                <textarea id="doctorNoteInput" rows="3" placeholder="Doctor note">${escapeHtml(selectedSubmission.note || '')}</textarea>
                                <textarea id="treatmentsInput" rows="3" placeholder="Treatments (one per line)">${escapeHtml(defaultTreatments.join('\n'))}</textarea>
                                <textarea id="suggestionsInput" rows="4" placeholder="Suggestions (one per line)">${escapeHtml(defaultSuggestions.join('\n'))}</textarea>
                                <div class="two-col">
                                    <select id="severityInput">
                                        <option value="normal" ${!aiResult || aiResult.predicted_class_name !== 'DR' ? 'selected' : ''}>Normal</option>
                                        <option value="serious" ${aiResult && aiResult.predicted_class_name === 'DR' ? 'selected' : ''}>Serious</option>
                                    </select>
                                    <input id="appointmentDateInput" type="date" placeholder="Optional manual appointment date">
                                </div>
                                <button class="action-btn" type="submit">Send to patient</button>
                            </form>
                        </div>
                    ` : '<div class="empty-state" style="margin-top:14px;">Select a patient message to review the case.</div>'}
                </div>

                <div class="section-card">
                    <div class="section-head">
                        <h3><i class="fas fa-calendar-days"></i> Daily appointments</h3>
                        <span class="muted tiny">Serious and normal, date-wise</span>
                    </div>
                    <div style="margin-top:14px;">
                        ${Object.keys(groupedAppointments).length ? Object.entries(groupedAppointments).map(([date, items]) => `
                            <div class="appointment-group">
                                <strong>${escapeHtml(formatDate(date))}</strong>
                                <div class="list-stack" style="margin-top:10px;">
                                    ${items.map((appointment) => `
                                        <div class="list-item-card">
                                            <div class="row-between">
                                                <strong>${escapeHtml(appointment.patient_name)}</strong>
                                                <span class="severity-pill ${escapeHtml(appointment.appointment_type || 'normal')}">${escapeHtml((appointment.appointment_type || 'normal').toUpperCase())}</span>
                                            </div>
                                            <div class="muted tiny" style="margin-top:8px;">Patient ID ${escapeHtml(appointment.patient_id)} • Slot ${escapeHtml(appointment.slot_number || 0)} • ${escapeHtml(appointment.patient_mobile || '—')}</div>
                                            <p style="margin-top:8px;">${escapeHtml(appointment.summary || '')}</p>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('') : '<div class="empty-state">No appointments scheduled yet.</div>'}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('doctorAvatarButton')?.addEventListener('click', () => {
        doctorProfileOpen = !doctorProfileOpen;
        renderDoctorDashboard();
    });
    document.getElementById('doctorFeeForm')?.addEventListener('submit', updateDoctorFee);
    doctorDashboardRoot.querySelectorAll('[data-submission-select]').forEach((button) => {
        button.addEventListener('click', async () => {
            selectedSubmissionId = button.getAttribute('data-submission-select') || '';
            if (!(await analyzeSubmissionIfNeeded(selectedSubmissionId))) {
                renderDoctorDashboard();
            }
        });
    });
    doctorDashboardRoot.querySelectorAll('[data-chat-select]').forEach((button) => {
        button.addEventListener('click', () => {
            selectedDoctorChatId = button.getAttribute('data-chat-select') || '';
            renderDoctorDashboard();
        });
    });
    document.getElementById('doctorChatForm')?.addEventListener('submit', sendDoctorChatMessage);
    document.getElementById('analyzeSubmissionBtn')?.addEventListener('click', analyzeSelectedSubmission);
    document.getElementById('doctorReportForm')?.addEventListener('submit', sendDoctorReport);
}

async function loadPatientDashboard() {
    const [dashboard, doctors] = await Promise.all([
        apiFetch('/patient/dashboard', { method: 'GET' }),
        apiFetch('/doctors', { method: 'GET' }),
    ]);
    patientDashboardData = dashboard;
    doctorDirectory = doctors.doctors || [];
    if (!selectedPatientDoctorId && doctorDirectory.length) {
        selectedPatientDoctorId = doctorDirectory[0].user_id;
    }
    renderPatientDashboard();
}

async function loadDoctorDashboard() {
    const [dashboard, doctors] = await Promise.all([
        apiFetch('/doctor/dashboard', { method: 'GET' }),
        apiFetch('/doctors', { method: 'GET' }),
    ]);
    doctorDashboardData = dashboard;
    doctorDirectory = doctors.doctors || [];
    if (!selectedSubmissionId) {
        selectedSubmissionId = dashboard.patient_messages?.[0]?.submission_id || '';
    }
    if (!selectedDoctorChatId) {
        selectedDoctorChatId = dashboard.doctor_chats?.[0]?.doctor?.user_id || '';
    }
    if (selectedSubmissionId) {
        const submission = dashboard.patient_messages?.find((item) => item.submission_id === selectedSubmissionId);
        if (submission?.image_data_url && !submission.ai_result) {
            await analyzeSelectedSubmission();
            return;
        }
    }
    renderDoctorDashboard();
}

async function submitPatientSubmission(event) {
    event.preventDefault();
    if (!selectedPatientDoctorId) {
        window.alert('Please search and select a doctor before sending.');
        return;
    }
    const note = (document.getElementById('patientNoteInput')?.value || '').trim();
    const file = document.getElementById('patientImageInput')?.files?.[0] || null;
    let image_data_url = null;
    if (file) {
        image_data_url = await fileToDataUrl(file);
    }
    if (!note && !image_data_url) {
        window.alert('Please add a note or retinal image.');
        return;
    }
    await apiFetch('/patient/submissions', {
        method: 'POST',
        body: JSON.stringify({
            doctor_id: selectedPatientDoctorId,
            note,
            image_name: file?.name || '',
            image_data_url,
        }),
    });
    document.getElementById('patientSubmissionForm')?.reset();
    await loadPatientDashboard();
    window.alert('Your retinal case was sent to the selected doctor.');
}

async function updateDoctorFee(event) {
    event.preventDefault();
    const fee = Number(document.getElementById('doctorFeeInput')?.value || '1');
    await apiFetch('/doctor/profile/fees', {
        method: 'POST',
        body: JSON.stringify({ fee }),
    });
    await loadDoctorDashboard();
}

async function analyzeSelectedSubmission() {
    if (!selectedSubmissionId) return;
    try {
        await apiFetch(`/doctor/submissions/${selectedSubmissionId}/analyze`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        await loadDoctorDashboard();
    } catch (error) {
        window.alert(error.message || 'Unable to analyze the retinal image right now.');
        renderDoctorDashboard();
    }
}

async function analyzeSubmissionIfNeeded(submissionId) {
    const submission = doctorDashboardData?.patient_messages?.find((item) => item.submission_id === submissionId);
    if (submission?.image_data_url && !submission.ai_result) {
        await analyzeSelectedSubmission();
        return true;
    }
    return false;
}

async function sendDoctorReport(event) {
    event.preventDefault();
    if (!selectedSubmissionId) return;
    const report_summary = (document.getElementById('reportSummaryInput')?.value || '').trim();
    const note = (document.getElementById('doctorNoteInput')?.value || '').trim();
    const treatments = (document.getElementById('treatmentsInput')?.value || '').split('\n').map((item) => item.trim()).filter(Boolean);
    const suggestions = (document.getElementById('suggestionsInput')?.value || '').split('\n').map((item) => item.trim()).filter(Boolean);
    const severity = document.getElementById('severityInput')?.value || 'normal';
    const appointment_date = (document.getElementById('appointmentDateInput')?.value || '').trim();
    await apiFetch('/doctor/reports', {
        method: 'POST',
        body: JSON.stringify({
            submission_id: selectedSubmissionId,
            report_summary,
            note,
            treatments,
            suggestions,
            severity,
            appointment_date: appointment_date || null,
        }),
    });
    await loadDoctorDashboard();
    window.alert('Doctor report sent to the patient.');
}

async function sendDoctorChatMessage(event) {
    event.preventDefault();
    const message = (document.getElementById('doctorChatMessage')?.value || '').trim();
    if (!message || !selectedDoctorChatId) return;
    await apiFetch('/doctor/messages', {
        method: 'POST',
        body: JSON.stringify({ doctor_id: selectedDoctorChatId, message }),
    });
    await loadDoctorDashboard();
}

async function init() {
    setupAuthTabs();
    await checkAPIStatus();
    if (getToken()) {
        try {
            await showApp(await fetchMe());
            return;
        } catch (_) {
            clearToken();
        }
    }
    showAuth();
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('sendOtpDrBtn')?.addEventListener('click', () => sendOtp('dr'));
    document.getElementById('sendOtpPtBtn')?.addEventListener('click', () => sendOtp('pt'));
    document.getElementById('sendOtpForgotBtn')?.addEventListener('click', () => sendOtp('forgot'));
    document.getElementById('loginForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        login();
    });
    document.getElementById('doctorRegForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        registerDoctor();
    });
    document.getElementById('patientRegForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        registerPatient();
    });
    document.getElementById('forgotForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        forgotPassword();
    });
    logoutBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        logout();
    });
});

setInterval(checkAPIStatus, 30000);

const SETTINGS_KEY = 'tt_settings';
const PLANNED_KEY = 'tt_planned_pending';
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbywgrvW0bP1sndabYtaDodiNCm3LP2GgvlBfLaHBKM65cJqC5bwYiPWnqr_VOMhlg2tdg/exec';
const GOOGLE_CLIENT_ID = '656479148002-43g57hp4r32oa7v9eei8vpl7ldhcsaht.apps.googleusercontent.com';
const ID_TOKEN_KEY = 'tt_id_token';

function loadIdToken() {
  return localStorage.getItem(ID_TOKEN_KEY) || '';
}
function saveIdToken(token) {
  localStorage.setItem(ID_TOKEN_KEY, token);
}
function clearIdToken() {
  localStorage.removeItem(ID_TOKEN_KEY);
}
function idTokenExpiryMs(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000;
  } catch {
    return 0;
  }
}
function hasValidIdToken() {
  const token = loadIdToken();
  return !!token && idTokenExpiryMs(token) > Date.now();
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
let settings = loadSettings();

function baseUrl() {
  return (settings.scriptUrl || DEFAULT_SCRIPT_URL).replace(/\/+$/, '');
}
function userName() {
  return settings.user || 'me';
}

function handleApiError(message) {
  if (message.indexOf('Unauthorized') === 0) {
    clearIdToken();
    if (message.indexOf('wrong account') !== -1) {
      // Otherwise auto_select silently signs back in with the same rejected
      // account on the next load, reproducing the same silent bounce.
      if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
      showAuthGate('Доступ заборонено для цього акаунта. Увійди правильним акаунтом.');
    } else {
      showAuthGate();
    }
  }
  return new Error(message);
}
async function apiPost(path, body) {
  const res = await fetch(`${baseUrl()}?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight — Apps Script doesn't handle OPTIONS
    body: JSON.stringify({ user: userName(), idToken: loadIdToken(), ...body }),
  });
  const data = await res.json().catch(() => null);
  if (!data || data.ok === false) throw handleApiError((data && data.error) || `${path}: request failed`);
  return data;
}
async function apiGet(path, params = {}) {
  const qs = new URLSearchParams({ path, user: userName(), idToken: loadIdToken(), ...params }).toString();
  const res = await fetch(`${baseUrl()}?${qs}`);
  const data = await res.json().catch(() => null);
  if (!data || data.ok === false) throw handleApiError((data && data.error) || `${path}: request failed`);
  return data;
}

function nowHHMM() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isRunningRow(row) {
  return row.Hours === '' || row.Hours === undefined || row.Hours === null;
}
function rowStartDate(row) {
  return new Date(`${row.Date}T${row['Start time']}:00`);
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') refreshHistory();
  });
});

/* ---------- Settings modal ---------- */
const settingsModal = document.getElementById('settings-modal');
function openSettingsModal() {
  document.getElementById('settings-script-url').value = settings.scriptUrl || DEFAULT_SCRIPT_URL;
  document.getElementById('settings-user').value = settings.user || 'me';
  settingsModal.classList.remove('hidden');
}
document.getElementById('tab-settings-btn').addEventListener('click', openSettingsModal);
document.getElementById('settings-close-btn').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});
document.getElementById('settings-save-btn').addEventListener('click', () => {
  settings = {
    scriptUrl: document.getElementById('settings-script-url').value.trim(),
    user: document.getElementById('settings-user').value.trim() || 'me',
  };
  saveSettings(settings);
  settingsModal.classList.add('hidden');
});
document.getElementById('settings-signout-btn').addEventListener('click', () => {
  clearIdToken();
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  settingsModal.classList.add('hidden');
  showAuthGate();
});

/* ---------- Google sign-in gate ---------- */
const authGate = document.getElementById('auth-gate');
const authGateStatus = document.getElementById('auth-gate-status');
function showAuthGate(message) {
  authGateStatus.textContent = message || '';
  authGateStatus.classList.toggle('hidden', !message);
  authGate.classList.remove('hidden');
}
function hideAuthGate() {
  authGate.classList.add('hidden');
}
function handleCredentialResponse(response) {
  saveIdToken(response.credential);
  hideAuthGate();
  initApp();
}
function initAuth() {
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true,
    });
    google.accounts.id.renderButton(document.getElementById('g_id_signin'), { theme: 'outline', size: 'large', width: 300 });
    google.accounts.id.prompt();
  }
  if (hasValidIdToken()) {
    hideAuthGate();
    initApp();
  } else {
    showAuthGate();
  }
}

/* ---------- Timer ---------- */
const timerDisplay = document.getElementById('timer-display');
const timerMeta = document.getElementById('timer-meta');
const startBtn = document.getElementById('timer-start-btn');
const stopBtn = document.getElementById('timer-stop-btn');
let timerStartMs = null;
let timerInterval = null;

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function tickTimer() {
  if (timerStartMs === null) return;
  timerDisplay.textContent = formatElapsed(Date.now() - timerStartMs);
}
function setRunningUI(active) {
  startBtn.classList.toggle('hidden', active);
  stopBtn.classList.toggle('hidden', !active);
  document.getElementById('timer-client').disabled = active;
  document.getElementById('timer-project').disabled = active;
  document.getElementById('timer-activity').disabled = active;
  document.getElementById('timer-billable').disabled = active;
}
function beginLocalTimer(row, preciseStartMs) {
  timerStartMs = preciseStartMs || rowStartDate(row).getTime();
  timerMeta.textContent = `${row.Client || ''} ${row.Project ? '· ' + row.Project : ''} ${row.Activity ? '· ' + row.Activity : ''}`;
  setRunningUI(true);
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
}
function endLocalTimer(row) {
  timerStartMs = null;
  clearInterval(timerInterval);
  timerDisplay.textContent = '00:00:00';
  timerMeta.textContent = row && row.Hours !== undefined ? `Записано: ${row.Hours} год${row.Amount ? ' · € ' + row.Amount : ''}` : '';
  setRunningUI(false);
}

let actionBusy = false;
async function guardedAction(fn) {
  if (actionBusy) return;
  actionBusy = true;
  document.getElementById('timer-quick-slots').classList.add('disabled-group');
  startBtn.disabled = true;
  stopBtn.disabled = true;
  try {
    await fn();
  } finally {
    actionBusy = false;
    document.getElementById('timer-quick-slots').classList.remove('disabled-group');
    startBtn.disabled = false;
    stopBtn.disabled = false;
  }
}

startBtn.addEventListener('click', () => guardedAction(async () => {
  const client = document.getElementById('timer-client').value.trim();
  const project = document.getElementById('timer-project').value.trim();
  const activity = document.getElementById('timer-activity').value.trim();
  const billable = document.getElementById('timer-billable').checked;
  try {
    const clickMs = Date.now();
    const row = await apiPost('timer/start', { client, project, activity, billable, startTime: nowHHMM() });
    beginLocalTimer(row, clickMs);
  } catch (e) {
    alert('Не вдалося почати таймер: ' + e.message);
  }
}));
stopBtn.addEventListener('click', () => guardedAction(async () => {
  try {
    const row = await apiPost('timer/stop', { stopTime: nowHHMM() });
    endLocalTimer(row);
  } catch (e) {
    alert('Не вдалося зупинити таймер: ' + e.message);
  }
}));

async function startTimerAt(startTime) {
  return guardedAction(async () => {
    const client = document.getElementById('timer-client').value.trim();
    const project = document.getElementById('timer-project').value.trim();
    const activity = document.getElementById('timer-activity').value.trim();
    const billable = document.getElementById('timer-billable').checked;
    try {
      const row = await apiPost('timer/start', { client, project, activity, billable, startTime });
      beginLocalTimer(row);
    } catch (e) {
      alert('Не вдалося почати таймер: ' + e.message);
    }
  });
}

function nearbySlots(before = 2, after = 2) {
  const d = new Date();
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  const rounded = new Date(d);
  rounded.setMinutes(minutes < 30 ? 0 : 30);
  const slots = [];
  for (let i = -before; i <= after; i++) slots.push(new Date(rounded.getTime() + i * 30 * 60000));
  return slots;
}
function renderTimerQuickSlots() {
  const container = document.getElementById('timer-quick-slots');
  container.innerHTML = '';
  const now = Date.now();
  nearbySlots().forEach((slot) => {
    const isFuture = slot.getTime() > now;
    const btn = document.createElement('button');
    btn.className = isFuture ? 'slot-btn slot-btn-planned' : 'slot-btn';
    btn.textContent = (isFuture ? '⏰ ' : '') + slot.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    btn.title = isFuture ? 'Запланувати старт на цей час (з підтвердженням)' : 'Почати таймер із цим часом одразу';
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = `${pad(slot.getHours())}:${pad(slot.getMinutes())}`;
    btn.addEventListener('click', () => (isFuture ? createPlannedStart(slot) : startTimerAt(hhmm)));
    container.appendChild(btn);
  });
}

async function loadLists() {
  try {
    const data = await apiGet('lists');
    const clientsList = document.getElementById('clients-list');
    const projectsList = document.getElementById('projects-list');
    clientsList.innerHTML = (data.clients || []).map((c) => `<option value="${c}">`).join('');
    projectsList.innerHTML = (data.projects || []).map((p) => `<option value="${p}">`).join('');
  } catch {
    /* backend not reachable yet — ignore */
  }
}

async function restoreTimerState() {
  try {
    const status = await apiGet('timer/status');
    if (status && status.active) {
      document.getElementById('timer-client').value = status.Client || '';
      document.getElementById('timer-project').value = status.Project || '';
      document.getElementById('timer-activity').value = status.Activity || '';
      beginLocalTimer(status);
    }
  } catch {
    /* backend not reachable yet — ignore, user can retry from Settings */
  }
}

/* ---------- Manual entry ---------- */
document.getElementById('manual-date').valueAsDate = new Date();
document.getElementById('manual-submit-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('manual-status');
  const body = {
    date: document.getElementById('manual-date').value,
    client: document.getElementById('manual-client').value.trim(),
    project: document.getElementById('manual-project').value.trim(),
    activity: document.getElementById('manual-activity').value.trim(),
    hours: document.getElementById('manual-hours').value,
    billable: document.getElementById('manual-billable').checked,
    note: document.getElementById('manual-note').value.trim(),
  };
  if (!body.project || !body.hours) {
    statusEl.textContent = 'Заповніть проєкт і кількість годин';
    statusEl.classList.add('error');
    return;
  }
  try {
    await apiPost('entry/manual', body);
    statusEl.classList.remove('error');
    statusEl.textContent = 'Запис додано';
    document.getElementById('manual-project').value = '';
    document.getElementById('manual-activity').value = '';
    document.getElementById('manual-hours').value = '';
    document.getElementById('manual-note').value = '';
  } catch (e) {
    statusEl.classList.add('error');
    statusEl.textContent = 'Помилка: ' + e.message;
  }
});

/* ---------- Planned start ---------- */
function loadPlanned() {
  try {
    return JSON.parse(localStorage.getItem(PLANNED_KEY)) || [];
  } catch {
    return [];
  }
}
function savePlanned(list) {
  localStorage.setItem(PLANNED_KEY, JSON.stringify(list));
}
function renderPlannedList() {
  const list = loadPlanned();
  const el = document.getElementById('planned-active-list');
  el.innerHTML = '';
  list.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'planned-item';
    const t = new Date(p.plannedTime).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span>${p.client ? p.client + ' · ' : ''}${p.project}</span><span>${t}</span>`;
    el.appendChild(div);
  });
}
async function createPlannedStart(slotDate) {
  const statusEl = document.getElementById('planned-status');
  const client = document.getElementById('timer-client').value.trim();
  const project = document.getElementById('timer-project').value.trim();
  if (!project) {
    statusEl.classList.add('error');
    statusEl.textContent = 'Вкажіть проєкт (у полі вище)';
    return;
  }
  try {
    const row = await apiPost('planned-start/create', {
      client,
      project,
      plannedTime: slotDate.toISOString(),
    });
    const list = loadPlanned();
    list.push({ id: row.ID, client, project, plannedTime: slotDate.toISOString(), notified: false });
    savePlanned(list);
    renderPlannedList();
    statusEl.classList.remove('error');
    statusEl.textContent = `Заплановано на ${slotDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    statusEl.classList.add('error');
    statusEl.textContent = 'Помилка: ' + e.message;
  }
}

const confirmModal = document.getElementById('confirm-modal');
let confirmQueue = [];
function showNextConfirm() {
  if (confirmQueue.length === 0) {
    confirmModal.classList.add('hidden');
    return;
  }
  const item = confirmQueue[0];
  document.getElementById('confirm-body').textContent = `${item.client ? item.client + ' · ' : ''}${item.project} (заплановано на ${new Date(item.plannedTime).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })})`;
  confirmModal.classList.remove('hidden');
}
async function resolveConfirm(confirmed) {
  const item = confirmQueue.shift();
  if (!item) return;
  showNextConfirm();
  const clickMs = Date.now();
  try {
    const result = await apiPost('planned-start/confirm', { id: item.id, confirmed, startTime: nowHHMM() });
    const list = loadPlanned().filter((p) => p.id !== item.id);
    savePlanned(list);
    renderPlannedList();
    if (confirmed && result && isRunningRow(result)) {
      beginLocalTimer(result, clickMs);
    }
  } catch (e) {
    alert('Помилка підтвердження: ' + e.message);
  }
}
document.getElementById('confirm-yes-btn').addEventListener('click', () => resolveConfirm(true));
document.getElementById('confirm-no-btn').addEventListener('click', () => resolveConfirm(false));

function checkPlannedDue() {
  const now = Date.now();
  const list = loadPlanned();
  const due = list.filter((p) => !p.notified && new Date(p.plannedTime).getTime() <= now);
  if (due.length === 0) return;
  due.forEach((p) => (p.notified = true));
  savePlanned(list);
  confirmQueue.push(...due);
  showNextConfirm();
}
setInterval(checkPlannedDue, 15000);
setInterval(renderTimerQuickSlots, 60000);

/* ---------- History ---------- */
async function refreshHistory() {
  const tbody = document.getElementById('entries-tbody');
  try {
    const rows = await apiGet('entries');
    tbody.innerHTML = '';
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const tr = document.createElement('tr');
      const hours = r.Hours === '' || r.Hours == null ? '' : r.Hours;
      const amount = r.Amount === '' || r.Amount == null ? '' : `€ ${r.Amount}`;
      tr.innerHTML = `<td>${r.Date || ''}</td><td>${r.Client || ''}</td><td>${r.Project || ''}</td><td>${hours}</td><td>${amount}</td><td>${r.Status || ''}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6">Помилка завантаження: ${e.message}</td></tr>`;
  }
}
document.getElementById('history-refresh-btn').addEventListener('click', refreshHistory);

/* ---------- Init ---------- */
function initApp() {
  renderTimerQuickSlots();
  renderPlannedList();
  loadLists();
  restoreTimerState();
}

window.addEventListener('load', () => {
  initAuth();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
});

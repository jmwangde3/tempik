const inboxSelect = document.getElementById('inboxSelect');
const copyBtn = document.getElementById('copyBtn');
const refreshBtn = document.getElementById('refreshBtn');
const newBtn = document.getElementById('newBtn');
const deleteBtn = document.getElementById('deleteBtn');
const newBox = document.getElementById('newBox');
const createCustomBtn = document.getElementById('createCustomBtn');
const createRandomBtn = document.getElementById('createRandomBtn');
const localPartInput = document.getElementById('localPartInput');
const domainSelect = document.getElementById('domainSelect');
const currentInbox = document.getElementById('currentInbox');
const messageCount = document.getElementById('messageCount');
const messageList = document.getElementById('messageList');
const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');

let appConfig = {
  appName: 'Tempik',
  mailDomain: 'example.com',
  mailDomains: ['example.com'],
  webHost: 'tempik.example.com',
  maxInboxesPerSession: 20
};

const SESSION_KEY = 'tempik_session_id';
let sessionId = localStorage.getItem(SESSION_KEY) || '';
let pollTimer = null;

async function fetchJson(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (sessionId) {
    headers['x-session-id'] = sessionId;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload && payload.error) message = payload.error;
    } catch {
      /* keep the status line */
    }
    throw new Error(message);
  }
  return res.json();
}

/**
 * The API returns ISO-8601 UTC. Older rows may still look like
 * "2026-11-04 13:26:32", which browsers parse as *local* time — append the
 * missing zone so legacy values are not shifted by the viewer's offset.
 */
function parseTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw);
  const date = new Date(naive ? `${raw.replace(' ', 'T')}Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function emptyState(icon, title, subtitle) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const iconEl = document.createElement('div');
  iconEl.className = 'icon';
  iconEl.textContent = icon;

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = title;

  const subEl = document.createElement('div');
  subEl.className = 'sub';
  subEl.textContent = subtitle;

  wrap.append(iconEl, titleEl, subEl);
  return wrap;
}

function renderMessages(messages) {
  messageCount.textContent = `${messages.length} messages`;

  if (!messages.length) {
    messageList.replaceChildren(
      emptyState('✉️', 'Inbox empty', 'Emails sent to this address will appear here.')
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  messages.forEach((msg) => {
    const item = document.createElement('div');
    item.className = 'message-item';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const when = parseTimestamp(msg.received_at);
    meta.textContent = `From: ${msg.from_address}${when ? ` • ${when.toLocaleString()}` : ''}`;

    const subject = document.createElement('strong');
    subject.textContent = msg.subject || '(no subject)';

    const body = document.createElement('p');
    // textContent, never innerHTML: senders control every one of these fields.
    body.textContent = msg.body || '';

    item.append(meta, subject, body);
    fragment.appendChild(item);
  });

  messageList.replaceChildren(fragment);
}

async function loadConfig() {
  appConfig = await fetchJson('/api/config', { headers: {} });
  document.title = appConfig.appName;
  appTitle.textContent = appConfig.appName;

  const domains = appConfig.mailDomains || [appConfig.mailDomain];
  appSubtitle.textContent = `Disposable inbox for ${domains.join(', ')}`;
  localPartInput.placeholder = `username atau kosongkan untuk random @${appConfig.mailDomain}`;

  domainSelect.innerHTML = '';
  domains.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `@${d}`;
    domainSelect.appendChild(opt);
  });
  if (domains.length <= 1) domainSelect.style.display = 'none';
}

async function ensureSession() {
  const payload = await fetchJson('/api/session');
  sessionId = payload.sessionId;
  localStorage.setItem(SESSION_KEY, sessionId);
}

async function loadInboxes(selectedAddress) {
  const inboxes = await fetchJson('/api/inboxes');
  inboxSelect.innerHTML = '';

  if (!inboxes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Belum ada inbox';
    inboxSelect.appendChild(opt);
    currentInbox.textContent = 'No inbox selected';
    messageCount.textContent = '0 messages';
    messageList.replaceChildren(
      emptyState('📬', 'No inboxes yet', 'Click New to create a disposable email address.')
    );
    return;
  }

  inboxes.forEach((inbox) => {
    const opt = document.createElement('option');
    opt.value = inbox.address;
    opt.textContent = inbox.address;
    inboxSelect.appendChild(opt);
  });

  inboxSelect.value = selectedAddress && inboxes.some((x) => x.address === selectedAddress)
    ? selectedAddress
    : inboxes[0].address;

  await loadMessages();
}

async function loadMessages() {
  const address = inboxSelect.value;
  if (!address) return;
  currentInbox.textContent = address;
  const messages = await fetchJson(`/api/inboxes/${encodeURIComponent(address)}/messages`);
  renderMessages(messages);
}

function showToast(text) {
  const tc = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  tc.appendChild(el);
  setTimeout(() => { el.classList.add('fadeout'); setTimeout(() => el.remove(), 200); }, 1800);
}

function reportError(err) {
  console.error(err);
  showToast(`⚠️ ${err.message}`);
}

copyBtn.addEventListener('click', async () => {
  if (!inboxSelect.value) return;
  await navigator.clipboard.writeText(inboxSelect.value);
  showToast('📋 Copied to clipboard');
});

refreshBtn.addEventListener('click', () => {
  loadMessages().catch(reportError);
});

newBtn.addEventListener('click', () => newBox.classList.toggle('hidden'));
inboxSelect.addEventListener('change', () => {
  loadMessages().catch(reportError);
});

deleteBtn.addEventListener('click', async () => {
  if (!inboxSelect.value) return;
  if (!confirm(`Delete inbox ${inboxSelect.value}?`)) return;
  const target = inboxSelect.value;
  try {
    await fetchJson(`/api/inboxes/${encodeURIComponent(target)}`, { method: 'DELETE' });
    await loadInboxes();
  } catch (err) {
    reportError(err);
  }
});

createCustomBtn.addEventListener('click', async () => {
  const localPart = localPartInput.value.trim();
  const domain = domainSelect.value;
  try {
    const inbox = await fetchJson('/api/inboxes', {
      method: 'POST',
      body: JSON.stringify({ localPart, domain })
    });
    localPartInput.value = '';
    await loadInboxes(inbox.address);
  } catch (err) {
    reportError(err);
  }
});

createRandomBtn.addEventListener('click', async () => {
  const domain = domainSelect.value;
  try {
    const inbox = await fetchJson('/api/inboxes', {
      method: 'POST',
      body: JSON.stringify({ domain })
    });
    localPartInput.value = '';
    await loadInboxes(inbox.address);
  } catch (err) {
    reportError(err);
  }
});

// Temp mail is a watching game: without a poll the inbox looks broken until
// the user hits Refresh.
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.hidden || !inboxSelect.value) return;
    loadMessages().catch(() => {});
  }, 10000);
}

Promise.all([loadConfig(), ensureSession()])
  .then(() => loadInboxes())
  .then(() => startPolling())
  .catch((err) => {
    console.error(err);
    messageList.replaceChildren(emptyState('⚠️', 'Connection error', err.message));
  });

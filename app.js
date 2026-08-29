/* =============================================
   app.js — PrintHub Main Application Logic
   Supabase Auth + Database + Storage
   ============================================= */

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---- State ---- */
let currentUser    = null;
let currentProfile = null;
let allJobs        = [];
let activeFilter   = 'all';
let copies         = 1;
let selectedFile   = null;
let refreshTimer   = null;

/* ---- Utility ---- */
function $(id) { return document.getElementById(id); }

function showToast(msg, type = 'info') {
  const c = $('toastContainer');
  const t = document.createElement('div');
  t.className = `toast${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toast-out 0.2s ease forwards';
    setTimeout(() => t.remove(), 200);
  }, 3500);
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileEmoji(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  return { pdf: '📄', doc: '📝', docx: '📝', jpg: '🖼', jpeg: '🖼', png: '🖼' }[ext] || '📄';
}

function setLoading(btnId, loading, label) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span>' : label;
}

/* ============================
   AUTH
   ============================ */
async function init() {
  if (localStorage.getItem('printhub_owner_session') === 'true') {
    const ownerData = JSON.parse(localStorage.getItem('printhub_owner_user') || '{}');
    currentUser = { id: 'owner-session', email: OWNER_EMAIL };
    currentProfile = { id: 'owner-session', name: ownerData.name || 'Owner', role: 'owner', email: OWNER_EMAIL };
    showApp();
    return;
  }

  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = data.session.user;
  await loadProfile();
}

async function loadProfile() {
  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (error || !profile) {
    // Profile might not exist yet — create it
    const meta = currentUser.user_metadata || {};
    const role = currentUser.email === OWNER_EMAIL ? 'owner' : 'customer';
    const { data: newProfile, error: insertErr } = await sb
      .from('profiles')
      .insert({
        id:         currentUser.id,
        name:       meta.name || currentUser.email.split('@')[0],
        student_id: meta.student_id || '',
        phone:      meta.phone || '',
        role:       role,
      })
      .select()
      .single();

    if (insertErr) {
      showToast('Error loading profile. Please refresh.', 'error');
      return;
    }
    currentProfile = newProfile;
  } else {
    currentProfile = profile;
  }

  showApp();
}

async function signOut() {
  localStorage.removeItem('printhub_owner_session');
  localStorage.removeItem('printhub_owner_user');
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

/* ============================
   SHOW APP (role-based)
   ============================ */
function showApp() {
  $('pageLoading').classList.add('hidden');
  $('navUser').classList.remove('hidden');
  $('navUserName').textContent = currentProfile.name;

  if (currentProfile.role === 'owner') {
    $('navBrand').textContent = 'PrintHub · Dashboard';
    $('ownerView').classList.remove('hidden');
    initOwnerDashboard();
  } else {
    $('customerView').classList.remove('hidden');
    onOptionChange();
  }
}

/* ============================
   CUSTOMER — TABS
   ============================ */
function showTab(tab) {
  const isNew = tab === 'newJob';
  $('panelNewJob').classList.toggle('hidden', !isNew);
  $('panelOrders').classList.toggle('hidden', isNew);
  $('tabNewJob').classList.toggle('active', isNew);
  $('tabOrders').classList.toggle('active', !isNew);
  if (!isNew) loadOrders();
}

/* ============================
   CUSTOMER — FILE UPLOAD
   ============================ */
function onFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    showToast('File must be under 20 MB.', 'error');
    input.value = '';
    return;
  }
  selectedFile = file;
  $('filePill').classList.remove('hidden');
  $('filePill').innerHTML = `
    <div class="file-pill">
      <span>${getFileEmoji(file.name)}</span>
      <span class="file-pill-name">${file.name}</span>
      <span class="file-pill-size">${formatSize(file.size)}</span>
      <button class="file-pill-remove" onclick="clearFile()">×</button>
    </div>`;
  onOptionChange();
}

function clearFile() {
  selectedFile = null;
  $('fileInput').value = '';
  $('filePill').classList.add('hidden');
  $('filePill').innerHTML = '';
}

// Drag & drop
const zone = $('uploadZone');
zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
zone.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  $('fileInput').files = dt.files;
  onFileSelect($('fileInput'));
});

/* ============================
   CUSTOMER — OPTIONS
   ============================ */
function changeCopies(delta) {
  copies = Math.max(1, Math.min(99, copies + delta));
  $('copiesNum').textContent = copies;
  onOptionChange();
}

function onOptionChange() {
  const isMono = $('rdMono').checked;
  $('optMono').classList.toggle('selected', isMono);
  $('optColor').classList.toggle('selected', !isMono);
  const rate = isMono ? 0.10 : 0.50;
  $('priceEst').textContent = `RM ${(rate * copies).toFixed(2)}+`;
}

document.querySelectorAll('.radio-option').forEach(el => el.addEventListener('click', onOptionChange));

/* ============================
   CUSTOMER — SUBMIT JOB
   ============================ */
async function submitJob() {
  if (!selectedFile) {
    showToast('Please upload a file first.', 'error');
    return;
  }

  setLoading('submitBtn', true, 'Submit Print Job');

  try {
    // 1. Upload file to Supabase Storage
    const ext      = selectedFile.name.split('.').pop();
    const ts       = Date.now();
    const filePath = `${currentUser.id}/${ts}_${selectedFile.name}`;

    const { error: uploadErr } = await sb.storage
      .from('print-files')
      .upload(filePath, selectedFile, { cacheControl: '3600', upsert: false });

    if (uploadErr) throw new Error('Upload failed: ' + uploadErr.message);

    // 2. Insert job record
    const { data: job, error: insertErr } = await sb.from('jobs').insert({
      customer_id:         currentUser.id,
      customer_name:       currentProfile.name,
      customer_student_id: currentProfile.student_id,
      file_name:           selectedFile.name,
      file_path:           filePath,
      file_size:           selectedFile.size,
      color_mode:          $('rdMono').checked ? 'monochrome' : 'color',
      paper_size:          $('paperSize').value,
      sides:               $('sides').value,
      copies:              copies,
      pickup_time:         $('pickupTime').value,
      instructions:        $('instructions').value.trim(),
      status:              'pending',
    }).select().single();

    if (insertErr) throw new Error('Failed to save job: ' + insertErr.message);

    setLoading('submitBtn', false, 'Submit Print Job');

    // Show success
    $('successId').textContent = 'Job ID: ' + job.id.slice(0, 8).toUpperCase();
    $('successOverlay').classList.remove('hidden');

  } catch (err) {
    setLoading('submitBtn', false, 'Submit Print Job');
    showToast(err.message, 'error');
  }
}

function closeSuccess() {
  $('successOverlay').classList.add('hidden');
  clearFile();
  $('instructions').value = '';
  copies = 1;
  $('copiesNum').textContent = '1';
  onOptionChange();
}

function viewOrders() {
  $('successOverlay').classList.add('hidden');
  showTab('orders');
}

/* ============================
   CUSTOMER — MY ORDERS
   ============================ */
async function loadOrders() {
  $('ordersList').innerHTML = '<div class="flex-center" style="padding:32px;"><div class="spinner spinner-dark"></div></div>';

  const { data: jobs, error } = await sb
    .from('jobs')
    .select('*')
    .eq('customer_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { showToast('Error loading orders.', 'error'); return; }

  if (!jobs || jobs.length === 0) {
    $('ordersList').innerHTML = `
      <div class="empty">
        <span class="empty-icon">📋</span>
        <h3>No orders yet</h3>
        <p>Submit your first print job to see it here.</p>
      </div>`;
    return;
  }

  const statusLabel = { pending: 'Pending', printing: 'Printing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };

  $('ordersList').innerHTML = jobs.map(j => `
    <div class="order-card">
      <div class="order-card-header">
        <div>
          <div class="order-file">${getFileEmoji(j.file_name)} ${j.file_name}</div>
          <div class="order-id">#${j.id.slice(0, 8).toUpperCase()}</div>
        </div>
        <span class="badge badge-${j.status}">${statusLabel[j.status] || j.status}</span>
      </div>
      <div class="order-meta">
        <span class="order-meta-item">${j.color_mode === 'color' ? 'Color' : 'Monochrome'}</span>
        <span class="order-meta-item">·</span>
        <span class="order-meta-item">${j.paper_size}</span>
        <span class="order-meta-item">·</span>
        <span class="order-meta-item">${j.copies} cop${j.copies > 1 ? 'ies' : 'y'}</span>
        <span class="order-meta-item">·</span>
        <span class="order-meta-item">${j.sides === 'double' ? 'Double-sided' : 'Single-sided'}</span>
      </div>
      ${j.instructions ? `<div class="order-time" style="margin-top:6px;">Note: ${j.instructions}</div>` : ''}
      <div class="order-time">Submitted ${formatDate(j.created_at)}</div>
    </div>`).join('');
}

/* ============================
   OWNER — DASHBOARD
   ============================ */
const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'printing',  label: 'Printing' },
  { key: 'ready',     label: 'Ready' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function initOwnerDashboard() {
  buildFilterBar();
  loadAllJobs();
  // Auto-refresh every 30s
  refreshTimer = setInterval(loadAllJobs, 30000);
}

function buildFilterBar() {
  $('filterBar').innerHTML = FILTERS.map(f => `
    <button class="filter-btn ${f.key === 'all' ? 'active' : ''}" id="filter-${f.key}"
      onclick="setFilter('${f.key}')">
      ${f.label} <span class="filter-count" id="fc-${f.key}">0</span>
    </button>`).join('');
}

function setFilter(key) {
  activeFilter = key;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  $(`filter-${key}`)?.classList.add('active');
  renderJobs();
}

async function loadAllJobs() {
  const { data: jobs, error } = await sb
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { showToast('Error loading jobs.', 'error'); return; }

  allJobs = jobs || [];
  updateStats();
  renderJobs();
}

function updateStats() {
  const today = new Date().toDateString();
  const pending   = allJobs.filter(j => j.status === 'pending').length;
  const printing  = allJobs.filter(j => j.status === 'printing').length;
  const ready     = allJobs.filter(j => j.status === 'ready').length;
  const completed = allJobs.filter(j => j.status === 'completed' && new Date(j.updated_at).toDateString() === today).length;

  $('statsRow').innerHTML = `
    <div class="stat-pill"><strong>${allJobs.length}</strong> Total</div>
    <div class="stat-pill"><strong>${pending}</strong> Pending</div>
    <div class="stat-pill"><strong>${printing}</strong> Printing</div>
    <div class="stat-pill"><strong>${ready}</strong> Ready</div>
    <div class="stat-pill"><strong>${completed}</strong> Done Today</div>`;

  // Update filter counts
  const counts = {};
  counts.all = allJobs.length;
  FILTERS.slice(1).forEach(f => { counts[f.key] = allJobs.filter(j => j.status === f.key).length; });
  Object.keys(counts).forEach(k => { const el = $(`fc-${k}`); if (el) el.textContent = counts[k]; });
}

function renderJobs() {
  const search = ($('searchInput')?.value || '').toLowerCase();
  let jobs = activeFilter === 'all' ? allJobs : allJobs.filter(j => j.status === activeFilter);
  if (search) {
    jobs = jobs.filter(j =>
      (j.customer_name || '').toLowerCase().includes(search) ||
      (j.file_name || '').toLowerCase().includes(search) ||
      (j.customer_student_id || '').toLowerCase().includes(search) ||
      (j.id || '').toLowerCase().includes(search)
    );
  }

  const empty = $('emptyJobs');
  const tbody = $('jobTableBody');
  const mobile = $('jobMobileList');

  if (!jobs.length) {
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    mobile.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  const statusLabel = { pending: 'Pending', printing: 'Printing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };

  tbody.innerHTML = jobs.map(j => `
    <tr>
      <td>
        <div class="cell-name">${j.customer_name}</div>
        <div class="cell-id">${j.customer_student_id || '—'} · #${j.id.slice(0,8).toUpperCase()}</div>
      </td>
      <td class="cell-file">${getFileEmoji(j.file_name)} ${j.file_name}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--text-3);">
        ${j.color_mode === 'color' ? 'Color' : 'Mono'} · ${j.paper_size}<br>
        ${j.copies}x · ${j.sides === 'double' ? 'Double' : 'Single'}
      </td>
      <td style="white-space:nowrap;">${formatDate(j.created_at)}</td>
      <td>
        <select class="status-select" onchange="updateStatus('${j.id}', this.value)">
          ${['pending','printing','ready','completed','cancelled'].map(s =>
            `<option value="${s}" ${j.status === s ? 'selected' : ''}>${statusLabel[s]}</option>`
          ).join('')}
        </select>
      </td>
      <td>
        <div class="actions">
          <button class="btn btn-primary btn-sm" onclick="printJob('${j.id}')">Print</button>
          <button class="btn btn-secondary btn-sm" onclick="downloadFile('${j.id}')">↓</button>
          <button class="btn btn-danger btn-sm" onclick="deleteJob('${j.id}')">✕</button>
        </div>
      </td>
    </tr>`).join('');

  // Mobile cards
  mobile.innerHTML = jobs.map(j => `
    <div style="padding:16px;border-bottom:1px solid var(--border);">
      <div class="flex-between mb-8">
        <div>
          <div style="font-weight:600;font-size:14px;">${j.customer_name}</div>
          <div style="font-size:11px;color:var(--text-4);">#${j.id.slice(0,8).toUpperCase()} · ${j.customer_student_id || '—'}</div>
        </div>
        <span class="badge badge-${j.status}">${statusLabel[j.status]}</span>
      </div>
      <div style="font-size:13px;color:var(--text-3);margin-bottom:10px;">${getFileEmoji(j.file_name)} ${j.file_name}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select class="status-select" onchange="updateStatus('${j.id}', this.value)">
          ${['pending','printing','ready','completed','cancelled'].map(s =>
            `<option value="${s}" ${j.status === s ? 'selected' : ''}>${statusLabel[s]}</option>`
          ).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="printJob('${j.id}')">Print</button>
        <button class="btn btn-secondary btn-sm" onclick="downloadFile('${j.id}')">Download</button>
        <button class="btn btn-danger btn-sm" onclick="deleteJob('${j.id}')">Delete</button>
      </div>
    </div>`).join('');
}

/* ============================
   OWNER — ACTIONS
   ============================ */
async function updateStatus(jobId, newStatus) {
  const { error } = await sb
    .from('jobs')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) { showToast('Failed to update status.', 'error'); return; }

  const labels = { pending: 'Set to Pending', printing: 'Now Printing', ready: 'Ready for pickup', completed: 'Completed ✓', cancelled: 'Cancelled' };
  showToast(labels[newStatus] || 'Status updated', 'success');

  const job = allJobs.find(j => j.id === jobId);
  if (job) { job.status = newStatus; job.updated_at = new Date().toISOString(); }
  updateStats();
}

async function downloadFile(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job?.file_path) { showToast('File not available.', 'error'); return; }

  const { data, error } = await sb.storage
    .from('print-files')
    .createSignedUrl(job.file_path, 60);

  if (error || !data?.signedUrl) { showToast('Could not get download link.', 'error'); return; }

  const a = document.createElement('a');
  a.href = data.signedUrl;
  a.download = job.file_name;
  a.target = '_blank';
  a.click();
  showToast(`Downloading "${job.file_name}"`, 'success');
}

async function printJob(jobId) {
  const job = allJobs.find(j => j.id === jobId);
  if (!job?.file_path) { showToast('File not available.', 'error'); return; }

  // Get signed URL
  const { data, error } = await sb.storage
    .from('print-files')
    .createSignedUrl(job.file_path, 120);

  if (error || !data?.signedUrl) { showToast('Could not open file for printing.', 'error'); return; }

  // Open in new tab and print
  const win = window.open(data.signedUrl, '_blank');
  if (!win) { showToast('Allow popups to use the print feature.', 'error'); return; }

  showToast('File opened — use Ctrl+P to print', 'success');
  await updateStatus(jobId, 'printing');
  loadAllJobs();
}

async function deleteJob(jobId) {
  if (!confirm('Delete this job? This cannot be undone.')) return;

  const job = allJobs.find(j => j.id === jobId);

  // Delete file from storage
  if (job?.file_path) {
    await sb.storage.from('print-files').remove([job.file_path]);
  }

  const { error } = await sb.from('jobs').delete().eq('id', jobId);
  if (error) { showToast('Failed to delete job.', 'error'); return; }

  showToast('Job deleted.', 'success');
  allJobs = allJobs.filter(j => j.id !== jobId);
  updateStats();
  renderJobs();
}

/* ============================
   INIT
   ============================ */
init();

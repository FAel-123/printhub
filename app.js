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

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.12);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Audio context fallback
  }
}

function setLoading(btnId, loading, label) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span>' : label;
}

/* ============================
   NO-LOGIN DIRECT ACCESS & AUTH
   ============================ */
function getGuestId() {
  let gId = localStorage.getItem('printhub_guest_id');
  if (!gId) {
    gId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    localStorage.setItem('printhub_guest_id', gId);
  }
  return gId;
}

async function init() {
  if (localStorage.getItem('printhub_owner_session') === 'true') {
    currentProfile = { id: 'owner-session', name: 'Owner', role: 'owner', email: OWNER_EMAIL };
    showOwnerApp();
    return;
  }
  showCustomerApp();
}

function showOwnerApp() {
  currentProfile = { id: 'owner-session', name: 'Owner', role: 'owner', email: OWNER_EMAIL };
  $('customerView').classList.add('hidden');
  $('ownerView').classList.remove('hidden');
  $('ownerPortalBtn').classList.add('hidden');
  $('signOutBtn').classList.remove('hidden');
  $('navBrand').innerHTML = '🖨️ PrintHub <span>Owner Dashboard</span>';
  initOwnerDashboard();
}

function showCustomerApp() {
  currentProfile = { id: getGuestId(), name: 'Customer', role: 'customer' };
  $('ownerView').classList.add('hidden');
  $('customerView').classList.remove('hidden');
  $('ownerPortalBtn').classList.remove('hidden');
  $('signOutBtn').classList.add('hidden');
  $('navBrand').innerHTML = '🖨️ PrintHub <span>College Service</span>';
  onOptionChange();
  initRealtimeSubscription();
}

function openOwnerModal() {
  $('ownerModal').classList.remove('hidden');
  $('ownerPassInput').value = '';
  $('ownerModalErr').classList.add('hidden');
}

function closeOwnerModal() {
  $('ownerModal').classList.add('hidden');
}

function unlockOwnerDashboard() {
  const pass = ($('ownerPassInput').value || '').trim();
  if (pass === '777607' || pass === '1234' || pass === '123456') {
    localStorage.setItem('printhub_owner_session', 'true');
    closeOwnerModal();
    showToast('Welcome Owner! Dashboard unlocked.', 'success');
    showOwnerApp();
  } else {
    $('ownerModalErr').classList.remove('hidden');
  }
}

function signOutOwner() {
  localStorage.removeItem('printhub_owner_session');
  showToast('Signed out of owner mode.', 'info');
  showCustomerApp();
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
/* ============================
   CUSTOMER — FILE & CHECKOUT STEP FLOW
   ============================ */
function goToStep1() {
  $('step1View').classList.remove('hidden');
  $('step2View').classList.add('hidden');
  $('step1Indicator').classList.add('active');
  $('step2Indicator').classList.remove('active');
}

function goToStep2() {
  if (!selectedFile) {
    showToast('Please select a file to print first.', 'error');
    return;
  }
  $('step1View').classList.add('hidden');
  $('step2View').classList.remove('hidden');
  $('step1Indicator').classList.remove('active');
  $('step2Indicator').classList.add('active');

  $('step2FileName').textContent = selectedFile.name;

  if (currentProfile) {
    if (!$('custName').value)  $('custName').value  = currentProfile.name || '';
    if (!$('custPhone').value) $('custPhone').value = currentProfile.phone || '';
  }

  onOptionChange();
  onPaymentChange();
}

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

  if ($('fileConfirmCard')) $('fileConfirmCard').classList.remove('hidden');
  if ($('nextToStep2Btn'))  $('nextToStep2Btn').disabled = false;
  onOptionChange();
}

function clearFile() {
  selectedFile = null;
  $('fileInput').value = '';
  $('filePill').classList.add('hidden');
  $('filePill').innerHTML = '';
  if ($('fileConfirmCard')) $('fileConfirmCard').classList.add('hidden');
  if ($('nextToStep2Btn'))  $('nextToStep2Btn').disabled = true;
}

// Drag & drop
const zone = $('uploadZone');
if (zone) {
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
}

/* ============================
   CUSTOMER — OPTIONS & PAYMENT
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

function onPaymentChange() {
  const isCash = $('payCash').checked;
  $('optPayCash').classList.toggle('selected', isCash);
  $('optPayToyyib').classList.toggle('selected', !isCash);
  $('payNote').textContent = isCash
    ? 'Pay at counter · Final total by page count'
    : 'ToyyibPay Gateway · FPX Online Banking';
}

/* ============================
   CUSTOMER — SUBMIT JOB & TRACKING
   ============================ */
async function submitJob() {
  if (!selectedFile) {
    showToast('Please upload a file first.', 'error');
    goToStep1();
    return;
  }

  const custName  = $('custName')?.value.trim() || 'Guest Student';
  const custPhone = $('custPhone')?.value.trim() || '';
  const isToyyib  = $('payToyyib')?.checked;
  const guestId   = getGuestId();

  setLoading('submitBtn', true, 'Confirm & Place Order 🖨️');

  try {
    // 1. Upload file to Supabase Storage
    const ext      = selectedFile.name.split('.').pop();
    const ts       = Date.now();
    const filePath = `public/${ts}_${selectedFile.name}`;

    const { error: uploadErr } = await sb.storage
      .from('print-files')
      .upload(filePath, selectedFile, { cacheControl: '3600', upsert: false });

    // Fallback if storage upload encounters error
    const finalPath = uploadErr ? `temp_${ts}_${selectedFile.name}` : filePath;

    // 2. Insert job record
    const { data: job, error: insertErr } = await sb.from('jobs').insert({
      customer_id:         guestId,
      customer_name:       custName,
      customer_student_id: custPhone,
      file_name:           selectedFile.name,
      file_path:           finalPath,
      file_size:           selectedFile.size,
      color_mode:          $('rdMono').checked ? 'monochrome' : 'color',
      paper_size:          $('paperSize').value,
      sides:               $('sides').value,
      copies:              copies,
      pickup_time:         $('pickupTime').value,
      instructions:        $('instructions').value.trim(),
      status:              'pending',
    }).select().single();

    if (insertErr) throw new Error('Failed to save order: ' + insertErr.message);

    setLoading('submitBtn', false, 'Confirm & Place Order 🖨️');

    if (isToyyib) {
      showToast('Order saved! Directing to ToyyibPay portal...', 'info');
    }

    // Save phone for auto-tracking
    if (custPhone) localStorage.setItem('printhub_last_phone', custPhone);

    // Show success modal
    $('successId').textContent = 'Job ID: #' + job.id.slice(0, 8).toUpperCase() + (isToyyib ? ' · ToyyibPay Selected' : ' · Cash on Pickup');
    $('successOverlay').classList.remove('hidden');

  } catch (err) {
    setLoading('submitBtn', false, 'Confirm & Place Order 🖨️');
    showToast(err.message, 'error');
  }
}

function showTrackOrderModal() {
  $('trackModal').classList.remove('hidden');
  const savedPhone = localStorage.getItem('printhub_last_phone') || '';
  if (savedPhone) {
    $('trackSearchInput').value = savedPhone;
    searchTrackOrder();
  }
}

function closeTrackModal() {
  $('trackModal').classList.add('hidden');
}

async function searchTrackOrder() {
  const query = ($('trackSearchInput').value || '').trim().toLowerCase();
  const resEl = $('trackResultList');

  if (!query) {
    resEl.innerHTML = '<div class="text-xs text-muted">Please enter your phone number or Order ID to search.</div>';
    return;
  }

  resEl.innerHTML = '<div class="flex-center" style="padding:16px;"><div class="spinner spinner-dark"></div></div>';

  const { data: jobs, error } = await sb
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !jobs) {
    resEl.innerHTML = '<div class="text-xs error-msg">Could not search orders.</div>';
    return;
  }

  const matches = jobs.filter(j =>
    (j.customer_student_id || '').toLowerCase().includes(query) ||
    (j.customer_name || '').toLowerCase().includes(query) ||
    (j.id || '').toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    resEl.innerHTML = '<div class="empty" style="padding:16px;"><h3>No order found</h3><p style="font-size:12px;">Check your phone number or Order ID.</p></div>';
    return;
  }

  const statusLabel = { pending: 'Pending', printing: 'Printing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };

  resEl.innerHTML = matches.map(j => `
    <div class="order-card" style="margin-bottom:8px;">
      <div class="order-card-header">
        <div>
          <div class="order-file">${getFileEmoji(j.file_name)} ${j.file_name}</div>
          <div class="order-id">#${j.id.slice(0, 8).toUpperCase()} · ${j.customer_name}</div>
        </div>
        <span class="badge badge-${j.status}">${statusLabel[j.status] || j.status}</span>
      </div>
      <div class="order-meta">
        <span class="order-meta-item">${j.color_mode === 'color' ? 'Color' : 'Monochrome'}</span>
        <span class="order-meta-item">·</span>
        <span class="order-meta-item">${j.copies} copies</span>
        <span class="order-meta-item">·</span>
        <span class="order-meta-item">${j.paper_size}</span>
      </div>
    </div>`).join('');
}

function closeSuccess() {
  $('successOverlay').classList.add('hidden');
  clearFile();
  $('instructions').value = '';
  copies = 1;
  $('copiesNum').textContent = '1';
  goToStep1();
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

function showOwnerTab(tab) {
  const isQueue = tab === 'queue';
  $('ownerPanelQueue').classList.toggle('hidden', !isQueue);
  $('ownerPanelAnalysis').classList.toggle('hidden', isQueue);
  $('tabOwnerQueue').classList.toggle('active', isQueue);
  $('tabOwnerAnalysis').classList.toggle('active', !isQueue);
  if (!isQueue) renderAnalytics();
}

let prevJobsLength = -1;

function initRealtimeSubscription() {
  try {
    sb.channel('realtime:jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, (payload) => {
        if (currentProfile?.role === 'owner') {
          if (payload.eventType === 'INSERT') {
            playNotificationSound();
            showToast(`🔔 New Order! ${payload.new.customer_name || 'Customer'}: ${payload.new.file_name}`, 'success');
            document.title = `🔔 NEW ORDER! — PrintHub`;
          }
          loadAllJobs();
        } else {
          if (payload.eventType === 'UPDATE' && payload.new.customer_id === currentUser?.id) {
            playNotificationSound();
            showToast(`📦 Order Status: "${payload.new.file_name}" is now ${payload.new.status.toUpperCase()}!`, 'info');
            loadOrders();
          }
        }
      })
      .subscribe();
  } catch (e) {
    // Subscription fallback
  }
}

function initOwnerDashboard() {
  buildFilterBar();
  loadAllJobs();
  initRealtimeSubscription();
  // Auto-refresh poll every 15s as backup
  refreshTimer = setInterval(loadAllJobs, 15000);
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

  const newJobs = jobs || [];

  if (prevJobsLength !== -1 && newJobs.length > prevJobsLength) {
    const newest = newJobs[0];
    playNotificationSound();
    showToast(`🔔 New Order from ${newest.customer_name || 'Student'}! File: ${newest.file_name}`, 'success');
    document.title = `🔔 NEW ORDER! — PrintHub`;
  }
  prevJobsLength = newJobs.length;

  allJobs = newJobs;
  updateStats();
  renderJobs();
  if (!$('ownerPanelAnalysis').classList.contains('hidden')) {
    renderAnalytics();
  }
}

function renderAnalytics() {
  const activeJobs = allJobs.filter(j => j.status !== 'cancelled');
  const total = activeJobs.length || 1;

  // 1. Revenue
  const rev = activeJobs.reduce((sum, j) => {
    const rate = j.color_mode === 'color' ? 0.50 : 0.10;
    return sum + (rate * (j.copies || 1));
  }, 0);
  $('anEstRevenue').textContent = `RM ${rev.toFixed(2)}`;

  // 2. Completed
  const completedCount = allJobs.filter(j => j.status === 'completed').length;
  $('anCompletedCount').textContent = completedCount;

  // 3. Color Ratio
  const colorCount = activeJobs.filter(j => j.color_mode === 'color').length;
  const monoCount  = activeJobs.length - colorCount;
  const colorPct   = Math.round((colorCount / total) * 100);
  const monoPct    = 100 - colorPct;

  $('anColorRatio').textContent = `${colorPct}%`;
  $('anColorSub').textContent = `${monoPct}% Monochrome (${monoCount} jobs)`;

  $('distColorPct').textContent = `${colorPct}% (${colorCount})`;
  $('distColorBar').style.width = `${colorPct}%`;
  $('distMonoPct').textContent = `${monoPct}% (${monoCount})`;
  $('distMonoBar').style.width = `${monoPct}%`;

  // 4. Avg Copies
  const totalCopies = activeJobs.reduce((s, j) => s + (j.copies || 1), 0);
  const avgCopies = (totalCopies / total).toFixed(1);
  $('anAvgCopies').textContent = avgCopies;

  // 5. Paper Sizes
  const a4Count     = activeJobs.filter(j => j.paper_size === 'A4').length;
  const letterCount = activeJobs.filter(j => j.paper_size === 'Letter').length;
  const a3Count     = activeJobs.filter(j => j.paper_size === 'A3').length;

  const a4Pct     = Math.round((a4Count / total) * 100);
  const letterPct = Math.round((letterCount / total) * 100);
  const a3Pct     = Math.round((a3Count / total) * 100);

  $('distA4Pct').textContent = `${a4Pct}% (${a4Count})`;
  $('distA4Bar').style.width = `${a4Pct}%`;
  $('distLetterPct').textContent = `${letterPct}% (${letterCount})`;
  $('distLetterBar').style.width = `${letterPct}%`;
  $('distA3Pct').textContent = `${a3Pct}% (${a3Count})`;
  $('distA3Bar').style.width = `${a3Pct}%`;

  // 6. Pickup Slots
  const readyCount = activeJobs.filter(j => (j.pickup_time || '').includes('ready')).length;
  const mornCount  = activeJobs.filter(j => (j.pickup_time || '').includes('Morning')).length;
  const aftCount   = activeJobs.filter(j => (j.pickup_time || '').includes('Afternoon')).length;
  const eveCount   = activeJobs.filter(j => (j.pickup_time || '').includes('Evening')).length;

  $('distReadyPct').textContent = `${Math.round((readyCount / total) * 100)}% (${readyCount})`;
  $('distReadyBar').style.width = `${Math.round((readyCount / total) * 100)}%`;
  $('distMornPct').textContent  = `${Math.round((mornCount / total) * 100)}% (${mornCount})`;
  $('distMornBar').style.width  = `${Math.round((mornCount / total) * 100)}%`;
  $('distAftPct').textContent   = `${Math.round((aftCount / total) * 100)}% (${aftCount})`;
  $('distAftBar').style.width   = `${Math.round((aftCount / total) * 100)}%`;
  $('distEvePct').textContent   = `${Math.round((eveCount / total) * 100)}% (${eveCount})`;
  $('distEveBar').style.width   = `${Math.round((eveCount / total) * 100)}%`;

  // 7. Active Customers
  const customerMap = {};
  allJobs.forEach(j => {
    const name = j.customer_name || 'Anonymous';
    if (!customerMap[name]) customerMap[name] = { count: 0, spend: 0 };
    customerMap[name].count += 1;
    const rate = j.color_mode === 'color' ? 0.50 : 0.10;
    customerMap[name].spend += (rate * (j.copies || 1));
  });

  const topCust = Object.entries(customerMap)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (topCust.length === 0) {
    $('topCustomersList').innerHTML = '<div class="text-muted text-xs">No active customer history yet.</div>';
  } else {
    $('topCustomersList').innerHTML = topCust.map(c => `
      <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border);">
        <div>
          <span style="font-weight:600;color:var(--text);">${c.name}</span>
          <span style="font-size:11px;color:var(--text-4);margin-left:6px;">${c.count} order${c.count > 1 ? 's' : ''}</span>
        </div>
        <span style="font-weight:600;color:var(--accent);">RM ${c.spend.toFixed(2)}</span>
      </div>`).join('');
  }
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

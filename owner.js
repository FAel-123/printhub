/* =============================================
   owner.js — PrintHub Owner Dashboard Logic
   ============================================= */

/* ---- Config ---- */
const OWNER_PIN = '1234'; // Change this to your preferred PIN
const JOBS_KEY  = 'printhub_jobs';
const OWNER_SESSION_KEY = 'printhub_owner_session';

/* ---- State ---- */
let currentFilter = 'all';
let allJobs = [];
let refreshTimer = null;

/* ---- Utility ---- */
function formatDate(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hrs ago`;
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(name) {
  if (!name) return '📄';
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf: '📕', doc: '📘', docx: '📘', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️' };
  return icons[ext] || '📄';
}

function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function getJobs() { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]'); }
function saveJobs(j) { localStorage.setItem(JOBS_KEY, JSON.stringify(j)); }

/* ---- PIN Auth ---- */
// PIN digit auto-advance
document.querySelectorAll('.pin-digit').forEach((input, i, inputs) => {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/, '');
    if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
    if (i === inputs.length - 1 && input.value) verifyPin();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
  });
});

function verifyPin() {
  const pin = Array.from(document.querySelectorAll('.pin-digit')).map(i => i.value).join('');
  if (pin.length < 4) { showToast('Please enter your 4-digit PIN.', 'error'); return; }

  if (pin === OWNER_PIN) {
    sessionStorage.setItem(OWNER_SESSION_KEY, '1');
    showDashboard();
  } else {
    showToast('Incorrect PIN. Please try again.', 'error');
    document.querySelectorAll('.pin-digit').forEach(i => { i.value = ''; i.classList.add('input-error'); });
    setTimeout(() => document.querySelectorAll('.pin-digit').forEach(i => i.classList.remove('input-error')), 1200);
    document.getElementById('pin0').focus();
  }
}

function showDashboard() {
  document.getElementById('pinWall').classList.add('hidden');
  document.getElementById('ownerDashboard').classList.remove('hidden');
  document.getElementById('ownerLogoutBtn').style.display = 'flex';
  document.getElementById('ownerBadge').style.display = 'flex';
  refreshDashboard();
  startAutoRefresh();
}

function ownerLogout() {
  sessionStorage.removeItem(OWNER_SESSION_KEY);
  if (refreshTimer) clearInterval(refreshTimer);
  location.reload();
}

/* ---- Dashboard ---- */
function refreshDashboard() {
  allJobs = getJobs().reverse(); // newest first
  updateStats();
  updateFilterCounts();
  renderJobs();

  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('dashboardSubtitle').textContent = today + ' · Last updated just now';
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshDashboard();
  }, 30000);
}

function updateStats() {
  const today = new Date().toDateString();
  document.getElementById('statTotal').textContent = allJobs.length;
  document.getElementById('statPending').textContent = allJobs.filter(j => j.status === 'pending').length;
  document.getElementById('statPrinting').textContent = allJobs.filter(j => j.status === 'printing').length;
  document.getElementById('statCompleted').textContent = allJobs.filter(j =>
    j.status === 'completed' && new Date(j.updatedAt).toDateString() === today
  ).length;
}

function updateFilterCounts() {
  const statuses = ['pending', 'printing', 'ready', 'completed', 'cancelled'];
  document.getElementById('countAll').textContent = allJobs.length;
  statuses.forEach(s => {
    const el = document.getElementById('count' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.textContent = allJobs.filter(j => j.status === s).length;
  });
}

function setFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderJobs();
}

function renderJobs() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  let jobs = currentFilter === 'all' ? allJobs : allJobs.filter(j => j.status === currentFilter);
  if (search) {
    jobs = jobs.filter(j =>
      j.customerName?.toLowerCase().includes(search) ||
      j.fileName?.toLowerCase().includes(search) ||
      j.id?.toLowerCase().includes(search) ||
      j.customerStudentId?.toLowerCase().includes(search)
    );
  }

  const grid = document.getElementById('jobsGrid');
  if (jobs.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">📭</span>
        <h3>No jobs found</h3>
        <p>${search ? 'No results for your search.' : 'No jobs in this category.'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = jobs.map(job => buildJobCard(job)).join('');
}

function buildJobCard(job) {
  const statusLabel = { pending: 'Pending', printing: 'Printing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
  const pricePerPage = job.colorMode === 'color' ? 0.50 : 0.10;
  const estimatedPrice = (pricePerPage * (job.copies || 1)).toFixed(2);

  return `
    <div class="job-card fade-in" id="card-${job.id}">
      <div class="job-card-header">
        <div style="flex:1;min-width:0;">
          <div class="job-customer-name">${job.customerName}</div>
          <div class="job-order-id">${job.id} · ${job.customerStudentId}</div>
        </div>
        <span class="badge badge-${job.status}">${statusLabel[job.status] || job.status}</span>
      </div>

      <div class="job-meta">
        <span class="job-meta-item"><span class="icon">${getFileIcon(job.fileName)}</span> ${job.fileName}</span>
        <span class="job-meta-item"><span class="icon">${job.colorMode === 'color' ? '🌈' : '🖤'}</span> ${job.colorMode === 'color' ? 'Color' : 'Monochrome'}</span>
        <span class="job-meta-item"><span class="icon">📋</span> ${job.paperSize}</span>
        <span class="job-meta-item"><span class="icon">📑</span> ${job.copies} cop${job.copies > 1 ? 'ies' : 'y'}</span>
        <span class="job-meta-item"><span class="icon">↔️</span> ${job.sides === 'double' ? 'Double-sided' : 'Single-sided'}</span>
        <span class="job-meta-item"><span class="icon">💰</span> RM ${estimatedPrice}+</span>
        <span class="job-meta-item"><span class="icon">⏰</span> ${formatDate(job.submittedAt)}</span>
      </div>

      <div class="job-actions">
        <select class="status-select" onchange="updateStatus('${job.id}', this.value)">
          <option value="pending"   ${job.status === 'pending'   ? 'selected' : ''}>⏳ Pending</option>
          <option value="printing"  ${job.status === 'printing'  ? 'selected' : ''}>🖨️ Printing</option>
          <option value="ready"     ${job.status === 'ready'     ? 'selected' : ''}>📦 Ready</option>
          <option value="completed" ${job.status === 'completed' ? 'selected' : ''}>✅ Completed</option>
          <option value="cancelled" ${job.status === 'cancelled' ? 'selected' : ''}>❌ Cancelled</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="printJob('${job.id}')">🖨️ Print Now</button>
        <button class="btn btn-secondary btn-sm" onclick="downloadFile('${job.id}')">⬇️ Download</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleDetail('${job.id}')">ℹ️ Details</button>
        <button class="btn btn-danger btn-sm" onclick="deleteJob('${job.id}')">🗑️</button>
      </div>

      <!-- Expanded Detail -->
      <div class="job-detail" id="detail-${job.id}">
        <div class="job-detail-grid">
          <div class="detail-item">
            <label>Customer Email</label>
            <span>${job.customerEmail || 'N/A'}</span>
          </div>
          <div class="detail-item">
            <label>Phone</label>
            <span>${job.customerPhone || 'N/A'}</span>
          </div>
          <div class="detail-item">
            <label>File Size</label>
            <span>${formatFileSize(job.fileSize)}</span>
          </div>
          <div class="detail-item">
            <label>Preferred Pickup</label>
            <span>${job.pickupTime || 'As soon as ready'}</span>
          </div>
          ${job.instructions ? `
          <div class="detail-item" style="grid-column:1/-1;">
            <label>Special Instructions</label>
            <span style="white-space:pre-wrap;">${job.instructions}</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
}

/* ---- Actions ---- */
function updateStatus(jobId, newStatus) {
  const jobs = getJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return;
  jobs[idx].status = newStatus;
  jobs[idx].updatedAt = new Date().toISOString();
  saveJobs(jobs);
  allJobs = jobs.slice().reverse();
  updateStats();
  updateFilterCounts();

  const statusMessages = {
    pending: 'Job set back to Pending.',
    printing: 'Job is now Printing!',
    ready: '📦 Job marked as Ready for pickup.',
    completed: '✅ Job marked as Completed.',
    cancelled: 'Job cancelled.'
  };
  showToast(statusMessages[newStatus] || 'Status updated.', 'success');

  // Re-render only the card badge for smoothness
  const card = document.getElementById('card-' + jobId);
  if (card) {
    const badge = card.querySelector('.badge');
    const statusLabel = { pending: 'Pending', printing: 'Printing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
    if (badge) {
      badge.className = `badge badge-${newStatus}`;
      badge.textContent = statusLabel[newStatus];
    }
    // Apply left border color by re-rendering if filter hides it
    if (currentFilter !== 'all' && currentFilter !== newStatus) {
      card.style.opacity = '0.4';
      setTimeout(() => renderJobs(), 800);
    }
  }
}

function toggleDetail(jobId) {
  const detail = document.getElementById('detail-' + jobId);
  if (detail) detail.classList.toggle('open');
}

function printJob(jobId) {
  const jobs = getJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job || !job.fileData) {
    showToast('File data not available for printing.', 'error'); return;
  }

  showToast('Opening print dialog...', 'info');

  // Update status to printing
  updateStatus(jobId, 'printing');

  // Open file in a new window and print
  const printWin = window.open('', '_blank');
  if (!printWin) {
    showToast('Popup blocked! Please allow popups and try again.', 'error'); return;
  }

  const isImage = job.fileData.startsWith('data:image');
  const isPDF   = job.fileData.startsWith('data:application/pdf');

  if (isImage) {
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PrintHub — ${job.fileName}</title>
        <style>
          * { margin:0;padding:0;box-sizing:border-box; }
          body { display:flex;justify-content:center;align-items:flex-start;min-height:100vh; }
          img { max-width:100%;display:block; }
          @media print {
            @page { margin: 0; }
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        <img src="${job.fileData}" onload="window.print();" />
      </body>
      </html>`);
    printWin.document.close();
  } else if (isPDF) {
    // For PDF, embed in iframe and print
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PrintHub — ${job.fileName}</title>
        <style>
          * { margin:0;padding:0;box-sizing:border-box; }
          body { height:100vh; }
          iframe { width:100%;height:100%;border:none; }
        </style>
      </head>
      <body>
        <iframe src="${job.fileData}" onload="this.contentWindow.print();"></iframe>
      </body>
      </html>`);
    printWin.document.close();
  } else {
    // DOCX and other — trigger download with instructions
    showToast('Word files: please download and print manually. PDF is best for direct printing.', 'info', 6000);
    downloadFile(jobId);
  }
}

function downloadFile(jobId) {
  const jobs = getJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job || !job.fileData) {
    showToast('File not available.', 'error'); return;
  }
  const a = document.createElement('a');
  a.href = job.fileData;
  a.download = job.fileName;
  a.click();
  showToast(`Downloading "${job.fileName}"...`, 'success');
}

function deleteJob(jobId) {
  if (!confirm(`Delete job ${jobId}? This cannot be undone.`)) return;
  const jobs = getJobs().filter(j => j.id !== jobId);
  saveJobs(jobs);
  allJobs = jobs.slice().reverse();
  updateStats();
  updateFilterCounts();
  renderJobs();
  showToast('Job deleted.', 'info');
}

/* ---- Init ---- */
function init() {
  // Auto-login if session exists
  if (sessionStorage.getItem(OWNER_SESSION_KEY)) {
    showDashboard();
  } else {
    document.getElementById('pin0').focus();
  }
}

// Allow Enter key on PIN
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('pinWall') && !document.getElementById('pinWall').classList.contains('hidden')) {
    verifyPin();
  }
});

init();

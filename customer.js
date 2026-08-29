/* =============================================
   customer.js — PrintHub Customer Portal Logic
   ============================================= */

/* ---- Utility ---- */
function generateId(prefix = 'JOB') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix + '-';
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

/* ---- State ---- */
let currentUser = null;
let selectedFile = null;
let fileData = null; // base64
let copies = 1;

/* ---- LocalStorage Keys ---- */
const USERS_KEY = 'printhub_users';
const JOBS_KEY  = 'printhub_jobs';
const SESSION_KEY = 'printhub_session';

function getUsers()  { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
function getJobs()   { return JSON.parse(localStorage.getItem(JOBS_KEY)  || '[]'); }
function saveJobs(j) { localStorage.setItem(JOBS_KEY, JSON.stringify(j)); }

/* ---- Auth ---- */
function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('registerForm').classList.toggle('hidden', isLogin);
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
}

function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const studentId = document.getElementById('loginStudentId').value.trim();
  if (!email || !studentId) { showToast('Please fill in all fields.', 'error'); return; }

  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.studentId === studentId);
  if (!user) {
    showToast('No account found. Please check your email & Student ID, or register.', 'error');
    return;
  }
  loginUser(user);
}

function handleRegister() {
  const name = document.getElementById('regName').value.trim();
  const studentId = document.getElementById('regStudentId').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();

  if (!name || !studentId || !email) { showToast('Please fill in all required fields.', 'error'); return; }
  if (!/\S+@\S+\.\S+/.test(email)) { showToast('Please enter a valid email address.', 'error'); return; }

  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    showToast('An account with this email already exists. Please sign in.', 'error'); return;
  }

  const user = { id: generateId('USR'), name, studentId, email, phone, createdAt: new Date().toISOString() };
  users.push(user);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  loginUser(user);
  showToast(`Welcome, ${name}! Account created successfully.`, 'success');
}

function loginUser(user) {
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  document.getElementById('authWall').classList.add('hidden');
  document.getElementById('customerPortal').classList.remove('hidden');
  document.getElementById('logoutBtn').style.display = 'flex';
  document.getElementById('welcomeName').textContent = user.name;
  document.getElementById('welcomeId').textContent = '(' + user.studentId + ')';

  // Pre-fill phone
  if (user.phone) document.getElementById('contactPhone').value = user.phone;
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  currentUser = null;
  selectedFile = null;
  fileData = null;
  location.reload();
}

/* ---- Portal Tabs ---- */
function showPortalTab(tab) {
  const isSubmit = tab === 'submit';
  document.getElementById('portalSubmit').classList.toggle('hidden', !isSubmit);
  document.getElementById('portalOrders').classList.toggle('hidden', isSubmit);
  document.getElementById('tabSubmit').classList.toggle('active', isSubmit);
  document.getElementById('tabOrders').classList.toggle('active', !isSubmit);
  if (!isSubmit) loadOrders();
}

/* ---- File Upload ---- */
function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    showToast('File is too large. Maximum size is 20MB.', 'error'); return;
  }

  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    fileData = e.target.result;
    updateOptions();
  };
  reader.readAsDataURL(file);

  // Show preview
  const preview = document.getElementById('filePreview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="file-selected">
      <span class="file-selected-icon">${getFileIcon(file.name)}</span>
      <span class="file-selected-name">${file.name}</span>
      <span class="file-selected-size">${formatFileSize(file.size)}</span>
      <button onclick="clearFile()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;margin-left:8px;">✕</button>
    </div>`;

  document.getElementById('sumFile').textContent = file.name;
  showToast(`File "${file.name}" selected.`, 'success');
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf: '📕', doc: '📘', docx: '📘', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️' };
  return icons[ext] || '📄';
}

function clearFile() {
  selectedFile = null;
  fileData = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').classList.add('hidden');
  document.getElementById('sumFile').textContent = 'No file selected';
  updateOptions();
}

/* ---- Drag & Drop ---- */
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('fileInput').files = dt.files;
    handleFileSelect(document.getElementById('fileInput'));
  }
});

/* ---- Copies Counter ---- */
function changeCopies(delta) {
  copies = Math.max(1, Math.min(99, copies + delta));
  document.getElementById('copiesDisplay').textContent = copies;
  document.getElementById('sumCopies').textContent = copies;
  updatePrice();
}

/* ---- Options ---- */
function updateOptions() {
  // Color mode radio cards
  const isMono = document.getElementById('colorMono').checked;
  document.getElementById('optMono').classList.toggle('selected', isMono);
  document.getElementById('optColor').classList.toggle('selected', !isMono);

  document.getElementById('sumMode').textContent = isMono ? 'Monochrome' : 'Full Color';
  document.getElementById('sumPaper').textContent = document.getElementById('paperSize').value;
  document.getElementById('sumSides').textContent = document.getElementById('sides').value === 'single' ? 'Single-sided' : 'Double-sided';
  document.getElementById('sumPickup').textContent = document.getElementById('pickupTime').value;
  updatePrice();
}

function updatePrice() {
  const isMono = document.getElementById('colorMono').checked;
  const pricePerPage = isMono ? 0.10 : 0.50;
  // Estimate: if no file, assume 1 page
  const estimated = (pricePerPage * copies).toFixed(2);
  document.getElementById('priceEstimate').textContent = `RM ${estimated}+`;
}

// Option card click handlers (for labels)
document.querySelectorAll('.option-card').forEach(card => {
  card.addEventListener('click', () => updateOptions());
});

/* ---- Submit Job ---- */
function submitJob() {
  if (!currentUser) { showToast('Please sign in first.', 'error'); return; }
  if (!selectedFile || !fileData) { showToast('Please upload a file first.', 'error'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting...';

  setTimeout(() => {
    const jobId = generateId('JOB');
    const isMono = document.getElementById('colorMono').checked;
    const job = {
      id: jobId,
      customerId: currentUser.id,
      customerName: currentUser.name,
      customerStudentId: currentUser.studentId,
      customerEmail: currentUser.email,
      customerPhone: document.getElementById('contactPhone').value || currentUser.phone || 'N/A',
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      fileData: fileData,
      colorMode: isMono ? 'monochrome' : 'color',
      paperSize: document.getElementById('paperSize').value,
      sides: document.getElementById('sides').value,
      copies: copies,
      pickupTime: document.getElementById('pickupTime').value,
      instructions: document.getElementById('specialInstructions').value.trim(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const jobs = getJobs();
    jobs.push(job);
    saveJobs(jobs);

    btn.disabled = false;
    btn.innerHTML = '🖨️ Submit Print Job';

    // Show success modal
    document.getElementById('successOrderId').textContent = 'Order ID: ' + jobId;
    document.getElementById('successModal').classList.add('open');
  }, 1200);
}

function closeModal() {
  document.getElementById('successModal').classList.remove('open');
  showPortalTab('orders');
}

function closeModalAndReset() {
  document.getElementById('successModal').classList.remove('open');
  clearFile();
  document.getElementById('specialInstructions').value = '';
  copies = 1;
  document.getElementById('copiesDisplay').textContent = '1';
  updateOptions();
  showPortalTab('submit');
}

/* ---- Load Orders ---- */
function loadOrders() {
  if (!currentUser) return;
  const jobs = getJobs().filter(j => j.customerId === currentUser.id).reverse();
  const list = document.getElementById('ordersList');

  if (jobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">🖨️</span>
        <h3>No print jobs yet</h3>
        <p>Submit your first job and it will appear here.</p>
      </div>`;
    return;
  }

  const statusLabel = { pending: 'Pending', printing: 'Printing', ready: 'Ready for Pickup', completed: 'Completed', cancelled: 'Cancelled' };
  list.innerHTML = jobs.map(job => `
    <div class="order-item status-${job.status}">
      <div class="order-header">
        <div>
          <div class="order-file">${getFileIcon(job.fileName)} ${job.fileName}</div>
          <div class="order-id">${job.id}</div>
        </div>
        <span class="badge badge-${job.status}">${statusLabel[job.status] || job.status}</span>
      </div>
      <div class="order-meta">
        <span class="order-meta-tag">${job.colorMode === 'color' ? '🌈 Color' : '🖤 Mono'}</span>
        <span class="order-meta-tag">📋 ${job.paperSize}</span>
        <span class="order-meta-tag">📑 ${job.copies} cop${job.copies > 1 ? 'ies' : 'y'}</span>
        <span class="order-meta-tag">${job.sides === 'double' ? '↔️ Double-sided' : '➡️ Single-sided'}</span>
      </div>
      ${job.instructions ? `<div style="font-size:12px;color:var(--text-muted);margin-top:10px;">📝 ${job.instructions}</div>` : ''}
      <div class="order-time">Submitted: ${formatDate(job.submittedAt)}</div>
    </div>`).join('');
}

/* ---- Init ---- */
function init() {
  const session = sessionStorage.getItem(SESSION_KEY);
  if (session) {
    try { loginUser(JSON.parse(session)); }
    catch (_) { sessionStorage.removeItem(SESSION_KEY); }
  }
  updateOptions();
}

// Listen for pickup time change
document.getElementById('pickupTime').addEventListener('change', updateOptions);
document.getElementById('paperSize').addEventListener('change', updateOptions);
document.getElementById('sides').addEventListener('change', updateOptions);

init();

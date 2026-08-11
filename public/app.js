const api = {
  login: '/api/login',
  complaints: '/api/complaints',
  summary: '/api/summary'
};

let currentUser = null;

const sections = {
  home: document.getElementById('page-home'),
  loginChoice: document.getElementById('page-loginChoice'),
  loginStudent: document.getElementById('page-loginStudent'),
  loginAdmin: document.getElementById('page-loginAdmin'),
  newComplaint: document.getElementById('page-newComplaint'),
  track: document.getElementById('page-track')
};

function showSection(sectionKey) {
  Object.values(sections).forEach(sec => sec.classList.remove('active'));
  const section = sections[sectionKey];
  if (section) section.classList.add('active');
}

function openLogin() {
  showSection('loginChoice');
}

function closeLogin() {
  showSection('home');
}

function applyUserDetails(user) {
  currentUser = user;
  const profileCard = document.getElementById('userProfileCard');
  const userName = document.getElementById('userNameDisplay');
  const userRole = document.getElementById('userRoleDisplay');
  const userReg = document.getElementById('userRegNumberDisplay');
  const complaintStudent = document.getElementById('complaintStudent');
  const complaintReg = document.getElementById('complaintRegNumber');

  if (profileCard) profileCard.classList.remove('hidden');
  if (userName) userName.textContent = user.name;
  if (userRole) userRole.textContent = user.role;
  if (userReg) userReg.textContent = user.registrationNumber || 'N/A';
  if (complaintStudent) {
    complaintStudent.value = user.name;
    complaintStudent.readOnly = true;
  }
  if (complaintReg) {
    complaintReg.value = user.registrationNumber || '';
    complaintReg.readOnly = true;
  }
}

async function refreshStats() {
  try {
    const response = await fetch(api.summary);
    if (!response.ok) throw new Error('Unable to load summary');
    const summary = await response.json();
    document.getElementById('statTotal').textContent = summary.total;
    document.getElementById('statPending').textContent = summary.pending;
    document.getElementById('statProgress').textContent = summary.inProgress;
    document.getElementById('statComplete').textContent = summary.completed;
  } catch (err) {
    showToast('Could not load summary data.', 'error');
  }
}

async function submitComplaint(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(api.complaints, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Unable to submit complaint');
    }

    const complaint = await response.json();
    showToast(`Complaint submitted: ${complaint.id}`, 'success');
    form.reset();
    showSection('home');
    refreshStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function trackComplaint() {
  const value = document.getElementById('trackInput').value.trim();
  const result = document.getElementById('trackResult');
  result.classList.add('hidden');

  if (!value) {
    showToast('Please enter a complaint ID.', 'warning');
    return;
  }

  try {
    const response = await fetch(`${api.complaints}/${encodeURIComponent(value)}`);
    if (!response.ok) {
      if (response.status === 404) showToast('Complaint not found.', 'warning');
      else throw new Error('Tracking error');
      return;
    }

    const complaint = await response.json();
    result.innerHTML = `<p><strong>ID:</strong> ${complaint.id}</p><p><strong>Student:</strong> ${complaint.student}</p><p><strong>Room:</strong> ${complaint.room}</p><p><strong>Category:</strong> ${complaint.category}</p><p><strong>Priority:</strong> ${complaint.priority}</p><p><strong>Status:</strong> ${complaint.status}</p><p><strong>Submitted:</strong> ${new Date(complaint.createdAt).toLocaleString()}</p>`;
    result.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showToast(message, type = 'info') {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 4000);
}

async function handleLogin(event, expectedRole) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.role = expectedRole;

  try {
    const response = await fetch(api.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const user = await response.json();
    applyUserDetails(user);
    closeLogin();
    showToast(`Logged in as ${user.name} (${user.role})`, 'success');
    showSection('home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function init() {
  document.getElementById('complaintForm').addEventListener('submit', submitComplaint);
  document.getElementById('studentLoginForm').addEventListener('submit', (event) => handleLogin(event, 'student'));
  document.getElementById('adminLoginForm').addEventListener('submit', (event) => handleLogin(event, 'admin'));
  refreshStats();
}

document.addEventListener('DOMContentLoaded', init);

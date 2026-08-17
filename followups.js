import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// Files are stored directly inside Firestore documents (base64) so no
// paid Firebase Storage / Blaze plan is required. Max ~700KB per file.

// =====================================================================
// 1) PASTE YOUR FIREBASE CONFIG HERE (from Firebase Console > Project
//    Settings > General > Your apps > SDK setup and configuration)
// =====================================================================
const firebaseConfig = {
  apiKey: "AIzaSyB4E5b8LcC7JTdZEZJyrHGCb106sLsGHJI",
  authDomain: "soulasia-portal.firebaseapp.com",
  projectId: "soulasia-portal",
  storageBucket: "soulasia-portal.firebasestorage.app",
  messagingSenderId: "43726840287",
  appId: "1:43726840287:web:4760837ff0db700b16e46a"
};

const CONFIGURED = firebaseConfig.apiKey !== "YOUR_API_KEY";
if (!CONFIGURED) {
  document.getElementById('connBanner').classList.add('visible');
}

const app = CONFIGURED ? initializeApp(firebaseConfig) : null;
const db = CONFIGURED ? getFirestore(app) : null;
const MAX_FILE_BYTES = 700000; // ~700KB, stays safely under Firestore's 1MB document cap once base64-encoded

const FILE_SECTIONS = ['client_info', 'pi_permit', 'follow_up', 'inspection', 'loading', 'shipment', 'documents'];

function emptyFileBucket() {
  const bucket = {};
  FILE_SECTIONS.forEach(s => { bucket[s] = []; });
  return bucket;
}

let currentUser = null;
let currentRole = null;
let viewingClient = null;
let filesUnsub = null;
let chatUnsub = null;
let allClientFiles = emptyFileBucket();
let filesById = {};

async function ensureSeedAccounts() {
  if (!CONFIGURED) return;
  const adminSnap = await getDoc(doc(db, 'clients', 'admin'));
  if (!adminSnap.exists()) {
    await setDoc(doc(db, 'clients', 'admin'), { password: 'admin123', role: 'admin' });
  }
  const demoSnap = await getDoc(doc(db, 'clients', 'demo'));
  if (!demoSnap.exists()) {
    await setDoc(doc(db, 'clients', 'demo'), { password: 'demo123', role: 'client' });
    await setDoc(doc(db, 'clientData', 'demo'), { name: 'demo', company: '', email: '', project: '' });
    await addDoc(collection(db, 'clientChats', 'demo', 'messages'), {
      sender: 'admin', message: 'Welcome! How can I help you today?',
      time: new Date().toLocaleTimeString(), timestamp: serverTimestamp()
    });
  }
}

// ===== ADMIN: CREATE ACCOUNT =====

window.createAccount = async function () {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  const msgEl = document.getElementById('adminMessage');

  if (!CONFIGURED) { msgEl.textContent = 'Firebase is not configured yet.'; msgEl.style.color = '#c0392b'; return; }
  if (!username || !password) { msgEl.textContent = 'Please enter both username and password.'; msgEl.style.color = '#c0392b'; return; }
  if (username.length < 3) { msgEl.textContent = 'Username must be at least 3 characters.'; msgEl.style.color = '#c0392b'; return; }
  if (password.length < 4) { msgEl.textContent = 'Password must be at least 4 characters.'; msgEl.style.color = '#c0392b'; return; }

  try {
    const existing = await getDoc(doc(db, 'clients', username));
    if (existing.exists()) { msgEl.textContent = `Username "${username}" already exists.`; msgEl.style.color = '#c0392b'; return; }

    await setDoc(doc(db, 'clients', username), { password, role: 'client' });
    await setDoc(doc(db, 'clientData', username), { name: username, company: '', email: '', project: '' });
    await addDoc(collection(db, 'clientChats', username, 'messages'), {
      sender: 'admin', message: 'Welcome! How can I help you today?',
      time: new Date().toLocaleTimeString(), timestamp: serverTimestamp()
    });

    msgEl.textContent = `Account "${username}" created successfully!`;
    msgEl.style.color = '#27ae60';
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
  } catch (err) {
    console.error(err);
    msgEl.textContent = 'Something went wrong. Check the console for details.';
    msgEl.style.color = '#c0392b';
  }
};

// ===== LOGIN =====

window.handleLogin = async function () {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!CONFIGURED) { errorEl.textContent = 'Firebase is not configured yet.'; errorEl.style.display = 'block'; return; }
  if (!username || !password) { errorEl.textContent = 'Please enter both username and password.'; errorEl.style.display = 'block'; return; }

  btn.disabled = true;
  try {
    const snap = await getDoc(doc(db, 'clients', username));
    if (snap.exists() && snap.data().password === password) {
      errorEl.style.display = 'none';
      currentUser = username;
      currentRole = snap.data().role || 'client';
      viewingClient = null;
      sessionStorage.setItem('soulasia_current_user', username);
      sessionStorage.setItem('soulasia_current_role', currentRole);
      await showDashboard(username, currentRole);
    } else {
      errorEl.textContent = 'Invalid username or password. Please try again.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'Connection error — check your Firebase setup.';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
};

async function showDashboard(username, role) {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  document.getElementById('displayUsername').textContent = username.charAt(0).toUpperCase() + username.slice(1);
  document.getElementById('displayUsername2').textContent = username.charAt(0).toUpperCase() + username.slice(1);

  const infoSnap = await getDoc(doc(db, 'clientData', username));
  const info = infoSnap.exists() ? infoSnap.data() : { name: '', company: '', email: '', project: '' };
  setInfoDisplay(info);

  const badge = document.getElementById('roleBadge');
  if (role === 'admin') {
    badge.textContent = 'Admin';
    badge.className = 'role-badge admin';
    document.getElementById('dashboardSub').textContent = 'You have full access to manage all client files.';
    document.getElementById('adminSwitcher').classList.add('visible');
    document.getElementById('createAccountBtn').style.display = 'inline-block';
    await populateClientSelect();
    document.getElementById('clientInfoEdit').style.display = 'flex';
  } else {
    badge.textContent = 'Client';
    badge.className = 'role-badge';
    document.getElementById('dashboardSub').textContent = 'Select a section below to view your project files.';
    document.getElementById('adminSwitcher').classList.remove('visible');
    document.getElementById('createAccountBtn').style.display = 'none';
    document.getElementById('clientInfoEdit').style.display = 'none';
  }

  applyViewMode(role);
  attachListeners(username);
}

function setInfoDisplay(info) {
  document.getElementById('infoName').textContent = info.name || '—';
  document.getElementById('infoCompany').textContent = info.company || '—';
  document.getElementById('infoEmail').textContent = info.email || '—';
  document.getElementById('infoProject').textContent = info.project || '—';
}

function applyViewMode(role) {
  document.querySelectorAll('.file-section').forEach(section => {
    if (role === 'admin') {
      section.classList.add('admin-view');
      section.classList.remove('client-view');
    } else {
      section.classList.add('client-view');
      section.classList.remove('admin-view');
    }
  });
}

// ===== LIVE LISTENERS (this is what makes uploads/chat arrive without a refresh) =====

function attachListeners(targetUsername) {
  if (filesUnsub) { filesUnsub(); filesUnsub = null; }
  if (chatUnsub) { chatUnsub(); chatUnsub = null; }

  filesUnsub = onSnapshot(collection(db, 'clientFiles', targetUsername, 'items'), snapshot => {
    allClientFiles = emptyFileBucket();
    filesById = {};
    snapshot.forEach(d => {
      const data = d.data();
      const item = { id: d.id, ...data };
      filesById[d.id] = item;
      if (!allClientFiles[item.section]) allClientFiles[item.section] = [];
      allClientFiles[item.section].push(item);
    });
    FILE_SECTIONS.forEach(section => renderFileList(section));
  }, err => console.error('Files listener error:', err));

  const chatQuery = query(collection(db, 'clientChats', targetUsername, 'messages'), orderBy('timestamp'));
  chatUnsub = onSnapshot(chatQuery, snapshot => {
    const messages = [];
    snapshot.forEach(d => messages.push(d.data()));
    renderChatMessages(messages);
  }, err => console.error('Chat listener error:', err));
}

function renderChatMessages(messages) {
  const container = document.getElementById('chatMessages');
  if (messages.length === 0) {
    container.innerHTML = `<div class="message admin"><span class="sender">Admin</span>Welcome! How can I help you today?</div>`;
    return;
  }
  let html = '';
  messages.forEach(msg => {
    const isAdmin = msg.sender === 'admin';
    html += `<div class="message ${isAdmin ? 'admin' : 'client'}">
      <span class="sender">${isAdmin ? 'Admin' : 'You'}</span>
      ${escapeHtml(msg.message)}
      <span class="time">${msg.time || ''}</span>
    </div>`;
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.handleLogout = function () {
  if (filesUnsub) { filesUnsub(); filesUnsub = null; }
  if (chatUnsub) { chatUnsub(); chatUnsub = null; }
  currentUser = null;
  currentRole = null;
  viewingClient = null;
  sessionStorage.removeItem('soulasia_current_user');
  sessionStorage.removeItem('soulasia_current_role');
  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('loginSection').style.display = 'flex';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  document.getElementById('changePasswordPanel').classList.remove('visible');
  document.getElementById('createAccountPanel').classList.remove('visible');
  document.getElementById('createAccountBtn').style.display = 'none';
  document.querySelectorAll('.file-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dash-btn').forEach(el => el.classList.remove('active'));
};

// ===== CHANGE PASSWORD =====

window.toggleChangePassword = function () {
  document.getElementById('changePasswordPanel').classList.toggle('visible');
};

window.toggleCreateAccount = function () {
  document.getElementById('createAccountPanel').classList.toggle('visible');
};

window.changePassword = async function () {
  const oldPass = document.getElementById('cpOldPassword').value;
  const newPass = document.getElementById('cpNewPassword').value;
  const confirmPass = document.getElementById('cpConfirmPassword').value;
  const msgEl = document.getElementById('cpMessage');

  if (!oldPass || !newPass || !confirmPass) { msgEl.textContent = 'Please fill in all fields.'; msgEl.style.color = '#c0392b'; return; }
  if (newPass.length < 4) { msgEl.textContent = 'New password must be at least 4 characters.'; msgEl.style.color = '#c0392b'; return; }
  if (newPass !== confirmPass) { msgEl.textContent = 'New passwords do not match.'; msgEl.style.color = '#c0392b'; return; }

  try {
    const snap = await getDoc(doc(db, 'clients', currentUser));
    if (!snap.exists() || snap.data().password !== oldPass) {
      msgEl.textContent = 'Current password is incorrect.'; msgEl.style.color = '#c0392b'; return;
    }
    await updateDoc(doc(db, 'clients', currentUser), { password: newPass });
    msgEl.textContent = 'Password updated successfully!';
    msgEl.style.color = '#27ae60';
    document.getElementById('cpOldPassword').value = '';
    document.getElementById('cpNewPassword').value = '';
    document.getElementById('cpConfirmPassword').value = '';
  } catch (err) {
    console.error(err);
    msgEl.textContent = 'Something went wrong. Try again.';
    msgEl.style.color = '#c0392b';
  }
};

// ===== ADMIN CLIENT SWITCHER =====

async function populateClientSelect() {
  const select = document.getElementById('clientSelect');
  select.innerHTML = '<option value="">Select a client...</option>';
  const snap = await getDocs(collection(db, 'clients'));
  snap.forEach(d => {
    const data = d.data();
    if (d.id !== 'admin' && data.role !== 'admin') {
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = d.id.charAt(0).toUpperCase() + d.id.slice(1);
      select.appendChild(option);
    }
  });
}

window.switchToClient = async function () {
  const select = document.getElementById('clientSelect');
  const username = select.value;
  if (!username) { alert('Please select a client.'); return; }
  viewingClient = username;

  const infoSnap = await getDoc(doc(db, 'clientData', username));
  const info = infoSnap.exists() ? infoSnap.data() : { name: '', company: '', email: '', project: '' };
  setInfoDisplay(info);

  attachListeners(username);
  document.getElementById('displayUsername').textContent = username.charAt(0).toUpperCase() + username.slice(1) + ' (Admin View)';
  document.getElementById('displayUsername2').textContent = username.charAt(0).toUpperCase() + username.slice(1);
  document.getElementById('roleBadge').textContent = 'Admin Viewing Client';
  document.getElementById('roleBadge').className = 'role-badge admin';
  document.getElementById('clientInfoEdit').style.display = 'flex';
};

window.switchBackToAdmin = async function () {
  viewingClient = null;
  await showDashboard(currentUser, 'admin');
};

window.resetClientPassword = async function () {
  const select = document.getElementById('clientSelect');
  const username = select.value;
  if (!username) { alert('Please select a client first.'); return; }

  const newPass = prompt(`Enter a new password for "${username}" (at least 4 characters):`);
  if (!newPass) return;
  if (newPass.length < 4) { alert('Password must be at least 4 characters.'); return; }

  try {
    await updateDoc(doc(db, 'clients', username), { password: newPass });
    alert(`Password for "${username}" has been reset. Share the new password with them directly.`);
  } catch (err) {
    console.error(err);
    alert('Password reset failed. Check the console for details.');
  }
};

window.deleteClient = async function () {
  const select = document.getElementById('clientSelect');
  const username = select.value;
  if (!username) { alert('Please select a client first.'); return; }
  if (!confirm(`Permanently delete the client "${username}"? This removes their login and can't be undone.`)) return;

  try {
    await deleteDoc(doc(db, 'clients', username));
    await deleteDoc(doc(db, 'clientData', username)).catch(() => {});
    if (viewingClient === username) {
      viewingClient = null;
      await showDashboard(currentUser, 'admin');
    } else {
      await populateClientSelect();
    }
    alert(`Client "${username}" has been deleted.`);
  } catch (err) {
    console.error(err);
    alert('Delete failed. Check the console for details.');
  }
};

// ===== CLIENT INFO UPDATE =====

window.updateClientInfo = async function () {
  if (currentRole !== 'admin') { alert('Only administrators can update client information.'); return; }
  const targetClient = viewingClient || currentUser;

  const snap = await getDoc(doc(db, 'clientData', targetClient));
  const info = snap.exists() ? snap.data() : { name: '', company: '', email: '', project: '' };
  info.name = document.getElementById('editName').value || info.name;
  info.company = document.getElementById('editCompany').value || info.company;
  info.email = document.getElementById('editEmail').value || info.email;
  info.project = document.getElementById('editProject').value || info.project;

  try {
    await setDoc(doc(db, 'clientData', targetClient), info);
    setInfoDisplay(info);
    document.getElementById('editName').value = '';
    document.getElementById('editCompany').value = '';
    document.getElementById('editEmail').value = '';
    document.getElementById('editProject').value = '';
    alert('Client information updated successfully!');
  } catch (err) {
    console.error(err);
    alert('Update failed. Check the console for details.');
  }
};

// ===== FILE SYSTEM =====

window.openSection = function (section) {
  document.querySelectorAll('.file-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dash-btn').forEach(el => el.classList.remove('active'));

  const sectionMap = {
    client_info: 'client_infoSection', pi_permit: 'pi_permitSection', follow_up: 'follow_upSection',
    inspection: 'inspectionSection', loading: 'loadingSection', shipment: 'shipmentSection', documents: 'documentsSection'
  };
  const targetSection = document.getElementById(sectionMap[section]);
  if (targetSection) targetSection.classList.add('active');

  const buttons = document.querySelectorAll('.dash-btn');
  const sections = ['client_info', 'pi_permit', 'follow_up', 'inspection', 'loading', 'shipment', 'documents'];
  const index = sections.indexOf(section);
  if (buttons[index]) buttons[index].classList.add('active');
};

const INPUT_MAP = {
  client_info: 'client_infoFileInput', pi_permit: 'pi_permitFileInput', follow_up: 'follow_upFileInput',
  inspection: 'inspectionFileInput', loading: 'loadingFileInput', shipment: 'shipmentFileInput', documents: 'documentsFileInput'
};
const LIST_MAP = {
  client_info: 'client_infoFileList', pi_permit: 'pi_permitFileList', follow_up: 'follow_upFileList',
  inspection: 'inspectionFileList', loading: 'loadingFileList', shipment: 'shipmentFileList', documents: 'documentsFileList'
};

window.uploadFile = async function (section) {
  if (currentRole !== 'admin') { alert('You do not have permission to upload files. Only administrators can upload files.'); return; }
  const targetClient = viewingClient || currentUser;
  if (currentRole === 'admin' && !viewingClient) {
    alert('Select a client first using "Switch to Client" above, then upload.');
    return;
  }

  const input = document.getElementById(INPUT_MAP[section]);
  const files = input.files;
  if (files.length === 0) { alert('Please select at least one file to upload.'); return; }

  const btn = document.querySelector(`#${section}Section .btn-upload`);
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      alert(`"${file.name}" is too large (${(file.size / 1024).toFixed(0)}KB). Files must be under ~700KB on the free plan.`);
      continue;
    }
    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await addDoc(collection(db, 'clientFiles', targetClient, 'items'), {
        section, name: file.name, size: file.size, type: file.type,
        data: base64Data, uploadedAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
      alert(`Upload failed for "${file.name}". Check the console for details.`);
    }
  }

  input.value = '';
  if (btn) { btn.disabled = false; btn.textContent = 'Upload Files'; }
};

function renderFileList(section) {
  const listElement = document.getElementById(LIST_MAP[section]);
  if (!listElement) return;
  const files = allClientFiles[section] || [];

  if (files.length === 0) {
    listElement.innerHTML = '<li class="empty-files">No files uploaded yet.</li>';
    return;
  }

  let html = '';
  files.forEach(fileData => {
    const fileSize = fileData.size < 1024 ? fileData.size + ' B' :
                     fileData.size < 1048576 ? (fileData.size / 1024).toFixed(1) + ' KB' :
                     (fileData.size / 1048576).toFixed(1) + ' MB';

    let icon = '📄';
    if (fileData.type && fileData.type.startsWith('image/')) icon = '🖼️';
    else if (fileData.type === 'application/pdf') icon = '📕';
    else if (fileData.type && (fileData.type.includes('word') || fileData.type.includes('document'))) icon = '📘';
    else if (fileData.type && (fileData.type.includes('excel') || fileData.type.includes('sheet'))) icon = '📊';

    const isAdmin = currentRole === 'admin';
    html += `
      <li>
        <div class="file-name">
          <span class="icon">${icon}</span>
          <span>${escapeHtml(fileData.name)}</span>
        </div>
        <div class="file-actions">
          <span class="file-size">${fileSize}</span>
          <a href="${fileData.data}" download="${fileData.name}">Download</a>
          ${isAdmin ? `<button class="delete" onclick="deleteFile('${fileData.id}')">Delete</button>` : ''}
        </div>
      </li>
    `;
  });
  listElement.innerHTML = html;
}

window.deleteFile = async function (id) {
  if (currentRole !== 'admin') { alert('You do not have permission to delete files. Only administrators can delete files.'); return; }
  if (!confirm('Are you sure you want to delete this file?')) return;

  const targetClient = viewingClient || currentUser;
  const item = filesById[id];
  if (!item) return;

  try {
    await deleteDoc(doc(db, 'clientFiles', targetClient, 'items', id));
  } catch (err) {
    console.error(err);
    alert('Delete failed. Check the console for details.');
  }
};

// ===== CHAT SYSTEM =====

window.sendMessage = async function () {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  const targetClient = viewingClient || currentUser;

  try {
    await addDoc(collection(db, 'clientChats', targetClient, 'messages'), {
      sender: currentRole === 'admin' ? 'admin' : 'client',
      message,
      time: new Date().toLocaleTimeString(),
      timestamp: serverTimestamp()
    });
    input.value = '';
  } catch (err) {
    console.error(err);
    alert('Message failed to send. Check the console for details.');
  }
};

// ===== MISC =====

document.getElementById('password').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') window.handleLogin();
});
document.getElementById('username').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') window.handleLogin();
});

const faders = document.querySelectorAll('.fade-in');
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: 0.15 });
faders.forEach(el => observer.observe(el));

// ===== INIT =====

(async function init() {
  if (!CONFIGURED) return;
  await ensureSeedAccounts();

  const savedUser = sessionStorage.getItem('soulasia_current_user');
  const savedRole = sessionStorage.getItem('soulasia_current_role');
  if (savedUser) {
    const snap = await getDoc(doc(db, 'clients', savedUser));
    if (snap.exists()) {
      currentUser = savedUser;
      currentRole = savedRole || snap.data().role || 'client';
      await showDashboard(savedUser, currentRole);
    }
  }
})();

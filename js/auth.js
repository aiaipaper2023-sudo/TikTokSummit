// Simple auth system with localStorage
const DEFAULT_USERS = [
  { username: 'admin', password: 'admin12345', role: 'admin' },
  { username: 'edward', password: 'rizzway', role: 'admin' },
  { username: 'dk', password: 'rizzway', role: 'admin' },
  { username: 'demon', password: 'rizzway', role: 'admin' }
];

// Initialize users store — merge DEFAULT_USERS into existing list
function initUsers() {
  const existing = localStorage.getItem('tks_users');
  if (!existing) {
    localStorage.setItem('tks_users', JSON.stringify(DEFAULT_USERS));
    return;
  }
  const users = JSON.parse(existing);
  const names = new Set(users.map(u => u.username));
  let changed = false;
  DEFAULT_USERS.forEach(du => {
    if (!names.has(du.username)) {
      users.push(du);
      changed = true;
    }
  });
  if (changed) localStorage.setItem('tks_users', JSON.stringify(users));
}

function getUsers() {
  initUsers();
  return JSON.parse(localStorage.getItem('tks_users'));
}

function saveUsers(users) {
  localStorage.setItem('tks_users', JSON.stringify(users));
}

// Auth
function login(username, password) {
  const users = getUsers();
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    localStorage.setItem('tks_current', JSON.stringify({ username: user.username, role: user.role }));
    return user;
  }
  return null;
}

function logout() {
  localStorage.removeItem('tks_current');
  // Clear cross-subdomain auth cookie
  document.cookie = 'tks_auth=; domain=.tiktoksummit.com; path=/; secure; max-age=0';
  window.location.href = 'index.html';
}

function getCurrentUser() {
  const data = localStorage.getItem('tks_current');
  return data ? JSON.parse(data) : null;
}

// Permission map: role -> allowed pages
const PERMISSIONS = {
  admin: ['v2v', 'p2v', 'spy', 'admin', 'analytics'],
  creator: ['v2v', 'p2v'],
  analyst: ['spy'],
  viewer: []
};

function canAccess(page) {
  const user = getCurrentUser();
  if (!user) return false;
  const allowed = PERMISSIONS[user.role] || [];
  return allowed.includes(page);
}

// Guard: call on each protected page
function requireAuth(page) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'index.html?msg=login_required';
    return false;
  }
  if (!canAccess(page)) {
    window.location.href = 'dashboard.html?msg=no_permission';
    return false;
  }
  return true;
}

// User management (admin only)
function addUser(username, password, role) {
  const users = getUsers();
  if (users.find(u => u.username === username)) return false;
  users.push({ username, password, role });
  saveUsers(users);
  return true;
}

function deleteUser(username) {
  let users = getUsers();
  users = users.filter(u => u.username !== username);
  saveUsers(users);
}

function getAllRoles() {
  return Object.keys(PERMISSIONS);
}

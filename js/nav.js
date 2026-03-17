// Shared nav component for all pages
function renderNav(activePage) {
  const user = getCurrentUser();
  if (!user) return '';

  const pages = [
    { id: 'dashboard', label: '控制台', icon: '📊', roles: ['admin', 'creator', 'analyst', 'viewer'] },
    { id: 'v2v', label: 'V2V', icon: '🔄', roles: ['admin', 'creator'] },
    { id: 'p2v', label: 'P2V', icon: '🎬', roles: ['admin', 'creator'] },
    { id: 'spy', label: 'Spy', icon: '🔍', roles: ['admin', 'analyst'] },
    { id: 'admin', label: '用户管理', icon: '⚙️', roles: ['admin'] },
  ];

  const links = pages
    .filter(p => p.roles.includes(user.role))
    .map(p => {
      const active = p.id === activePage ? ' active' : '';
      return `<a href="${p.id === 'dashboard' ? 'dashboard' : p.id}.html" class="nav-item${active}">${p.icon} ${p.label}</a>`;
    }).join('');

  return `
    <nav class="app-nav">
      <div class="nav-brand">TikTok Summit</div>
      <div class="nav-menu">${links}</div>
      <div class="nav-user">
        <span class="user-badge">${user.role}</span>
        <span class="user-name">${user.username}</span>
        <button onclick="logout()" class="btn-logout">退出</button>
      </div>
    </nav>
  `;
}

function injectNav(activePage) {
  document.getElementById('app-nav').innerHTML = renderNav(activePage);
}

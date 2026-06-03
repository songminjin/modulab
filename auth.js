(function () {
  const API_URL = 'https://modulab-production.up.railway.app';

  function getUser() {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }

  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function applyUser(user) {
    const navAuth = document.getElementById('nav-auth');
    const drawerAuth = document.getElementById('drawer-auth');
    if (!user) return;
    if (navAuth) navAuth.innerHTML =
      `<span style="font-size:13px;color:var(--text2);white-space:nowrap;">${escHtml(user.name)}님</span>` +
      `<button class="nav-btn nav-btn-ghost" onclick="window.__moduLogout()">로그아웃</button>`;
    if (drawerAuth) drawerAuth.innerHTML =
      `<button class="nav-btn nav-btn-ghost" onclick="window.__moduLogout()">로그아웃</button>`;
  }

  window.__moduLogout = async function () {
    try { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch {}
    localStorage.removeItem('user');
    location.href = 'login.html';
  };

  async function init() {
    const params = new URLSearchParams(location.search);
    if (params.get('login') === 'success') {
      history.replaceState(null, '', location.pathname);
      try {
        const r = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
        if (r.ok) {
          const { user } = await r.json();
          localStorage.setItem('user', JSON.stringify(user));
          applyUser(user);
          return;
        }
      } catch {}
    }
    applyUser(getUser());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

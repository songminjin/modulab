(function () {
  const API_URL = 'https://modulab-production.up.railway.app';
  const ADMIN_EMAIL = 'songminjin123@gmail.com';

  function getUser() {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }

  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isAdminUser(user) {
    return user && (user.email === ADMIN_EMAIL || user.role === 'admin');
  }

  function getAdminUrl() {
    return location.pathname.includes('/admin/') ? 'dashboard.html' : 'admin/dashboard.html';
  }

  function applyUser(user) {
    const navAuth = document.getElementById('nav-auth');
    const drawerAuth = document.getElementById('drawer-auth');
    if (!user) return;

    const adminBtn = isAdminUser(user)
      ? `<a href="${getAdminUrl()}" class="nav-btn" style="background:#0F172A;color:white;border:none;gap:5px;">⚙️ 관리자</a>`
      : '';
    const drawerAdminBtn = isAdminUser(user)
      ? `<a href="${getAdminUrl()}" class="nav-btn nav-btn-ghost" style="flex:1;justify-content:center;">⚙️ 관리자</a>`
      : '';

    const mypageUrl = location.pathname.includes('/admin/') ? '../mypage.html' : 'mypage.html';
    const mypageBtn = `<a href="${mypageUrl}" class="nav-btn nav-btn-ghost">마이페이지</a>`;
    const drawerMypageBtn = `<a href="${mypageUrl}" class="nav-btn nav-btn-ghost" style="flex:1;justify-content:center;">마이페이지</a>`;

    if (navAuth) navAuth.innerHTML =
      `<span style="font-size:13px;color:var(--text2);white-space:nowrap;">${escHtml(user.name)}님</span>` +
      mypageBtn +
      adminBtn +
      `<button class="nav-btn nav-btn-ghost" onclick="window.__moduLogout()">로그아웃</button>`;
    if (drawerAuth) drawerAuth.innerHTML =
      drawerMypageBtn +
      drawerAdminBtn +
      `<button class="nav-btn nav-btn-ghost" onclick="window.__moduLogout()" style="flex:1;justify-content:center;">로그아웃</button>`;
  }

  window.__moduLogout = async function () {
    try { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch {}
    localStorage.removeItem('user');
    localStorage.removeItem('modulab_token');
    location.href = location.pathname.includes('/admin/') ? '../login.html' : 'login.html';
  };

  async function init() {
    const params = new URLSearchParams(location.search);
    if (params.get('login') === 'success') {
      history.replaceState(null, '', location.pathname);
      try {
        const r = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
        if (r.ok) {
          const { user, token } = await r.json();
          localStorage.setItem('user', JSON.stringify(user));
          if (token) localStorage.setItem('modulab_token', token);
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

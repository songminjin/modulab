/* Admin auth guard — included in all admin pages */
(function () {
  const API = 'https://modulab-production.up.railway.app';

  document.documentElement.style.visibility = 'hidden';

  function getToken() {
    return sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken') || '';
  }

  function authHeaders(json) {
    const token = getToken();
    const h = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  fetch(`${API}/api/auth/me`, {
    credentials: 'include',
    headers: authHeaders()
  })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      const user = data.user || data;
      if (!user || user.role !== 'admin') throw new Error();
      if (data.token) { localStorage.setItem('adminToken', data.token); sessionStorage.setItem('adminToken', data.token); }
      document.documentElement.style.visibility = '';
    })
    .catch(() => { location.replace('index.html'); });

  window.adminLogout = async function (e) {
    if (e) e.preventDefault();
    sessionStorage.removeItem('adminToken');
    localStorage.removeItem('adminToken');
    try { await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch {}
    location.href = 'index.html';
  };

  /* 모든 admin 페이지에서 인증 fetch를 쉽게 쓸 수 있도록 전역 헬퍼 제공 */
  window.adminFetch = function (url, options = {}) {
    const token = getToken();
    const isFormData = options.body instanceof FormData;
    const headers = { ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData && !headers['Content-Type'] && options.body) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { credentials: 'include', ...options, headers });
  };
})();

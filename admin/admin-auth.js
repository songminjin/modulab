/* Admin auth guard — included in all admin pages */
(function () {
  const API = 'https://modulab-production.up.railway.app';

  // Hide page until auth verified
  document.documentElement.style.visibility = 'hidden';

  fetch(`${API}/api/auth/me`, { credentials: 'include' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      const user = data.user || data;
      if (!user || user.role !== 'admin') throw new Error();
      document.documentElement.style.visibility = '';
    })
    .catch(() => { location.replace('index.html'); });

  window.adminLogout = async function (e) {
    if (e) e.preventDefault();
    try { await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' }); } catch {}
    location.href = 'index.html';
  };
})();

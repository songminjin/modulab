/* ── GitHub Products Sync ── */
const GH_OWNER = 'songminjin';
const GH_REPO  = 'modulab';
const GH_FILE  = 'products.json';
const GH_API   = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;

function ghToken() {
  return localStorage.getItem('modulab_gh_token') || '';
}

/* 현재 products.json의 SHA 가져오기 */
async function getFileSha(token) {
  const res = await fetch(GH_API, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`SHA 조회 실패 (${res.status})`);
  const data = await res.json();
  return data.sha;
}

/* products 배열을 GitHub에 push */
async function syncProductsToGitHub(products) {
  const token = ghToken();
  if (!token) {
    throw new Error('GitHub 토큰이 설정되지 않았습니다.\n상품 목록 페이지 상단의 ⚙️ GitHub 연동 설정에서 토큰을 입력해주세요.');
  }

  // detailImages(base64)는 용량이 크므로 GitHub 저장 시 제외
  const clean = products.map(p => {
    const { detailImages, ...rest } = p;
    return { ...rest, detailImages: [] };
  });

  const sha = await getFileSha(token);
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(clean, null, 2))));

  const res = await fetch(GH_API, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: '상품 데이터 업데이트 [ModuLab Admin]',
      content,
      sha,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub 업데이트 실패 (${res.status})`);
  }
  return await res.json();
}

/* localStorage의 modulab_products를 GitHub에 동기화 */
async function syncAll(showToastFn) {
  try {
    const products = JSON.parse(localStorage.getItem('modulab_products') || '[]');
    if (!products.length) { showToastFn?.('동기화할 상품이 없습니다.', 'error'); return; }
    showToastFn?.('GitHub에 동기화 중...', 'success');
    await syncProductsToGitHub(products);
    showToastFn?.('✓ GitHub 동기화 완료! 1~2분 내 사이트에 반영됩니다.', 'success');
  } catch (e) {
    showToastFn?.(e.message, 'error');
  }
}

window.GhSync = { syncProductsToGitHub, syncAll, ghToken };

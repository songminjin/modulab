/* ── GitHub Products Sync ── */
const GH_OWNER = 'songminjin';
const GH_REPO  = 'modulab';
const GH_FILE  = 'products.json';
const GH_API   = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;

function ghToken() {
  return localStorage.getItem('modulab_gh_token') || '';
}

/* products.json SHA 가져오기 */
async function getFileSha(token) {
  const res = await fetch(GH_API, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`SHA 조회 실패 (${res.status})`);
  return (await res.json()).sha;
}

/* 이미지를 GitHub /images/products/ 폴더에 업로드하고 URL 반환 */
async function uploadImageToGitHub(filename, base64Content, token) {
  if (!token) throw new Error('토큰 없음');
  const path = `images/products/${filename}`;
  const url  = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;

  // 기존 파일 SHA 확인 (덮어쓰기용)
  let sha;
  try {
    const r = await fetch(url, { headers: { Authorization: `token ${token}` } });
    if (r.ok) sha = (await r.json()).sha;
  } catch {}

  const body = { message: `이미지 업로드: ${filename}`, content: base64Content };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('이미지 업로드 실패');

  return `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/${path}`;
}

/* dataUrl(base64)에서 순수 base64만 추출 */
function extractBase64(dataUrl) {
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

/* dataUrl에서 확장자 추출 */
function extFromDataUrl(dataUrl) {
  const m = dataUrl.match(/data:image\/(\w+);/);
  return m ? m[1].replace('jpeg', 'jpg') : 'jpg';
}

/* 상품 이미지 일괄 업로드 후 URL 배열 반환 */
async function uploadProductImages(productId, thumbDataUrl, detailImagesArr, token, onProgress) {
  const result = { thumbUrl: '', detailImageUrls: [] };

  // 썸네일 업로드
  if (thumbDataUrl && thumbDataUrl.startsWith('data:')) {
    try {
      onProgress?.('썸네일 이미지 업로드 중...');
      const ext = extFromDataUrl(thumbDataUrl);
      const filename = `thumb-${productId}.${ext}`;
      result.thumbUrl = await uploadImageToGitHub(filename, extractBase64(thumbDataUrl), token);
    } catch (e) { console.warn('썸네일 업로드 실패:', e); }
  } else if (thumbDataUrl && thumbDataUrl.startsWith('http')) {
    result.thumbUrl = thumbDataUrl; // 이미 URL이면 그대로 사용
  }

  // 상세 이미지 업로드
  for (let i = 0; i < detailImagesArr.length; i++) {
    const img = detailImagesArr[i];
    const src = img.dataUrl || img.url || img;
    if (src && src.startsWith('data:')) {
      try {
        onProgress?.(`상세 이미지 ${i + 1}/${detailImagesArr.length} 업로드 중...`);
        const ext = extFromDataUrl(src);
        const filename = `detail-${productId}-${i}.${ext}`;
        const imgUrl = await uploadImageToGitHub(filename, extractBase64(src), token);
        result.detailImageUrls.push(imgUrl);
      } catch (e) { console.warn(`상세 이미지 ${i} 업로드 실패:`, e); }
    } else if (src && src.startsWith('http')) {
      result.detailImageUrls.push(src); // 이미 URL이면 그대로
    }
  }

  return result;
}

/* products 배열을 products.json으로 GitHub에 push */
async function syncProductsToGitHub(products) {
  const token = ghToken();
  if (!token) throw new Error('GitHub 토큰이 설정되지 않았습니다.\n관리자 페이지 상단 ⚙️에서 토큰을 입력해주세요.');

  // detailImages(base64)는 제외하고, URL만 저장
  const clean = products.map(p => {
    const { detailImages, ...rest } = p;
    return rest;
  });

  const sha = await getFileSha(token);
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(clean, null, 2))));

  const res = await fetch(GH_API, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '상품 데이터 업데이트 [ModuLab Admin]', content, sha }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub 업데이트 실패 (${res.status})`);
  }
  return await res.json();
}

/* localStorage의 상품들을 GitHub에 동기화 */
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

window.GhSync = { syncProductsToGitHub, syncAll, ghToken, uploadProductImages };

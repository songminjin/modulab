/* ── ModuLab Products Renderer ── */
(function() {
  const RAW_URL = 'https://raw.githubusercontent.com/songminjin/modulab/main/products.json';

  const CAT_BG  = { excel:'#EFF6FF', sheets:'#FEFCE8', short:'#F5F3FF', detail:'#FFF1F2', web:'#EFF6FF', program:'#F8FAFC' };
  const CAT_BG2 = { excel:'#DBEAFE', sheets:'#FEF9C3', short:'#EDE9FE', detail:'#FFE4E6', web:'#BFDBFE', program:'#F1F5F9' };
  const CAT_LABEL = { excel:'엑셀 프로그램', sheets:'구글시트 자동화', short:'숏폼 템플릿', detail:'상세페이지 제작', web:'홈페이지 제작', program:'프로그램 제작' };

  async function fetchProducts() {
    try {
      const res = await fetch(RAW_URL, { cache: 'no-cache' });
      if (res.ok) return await res.json();
    } catch {}
    return null;
  }

  // mkt-card style (used in category pages)
  function mktCardHTML(p) {
    const bg1 = CAT_BG[p.cat] || '#EFF6FF';
    const bg2 = CAT_BG2[p.cat] || '#DBEAFE';
    const priceStr = !p.price ? '가격 문의' : (p.discount ? `₩${p.discount.toLocaleString()}` : `₩${p.price.toLocaleString()}`);
    const origStr = p.discount ? `<span style="text-decoration:line-through;color:#94A3B8;font-size:12px;">₩${p.price.toLocaleString()}</span> ` : '';
    const href = `product.html?id=${p.id}&cat=${p.cat}&name=${encodeURIComponent(p.name)}&price=${p.price}&emoji=${encodeURIComponent(p.emoji)}`;
    const badge = p.newBadge ? '<span class="mkt-badge mkt-badge-new">NEW</span>' : (p.bestBadge ? '<span class="mkt-badge mkt-badge-best">BEST</span>' : '<span class="mkt-badge">판매중</span>');
    const thumbInner = p.thumbUrl
      ? `<img src="${p.thumbUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`
      : `<div style="background:${bg2};width:75%;height:65%;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:52px;">${p.emoji}</div>`;
    return `
      <a href="${href}" class="mkt-card" data-price="${p.price}" data-name="${p.name}">
        <div class="mkt-card-img" style="background:${bg1};">
          ${thumbInner}
          ${badge}
        </div>
        <div class="mkt-card-body">
          <div class="mkt-card-name">${p.name}</div>
          <div class="mkt-card-desc">${p.desc || ''}</div>
          <div class="mkt-card-price">${origStr}${priceStr}</div>
          <div class="mkt-card-meta">
            <span>👁 ${p.views || 0}</span>
            <span>↓ ${p.downloads || 0}</span>
            <span class="mkt-card-seller">by 모듈랩</span>
          </div>
        </div>
      </a>`;
  }

  // small product-card style (used in index.html)
  function productCardHTML(p) {
    const bg1 = CAT_BG[p.cat] || '#EFF6FF';
    const bg2 = CAT_BG2[p.cat] || '#DBEAFE';
    const priceStr = !p.price ? '가격 문의' : (p.discount ? `₩${p.discount.toLocaleString()}` : `₩${p.price.toLocaleString()}`);
    const href = `product.html?id=${p.id}&cat=${p.cat}&name=${encodeURIComponent(p.name)}&price=${p.price}&emoji=${encodeURIComponent(p.emoji)}`;
    const catLabel = CAT_LABEL[p.cat] || p.cat;
    return `
      <a href="${href}" class="product-card">
        <div class="product-img" style="background:${bg1};">
          ${p.thumbUrl
            ? `<img src="${p.thumbUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div class="product-img-inner" style="background:${bg2};">${p.emoji}</div>`}
        </div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-creator">by 모듈랩 · ${catLabel}</div>
          <div class="product-footer">
            <div class="product-price"><span class="won">₩</span>${p.discount ? p.discount.toLocaleString() : (p.price ? p.price.toLocaleString() : '문의')}</div>
          </div>
        </div>
      </a>`;
  }

  // Render category page grid from products.json
  async function renderCategoryGrid(catId, gridId, countId) {
    const products = await fetchProducts();
    if (!products) return; // keep hardcoded fallback
    const visible = products.filter(p => p.cat === catId && p.visible !== false);
    const grid = document.getElementById(gridId);
    if (!grid) return;
    if (countId) {
      const countEl = document.getElementById(countId);
      if (countEl) countEl.textContent = visible.length;
    }
    if (!visible.length) { grid.innerHTML = '<p style="color:#94A3B8;padding:40px;text-align:center;">등록된 상품이 없습니다.</p>'; return; }
    grid.innerHTML = visible.map(mktCardHTML).join('');
  }

  // Render index.html section
  async function renderIndexSection(catId, gridId, countSelector) {
    const products = await fetchProducts();
    if (!products) return;
    const visible = products.filter(p => p.cat === catId && p.visible !== false);
    const grid = document.getElementById(gridId);
    if (!grid) return;
    if (countSelector) {
      const el = document.querySelector(countSelector);
      if (el) el.textContent = `${visible.length} PRODUCTS`;
    }
    grid.innerHTML = visible.slice(0, 4).map(productCardHTML).join('');
  }

  // Render all index.html sections at once
  async function renderIndexAll() {
    const products = await fetchProducts();
    if (!products) return;
    // Update each section
    [
      { cat:'excel',   gridId:'idx-excel-grid',   count:'.idx-excel-count' },
      { cat:'sheets',  gridId:'idx-sheets-grid',  count:'.idx-sheets-count' },
      { cat:'short',   gridId:'idx-short-grid',   count:'.idx-short-count' },
      { cat:'detail',  gridId:'idx-detail-grid',  count:'.idx-detail-count' },
      { cat:'web',     gridId:'idx-web-grid',     count:'.idx-web-count' },
      { cat:'program', gridId:'idx-program-grid', count:'.idx-program-count' },
    ].forEach(({ cat, gridId, count }) => {
      const visible = products.filter(p => p.cat === cat && p.visible !== false);
      const grid = document.getElementById(gridId);
      if (!grid) return;
      const countEl = document.querySelector(count);
      if (countEl) countEl.textContent = `${visible.length} PRODUCTS`;
      grid.innerHTML = visible.slice(0, 4).map(productCardHTML).join('');
    });
  }

  // For product.html: get single product data
  async function getProduct(id) {
    const products = await fetchProducts();
    if (!products) return null;
    return products.find(p => p.id === id) || null;
  }

  window.ModuProducts = { fetchProducts, renderCategoryGrid, renderIndexSection, renderIndexAll, getProduct, mktCardHTML, productCardHTML };
})();

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

const CAT_LABEL = {
  excel: '엑셀 프로그램', sheets: '구글시트 자동화', short: '숏폼 템플릿',
  detail: '상세페이지 제작', web: '홈페이지 제작', program: '프로그램 제작',
};

// GET /api/events/coupons — 진행 중인 쿠폰 이벤트 목록 (공개)
router.get('/coupons', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT ce.*,
            COALESCE(array_agg(cep.product_id) FILTER (WHERE cep.product_id IS NOT NULL), '{}') as applied_products
     FROM coupon_events ce
     LEFT JOIN coupon_event_products cep ON cep.coupon_event_id = ce.id
     WHERE ce.start_date <= $1 AND ce.end_date >= $1
     GROUP BY ce.id ORDER BY ce.created_at DESC`,
    [today]
  );
  res.json(rows);
});

// GET /api/events/sites — 진행 중인 사이트 이벤트 목록 (공개)
router.get('/sites', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT se.*,
            COALESCE(array_agg(sep.product_id) FILTER (WHERE sep.product_id IS NOT NULL), '{}') as applied_products
     FROM site_events se
     LEFT JOIN site_event_products sep ON sep.site_event_id = se.id
     WHERE se.start_date <= $1 AND se.end_date >= $1
     GROUP BY se.id ORDER BY se.created_at DESC`,
    [today]
  );
  res.json(rows);
});

// POST /api/events/coupons/:id/download — 쿠폰 이벤트 다운로드
router.post('/coupons/:id/download', authenticate, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { rows: [ev] } = await db.query(
    'SELECT * FROM coupon_events WHERE id = $1 AND start_date <= $2 AND end_date >= $2',
    [req.params.id, today]
  );
  if (!ev) return res.status(404).json({ error: '진행 중인 쿠폰 이벤트가 아닙니다.' });

  const { rows: [existing] } = await db.query(
    'SELECT id FROM coupon_event_downloads WHERE user_id = $1 AND coupon_event_id = $2',
    [req.user.id, ev.id]
  );
  if (existing) return res.status(409).json({ error: '이미 발급받은 쿠폰입니다.' });

  try {
    await db.query(
      'INSERT INTO coupon_event_downloads (user_id, coupon_event_id) VALUES ($1, $2)',
      [req.user.id, ev.id]
    );
    res.json({ message: '쿠폰이 발급됐습니다.' });
  } catch (err) {
    res.status(500).json({ error: '쿠폰 발급 중 오류가 발생했습니다.' });
  }
});

// GET /api/events/my-coupons — 내가 받은 쿠폰 목록 (미사용)
router.get('/my-coupons', authenticate, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT ced.id as download_id, ced.coupon_event_id, ced.created_at,
            ce.name, ce.discount_type, ce.discount_value, ce.min_order_amount,
            ce.applicable_categories, ce.applicable_grades,
            ce.start_date, ce.end_date
     FROM coupon_event_downloads ced
     JOIN coupon_events ce ON ce.id = ced.coupon_event_id
     WHERE ced.user_id = $1 AND ced.is_used = false AND ce.end_date >= $2
     ORDER BY ced.created_at DESC`,
    [req.user.id, today]
  );
  res.json(rows);
});

// POST /api/events/coupons/validate — 쿠폰 유효성 검사 및 할인 금액 계산
router.post('/coupons/validate', authenticate, async (req, res) => {
  const { coupon_download_id, amount, product_categories } = req.body;
  if (!coupon_download_id || !amount) return res.status(400).json({ error: '필수 파라미터 누락' });

  const today = new Date().toISOString().slice(0, 10);
  const { rows: [dl] } = await db.query(
    `SELECT ced.id, ce.name, ce.discount_type, ce.discount_value,
            ce.min_order_amount, ce.applicable_categories, ce.applicable_grades,
            ce.start_date, ce.end_date
     FROM coupon_event_downloads ced
     JOIN coupon_events ce ON ce.id = ced.coupon_event_id
     WHERE ced.id = $1 AND ced.user_id = $2 AND ced.is_used = false
       AND ce.start_date <= $3 AND ce.end_date >= $3`,
    [coupon_download_id, req.user.id, today]
  );

  if (!dl) return res.status(400).json({ error: '사용할 수 없는 쿠폰입니다.' });

  if (dl.min_order_amount > 0 && amount < dl.min_order_amount) {
    return res.status(400).json({
      error: `최소 구매 금액 ${Number(dl.min_order_amount).toLocaleString()}원 이상 구매 시 사용 가능합니다.`,
    });
  }

  const cats = dl.applicable_categories;
  if (cats && cats.length > 0 && product_categories && product_categories.length > 0) {
    const hasMatch = product_categories.some(c => cats.includes(c));
    if (!hasMatch) {
      const names = cats.map(c => CAT_LABEL[c] || c).join(', ');
      return res.status(400).json({ error: `이 쿠폰은 ${names} 상품에만 사용 가능합니다.` });
    }
  }

  let discount = 0;
  if (dl.discount_type === 'percent') {
    discount = Math.floor(amount * dl.discount_value / 100);
  } else {
    discount = Math.min(Number(dl.discount_value), amount);
  }

  res.json({ discount, coupon_name: dl.name });
});

module.exports = router;

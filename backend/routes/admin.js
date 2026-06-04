const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, isAdmin } = require('../middleware/auth');

// GET /api/admin/dashboard — 대시보드 통계
router.get('/dashboard', authenticate, isAdmin, async (req, res) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const monthStr = today.toISOString().slice(0, 7);

    const [todayRes, monthRes, pendingRes, chartRes, recentRes, topRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int as count, COALESCE(SUM(final_amount),0)::int as amount
         FROM orders WHERE status='paid' AND DATE(paid_at)=$1`,
        [todayStr]
      ),
      db.query(
        `SELECT COUNT(*)::int as count, COALESCE(SUM(final_amount),0)::int as amount
         FROM orders WHERE status='paid' AND TO_CHAR(paid_at,'YYYY-MM')=$1`,
        [monthStr]
      ),
      db.query(`SELECT COUNT(*)::int as count FROM orders WHERE status='pending'`),
      db.query(
        `SELECT DATE(paid_at)::text as date, COUNT(*)::int as count,
                COALESCE(SUM(final_amount),0)::int as amount
         FROM orders WHERE status='paid' AND paid_at >= NOW() - INTERVAL '7 days'
         GROUP BY DATE(paid_at) ORDER BY date`
      ),
      db.query(
        `SELECT o.id, o.final_amount, o.status, o.payment_method,
                o.created_at, o.paid_at,
                u.email as buyer_email, u.name as buyer_name,
                (SELECT p.name FROM order_items oi
                 JOIN products p ON p.id=oi.product_id
                 WHERE oi.order_id=o.id LIMIT 1) as first_product
         FROM orders o JOIN users u ON u.id=o.user_id
         ORDER BY o.created_at DESC LIMIT 5`
      ),
      db.query(
        `SELECT p.name, p.emoji, COUNT(oi.id)::int as sales,
                COALESCE(SUM(oi.price),0)::int as revenue
         FROM order_items oi
         JOIN products p ON p.id=oi.product_id
         JOIN orders o ON o.id=oi.order_id
         WHERE o.status='paid'
         GROUP BY p.id, p.name, p.emoji
         ORDER BY sales DESC LIMIT 3`
      )
    ]);

    res.json({
      today: todayRes.rows[0],
      month: monthRes.rows[0],
      pending: pendingRes.rows[0].count,
      unanswered: 0,
      chart: chartRes.rows,
      recent_orders: recentRes.rows,
      top_products: topRes.rows
    });
  } catch (err) {
    console.error('[admin/dashboard]', err);
    res.status(500).json({ error: '대시보드 데이터 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/admin/products
router.get('/products', authenticate, isAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM products ORDER BY created_at DESC');
  res.json(rows);
});

// POST /api/admin/products
router.post('/products', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, short_description, description, price, discount_price, category, emoji, sale_type, file_url, file_name, file_type, is_active, new_badge, best_badge, meta_title, meta_description, detail_images } = req.body;
    if (!name || !price || !category) return res.status(400).json({ error: '상품명, 가격, 카테고리는 필수입니다.' });
    const { rows } = await db.query(
      `INSERT INTO products (name, short_description, description, price, discount_price, category, emoji, sale_type, file_url, file_name, file_type, is_active, new_badge, best_badge, meta_title, meta_description, detail_images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [name, short_description||null, description||null, price, discount_price||0, category, emoji||'📦', sale_type||'file', file_url||null, file_name||null, file_type||null, is_active!==false, new_badge!==false, !!best_badge, meta_title||null, meta_description||null, JSON.stringify(detail_images||[])]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[admin/products POST]', err);
    res.status(500).json({ error: '상품 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/admin/products/:id
router.put('/products/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, short_description, description, price, discount_price, category, emoji, sale_type, file_url, file_name, file_type, is_active, new_badge, best_badge, meta_title, meta_description, detail_images } = req.body;
    const { rows } = await db.query(
      `UPDATE products SET name=$1, short_description=$2, description=$3, price=$4, discount_price=$5, category=$6, emoji=$7, sale_type=$8, file_url=$9, file_name=$10, file_type=$11, is_active=$12, new_badge=$13, best_badge=$14, meta_title=$15, meta_description=$16, detail_images=$17
       WHERE id=$18 RETURNING *`,
      [name, short_description||null, description||null, price, discount_price||0, category, emoji||'📦', sale_type||'file', file_url||null, file_name||null, file_type||null, is_active!==false, new_badge!==false, !!best_badge, meta_title||null, meta_description||null, JSON.stringify(detail_images||[]), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: '상품 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', authenticate, isAdmin, async (req, res) => {
  await db.query('UPDATE products SET is_active = false WHERE id = $1', [req.params.id]);
  res.json({ message: '상품이 삭제됐습니다.' });
});

// GET /api/admin/events/coupons
router.get('/events/coupons', authenticate, isAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT ce.*, COALESCE(array_agg(cep.product_id) FILTER (WHERE cep.product_id IS NOT NULL), '{}') as applied_products
     FROM coupon_events ce
     LEFT JOIN coupon_event_products cep ON cep.coupon_event_id = ce.id
     GROUP BY ce.id ORDER BY ce.created_at DESC`
  );
  res.json(rows);
});

// POST /api/admin/events/coupons
router.post('/events/coupons', authenticate, isAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { name, discount_type, discount_value, start_date, end_date, note, applied_products } = req.body;
    if (!name || !discount_type || !discount_value || !start_date || !end_date) return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    const { rows: [ev] } = await client.query(
      'INSERT INTO coupon_events (name, discount_type, discount_value, start_date, end_date, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, discount_type, discount_value, start_date, end_date, note||null, req.user.id]
    );
    if (applied_products?.length) {
      for (const pid of applied_products) {
        await client.query('INSERT INTO coupon_event_products (coupon_event_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, pid]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ...ev, applied_products: applied_products || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: '쿠폰 이벤트 등록 중 오류가 발생했습니다.' });
  } finally { client.release(); }
});

// PUT /api/admin/events/coupons/:id
router.put('/events/coupons/:id', authenticate, isAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { name, discount_type, discount_value, start_date, end_date, note, applied_products } = req.body;
    const { rows: [ev] } = await client.query(
      'UPDATE coupon_events SET name=$1, discount_type=$2, discount_value=$3, start_date=$4, end_date=$5, note=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
      [name, discount_type, discount_value, start_date, end_date, note||null, req.params.id]
    );
    if (!ev) return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    await client.query('DELETE FROM coupon_event_products WHERE coupon_event_id = $1', [req.params.id]);
    if (applied_products?.length) {
      for (const pid of applied_products) {
        await client.query('INSERT INTO coupon_event_products (coupon_event_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, pid]);
      }
    }
    await client.query('COMMIT');
    res.json({ ...ev, applied_products: applied_products || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: '쿠폰 이벤트 수정 중 오류가 발생했습니다.' });
  } finally { client.release(); }
});

// DELETE /api/admin/events/coupons/:id
router.delete('/events/coupons/:id', authenticate, isAdmin, async (req, res) => {
  await db.query('DELETE FROM coupon_events WHERE id = $1', [req.params.id]);
  res.json({ message: '삭제됐습니다.' });
});

// GET /api/admin/events/sites
router.get('/events/sites', authenticate, isAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT se.*, COALESCE(array_agg(sep.product_id) FILTER (WHERE sep.product_id IS NOT NULL), '{}') as applied_products
     FROM site_events se
     LEFT JOIN site_event_products sep ON sep.site_event_id = se.id
     GROUP BY se.id ORDER BY se.created_at DESC`
  );
  res.json(rows);
});

// POST /api/admin/events/sites
router.post('/events/sites', authenticate, isAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { name, banner_img, desc_images, start_date, end_date, event_type, discount_value, bundle_count, bundle_rate, other_desc, applied_products } = req.body;
    if (!name || !start_date || !end_date || !event_type) return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    const { rows: [ev] } = await client.query(
      `INSERT INTO site_events (name, banner_img, desc_images, start_date, end_date, event_type, discount_value, bundle_count, bundle_rate, other_desc, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, banner_img||null, JSON.stringify(desc_images||[]), start_date, end_date, event_type, discount_value||0, bundle_count||0, bundle_rate||0, other_desc||null, req.user.id]
    );
    if (applied_products?.length) {
      for (const pid of applied_products) {
        await client.query('INSERT INTO site_event_products (site_event_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, pid]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ...ev, applied_products: applied_products || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: '사이트 이벤트 등록 중 오류가 발생했습니다.' });
  } finally { client.release(); }
});

// PUT /api/admin/events/sites/:id
router.put('/events/sites/:id', authenticate, isAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { name, banner_img, desc_images, start_date, end_date, event_type, discount_value, bundle_count, bundle_rate, other_desc, applied_products } = req.body;
    const { rows: [ev] } = await client.query(
      `UPDATE site_events SET name=$1, banner_img=$2, desc_images=$3, start_date=$4, end_date=$5, event_type=$6, discount_value=$7, bundle_count=$8, bundle_rate=$9, other_desc=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,
      [name, banner_img||null, JSON.stringify(desc_images||[]), start_date, end_date, event_type, discount_value||0, bundle_count||0, bundle_rate||0, other_desc||null, req.params.id]
    );
    if (!ev) return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    await client.query('DELETE FROM site_event_products WHERE site_event_id = $1', [req.params.id]);
    if (applied_products?.length) {
      for (const pid of applied_products) {
        await client.query('INSERT INTO site_event_products (site_event_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, pid]);
      }
    }
    await client.query('COMMIT');
    res.json({ ...ev, applied_products: applied_products || [] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: '사이트 이벤트 수정 중 오류가 발생했습니다.' });
  } finally { client.release(); }
});

// DELETE /api/admin/events/sites/:id
router.delete('/events/sites/:id', authenticate, isAdmin, async (req, res) => {
  await db.query('DELETE FROM site_events WHERE id = $1', [req.params.id]);
  res.json({ message: '삭제됐습니다.' });
});

// GET /api/admin/users
router.get('/users', authenticate, isAdmin, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, email, name, nickname, phone, role, points, provider, is_active, is_dormant, last_login_at, dormant_at, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
});

// POST /api/admin/users/:id/restore
router.post('/users/:id/restore', authenticate, isAdmin, async (req, res) => {
  await db.query('UPDATE users SET is_dormant=false, dormant_at=NULL WHERE id=$1', [req.params.id]);
  res.json({ message: '휴면 계정이 복구됐습니다.' });
});

module.exports = router;

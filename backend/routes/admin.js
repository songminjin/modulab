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

// GET /api/admin/orders — 주문 목록
router.get('/orders', authenticate, isAdmin, async (req, res) => {
  try {
    const { status, pay, search, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE 1=1';

    if (status && status !== 'all') {
      params.push(status);
      where += ` AND o.status = $${params.length}`;
    }
    if (pay && pay !== 'all') {
      params.push(pay);
      where += ` AND o.payment_method = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR p.name ILIKE $${params.length})`;
    }
    if (dateFrom) { params.push(dateFrom); where += ` AND o.created_at >= $${params.length}`; }
    if (dateTo)   { params.push(dateTo);   where += ` AND o.created_at <= $${params.length}::date + 1`; }

    const { rows } = await db.query(`
      SELECT o.id, o.status, o.final_amount, o.payment_method, o.pg_provider,
             o.payment_key, o.created_at, o.paid_at,
             u.name AS buyer_name, u.email AS buyer_email,
             STRING_AGG(p.name, ', ') AS product_names
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      ${where}
      GROUP BY o.id, u.name, u.email
      ORDER BY o.created_at DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `, params);

    res.json({ orders: rows, page: Number(page) });
  } catch (err) {
    console.error('[admin/orders]', err);
    res.status(500).json({ error: '주문 조회 중 오류가 발생했습니다.' });
  }
});

// PUT /api/admin/orders/:id/status — 주문 상태 변경
router.put('/orders/:id/status', authenticate, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await db.query('UPDATE orders SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '상태 변경 실패' });
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
    const { name, discount_type, discount_value, start_date, end_date, note, applied_products, min_order_amount, applicable_categories, applicable_grades } = req.body;
    if (!name || !discount_type || !discount_value || !start_date || !end_date) return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    const { rows: [ev] } = await client.query(
      'INSERT INTO coupon_events (name, discount_type, discount_value, start_date, end_date, note, min_order_amount, applicable_categories, applicable_grades, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [name, discount_type, discount_value, start_date, end_date, note||null, min_order_amount||0, JSON.stringify(applicable_categories||[]), JSON.stringify(applicable_grades||[]), req.user.id]
    );
    if (applied_products?.length) {
      for (const pid of applied_products) {
        await client.query('INSERT INTO coupon_event_products (coupon_event_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, pid]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ...ev, applied_products: applied_products || [], applicable_categories: applicable_categories || [], applicable_grades: applicable_grades || [] });
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
    const { name, discount_type, discount_value, start_date, end_date, note, applied_products, min_order_amount, applicable_categories, applicable_grades } = req.body;
    const { rows: [ev] } = await client.query(
      'UPDATE coupon_events SET name=$1, discount_type=$2, discount_value=$3, start_date=$4, end_date=$5, note=$6, min_order_amount=$7, applicable_categories=$8, applicable_grades=$9, updated_at=NOW() WHERE id=$10 RETURNING *',
      [name, discount_type, discount_value, start_date, end_date, note||null, min_order_amount||0, JSON.stringify(applicable_categories||[]), JSON.stringify(applicable_grades||[]), req.params.id]
    );
    if (!ev) return res.status(404).json({ error: '이벤트를 찾을 수 없습니다.' });
    await client.query('DELETE FROM coupon_event_products WHERE coupon_event_id = $1', [req.params.id]);
    if (applied_products?.length) {
      for (const pid of applied_products) {
        await client.query('INSERT INTO coupon_event_products (coupon_event_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ev.id, pid]);
      }
    }
    await client.query('COMMIT');
    res.json({ ...ev, applied_products: applied_products || [], applicable_categories: applicable_categories || [], applicable_grades: applicable_grades || [] });
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

// ─── CUSTOMER MANAGEMENT ───

// GET /api/admin/customers
router.get('/customers', authenticate, isAdmin, async (req, res) => {
  try {
    const cfgRes = await db.query('SELECT * FROM member_grade_config WHERE id=1');
    const cfg = cfgRes.rows[0] || { sprout_max:50000, regular_max:300000, vip_max:1000000 };
    const { rows } = await db.query(`
      SELECT u.id, u.email, u.name, u.nickname, u.phone, u.provider, u.is_active, u.is_dormant,
        u.last_login_at, u.created_at, u.points, u.manual_grade, u.marketing_consent, u.referral_source,
        COALESCE((SELECT SUM(o.final_amount) FROM orders o WHERE o.user_id=u.id AND o.status='paid'),0)::int AS total_spent,
        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status='paid'),0)::int AS total_orders,
        COALESCE((SELECT SUM(o.final_amount) FROM orders o WHERE o.user_id=u.id AND o.status='paid' AND o.paid_at>=date_trunc('month',NOW())),0)::int AS monthly_amount,
        (SELECT MAX(o.paid_at) FROM orders o WHERE o.user_id=u.id AND o.status='paid') AS last_purchased_at
      FROM users u WHERE u.role='user' ORDER BY u.created_at DESC`);
    const customers = rows.map(u => {
      let grade = u.manual_grade;
      if (!grade) {
        if (u.total_orders===0) grade='new';
        else if (u.monthly_amount<=cfg.sprout_max) grade='sprout';
        else if (u.monthly_amount<=cfg.regular_max) grade='regular';
        else if (u.monthly_amount<=cfg.vip_max) grade='vip';
        else grade='vvip';
      }
      return { ...u, grade };
    });
    res.json({ customers, config: cfg });
  } catch(err) { console.error('[customers]',err); res.status(500).json({ error:'오류가 발생했습니다.' }); }
});

// GET /api/admin/customers/:id
router.get('/customers/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [uRes, ordersRes, reviewsRes, pointsRes, notesRes, couponsRes, cfgRes] = await Promise.all([
      db.query(`SELECT u.*,
        COALESCE((SELECT SUM(o.final_amount) FROM orders o WHERE o.user_id=u.id AND o.status='paid'),0)::int AS total_spent,
        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status='paid'),0)::int AS total_orders,
        COALESCE((SELECT SUM(o.final_amount) FROM orders o WHERE o.user_id=u.id AND o.status='paid' AND o.paid_at>=date_trunc('month',NOW())),0)::int AS monthly_amount,
        (SELECT MAX(o.paid_at) FROM orders o WHERE o.user_id=u.id AND o.status='paid') AS last_purchased_at,
        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status='refunded'),0)::int AS refund_count
        FROM users u WHERE u.id=$1`, [id]),
      db.query(`SELECT o.id, o.final_amount, o.status, o.payment_method, o.created_at,
        (SELECT p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id LIMIT 1) AS first_product,
        (SELECT COUNT(*)::int FROM order_items WHERE order_id=o.id) AS item_count
        FROM orders o WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 30`, [id]),
      db.query(`SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.user_id=$1 ORDER BY r.created_at DESC`, [id]),
      db.query(`SELECT * FROM point_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [id]),
      db.query(`SELECT * FROM admin_notes WHERE user_id=$1 ORDER BY created_at DESC`, [id]),
      db.query(`SELECT uc.*, c.name, c.code, c.discount_type, c.discount_value, c.expires_at FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id WHERE uc.user_id=$1 ORDER BY uc.created_at DESC`, [id]),
      db.query(`SELECT * FROM member_grade_config WHERE id=1`),
    ]);
    if (!uRes.rows[0]) return res.status(404).json({ error:'회원을 찾을 수 없습니다.' });
    const cfg = cfgRes.rows[0] || { sprout_max:50000, regular_max:300000, vip_max:1000000 };
    const u = uRes.rows[0];
    let grade = u.manual_grade;
    if (!grade) {
      if (u.total_orders===0) grade='new';
      else if (u.monthly_amount<=cfg.sprout_max) grade='sprout';
      else if (u.monthly_amount<=cfg.regular_max) grade='regular';
      else if (u.monthly_amount<=cfg.vip_max) grade='vip';
      else grade='vvip';
    }
    res.json({ user:{...u,grade}, orders:ordersRes.rows, reviews:reviewsRes.rows, points:pointsRes.rows, notes:notesRes.rows, coupons:couponsRes.rows });
  } catch(err) { console.error('[customer detail]',err); res.status(500).json({ error:'오류가 발생했습니다.' }); }
});

// POST /api/admin/customers/:id/points
router.post('/customers/:id/points', authenticate, isAdmin, async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || !description) return res.status(400).json({ error:'금액과 사유를 입력해주세요.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET points=GREATEST(0,points+$1) WHERE id=$2', [amount, req.params.id]);
    await client.query('INSERT INTO point_history (user_id,type,amount,description) VALUES ($1,$2,$3,$4)',
      [req.params.id, amount>0?'admin_add':'admin_deduct', amount, description]);
    await client.query('COMMIT');
    const { rows } = await db.query('SELECT points FROM users WHERE id=$1', [req.params.id]);
    res.json({ points: rows[0]?.points });
  } catch(err) { await client.query('ROLLBACK'); res.status(500).json({ error:'포인트 처리 중 오류가 발생했습니다.' }); }
  finally { client.release(); }
});

// PUT /api/admin/customers/:id/grade
router.put('/customers/:id/grade', authenticate, isAdmin, async (req, res) => {
  const { grade } = req.body;
  const valid = ['new','sprout','regular','vip','vvip','blacklist',null];
  if (!valid.includes(grade)) return res.status(400).json({ error:'잘못된 등급입니다.' });
  await db.query('UPDATE users SET manual_grade=$1 WHERE id=$2', [grade, req.params.id]);
  res.json({ grade });
});

// PUT /api/admin/customers/:id/status
router.put('/customers/:id/status', authenticate, isAdmin, async (req, res) => {
  const { action } = req.body;
  if (action==='suspend') await db.query('UPDATE users SET is_dormant=true, dormant_at=NOW() WHERE id=$1', [req.params.id]);
  else if (action==='restore') await db.query('UPDATE users SET is_dormant=false, dormant_at=NULL WHERE id=$1', [req.params.id]);
  else if (action==='deactivate') await db.query('UPDATE users SET is_active=false WHERE id=$1', [req.params.id]);
  else return res.status(400).json({ error:'잘못된 액션입니다.' });
  res.json({ message:'처리되었습니다.' });
});

// GET /api/admin/customers/:id/notes
router.get('/customers/:id/notes', authenticate, isAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM admin_notes WHERE user_id=$1 ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

// POST /api/admin/customers/:id/notes
router.post('/customers/:id/notes', authenticate, isAdmin, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error:'메모 내용을 입력해주세요.' });
  const { rows } = await db.query(
    'INSERT INTO admin_notes (user_id,content,created_by) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, content.trim(), req.user.id]
  );
  res.status(201).json(rows[0]);
});

// DELETE /api/admin/customers/:id/notes/:noteId
router.delete('/customers/:id/notes/:noteId', authenticate, isAdmin, async (req, res) => {
  await db.query('DELETE FROM admin_notes WHERE id=$1 AND user_id=$2', [req.params.noteId, req.params.id]);
  res.json({ message:'삭제됐습니다.' });
});

// ─── MEMBER GRADE CONFIG ───

// GET /api/admin/member-grade-config
router.get('/member-grade-config', authenticate, isAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM member_grade_config WHERE id = 1');
  res.json(rows[0] || { sprout_max: 50000, regular_max: 300000, vip_max: 1000000 });
});

// PUT /api/admin/member-grade-config
router.put('/member-grade-config', authenticate, isAdmin, async (req, res) => {
  const { sprout_max, regular_max, vip_max } = req.body;
  if (!sprout_max || !regular_max || !vip_max) return res.status(400).json({ error: '모든 등급 기준을 입력해주세요.' });
  if (sprout_max >= regular_max || regular_max >= vip_max) return res.status(400).json({ error: '등급 기준은 오름차순이어야 합니다.' });
  const { rows } = await db.query(
    `INSERT INTO member_grade_config (id, sprout_max, regular_max, vip_max, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET sprout_max=$1, regular_max=$2, vip_max=$3, updated_at=NOW()
     RETURNING *`,
    [sprout_max, regular_max, vip_max]
  );
  res.json(rows[0]);
});

// GET /api/admin/members
router.get('/members', authenticate, isAdmin, async (req, res) => {
  try {
    const [cfgRes, membersRes] = await Promise.all([
      db.query('SELECT * FROM member_grade_config WHERE id = 1'),
      db.query(`
        SELECT u.id, u.email, u.name, u.nickname, u.created_at, u.last_login_at,
          COALESCE((
            SELECT SUM(o.final_amount) FROM orders o
            WHERE o.user_id = u.id AND o.status = 'paid'
            AND o.paid_at >= date_trunc('month', NOW())
          ), 0)::int AS monthly_amount,
          COALESCE((
            SELECT COUNT(*) FROM orders o
            WHERE o.user_id = u.id AND o.status = 'paid'
          ), 0)::int AS total_orders,
          (SELECT MAX(o.paid_at) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS last_purchased_at
        FROM users u WHERE u.role = 'user' AND u.is_active = true
        ORDER BY u.created_at DESC
      `)
    ]);
    const cfg = cfgRes.rows[0] || { sprout_max: 50000, regular_max: 300000, vip_max: 1000000 };
    const members = membersRes.rows.map(u => {
      let grade;
      if (u.total_orders === 0) grade = 'new';
      else if (u.monthly_amount <= cfg.sprout_max) grade = 'sprout';
      else if (u.monthly_amount <= cfg.regular_max) grade = 'regular';
      else if (u.monthly_amount <= cfg.vip_max) grade = 'vip';
      else grade = 'vvip';
      return { ...u, grade };
    });
    res.json({ members, config: cfg });
  } catch (err) {
    console.error('[admin/members]', err);
    res.status(500).json({ error: '회원 목록 조회 중 오류가 발생했습니다.' });
  }
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

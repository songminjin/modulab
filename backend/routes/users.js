const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

// 내 정보 조회
router.get('/me', authenticate, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, email, name, nickname, phone, profile_image, role, points, provider, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json(rows[0]);
});

// 내 정보 수정
router.put('/me', authenticate, async (req, res) => {
  try {
    const { name, nickname, phone } = req.body;
    const { rows } = await db.query(
      'UPDATE users SET name=$1, nickname=$2, phone=$3, updated_at=NOW() WHERE id=$4 RETURNING id, email, name, nickname, phone',
      [name, nickname, phone, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: '정보 수정 중 오류가 발생했습니다.' });
  }
});

// 비밀번호 변경
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await db.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];

    if (!user.password) return res.status(400).json({ error: '소셜 로그인 계정은 비밀번호를 변경할 수 없습니다.' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    if (newPassword.length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashed, req.user.id]);
    res.json({ message: '비밀번호가 변경됐습니다.' });
  } catch (err) {
    res.status(500).json({ error: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
});

// 구매 이력
router.get('/orders', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT o.*, json_agg(json_build_object('id', p.id, 'name', p.name, 'price', oi.price, 'category', p.category, 'emoji', p.emoji)) as items
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = $1
     GROUP BY o.id ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// 다운로드 가능 상품
router.get('/downloads', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, p.name, p.emoji, p.category, p.file_url, d.download_count, d.last_downloaded_at
     FROM downloads d
     JOIN products p ON p.id = d.product_id
     WHERE d.user_id = $1
     ORDER BY d.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// 포인트 이력
router.get('/points', authenticate, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM point_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  const { rows: [user] } = await db.query('SELECT points FROM users WHERE id = $1', [req.user.id]);
  res.json({ balance: user.points, history: rows });
});

// 내 쿠폰
router.get('/coupons', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT uc.*, c.name, c.code, c.discount_type, c.discount_value, c.min_order_amount, c.expires_at
     FROM user_coupons uc
     JOIN coupons c ON c.id = uc.coupon_id
     WHERE uc.user_id = $1 AND uc.is_used = false AND (c.expires_at IS NULL OR c.expires_at > NOW())
     ORDER BY c.expires_at ASC`,
    [req.user.id]
  );
  res.json(rows);
});

// 회원 탈퇴
router.delete('/me', authenticate, async (req, res) => {
  await db.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [req.user.id]);
  res.clearCookie('token');
  res.json({ message: '회원 탈퇴가 완료됐습니다.' });
});

// GET /api/users/me/export — 개인정보 내려받기 (GDPR/개인정보보호법)
router.get('/me/export', authenticate, async (req, res) => {
  try {
    const [userRes, ordersRes, downloadsRes, reviewsRes, pointsRes] = await Promise.all([
      db.query('SELECT id, email, name, nickname, phone, provider, points, created_at, last_login_at FROM users WHERE id=$1', [req.user.id]),
      db.query(`SELECT o.id, o.final_amount, o.status, o.paid_at, o.created_at,
                json_agg(json_build_object('name', p.name, 'price', oi.price)) as items
                FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
                WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`, [req.user.id]),
      db.query('SELECT p.name, d.download_count, d.last_downloaded_at, d.created_at FROM downloads d JOIN products p ON p.id=d.product_id WHERE d.user_id=$1', [req.user.id]),
      db.query('SELECT p.name, r.rating, r.content, r.created_at FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.user_id=$1', [req.user.id]),
      db.query('SELECT type, amount, description, created_at FROM point_history WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]),
    ]);
    const exportData = {
      exported_at: new Date().toISOString(),
      profile: userRes.rows[0],
      orders: ordersRes.rows,
      downloads: downloadsRes.rows,
      reviews: reviewsRes.rows,
      point_history: pointsRes.rows,
    };
    res.setHeader('Content-Disposition', 'attachment; filename="modulab_my_data.json"');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: '데이터 내보내기 중 오류가 발생했습니다.' });
  }
});

module.exports = router;

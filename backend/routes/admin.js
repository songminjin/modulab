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

module.exports = router;

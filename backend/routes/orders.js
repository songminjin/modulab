const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

// 주문 생성
router.post('/', authenticate, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { product_ids, coupon_code } = req.body;
    if (!product_ids?.length) return res.status(400).json({ error: '상품을 선택해주세요.' });

    // 상품 조회
    const { rows: products } = await client.query(
      'SELECT id, name, price FROM products WHERE id = ANY($1) AND is_active = true',
      [product_ids]
    );
    if (products.length !== product_ids.length) return res.status(400).json({ error: '유효하지 않은 상품이 포함됐습니다.' });

    const total = products.reduce((sum, p) => sum + p.price, 0);
    let discount = 0;
    let couponId = null;

    // 쿠폰 적용
    if (coupon_code) {
      const { rows: [coupon] } = await client.query(
        `SELECT uc.id as uc_id, c.* FROM user_coupons uc
         JOIN coupons c ON c.id = uc.coupon_id
         WHERE uc.user_id = $1 AND c.code = $2 AND uc.is_used = false
         AND (c.expires_at IS NULL OR c.expires_at > NOW())`,
        [req.user.id, coupon_code]
      );
      if (coupon && total >= coupon.min_order_amount) {
        discount = coupon.discount_type === 'percent'
          ? Math.min(Math.floor(total * coupon.discount_value / 100), coupon.max_discount_amount || Infinity)
          : coupon.discount_value;
        couponId = coupon.id;
      }
    }

    const finalAmount = Math.max(0, total - discount);
    const orderId = uuidv4();

    // 주문 생성
    await client.query(
      'INSERT INTO orders (id, user_id, total_amount, discount_amount, final_amount, coupon_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [orderId, req.user.id, total, discount, finalAmount, couponId]
    );

    // 주문 상품 저장
    for (const p of products) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, price) VALUES ($1, $2, $3)',
        [orderId, p.id, p.price]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ order_id: orderId, total_amount: total, discount_amount: discount, final_amount: finalAmount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: '주문 생성 중 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

// 결제 완료 처리 (토스페이먼츠 연동 시 사용)
router.post('/:id/confirm', authenticate, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { payment_key, payment_method } = req.body;
    const { rows: [order] } = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2 AND status = $3',
      [req.params.id, req.user.id, 'pending']
    );
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });

    // 주문 상태 업데이트
    await client.query(
      'UPDATE orders SET status=$1, payment_key=$2, payment_method=$3, paid_at=NOW() WHERE id=$4',
      ['paid', payment_key, payment_method, order.id]
    );

    // 쿠폰 사용 처리
    if (order.coupon_id) {
      await client.query(
        'UPDATE user_coupons SET is_used=true, used_at=NOW() WHERE user_id=$1 AND coupon_id=$2',
        [req.user.id, order.coupon_id]
      );
    }

    // 다운로드 권한 부여
    const { rows: items } = await client.query('SELECT product_id FROM order_items WHERE order_id = $1', [order.id]);
    for (const item of items) {
      await client.query(
        'INSERT INTO downloads (user_id, product_id, order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.id, item.product_id, order.id]
      );
    }

    // 장바구니에서 구매 상품 제거
    const productIds = items.map(i => i.product_id);
    await client.query('DELETE FROM cart_items WHERE user_id=$1 AND product_id = ANY($2)', [req.user.id, productIds]);

    await client.query('COMMIT');
    res.json({ message: '결제가 완료됐습니다.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: '결제 처리 중 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

// 주문 상세 조회
router.get('/:id', authenticate, async (req, res) => {
  const { rows: [order] } = await db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });

  const { rows: items } = await db.query(
    'SELECT oi.*, p.name, p.emoji, p.category FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1',
    [order.id]
  );
  res.json({ ...order, items });
});

module.exports = router;

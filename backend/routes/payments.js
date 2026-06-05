const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

// ── 주문 확정 공통 처리 ──
async function confirmOrderPayment(client, orderId, userId, paymentKey, paymentMethod, pgProvider) {
  const { rows: [order] } = await client.query(
    'SELECT * FROM orders WHERE id = $1 AND user_id = $2 AND status = $3',
    [orderId, userId, 'pending']
  );
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  await client.query(
    `UPDATE orders SET status='paid', payment_key=$1, payment_method=$2, pg_provider=$3, paid_at=NOW() WHERE id=$4`,
    [paymentKey, paymentMethod, pgProvider, orderId]
  );

  if (order.coupon_id) {
    await client.query(
      'UPDATE user_coupons SET is_used=true, used_at=NOW() WHERE user_id=$1 AND coupon_id=$2',
      [userId, order.coupon_id]
    );
  }

  if (order.coupon_event_download_id) {
    await client.query(
      'UPDATE coupon_event_downloads SET is_used=true, used_at=NOW(), order_id=$1 WHERE id=$2 AND user_id=$3',
      [orderId, order.coupon_event_download_id, userId]
    );
  }

  const { rows: items } = await client.query('SELECT product_id FROM order_items WHERE order_id=$1', [orderId]);
  for (const item of items) {
    await client.query(
      'INSERT INTO downloads (user_id, product_id, order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, item.product_id, orderId]
    );
  }
  const productIds = items.map(i => i.product_id);
  await client.query('DELETE FROM cart_items WHERE user_id=$1 AND product_id = ANY($2)', [userId, productIds]);

  return order;
}

// ── PayPal 액세스 토큰 ──
async function getPayPalToken() {
  const base = process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return { token: data.access_token, base };
}

// ── PortOne v2 결제 완료 검증 ──
router.post('/portone/complete', authenticate, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { paymentId, orderId } = req.body;
    if (!paymentId || !orderId) return res.status(400).json({ error: '필수 파라미터 누락' });

    // PortOne API로 결제 상태 조회
    const portoneRes = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${process.env.PORTONE_SECRET_KEY}` }
    });
    if (!portoneRes.ok) return res.status(400).json({ error: '포트원 결제 조회 실패' });
    const payment = await portoneRes.json();

    // 가상계좌 발급 처리 (아직 입금 전)
    if (payment.status === 'VIRTUAL_ACCOUNT_ISSUED') {
      const va = payment.virtualAccount;
      await db.query(
        `UPDATE orders SET status='vbank_pending', payment_key=$1, pg_provider=$2 WHERE id=$3 AND user_id=$4`,
        [paymentId, payment.channel?.pgProvider || 'portone', orderId, req.user.id]
      );
      return res.json({
        success: true,
        type: 'vbank',
        vbankInfo: {
          bank: va?.bank || '',
          accountNumber: va?.accountNumber || '',
          dueDate: va?.dueDate || '',
          amount: payment.amount?.total
        }
      });
    }

    if (payment.status !== 'PAID') return res.status(400).json({ error: '결제가 완료되지 않았습니다.' });

    // 금액 검증 (위변조 방지)
    const { rows: [order] } = await db.query(
      'SELECT final_amount FROM orders WHERE id=$1 AND user_id=$2',
      [orderId, req.user.id]
    );
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    if (payment.amount.total !== order.final_amount) {
      return res.status(400).json({ error: '결제 금액이 주문 금액과 다릅니다.' });
    }

    await client.query('BEGIN');
    const pgProvider = payment.channel?.pgProvider || 'portone';
    await confirmOrderPayment(client, orderId, req.user.id, paymentId, payment.method, pgProvider);
    await client.query('COMMIT');

    res.json({ success: true, orderId });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    console.error('[PortOne 결제 완료]', err);
    res.status(500).json({ error: '결제 처리 중 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

// ── PayPal 주문 생성 ──
router.post('/paypal/create-order', authenticate, async (req, res) => {
  try {
    const { orderId } = req.body;
    const { rows: [order] } = await db.query(
      'SELECT * FROM orders WHERE id=$1 AND user_id=$2 AND status=$3',
      [orderId, req.user.id, 'pending']
    );
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });

    const { token, base } = await getPayPalToken();
    const ppRes = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: orderId,
          amount: {
            currency_code: 'USD',
            value: (order.final_amount / 1350).toFixed(2)
          }
        }]
      })
    });
    const ppOrder = await ppRes.json();
    if (!ppRes.ok) return res.status(400).json({ error: 'PayPal 주문 생성 실패', detail: ppOrder });

    await db.query('UPDATE orders SET paypal_order_id=$1 WHERE id=$2', [ppOrder.id, orderId]);
    res.json({ paypalOrderId: ppOrder.id });
  } catch (err) {
    console.error('[PayPal 주문 생성]', err);
    res.status(500).json({ error: 'PayPal 주문 생성 중 오류 발생' });
  }
});

// ── PayPal 결제 캡처 ──
router.post('/paypal/capture/:paypalOrderId', authenticate, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { paypalOrderId } = req.params;
    const { orderId } = req.body;

    const { token, base } = await getPayPalToken();
    const captureRes = await fetch(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const capture = await captureRes.json();
    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'PayPal 결제가 완료되지 않았습니다.' });
    }

    await client.query('BEGIN');
    await confirmOrderPayment(client, orderId, req.user.id, paypalOrderId, 'PAYPAL', 'paypal');
    await client.query('COMMIT');

    res.json({ success: true, orderId });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    console.error('[PayPal 캡처]', err);
    res.status(500).json({ error: '결제 처리 중 오류 발생' });
  } finally {
    client.release();
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

// 장바구니 조회
router.get('/', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT ci.id, ci.created_at, p.id as product_id, p.name, p.price, p.category, p.emoji
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.created_at DESC`,
    [req.user.id]
  );
  const total = rows.reduce((sum, item) => sum + item.price, 0);
  res.json({ items: rows, total });
});

// 장바구니 추가
router.post('/', authenticate, async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: '상품 ID가 필요합니다.' });

    const product = (await db.query('SELECT id, name, price FROM products WHERE id = $1 AND is_active = true', [product_id])).rows[0];
    if (!product) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });

    // 이미 구매한 상품 확인
    const bought = (await db.query(
      'SELECT id FROM downloads WHERE user_id = $1 AND product_id = $2',
      [req.user.id, product_id]
    )).rows[0];
    if (bought) return res.status(409).json({ error: '이미 구매한 상품입니다.' });

    await db.query(
      'INSERT INTO cart_items (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, product_id]
    );
    res.status(201).json({ message: '장바구니에 추가됐습니다.' });
  } catch (err) {
    res.status(500).json({ error: '장바구니 추가 중 오류가 발생했습니다.' });
  }
});

// 장바구니 삭제
router.delete('/:id', authenticate, async (req, res) => {
  await db.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ message: '삭제됐습니다.' });
});

// 장바구니 전체 비우기
router.delete('/', authenticate, async (req, res) => {
  await db.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
  res.json({ message: '장바구니를 비웠습니다.' });
});

module.exports = router;

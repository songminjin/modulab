const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, isAdmin } = require('../middleware/auth');

// 공개 통계 API — 조회수·구매수 (인증 불필요, products-renderer.js에서 호출)
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.view_count,
              COUNT(DISTINCT o.id)::int AS purchase_count
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'
       WHERE p.is_active = true
       GROUP BY p.id, p.view_count`
    );
    res.json(rows);
  } catch (err) {
    console.error('[stats]', err.message);
    res.json([]);
  }
});

// 전체 상품 조회
router.get('/', async (req, res) => {
  const { category, sort } = req.query;
  let query = 'SELECT id, name, description, price, category, emoji, thumbnail_url, view_count, download_count, created_at FROM products WHERE is_active = true';
  const params = [];

  if (category) { params.push(category); query += ` AND category = $${params.length}`; }

  const sortMap = { price_asc: 'price ASC', price_desc: 'price DESC', popular: 'download_count DESC', newest: 'created_at DESC' };
  query += ` ORDER BY ${sortMap[sort] || 'created_at DESC'}`;

  const { rows } = await db.query(query, params);
  res.json(rows);
});

// 상품 상세 조회
router.get('/:id', async (req, res) => {
  const { rows: [product] } = await db.query(
    'SELECT * FROM products WHERE id = $1 AND is_active = true',
    [req.params.id]
  );
  if (!product) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });

  await db.query('UPDATE products SET view_count = view_count + 1 WHERE id = $1', [req.params.id]);

  const { rows: reviews } = await db.query(
    `SELECT r.rating, r.content, r.created_at, u.name, u.nickname
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.product_id = $1 AND r.is_active = true ORDER BY r.created_at DESC`,
    [req.params.id]
  );
  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;

  res.json({ ...product, reviews, avg_rating: avgRating, review_count: reviews.length });
});

// 리뷰 작성
router.post('/:id/reviews', authenticate, async (req, res) => {
  try {
    const { rating, content } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: '평점은 1~5 사이여야 합니다.' });

    // 구매 여부 확인
    const bought = (await db.query(
      'SELECT order_id FROM downloads WHERE user_id = $1 AND product_id = $2',
      [req.user.id, req.params.id]
    )).rows[0];
    if (!bought) return res.status(403).json({ error: '구매한 상품에만 리뷰를 작성할 수 있습니다.' });

    await db.query(
      'INSERT INTO reviews (user_id, product_id, order_id, rating, content) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, req.params.id, bought.order_id, rating, content]
    );

    // 리뷰 포인트 500P 적립
    await db.query('UPDATE users SET points = points + 500 WHERE id = $1', [req.user.id]);
    await db.query(
      'INSERT INTO point_history (user_id, type, amount, description) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'earn_review', 500, '리뷰 작성 포인트 적립']
    );

    res.status(201).json({ message: '리뷰가 등록됐습니다. 500P가 적립됐습니다.' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 리뷰를 작성했습니다.' });
    res.status(500).json({ error: '리뷰 작성 중 오류가 발생했습니다.' });
  }
});

// 파일 다운로드
router.get('/:id/download', authenticate, async (req, res) => {
  const { rows: [download] } = await db.query(
    'SELECT d.*, p.file_url, p.name FROM downloads d JOIN products p ON p.id = d.product_id WHERE d.user_id = $1 AND d.product_id = $2',
    [req.user.id, req.params.id]
  );
  if (!download) return res.status(403).json({ error: '구매한 상품만 다운로드할 수 있습니다.' });

  await db.query(
    'UPDATE downloads SET download_count = download_count + 1, last_downloaded_at = NOW() WHERE user_id = $1 AND product_id = $2',
    [req.user.id, req.params.id]
  );
  await db.query('UPDATE products SET download_count = download_count + 1 WHERE id = $1', [req.params.id]);

  res.json({ download_url: download.file_url, name: download.name });
});

module.exports = router;

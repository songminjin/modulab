const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

// GET /api/reviews?productId=xxx&sort=popular|latest|rating
router.get('/', async (req, res) => {
  try {
    const { productId, sort = 'popular' } = req.query;
    if (!productId) return res.status(400).json({ error: '상품 ID가 필요합니다.' });

    const orderClauses = {
      popular: 'r.likes_count DESC, r.created_at DESC',
      latest:  'r.created_at DESC',
      rating:  'r.rating DESC, r.created_at DESC',
    };
    const orderBy = orderClauses[sort] || orderClauses.popular;

    const { rows } = await db.query(
      `SELECT r.id, r.rating, r.content, r.likes_count, r.reviewer_name,
              to_char(r.created_at, 'YYYY.MM.DD') as date_str
       FROM reviews r
       WHERE r.product_id = $1
       ORDER BY ${orderBy}`,
      [productId]
    );

    const total = rows.length;
    const avg = total
      ? (rows.reduce((s, r) => s + r.rating, 0) / total).toFixed(1)
      : '0.0';

    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rows.forEach(r => { dist[r.rating] = (dist[r.rating] || 0) + 1; });

    res.json({ reviews: rows, total, avg, dist });
  } catch (err) {
    console.error('[reviews GET]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/reviews — requires auth
router.post('/', authenticate, async (req, res) => {
  try {
    const { productId, rating, content } = req.body;
    if (!productId || !rating || !content?.trim()) {
      return res.status(400).json({ error: '상품 ID, 별점, 내용이 필요합니다.' });
    }
    const ratingNum = parseInt(rating);
    if (ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: '별점은 1~5 사이여야 합니다.' });
    }
    const trimmed = content.trim();
    if (trimmed.length < 10) {
      return res.status(400).json({ error: '리뷰 내용은 최소 10자 이상 입력해주세요.' });
    }
    if (trimmed.length > 1000) {
      return res.status(400).json({ error: '리뷰 내용은 1000자 이하여야 합니다.' });
    }

    const name = req.user.name || '익명';
    const maskedName = name.length > 1
      ? name[0] + '*'.repeat(Math.min(name.length - 1, 3))
      : name + '***';

    const { rows } = await db.query(
      `INSERT INTO reviews (product_id, user_id, reviewer_name, rating, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, rating, content, likes_count, reviewer_name,
                 to_char(created_at, 'YYYY.MM.DD') as date_str`,
      [productId, req.user.id, maskedName, ratingNum, trimmed]
    );

    res.status(201).json({ review: rows[0] });
  } catch (err) {
    console.error('[reviews POST]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/reviews/:id/like — fingerprint-based like toggle
router.post('/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { fingerprint } = req.body;
    if (!fingerprint || fingerprint.length > 100) {
      return res.status(400).json({ error: '유효하지 않은 요청입니다.' });
    }

    const existing = await db.query(
      'SELECT id FROM review_likes WHERE review_id = $1 AND fingerprint = $2',
      [id, fingerprint]
    );

    let liked;
    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM review_likes WHERE review_id = $1 AND fingerprint = $2',
        [id, fingerprint]
      );
      await db.query(
        'UPDATE reviews SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1',
        [id]
      );
      liked = false;
    } else {
      await db.query(
        'INSERT INTO review_likes (review_id, fingerprint) VALUES ($1, $2)',
        [id, fingerprint]
      );
      await db.query(
        'UPDATE reviews SET likes_count = likes_count + 1 WHERE id = $1',
        [id]
      );
      liked = true;
    }

    const { rows } = await db.query(
      'SELECT likes_count FROM reviews WHERE id = $1', [id]
    );
    res.json({ liked, likes_count: rows[0]?.likes_count ?? 0 });
  } catch (err) {
    console.error('[reviews LIKE]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;

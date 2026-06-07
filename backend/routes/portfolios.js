const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, isAdmin } = require('../middleware/auth');

// 공개 — 카테고리별 포트폴리오 목록
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    let query = `SELECT id, title, category, description, thumbnail_url, media_type, video_url, images, sort_order
                 FROM portfolios WHERE is_active = true`;
    const params = [];
    if (category) { params.push(category); query += ` AND category = $${params.length}`; }
    query += ' ORDER BY sort_order ASC, created_at DESC';
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[portfolios get]', err.message);
    res.status(500).json({ error: '포트폴리오 조회 중 오류가 발생했습니다.' });
  }
});

// 관리자 — 전체 목록 (비활성 포함)
router.get('/admin/all', authenticate, isAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM portfolios ORDER BY sort_order ASC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '조회 오류' });
  }
});

// 관리자 — 등록
router.post('/admin', authenticate, isAdmin, async (req, res) => {
  try {
    const { title, category, description, thumbnail_url, media_type, video_url, images, sort_order } = req.body;
    if (!title || !category) return res.status(400).json({ error: '제목과 카테고리는 필수입니다.' });
    const { rows: [row] } = await db.query(
      `INSERT INTO portfolios (title, category, description, thumbnail_url, media_type, video_url, images, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [title, category, description || '', thumbnail_url || '', media_type || 'image',
       video_url || '', JSON.stringify(images || []), sort_order || 0]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('[portfolio create]', err.message);
    res.status(500).json({ error: '등록 중 오류가 발생했습니다.' });
  }
});

// 관리자 — 수정
router.put('/admin/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { title, category, description, thumbnail_url, media_type, video_url, images, sort_order, is_active } = req.body;
    const { rows: [row] } = await db.query(
      `UPDATE portfolios SET title=$1, category=$2, description=$3, thumbnail_url=$4,
       media_type=$5, video_url=$6, images=$7, sort_order=$8, is_active=$9
       WHERE id=$10 RETURNING *`,
      [title, category, description, thumbnail_url, media_type,
       video_url, JSON.stringify(images || []), sort_order, is_active, req.params.id]
    );
    if (!row) return res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: '수정 중 오류가 발생했습니다.' });
  }
});

// 관리자 — 활성화 토글
router.patch('/admin/:id/toggle', authenticate, isAdmin, async (req, res) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE portfolios SET is_active = NOT is_active WHERE id=$1 RETURNING id, is_active`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: '상태 변경 오류' });
  }
});

// 관리자 — 삭제
router.delete('/admin/:id', authenticate, isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM portfolios WHERE id=$1', [req.params.id]);
    res.json({ message: '삭제됐습니다.' });
  } catch (err) {
    res.status(500).json({ error: '삭제 중 오류가 발생했습니다.' });
  }
});

module.exports = router;

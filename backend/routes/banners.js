const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, isAdmin } = require('../middleware/auth');

// 공개 — 활성 배너 목록 (슬라이더용)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, title, subtitle, btn_text, btn_url, image_url, sort_order
       FROM hero_banners WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[banners get]', err.message);
    res.status(500).json({ error: '배너 조회 오류' });
  }
});

// 관리자 — 전체 목록 (비활성 포함)
router.get('/admin/all', authenticate, isAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM hero_banners ORDER BY sort_order ASC, created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '조회 오류' });
  }
});

// 관리자 — 등록
router.post('/admin', authenticate, isAdmin, async (req, res) => {
  try {
    const { title, subtitle, btn_text, btn_url, image_url, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: '제목은 필수입니다.' });
    const { rows: [row] } = await db.query(
      `INSERT INTO hero_banners (title, subtitle, btn_text, btn_url, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, subtitle || '', btn_text || '', btn_url || '', image_url || '', sort_order || 0]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error('[banner create]', err.message);
    res.status(500).json({ error: '등록 중 오류가 발생했습니다.' });
  }
});

// 관리자 — 수정
router.put('/admin/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { title, subtitle, btn_text, btn_url, image_url, sort_order, is_active } = req.body;
    const { rows: [row] } = await db.query(
      `UPDATE hero_banners SET title=$1, subtitle=$2, btn_text=$3, btn_url=$4,
       image_url=$5, sort_order=$6, is_active=$7 WHERE id=$8 RETURNING *`,
      [title, subtitle, btn_text, btn_url, image_url, sort_order, is_active, req.params.id]
    );
    if (!row) return res.status(404).json({ error: '배너를 찾을 수 없습니다.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: '수정 중 오류가 발생했습니다.' });
  }
});

// 관리자 — 활성화 토글
router.patch('/admin/:id/toggle', authenticate, isAdmin, async (req, res) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE hero_banners SET is_active = NOT is_active WHERE id=$1 RETURNING id, is_active`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: '배너를 찾을 수 없습니다.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: '상태 변경 오류' });
  }
});

// 관리자 — 순서 일괄 수정
router.patch('/admin/reorder', authenticate, isAdmin, async (req, res) => {
  try {
    const { orders } = req.body; // [{ id, sort_order }, ...]
    for (const item of orders) {
      await db.query('UPDATE hero_banners SET sort_order=$1 WHERE id=$2', [item.sort_order, item.id]);
    }
    res.json({ message: '순서가 저장됐습니다.' });
  } catch (err) {
    res.status(500).json({ error: '순서 저장 오류' });
  }
});

// 관리자 — 삭제
router.delete('/admin/:id', authenticate, isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM hero_banners WHERE id=$1', [req.params.id]);
    res.json({ message: '삭제됐습니다.' });
  } catch (err) {
    res.status(500).json({ error: '삭제 중 오류가 발생했습니다.' });
  }
});

module.exports = router;

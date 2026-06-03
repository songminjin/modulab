const jwt = require('jsonwebtoken');
const db = require('../config/db');

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query('SELECT id, email, name, role, points FROM users WHERE id = $1 AND is_active = true', [decoded.id]);

    if (!rows[0]) return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: '인증이 만료됐습니다. 다시 로그인해주세요.' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
};

module.exports = { authenticate, isAdmin };

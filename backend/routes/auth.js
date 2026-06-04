const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const KakaoStrategy = require('passport-kakao').Strategy;
const db = require('../config/db');

// ── JWT 토큰 생성 ──
const createToken = (user) => jwt.sign(
  { id: user.id, email: user.email, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

// ── 쿠키 설정 ──
const setTokenCookie = (res, token) => {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

// ── 소셜 로그인 공통 처리 ──
const handleSocialLogin = async (profile, provider, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName || profile._json?.nickname || '회원';
    const profileImage = profile.photos?.[0]?.value;
    const providerId = String(profile.id);

    let user = (await db.query(
      'SELECT * FROM users WHERE provider = $1 AND provider_id = $2',
      [provider, providerId]
    )).rows[0];

    if (!user && email) {
      user = (await db.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
    }

    if (!user) {
      const { rows } = await db.query(
        `INSERT INTO users (id, email, name, profile_image, provider, provider_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [uuidv4(), email || `${provider}_${providerId}@modulab.local`, name, profileImage, provider, providerId]
      );
      user = rows[0];
    } else if (!user.provider_id) {
      await db.query('UPDATE users SET provider = $1, provider_id = $2, updated_at = NOW() WHERE id = $3',
        [provider, providerId, user.id]);
    }

    await db.query('UPDATE users SET last_login_at = NOW(), is_dormant = false WHERE id = $1', [user.id]);

    return done(null, user);
  } catch (err) {
    return done(err);
  }
};

// ── Passport 설정 ──
const BACKEND_URL = process.env.BACKEND_URL
  || (process.env.NODE_ENV === 'production'
    ? 'https://modulab-production.up.railway.app'
    : 'http://localhost:3000');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID?.trim(),
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
  callbackURL: `${BACKEND_URL}/api/auth/google/callback`,
  proxy: true,
}, (accessToken, refreshToken, profile, done) => handleSocialLogin(profile, 'google', done)));

passport.use(new KakaoStrategy({
  clientID: process.env.KAKAO_CLIENT_ID,
  callbackURL: process.env.KAKAO_CALLBACK_URL || `${BACKEND_URL}/api/auth/kakao/callback`,
}, (accessToken, refreshToken, profile, done) => handleSocialLogin(profile, 'kakao', done)));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  done(null, rows[0]);
});

// ── 일반 회원가입 ──
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, nickname, phone } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });

    const exists = (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    if (exists) return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });

    const hashed = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (id, email, password, name, nickname, phone, provider)
       VALUES ($1, $2, $3, $4, $5, $6, 'local') RETURNING id, email, name, role, points`,
      [uuidv4(), email, hashed, name, nickname || null, phone || null]
    );

    const token = createToken(rows[0]);
    setTokenCookie(res, token);
    res.status(201).json({ user: rows[0], token });
  } catch (err) {
    res.status(500).json({ error: '회원가입 중 오류가 발생했습니다.' });
  }
});

// ── 일반 로그인 ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });

    const { rows } = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = rows[0];
    if (!user || !user.password) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });

    await db.query('UPDATE users SET last_login_at = NOW(), is_dormant = false WHERE id = $1', [user.id]);

    const token = createToken(user);
    setTokenCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, points: user.points }, token });
  } catch (err) {
    res.status(500).json({ error: '로그인 중 오류가 발생했습니다.' });
  }
});

// ── 구글 로그인 ──
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login.html?error=google` }),
  (req, res) => {
    const token = createToken(req.user);
    setTokenCookie(res, token);
    res.redirect(`${process.env.FRONTEND_URL}/?login=success`);
  }
);

// ── 카카오 로그인 ──
router.get('/kakao', passport.authenticate('kakao'));
router.get('/kakao/callback',
  passport.authenticate('kakao', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login.html?error=kakao` }),
  (req, res) => {
    const token = createToken(req.user);
    setTokenCookie(res, token);
    res.redirect(`${process.env.FRONTEND_URL}/?login=success`);
  }
);

// ── 로그아웃 ──
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: '로그아웃됐습니다.' });
});

// ── 토큰 검증 ──
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query(
      'SELECT id, email, name, nickname, phone, profile_image, role, points, provider, created_at FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    if (!rows[0]) return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(401).json({ error: '인증이 만료됐습니다.' });
  }
});

module.exports = router;

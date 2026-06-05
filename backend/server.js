require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const db = require('./config/db');

const app = express();

// ── 보안 미들웨어 ──
app.use(helmet());
const _frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
const _corsOrigin = (() => { try { return new URL(_frontendUrl).origin; } catch { return _frontendUrl; } })();
app.use(cors({
  origin: _corsOrigin,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── 세션 (Passport용) ──
app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 60000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Rate Limiting ──
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.' } }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: '회원가입은 1시간에 5번까지만 가능합니다.' } }));

// ── 라우터 ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/products', require('./routes/products'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/events', require('./routes/events'));

// ── 헬스체크 ──
app.get('/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// ── 에러 핸들러 ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ── DB 마이그레이션 (기동 시 실행) ──
async function runMigrations() {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS reviews (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       product_id VARCHAR(100) NOT NULL,
       user_id UUID REFERENCES users(id) ON DELETE SET NULL,
       reviewer_name VARCHAR(50),
       rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
       content TEXT NOT NULL,
       likes_count INTEGER DEFAULT 0,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS review_likes (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       review_id UUID REFERENCES reviews(id) ON DELETE CASCADE,
       fingerprint VARCHAR(100) NOT NULL,
       created_at TIMESTAMP DEFAULT NOW(),
       UNIQUE(review_id, fingerprint)
     )`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name VARCHAR(50)`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS product_id VARCHAR(100)`,
    `ALTER TABLE reviews ALTER COLUMN product_id TYPE VARCHAR(100) USING product_id::text`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at)`,
    `CREATE TABLE IF NOT EXISTS coupon_event_downloads (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       coupon_event_id UUID NOT NULL REFERENCES coupon_events(id) ON DELETE CASCADE,
       is_used BOOLEAN DEFAULT false,
       used_at TIMESTAMP,
       order_id UUID,
       created_at TIMESTAMP DEFAULT NOW(),
       UNIQUE(user_id, coupon_event_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ced_user ON coupon_event_downloads(user_id)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_event_download_id UUID`,
    `ALTER TABLE coupon_events ADD COLUMN IF NOT EXISTS applicable_grades JSONB DEFAULT '[]'`,
  ];
  for (const sql of migrations) {
    try { await db.query(sql); } catch (err) { console.error('[migration error]', err.message); }
  }
  console.log('[migrations] 완료');
}
runMigrations();

// ── 휴면 계정 자동 처리 (매일 자정) ──
async function checkDormantAccounts() {
  try {
    const { rowCount } = await db.query(
      `UPDATE users SET is_dormant=true, dormant_at=NOW()
       WHERE is_dormant=false AND is_active=true AND last_login_at IS NOT NULL
       AND last_login_at < NOW() - INTERVAL '1 year'`
    );
    if (rowCount > 0) console.log(`[휴면 계정] ${rowCount}개 계정이 휴면 처리됐습니다.`);
  } catch (err) {
    console.error('[휴면 계정 체크 오류]', err);
  }
}

checkDormantAccounts();
const DORMANT_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
setInterval(checkDormantAccounts, DORMANT_CHECK_INTERVAL);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ModuLab 서버 실행 중: http://localhost:${PORT}`));

module.exports = app;

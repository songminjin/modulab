-- ModuLab 데이터베이스 스키마

-- 회원 테이블
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  name VARCHAR(100) NOT NULL,
  nickname VARCHAR(100),
  phone VARCHAR(20),
  profile_image VARCHAR(500),
  provider VARCHAR(20) DEFAULT 'local',  -- local, google, kakao, naver
  provider_id VARCHAR(255),
  role VARCHAR(20) DEFAULT 'user',       -- user, admin
  points INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 상품 테이블
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  category VARCHAR(50) NOT NULL,  -- excel, sheets, short, detail, web, program
  emoji VARCHAR(10),
  file_url VARCHAR(500),          -- 다운로드 파일 링크
  thumbnail_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 장바구니 테이블
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- 주문 테이블
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  total_amount INTEGER NOT NULL,
  discount_amount INTEGER DEFAULT 0,
  final_amount INTEGER NOT NULL,
  status VARCHAR(30) DEFAULT 'pending',  -- pending, paid, cancelled, refunded
  payment_key VARCHAR(255),              -- 토스페이먼츠 결제키
  payment_method VARCHAR(50),
  coupon_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

-- 주문 상품 테이블
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  price INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 다운로드 이력
CREATE TABLE IF NOT EXISTS downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  product_id UUID NOT NULL REFERENCES products(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  download_count INTEGER DEFAULT 0,
  last_downloaded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- 리뷰 테이블
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  product_id UUID NOT NULL REFERENCES products(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- 쿠폰 테이블
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  discount_type VARCHAR(20) NOT NULL,   -- percent, fixed
  discount_value INTEGER NOT NULL,
  min_order_amount INTEGER DEFAULT 0,
  max_discount_amount INTEGER,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 회원 쿠폰 테이블
CREATE TABLE IF NOT EXISTS user_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  coupon_id UUID NOT NULL REFERENCES coupons(id),
  is_used BOOLEAN DEFAULT false,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, coupon_id)
);

-- 포인트 이력
CREATE TABLE IF NOT EXISTS point_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(30) NOT NULL,      -- earn_review, earn_event, use_order, admin
  amount INTEGER NOT NULL,
  description VARCHAR(255),
  order_id UUID,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

-- Migration: dormant account columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dormant BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dormant_at TIMESTAMP;

-- Migration: product extended fields
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_price INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_type VARCHAR(20) DEFAULT 'file';
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_images JSONB DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS new_badge BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS best_badge BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS file_type VARCHAR(50);

-- Coupon events table
CREATE TABLE IF NOT EXISTS coupon_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent', 'amount')),
  discount_value NUMERIC(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_event_products (
  coupon_event_id UUID REFERENCES coupon_events(id) ON DELETE CASCADE,
  product_id VARCHAR(255) NOT NULL,
  PRIMARY KEY (coupon_event_id, product_id)
);

-- Site events table
CREATE TABLE IF NOT EXISTS site_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  banner_img TEXT,
  desc_images JSONB DEFAULT '[]',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('discount', 'bundle', 'other')),
  discount_value NUMERIC(10,2) DEFAULT 0,
  bundle_count INTEGER DEFAULT 0,
  bundle_rate NUMERIC(10,2) DEFAULT 0,
  other_desc TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_event_products (
  site_event_id UUID REFERENCES site_events(id) ON DELETE CASCADE,
  product_id VARCHAR(255) NOT NULL,
  PRIMARY KEY (site_event_id, product_id)
);

-- Migration: coupon event conditions
ALTER TABLE coupon_events ADD COLUMN IF NOT EXISTS min_order_amount INTEGER DEFAULT 0;
ALTER TABLE coupon_events ADD COLUMN IF NOT EXISTS applicable_categories JSONB DEFAULT '[]';

-- Indexes for events
CREATE INDEX IF NOT EXISTS idx_coupon_events_dates ON coupon_events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_site_events_dates ON site_events(start_date, end_date);

-- Full schema for a brand-new D1 database.
-- The live database already has `posts`. Upgrade it with
-- `wrangler d1 migrations apply blog-db --remote` (migrations/0001_post_seo_fields.sql).
-- Do not run this file against the live database.

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    category TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    excerpt TEXT,
    cover_image_url TEXT,
    cover_alt TEXT,
    author TEXT DEFAULT 'Manivannan Gajendran',
    draft INTEGER NOT NULL DEFAULT 0,
    published_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_draft_published ON posts(draft, published_at DESC, created_at DESC);

CREATE TRIGGER IF NOT EXISTS update_posts_timestamp
AFTER UPDATE ON posts
BEGIN
    UPDATE posts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

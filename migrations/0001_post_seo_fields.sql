-- Additive upgrade for the live posts table.
-- Safe to apply on a database that already has the original columns.
-- Does not delete or rewrite existing post bodies.

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    category TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

ALTER TABLE posts ADD COLUMN excerpt TEXT;
ALTER TABLE posts ADD COLUMN cover_image_url TEXT;
ALTER TABLE posts ADD COLUMN cover_alt TEXT;
ALTER TABLE posts ADD COLUMN author TEXT DEFAULT 'Manivannan Gajendran';
ALTER TABLE posts ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN published_at DATETIME;

UPDATE posts
SET cover_image_url = image_url
WHERE (cover_image_url IS NULL OR cover_image_url = '')
  AND image_url IS NOT NULL
  AND image_url != '';

UPDATE posts
SET author = 'Manivannan Gajendran'
WHERE author IS NULL OR author = '';

UPDATE posts
SET published_at = created_at
WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_draft_published ON posts(draft, published_at DESC, created_at DESC);

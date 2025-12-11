-- Microblog Database Schema
-- Posts table for storing blog posts

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

-- Index on slug for fast lookups and upsert operations
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);

-- Index on category for filtering posts by category
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);

-- Index on created_at for sorting and pagination
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- Trigger to auto-update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_posts_timestamp 
AFTER UPDATE ON posts
BEGIN
    UPDATE posts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;


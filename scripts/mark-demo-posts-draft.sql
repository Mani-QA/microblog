-- Mark the five original demo posts as drafts.
-- Does not delete any rows. Safe to run more than once.
-- Apply migrations/0001_post_seo_fields.sql before this file.
--
--   npx wrangler d1 execute blog-db --remote --file=./scripts/mark-demo-posts-draft.sql

UPDATE posts
SET draft = 1
WHERE id IN (1, 2, 3, 4, 5)
  AND slug IN (
    'hello-world',
    'getting-started-cloudflare',
    'react-vite-setup',
    'understanding-d1',
    'csv-import-export'
  );

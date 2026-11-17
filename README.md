# ManiG Blog — blog.manig.dev

Personal blog for Manivannan Gajendran. Published posts are server-rendered HTML, so a browser with JavaScript turned off and a search crawler both see the title, description, and article. Drafts stay out of the site, the sitemap, the RSS feed, and the public API.

The admin UI at `/adminauthor` and CSV import still work. A content-writer bot can publish through `POST /api/posts` with `BLOG_API_TOKEN`. The contract is in [docs/API.md](docs/API.md). How the Worker is put together is in [ARCHITECTURE.md](ARCHITECTURE.md).

## What you can do

- Read the blog at [https://blog.manig.dev](https://blog.manig.dev). Each post lives at `/blog/<slug>`.
- Switch light and dark mode. The choice is remembered on that browser.
- Subscribe at `/rss.xml`. Crawlers can use `/sitemap.xml` and `/robots.txt`.
- Sign in at `/adminauthor` with the `ADMIN_PASSWORD` secret to create, edit, delete, import, and export posts.
- Post from a script with `Authorization: Bearer <BLOG_API_TOKEN>`. Covers are stored in R2 and served from `/media/...`.

## Deploy

This Worker is `microblog`. The D1 database is `blog-db` (`51d64d29-a518-457a-95b1-fff58c072bed`). Do not change either id. `BLOG_API_TOKEN` and the R2 bucket `microblog-media` are already on the Cloudflare account. This repo only declares the bindings.

From a machine that is logged in to Cloudflare (`npx wrangler login`), in this order:

```bash
npm install
npm install --prefix client

# Add excerpt, cover, author, draft, and published_at. Does not delete posts.
npx wrangler d1 migrations apply blog-db --remote

# Hide the five original demo posts (ids 1–5). Does not delete them.
npx wrangler d1 execute blog-db --remote --file=./scripts/mark-demo-posts-draft.sql

# Build the admin UI and deploy the Worker.
npm run deploy
```

`wrangler d1 migrations apply` asks for confirmation on an interactive terminal. The migration is `migrations/0001_post_seo_fields.sql`. Run it before `npm run deploy`. The new Worker selects the new columns, so deploying first will fail those queries until the migration has been applied.

Do not run `schema.sql` against the live database. That file is the full schema for an empty database. The live table already exists; the migration only adds columns.

Secrets (already set on the live Worker, never commit them):

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put BLOG_API_TOKEN
```

## Local development

```bash
npm install
npm install --prefix client
cp .dev.vars.example .dev.vars   # then put real local passwords in .dev.vars

npx wrangler d1 migrations apply blog-db --local
npm run build
npm run dev
```

The site is at `http://localhost:8787`. Public pages come from the Worker. The admin bundle is the Vite build in `client/dist`, so run `npm run build` again after admin UI changes. `npm run dev:client` is only the Vite dev server and proxies `/api` to port 8787.

Checks:

```bash
npm test
npm run typecheck
```

## Posting

```bash
curl -sS -X POST https://blog.manig.dev/api/posts \
  -H "Authorization: Bearer $BLOG_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "A note",
    "excerpt": "One sentence for the meta description.",
    "content_md": "The post body, in markdown.",
    "tags": ["notes"]
  }'
```

A successful create returns **201** and `{ "id", "slug", "url", "draft", "cover_image_url" }`. `url` is `https://blog.manig.dev/blog/<slug>`. If you omit `slug`, it is derived from the title. If that slug already exists, the response is **409**. The API does not add a numeric suffix.

Cover images can be `cover_image_base64`, `cover_image_url` (downloaded and copied into R2), or a multipart field `cover_image`. Details, limits, and update semantics are in [docs/API.md](docs/API.md).

Old links such as `/posts/<slug>` and `/post/<slug>` redirect to `/blog/<slug>`.

## CSV import

The admin import still accepts:

```csv
slug,title,content,tags,category,image_url
my-note,My note,Hello,notes,Notes,
```

`slug`, `title`, and `content` are required. New rows are published. Importing a slug that already exists updates the text and does not change its draft flag.

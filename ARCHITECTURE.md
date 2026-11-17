# Architecture

blog.manig.dev is one Cloudflare Worker, `microblog`. Hono routes API calls, server-rendered HTML, feeds, and media. The admin UI is a Vite/React bundle served with Workers Assets. Posts live in D1 (`blog-db`). Cover images live in R2 (`microblog-media`, binding `MEDIA`).

```
browser or crawler
        │
        ▼
Workers static asset router
  /assets/*, /og-default.png, /favicon.svg, /vite.svg
        │ served directly
        ▼
Worker (run_worker_first for everything else)
  ├─ GET /                         HTML list of published posts
  ├─ GET /blog/:slug               HTML article, or 404
  ├─ GET /posts/:slug, /post/:slug 301 → /blog/:slug
  ├─ GET /sitemap.xml /robots.txt /rss.xml
  ├─ GET /media/:key               R2 object
  ├─ /api/*                        JSON, cookie or bearer auth
  └─ GET /adminauthor              client/dist/index.html
        │
        ├── D1 binding DB
        └── R2 binding MEDIA
```

`not_found_handling` stays `single-page-application` so the admin app can load its shell. `run_worker_first` is required. Without it, `/` is the static `index.html` (a generic title) and navigation requests for unknown paths never reach the Worker, which is why `/sitemap.xml` used to return the SPA shell.

## Request paths

Public HTML is a string template in `src/render.ts`. It does not hydrate React. The document includes a unique title, description, canonical URL, Open Graph and Twitter tags, JSON-LD where relevant, and an RSS autodiscovery link. Post pages include the sanitized article HTML in the first response. Markdown is rendered with `marked`. Raw HTML in the markdown is dropped, and link and image URLs are limited to `http`, `https`, site-relative paths, and `mailto`.

A tiny inline script in the head sets `data-theme` from `localStorage` or `prefers-color-scheme` before the stylesheet is applied, so the theme does not flash. The toggle writes the same key. System fonts are used on public pages. Images declare width and height; list thumbnails and markdown images are lazy. The cover is eager because it is the largest element on the post page.

Drafts (`draft = 1`) are excluded from HTML lists, the sitemap, RSS, and unauthenticated API reads. `/blog/<draft-slug>` returns 404. A valid bearer token or admin session can still read and edit them.

Unknown public URLs return 404 HTML. Hashed files under `/assets/` and the default social image are static assets.

## Data

Live table, after `migrations/0001_post_seo_fields.sql`:

| Column | Notes |
| --- | --- |
| id, slug, title, content, tags, category, image_url, created_at, updated_at | Original columns. `content` is markdown. |
| excerpt | Optional meta description. Derived from `content` when null. |
| cover_image_url | Hosted `/media/...` path, or a legacy external URL copied from `image_url`. |
| cover_alt | Alt text for the cover and `og:image`. |
| author | Default `Manivannan Gajendran`. |
| draft | `0` published, `1` hidden. Default `0`. |
| published_at | Backfilled from `created_at` for existing rows. |

Index `idx_posts_draft_published` is on `(draft, published_at DESC, created_at DESC)`.

`schema.sql` is the same end state for a brand-new database, including the `updated_at` trigger. Do not execute it on the live database. The migration is additive `ALTER TABLE` plus backfill updates. `scripts/mark-demo-posts-draft.sql` sets `draft = 1` on demo ids 1–5 and does not delete rows.

`SITE_URL` is the wrangler var `https://blog.manig.dev`. Canonical URLs, the sitemap, RSS, and API `url` fields use it. `ADMIN_PASSWORD` and `BLOG_API_TOKEN` are Worker secrets.

## Auth

- Admin login compares the password with `crypto.subtle.timingSafeEqual` over SHA-256 digests, then sets an httpOnly `admin_session` cookie for 24 hours. The session map is per isolate, same as before.
- `POST`, `PUT`, `PATCH`, and `DELETE /api/posts`, `POST /api/media`, and CSV import call `requireWriter`. A present `Authorization` header must be `Bearer <BLOG_API_TOKEN>`. If the header is absent, the admin cookie is accepted. A wrong bearer token is 401 and does not fall through to the cookie.
- Writes use bound parameters. Cover fetches reject non-public hosts, credentials in the URL, and bodies that are not PNG, JPEG, WebP, or GIF under 5 MB.

## Media

Uploads are stored at `covers/<uuid>.<ext>` in R2 with a content type taken from the magic bytes. `GET /media/<key>` streams the object with `Cache-Control: public, max-age=31536000, immutable`. Replacing a cover deletes the previous `/media/` object.

## Code map

| Path | Role |
| --- | --- |
| `src/index.ts` | Routes |
| `src/posts.ts` | Validation and D1 queries |
| `src/render.ts` | HTML pages |
| `src/markdown.ts` | Markdown to sanitized HTML |
| `src/media.ts` | Image checks, R2, `/media` |
| `src/auth.ts` | Password, bearer token, session |
| `src/feeds.ts` | Sitemap, robots, RSS |
| `client/` | Admin SPA only |
| `migrations/` | D1 migrations for the existing database |
| `test/blog.spec.ts` | Worker tests via `@cloudflare/vitest-plugin` (Miniflare) |

`npm run build` writes `client/dist`. `npm run deploy` is that build plus `wrangler deploy`.

Observability logs and traces are enabled in `wrangler.toml`. Application errors are logged as JSON with `console.error` and are not returned to the client.

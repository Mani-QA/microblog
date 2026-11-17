# Machine posting API

Base URL: `https://blog.manig.dev`

The content-writer bot authenticates with the Worker secret `BLOG_API_TOKEN`:

```http
Authorization: Bearer <BLOG_API_TOKEN>
```

The comparison is constant-time. A missing or invalid token returns **401** `{ "error": "Unauthorized" }`. The admin UI does not send this header. It uses the `admin_session` cookie from `POST /api/admin/login` instead. If an `Authorization` header is present and wrong, the cookie is not used as a fallback.

Do not put the token in the browser, in git, or in `wrangler.toml`. Set it with `wrangler secret put BLOG_API_TOKEN`.

## Create a post

`POST /api/posts`

`Content-Type` is `application/json` or `multipart/form-data`.

### JSON fields

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | 1–200 characters |
| `content_md` | yes | Markdown body, stored in `content`. Also accepts legacy `content`. Max 500,000 characters. If both are sent, `content_md` wins. |
| `slug` | no | Derived from `title` when omitted. Pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 80 characters. |
| `excerpt` | recommended | Meta description. Max 300 characters. If omitted, the page derives one from the markdown. |
| `tags` | no | Array of strings or a comma-separated string. Max 20 tags, 40 characters each. |
| `category` | no | Max 80 characters. |
| `draft` | no | Boolean. Default `false` (published). `0`/`1` and `"true"`/`"false"` are also accepted. |
| `published_at` | no | ISO 8601. Defaults to now when the post is published and this is omitted. |
| `author` | no | Defaults to `Manivannan Gajendran`. Max 120 characters. |
| `cover_alt` | no | Max 300 characters. |
| `cover_image_base64` | no | Raw base64 or a `data:image/...;base64,...` URL. PNG, JPEG, WebP, or GIF. Magic bytes are checked. Max 5 MB decoded. |
| `cover_image_url` | no | Public `http` or `https` URL. The Worker fetches it and copies the bytes into R2. Private hosts, credentials, and non-image bodies are rejected. |
| `image_url` | no | Legacy admin field. Stored as given and used as the cover when no hosted cover is uploaded. It is not fetched. |

Send only one of `cover_image` (multipart file), `cover_image_base64`, or `cover_image_url`.

**Slug conflicts return 409.** The API does not append `-2` or any other suffix. Pick another slug.

```json
{ "error": "A post with this slug already exists", "slug": "my-post" }
```

### Success — 201

```json
{
  "id": 12,
  "slug": "my-post",
  "url": "https://blog.manig.dev/blog/my-post",
  "draft": false,
  "cover_image_url": "https://blog.manig.dev/media/covers/<uuid>.png",
  "title": "My post",
  "content": "# markdown source",
  "excerpt": "Meta description",
  "tags": "workers, d1",
  "category": "Notes",
  "image_url": "/media/covers/<uuid>.png",
  "cover_alt": "Cover description",
  "author": "Manivannan Gajendran",
  "published_at": "2026-11-17T00:00:00.000Z",
  "created_at": "2026-11-17 00:00:00",
  "updated_at": "2026-11-17 00:00:00"
}
```

`cover_image_url` is an absolute URL, or `null` when the post has no cover. Hosted covers are also written to `image_url` so the existing admin form can show them.

`draft: true` posts are omitted from the home page, `/sitemap.xml`, `/rss.xml`, and unauthenticated `GET /api/posts`. `GET /blog/<draft-slug>` is **404**.

### Example

```bash
curl -sS -X POST https://blog.manig.dev/api/posts \
  -H "Authorization: Bearer $BLOG_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Notes on D1",
    "excerpt": "How this blog stores posts.",
    "content_md": "The body is markdown.",
    "tags": ["d1", "workers"],
    "cover_image_base64": "<base64>"
  }'
```

### Multipart

Use a file field named `cover_image` (or `file` on `POST /api/media`). Other fields are form text. `tags` may be a comma-separated string or a JSON array string.

```bash
curl -sS -X POST https://blog.manig.dev/api/posts \
  -H "Authorization: Bearer $BLOG_API_TOKEN" \
  -F 'title=Notes on D1' \
  -F 'content_md=The body is markdown.' \
  -F 'cover_image=@cover.png;type=image/png'
```

### Errors

| Status | When |
| --- | --- |
| 400 | Missing or invalid field. Body is `{ "error": "...", "field": "title" }` when a field is known. |
| 401 | Missing or invalid bearer token, and no admin session. |
| 409 | Slug already exists. No automatic suffix. |
| 413 | Cover or body is over the size limit (images 5 MB, JSON body 8 MB). |
| 415 | Content-Type is not JSON or multipart. |
| 500 | Unexpected failure. The response does not include a stack trace. |

## Update a post

`PATCH /api/posts/:slug` and `PUT /api/posts/:slug` accept the same fields as create. Send only the fields to change. The same auth rules apply.

- Setting `draft` to `false` fills `published_at` with the current time when it is still empty.
- A new cover replaces the previous R2 object when that object lived under `/media/`.
- Changing `slug` returns **409** if the new slug is taken. The URL in the response uses the new slug.
- **404** if the slug does not exist.

Success is **200** with the same JSON shape as create.

```bash
curl -sS -X PATCH https://blog.manig.dev/api/posts/notes-on-d1 \
  -H "Authorization: Bearer $BLOG_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "draft": false, "excerpt": "Updated description" }'
```

## Upload media only

`POST /api/media` with the same auth.

- Multipart file field `file` or `cover_image`, or
- JSON `{ "cover_image_base64": "..." }`

**201**

```json
{
  "key": "covers/<uuid>.png",
  "url": "https://blog.manig.dev/media/covers/<uuid>.png",
  "content_type": "image/png"
}
```

`GET /media/<key>` serves the object with `Content-Type` set from the image bytes and `Cache-Control: public, max-age=31536000, immutable`.

## Read posts

`GET /api/posts` and `GET /api/posts/:slug` stay available.

- Anonymous requests never include drafts. A draft slug is **404**.
- A valid bearer token or admin session includes drafts.
- List query: `page` (default 1), `limit` (default 10, max 100), `category`, `tag`.

`POST /api/posts/import` and `GET /api/posts/export` still work for the admin cookie (and for the bearer token). Import still requires `slug`, `title`, and `content` columns. New rows are published. Re-importing an existing slug updates the text fields and does not flip a draft back to published unless you change it with PATCH. Public export omits drafts.

## Public pages

| URL | Behavior |
| --- | --- |
| `/` | Server-rendered list of published posts |
| `/blog/<slug>` | Server-rendered post. Unknown or draft slugs are **404**. |
| `/posts/<slug>` and `/post/<slug>` | **301** to `/blog/<slug>` |
| `/sitemap.xml` | Home plus every published post, with `lastmod` |
| `/robots.txt` | Allow `/`, disallow `/admin` and `/api`, `Sitemap` line |
| `/rss.xml` | RSS 2.0 for published posts, absolute links |
| `/category/<name>` and `/tags/<name>` | Server-rendered filtered lists |
| `/trending` | Posts tagged `trending` (author-picked popular posts). `/tags/trending` redirects here. |
| `/adminauthor` | Existing admin SPA |

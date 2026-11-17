import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

const BASE = 'https://blog.manig.dev';
const TOKEN = 'test-blog-token';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const LEGACY_STATEMENTS = [
  `CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    category TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  'CREATE INDEX idx_posts_slug ON posts(slug)',
  'CREATE INDEX idx_posts_category ON posts(category)',
  'CREATE INDEX idx_posts_created_at ON posts(created_at DESC)',
];

function workerEnv(): Env & { TEST_MIGRATIONS: D1Migration[] } {
  return env as Env & { TEST_MIGRATIONS: D1Migration[] };
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return exports.default.fetch(new Request(`${BASE}${path}`, { ...init, headers, redirect: 'manual' }));
}

beforeAll(async () => {
  for (const statement of LEGACY_STATEMENTS) {
    await env.DB.prepare(statement).run();
  }
  await env.DB.prepare(`
    INSERT INTO posts (slug, title, content, tags, category, image_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    'legacy-post',
    'Legacy Post',
    'Hello legacy body',
    'notes',
    'Notes',
    'https://example.com/a.jpg',
    '2024-01-02 03:04:05',
    '2024-01-02 03:04:05',
  ).run();
  await applyD1Migrations(env.DB, workerEnv().TEST_MIGRATIONS);
});

describe('schema migration', () => {
  it('keeps the legacy row and backfills cover, author, and published_at', async () => {
    const row = await env.DB.prepare('SELECT * FROM posts WHERE slug = ?').bind('legacy-post').first<{
      content: string;
      cover_image_url: string;
      author: string;
      draft: number;
      published_at: string;
    }>();
    expect(row?.content).toBe('Hello legacy body');
    expect(row?.cover_image_url).toBe('https://example.com/a.jpg');
    expect(row?.author).toBe('Manivannan Gajendran');
    expect(Number(row?.draft)).toBe(0);
    expect(row?.published_at).toContain('2024-01-02');
  });
});

describe('public HTML', () => {
  it('server-renders post meta tags and the body', async () => {
    const created = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: 'Hello SEO',
        slug: 'hello-seo',
        excerpt: 'A short excerpt for search.',
        content_md: 'Crawlers can read this sentence.\n\n<script>alert(1)</script>\n\n[click](javascript:alert(1))',
        tags: ['workers', 'seo'],
        author: 'Manivannan Gajendran',
      }),
    });
    expect(created.status).toBe(201);

    const response = await api('/blog/hello-seo');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<title>Hello SEO · ManiG Blog</title>');
    expect(html).toContain('name="description" content="A short excerpt for search."');
    expect(html).toContain('rel="canonical" href="https://blog.manig.dev/blog/hello-seo"');
    expect(html).toContain('property="og:title" content="Hello SEO · ManiG Blog"');
    expect(html).toContain('property="og:description" content="A short excerpt for search."');
    expect(html).toContain('property="og:image" content="https://blog.manig.dev/og-default.png"');
    expect(html).toContain('property="og:url" content="https://blog.manig.dev/blog/hello-seo"');
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="article:published_time"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:title" content="Hello SEO · ManiG Blog"');
    expect(html).toContain('name="twitter:description" content="A short excerpt for search."');
    expect(html).toContain('name="twitter:image" content="https://blog.manig.dev/og-default.png"');
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain('"headline":"Hello SEO"');
    expect(html).toContain('"description":"A short excerpt for search."');
    expect(html).toContain('"image":"https://blog.manig.dev/og-default.png"');
    expect(html).toContain('"datePublished"');
    expect(html).toContain('"dateModified"');
    expect(html).toContain('"@type":"Person"');
    expect(html).toContain('"name":"Manivannan Gajendran"');
    expect(html).toContain('"mainEntityOfPage"');
    expect(html).toContain('"publisher"');
    expect(html).toContain('Crawlers can read this sentence.');
    expect(html).toContain('rel="alternate" type="application/rss+xml"');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Microblog');
  });

  it('renders the home page on the server and hides drafts', async () => {
    await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: 'Secret Draft Title',
        slug: 'secret-draft',
        content_md: 'This draft must stay private.',
        draft: true,
      }),
    });

    const home = await api('/');
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('<title>ManiG Blog</title>');
    expect(html).toContain('href="/blog/hello-seo"');
    expect(html).toContain('Hello SEO');
    expect(html).toContain('href="/blog/legacy-post"');
    expect(html).not.toContain('Secret Draft Title');
    expect(html).not.toContain('Microblog');

    const draftPage = await api('/blog/secret-draft');
    expect(draftPage.status).toBe(404);
    expect(await draftPage.text()).toContain('Not found');

    const missing = await api('/blog/does-not-exist');
    expect(missing.status).toBe(404);

    const list = await api('/api/posts') as Response;
    expect(list.status).toBe(200);
    const body = await list.json() as { posts: { slug: string }[] };
    const slugs = body.posts.map((post) => post.slug);
    expect(slugs).toContain('hello-seo');
    expect(slugs).not.toContain('secret-draft');

    const hidden = await api('/api/posts/secret-draft');
    expect(hidden.status).toBe(404);

    const visibleToBot = await api('/api/posts/secret-draft', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(visibleToBot.status).toBe(200);
  });

  it('redirects the old post routes', async () => {
    const plural = await api('/posts/hello-seo');
    expect(plural.status).toBe(301);
    expect(plural.headers.get('location')).toBe(`${BASE}/blog/hello-seo`);

    const singular = await api('/post/hello-seo');
    expect(singular.status).toBe(301);
    expect(singular.headers.get('location')).toBe(`${BASE}/blog/hello-seo`);
  });
});

describe('feeds', () => {
  it('serves sitemap, robots, and rss', async () => {
    const sitemap = await api('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain('<loc>https://blog.manig.dev/</loc>');
    expect(sitemapBody).toContain('<loc>https://blog.manig.dev/blog/hello-seo</loc>');
    expect(sitemapBody).toContain('<lastmod>');
    expect(sitemapBody).not.toContain('secret-draft');

    const robots = await api('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.headers.get('content-type')).toContain('text/plain');
    const robotsBody = await robots.text();
    expect(robotsBody).toContain('Allow: /');
    expect(robotsBody).toContain('Disallow: /admin');
    expect(robotsBody).toContain('Disallow: /api');
    expect(robotsBody).toContain('Sitemap: https://blog.manig.dev/sitemap.xml');

    const rss = await api('/rss.xml');
    expect(rss.status).toBe(200);
    expect(rss.headers.get('content-type')).toContain('application/rss+xml');
    const rssBody = await rss.text();
    expect(rssBody).toContain('<rss version="2.0">');
    expect(rssBody).toContain('<link>https://blog.manig.dev/blog/hello-seo</link>');
    expect(rssBody).not.toContain('secret-draft');
  });
});

describe('machine API', () => {
  it('rejects missing and invalid tokens, then creates a post', async () => {
    const missing = await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Nope', content_md: 'No token' }),
    });
    expect(missing.status).toBe(401);

    const invalid = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ title: 'Nope', content_md: 'Bad token' }),
    });
    expect(invalid.status).toBe(401);

    const created = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: 'Token Created',
        content_md: 'Created by the bot.',
        content: 'ignored because content_md wins',
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as {
      id: number;
      slug: string;
      url: string;
      draft: boolean;
      cover_image_url: string | null;
      content: string;
    };
    expect(body.id).toBeGreaterThan(0);
    expect(body.slug).toBe('token-created');
    expect(body.url).toBe(`${BASE}/blog/token-created`);
    expect(body.draft).toBe(false);
    expect(body.cover_image_url).toBeNull();
    expect(body.content).toBe('Created by the bot.');

    const conflict = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ title: 'Token Created', slug: 'token-created', content_md: 'Again' }),
    });
    expect(conflict.status).toBe(409);
  });

  it('stores a base64 cover in R2 and serves it from /media', async () => {
    const created = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: 'With Cover',
        slug: 'with-cover',
        content_md: 'A post with a cover image.',
        cover_alt: 'A tiny red square',
        cover_image_base64: PNG_BASE64,
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { cover_image_url: string; url: string };
    expect(body.cover_image_url).toMatch(/^https:\/\/blog\.manig\.dev\/media\/covers\/[0-9a-f-]+\.png$/);
    expect(body.url).toBe(`${BASE}/blog/with-cover`);

    const mediaPath = new URL(body.cover_image_url).pathname;
    const media = await api(mediaPath);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toContain('image/png');
    expect(media.headers.get('cache-control')).toContain('public, max-age=31536000, immutable');
    const bytes = new Uint8Array(await media.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const page = await api('/blog/with-cover');
    const html = await page.text();
    expect(html).toContain(`property="og:image" content="${body.cover_image_url}"`);
    expect(html).toContain(`src="${new URL(body.cover_image_url).pathname}"`);
    expect(html).toContain('alt="A tiny red square"');
    expect(html).toContain('A post with a cover image.');
  });

  it('accepts a data URL and multipart upload, and blocks private cover URLs', async () => {
    const dataUrl = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: 'Data URL Cover',
        content_md: 'Stored from a data URL.',
        cover_image_base64: `data:image/png;base64,${PNG_BASE64}`,
      }),
    });
    expect(dataUrl.status).toBe(201);

    const bytes = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.set('title', 'Multipart Cover');
    form.set('content_md', 'Stored from multipart.');
    form.set('cover_image', new File([bytes], 'dot.png', { type: 'image/png' }));
    const multipart = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    });
    expect(multipart.status).toBe(201);
    const uploaded = await multipart.json() as { slug: string; cover_image_url: string };
    expect(uploaded.slug).toBe('multipart-cover');
    const media = await api(new URL(uploaded.cover_image_url).pathname);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toContain('image/png');

    const blocked = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: 'Blocked Cover',
        content_md: 'Should not fetch loopback.',
        cover_image_url: 'http://127.0.0.1/secret.png',
      }),
    });
    expect(blocked.status).toBe(400);
    const error = await blocked.json() as { error: string };
    expect(error.error).toMatch(/public URL/i);
  });

  it('updates a post with PATCH and still accepts the admin session', async () => {
    const patched = await api('/api/posts/token-created', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ draft: true, excerpt: 'Now a draft.' }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json() as { draft: boolean; url: string };
    expect(patchedBody.draft).toBe(true);
    expect(patchedBody.url).toBe(`${BASE}/blog/token-created`);
    expect((await api('/blog/token-created')).status).toBe(404);

    const login = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test-admin-password' }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    expect(cookie.startsWith('admin_session=')).toBe(true);

    const created = await api('/api/posts', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({
        slug: 'admin-created',
        title: 'Admin Created',
        content: 'Saved from the admin form.',
        tags: 'admin',
        category: 'Notes',
      }),
    });
    expect(created.status).toBe(201);
    const adminPost = await created.json() as { slug: string; content: string };
    expect(adminPost.slug).toBe('admin-created');
    expect(adminPost.content).toBe('Saved from the admin form.');
  });

  it('imports a CSV for an authenticated admin', async () => {
    const login = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test-admin-password' }),
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const csv = 'slug,title,content,tags,category,image_url\nimported-note,Imported Note,Imported body text,notes,Notes,\n';
    const form = new FormData();
    form.set('file', new File([csv], 'posts.csv', { type: 'text/csv' }));
    const imported = await api('/api/posts/import', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    expect(imported.status).toBe(200);
    const result = await imported.json() as { success: boolean; stats: { processed: number } };
    expect(result.success).toBe(true);
    expect(result.stats.processed).toBe(1);

    const page = await api('/blog/imported-note');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Imported body text');
  });
});

describe('tags', () => {
  it('links tags on list rows, filters by any tag, and lists tags', async () => {
    const created = await api('/api/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ title: 'Tagged Post', slug: 'tagged-post', content_md: 'Tagged body.', tags: ['agents', 'mcp tools'] }),
    });
    expect(created.status).toBe(201);
    const home = await (await api('/')).text();
    expect(home).toContain('Of the Agents,<br>By the Agents,<br>For the Agents');
    expect(home).toContain('href="/tags/mcp%20tools">#mcp tools</a>');
    const second = await (await api('/tags/mcp%20tools')).text();
    expect(second).toContain('Tagged Post');
    const index = await api('/tags');
    expect(index.status).toBe(200);
    const indexHtml = await index.text();
    expect(indexHtml).toContain('href="/tags/agents">#agents</a>');
    const sitemap = await (await api('/sitemap.xml')).text();
    expect(sitemap).toContain('/tags/agents</loc>');
  });
});

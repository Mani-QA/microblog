import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';
import Papa from 'papaparse';
import { login, logout, readAccess, requireWriter, verify } from './auth';
import { robotsTxt, rssXml, sitemapXml } from './feeds';
import { HttpError, jsonError, siteUrl } from './http';
import { serveMedia, storeFile, storeImage, decodeBase64Image } from './media';
import {
  createPost,
  deletePost,
  getPostBySlug,
  isDraft,
  listPosts,
  listPublicForFeed,
  serializePost,
  updatePost,
} from './posts';
import { renderFilter, renderHome, renderNotFound, renderPost } from './render';

interface CsvPost {
  slug?: string;
  title?: string;
  content?: string;
  tags?: string;
  category?: string;
  image_url?: string;
}

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    const url = new URL(c.req.url);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
      return c.redirect(url.toString(), 301);
    }
  }
  await next();
});

app.use('/api/*', cors());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Robots-Tag', 'noindex');
  c.header('Cache-Control', 'no-store');
});

app.onError((err, c) => {
  console.error(JSON.stringify({
    message: 'request failed',
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
  }));
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/media/')) {
    return c.json({ error: 'Internal server error' }, 500);
  }
  return c.text('Something went wrong.', 500);
});

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function readBody(c: AppContext): Promise<{ fields: Record<string, unknown>; file: File | null }> {
  const length = Number(c.req.header('content-length') || 0);
  if (length > 8 * 1024 * 1024) throw new HttpError('Request body is too large', 413);
  const type = c.req.header('content-type') || '';
  if (type.includes('multipart/form-data')) {
    const form = await c.req.parseBody();
    const fields: Record<string, unknown> = {};
    let file: File | null = null;
    for (const [key, value] of Object.entries(form)) {
      if (value instanceof File) {
        if (key === 'cover_image' || key === 'file') file = value;
      } else {
        fields[key] = value;
      }
    }
    return { fields, file };
  }
  if (type.includes('application/json') || type === '') {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new HttpError('Request body must be a JSON object or multipart form', 400);
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new HttpError('Request body must be a JSON object', 400);
    }
    return { fields: json as Record<string, unknown>, file: null };
  }
  throw new HttpError('Content-Type must be application/json or multipart/form-data', 415);
}

app.post('/api/admin/login', (c) => login(c));
app.post('/api/admin/logout', (c) => logout(c));
app.get('/api/admin/verify', (c) => verify(c));

app.post('/api/posts/import', async (c) => {
  const denied = await requireWriter(c);
  if (denied) return denied;
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'No CSV file provided' }, 400);

    const parsed = Papa.parse<CsvPost>(await file.text(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
    });
    if (parsed.errors.length > 0) {
      return c.json({ error: 'CSV parsing errors', details: parsed.errors }, 400);
    }
    if (parsed.data.length === 0) return c.json({ error: 'No valid posts found in CSV' }, 400);

    let processed = 0;
    const chunkSize = 50;
    for (let i = 0; i < parsed.data.length; i += chunkSize) {
      const statements: D1PreparedStatement[] = [];
      for (const post of parsed.data.slice(i, i + chunkSize)) {
        if (!post.slug?.trim() || !post.title?.trim() || !post.content) continue;
        const image = post.image_url?.trim() || null;
        statements.push(c.env.DB.prepare(`
          INSERT INTO posts (
            slug, title, content, tags, category, image_url, cover_image_url,
            author, draft, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Manivannan Gajendran', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            tags = excluded.tags,
            category = excluded.category,
            image_url = excluded.image_url,
            cover_image_url = CASE
              WHEN excluded.image_url IS NOT NULL AND excluded.image_url != '' THEN excluded.image_url
              ELSE posts.cover_image_url
            END,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          post.slug.trim(),
          post.title.trim(),
          post.content,
          post.tags || null,
          post.category || null,
          image,
          image,
        ));
      }
      if (statements.length) {
        await c.env.DB.batch(statements);
        processed += statements.length;
      }
    }

    return c.json({
      success: true,
      message: 'Import completed',
      stats: { total: parsed.data.length, processed },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'import failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Import failed' }, 500);
  }
});

app.get('/api/posts/export', async (c) => {
  const access = await readAccess(c);
  if (access instanceof Response) return access;
  try {
    const where = access === 'privileged' ? '' : ' WHERE draft = 0';
    const result = await c.env.DB.prepare(`
      SELECT slug, title, content, tags, category, image_url, created_at, updated_at
      FROM posts${where}
      ORDER BY datetime(COALESCE(published_at, created_at)) DESC
    `).raw({ columnNames: true });

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="posts-export.csv"');
    if (!result || result.length === 0) {
      return c.body('slug,title,content,tags,category,image_url,created_at,updated_at\n');
    }
    const columns = result[0] as string[];
    const rows = result.slice(1);
    return streamText(c, async (stream) => {
      await stream.writeln(columns.join(','));
      for (const row of rows) {
        const csvRow = (row as (string | number | null)[]).map((value) => {
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          if (/[",\n]/.test(stringValue)) return `"${stringValue.replace(/"/g, '""')}"`;
          return stringValue;
        }).join(',');
        await stream.writeln(csvRow);
      }
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'export failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Export failed' }, 500);
  }
});

app.get('/api/posts', async (c) => {
  const access = await readAccess(c);
  if (access instanceof Response) return access;
  try {
    const page = positiveInt(c.req.query('page'), 1, 100000);
    const limit = positiveInt(c.req.query('limit'), 10, 100);
    const category = c.req.query('category') || undefined;
    const tag = c.req.query('tag') || undefined;
    const { posts, total } = await listPosts(c.env, {
      page,
      limit,
      category,
      tag,
      includeDrafts: access === 'privileged',
    });
    const totalPages = Math.ceil(total / limit);
    const base = siteUrl(c.env);
    return c.json({
      posts: posts.map((post) => serializePost(post, base)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
});

app.get('/api/categories', async (c) => {
  const access = await readAccess(c);
  if (access instanceof Response) return access;
  const where = access === 'privileged' ? '' : ' AND draft = 0';
  const result = await c.env.DB.prepare(`
    SELECT category, COUNT(*) AS count
    FROM posts
    WHERE category IS NOT NULL AND category != ''${where}
    GROUP BY category
    ORDER BY count DESC
  `).all<{ category: string; count: number }>();
  return c.json({ categories: result.results });
});

app.get('/api/tags', async (c) => {
  const access = await readAccess(c);
  if (access instanceof Response) return access;
  const where = access === 'privileged' ? '' : ' AND draft = 0';
  const posts = await c.env.DB.prepare(`
    SELECT tags FROM posts WHERE tags IS NOT NULL AND tags != ''${where}
  `).all<{ tags: string }>();
  const counts = new Map<string, number>();
  for (const post of posts.results) {
    for (const tag of post.tags.split(',').map((item) => item.trim()).filter(Boolean)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  return c.json({ tags });
});

app.get('/api/posts/:slug', async (c) => {
  const access = await readAccess(c);
  if (access instanceof Response) return access;
  const post = await getPostBySlug(c.env, c.req.param('slug'));
  if (!post || (isDraft(post) && access !== 'privileged')) {
    return c.json({ error: 'Post not found' }, 404);
  }
  return c.json(serializePost(post, siteUrl(c.env)));
});

app.post('/api/posts', async (c) => {
  const denied = await requireWriter(c);
  if (denied) return denied;
  try {
    const { fields, file } = await readBody(c);
    const post = await createPost(c.env, fields, file);
    return c.json(serializePost(post, siteUrl(c.env)), 201);
  } catch (error) {
    return jsonError(error);
  }
});

async function updateHandler(c: AppContext): Promise<Response> {
  const denied = await requireWriter(c);
  if (denied) return denied;
  try {
    const slug = c.req.param('slug');
    if (!slug) return c.json({ error: 'Not found' }, 404);
    const { fields, file } = await readBody(c);
    const post = await updatePost(c.env, slug, fields, file);
    return c.json(serializePost(post, siteUrl(c.env)));
  } catch (error) {
    return jsonError(error);
  }
}

app.put('/api/posts/:slug', (c) => updateHandler(c));
app.patch('/api/posts/:slug', (c) => updateHandler(c));

app.delete('/api/posts/:slug', async (c) => {
  const denied = await requireWriter(c);
  if (denied) return denied;
  try {
    await deletePost(c.env, c.req.param('slug'));
    return c.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    return jsonError(error);
  }
});

app.post('/api/media', async (c) => {
  const denied = await requireWriter(c);
  if (denied) return denied;
  try {
    const { fields, file } = await readBody(c);
    const stored = file && file.size > 0
      ? await storeFile(c.env, file)
      : typeof fields.cover_image_base64 === 'string'
        ? await storeImage(c.env, decodeBase64Image(fields.cover_image_base64))
        : null;
    if (!stored) throw new HttpError('Send a cover_image file or cover_image_base64', 400);
    const base = siteUrl(c.env);
    return c.json({
      key: stored.key,
      url: `${base}${stored.path}`,
      content_type: stored.contentType,
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
});

app.get('/api/health', (c) => c.json({ status: 'healthy', timestamp: new Date().toISOString() }));

app.get('/sitemap.xml', async (c) => {
  const posts = await listPublicForFeed(c.env);
  return c.body(sitemapXml(c.env, posts), 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
});

app.get('/robots.txt', (c) => c.body(robotsTxt(c.env), 200, {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
}));

app.get('/rss.xml', async (c) => {
  const posts = await listPublicForFeed(c.env, 50);
  return c.body(rssXml(c.env, posts), 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
});

app.get('/media/*', (c) => serveMedia(c.env, decodeURIComponent(c.req.path.slice('/media/'.length))));

function redirectToBlog(url: string, slug: string): Response {
  return Response.redirect(new URL(`/blog/${encodeURIComponent(slug)}`, url).toString(), 301);
}

app.get('/posts/:slug', (c) => redirectToBlog(c.req.url, c.req.param('slug')));
app.get('/post/:slug', (c) => redirectToBlog(c.req.url, c.req.param('slug')));

app.get('/', async (c) => {
  const page = positiveInt(c.req.query('page'), 1, 100000);
  const limit = 20;
  const { posts, total } = await listPosts(c.env, { page, limit, includeDrafts: false });
  return renderHome(c.env, posts, page, Math.max(1, Math.ceil(total / limit)));
});

app.get('/blog/:slug', async (c) => {
  const post = await getPostBySlug(c.env, c.req.param('slug'));
  if (!post || isDraft(post)) return renderNotFound(c.env);
  return renderPost(c.env, post);
});

app.get('/category/:name', async (c) => {
  const name = c.req.param('name');
  const page = positiveInt(c.req.query('page'), 1, 100000);
  const limit = 20;
  const { posts, total } = await listPosts(c.env, { page, limit, category: name, includeDrafts: false });
  return renderFilter(c.env, 'Category', name, posts, page, Math.max(1, Math.ceil(total / limit)));
});

app.get('/tags/:name', async (c) => {
  const name = c.req.param('name');
  const page = positiveInt(c.req.query('page'), 1, 100000);
  const limit = 20;
  const { posts, total } = await listPosts(c.env, { page, limit, tag: name, includeDrafts: false });
  return renderFilter(c.env, 'Tag', name, posts, page, Math.max(1, Math.ceil(total / limit)));
});

async function adminShell(c: { req: { url: string }; env: Env }): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
}

app.get('/adminauthor', (c) => adminShell(c));
app.get('/adminauthor/*', (c) => adminShell(c));

app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json({ error: 'Not found' }, 404);
  }
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = asset.headers.get('content-type') || '';
  const path = c.req.path;
  const wantsAsset = path.includes('.') || path.startsWith('/assets/');
  if (wantsAsset && contentType.includes('text/html')) return renderNotFound(c.env);
  if (!wantsAsset) return renderNotFound(c.env);
  return asset;
});

export default app;

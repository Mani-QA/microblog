import {
  DEFAULT_AUTHOR,
  HttpError,
  MAX_CONTENT,
  MAX_EXCERPT,
  deriveExcerpt,
  isUniqueViolation,
  isValidSlug,
  slugify,
} from './http';
import { decodeBase64Image, deleteStoredImage, fetchRemoteImage, storeFile, storeImage } from './media';

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  content: string;
  tags: string | null;
  category: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  excerpt: string | null;
  cover_image_url: string | null;
  cover_alt: string | null;
  author: string | null;
  draft: number;
  published_at: string | null;
}

export interface PostWriteResult {
  post: PostRow;
}

export function isDraft(post: Pick<PostRow, 'draft'>): boolean {
  return Number(post.draft) === 1;
}

export function publicExcerpt(post: Pick<PostRow, 'excerpt' | 'content'>): string {
  const stored = post.excerpt?.trim();
  if (stored) return stored.slice(0, MAX_EXCERPT);
  return deriveExcerpt(post.content || '', MAX_EXCERPT);
}

export function coverSource(post: Pick<PostRow, 'cover_image_url' | 'image_url'>): string | null {
  return post.cover_image_url?.trim() || post.image_url?.trim() || null;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(`${field} is required`, 400, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new HttpError(`${field} must be ${max} characters or fewer`, 400, { field });
  }
  return trimmed;
}

function optionalString(value: unknown, field: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new HttpError(`${field} must be a string`, 400, { field });
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new HttpError(`${field} must be ${max} characters or fewer`, 400, { field });
  }
  return trimmed;
}

function parseTags(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  let parts: string[];
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string')) {
      throw new HttpError('tags must be an array of strings or a comma-separated string', 400, { field: 'tags' });
    }
    parts = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          parts = parsed;
        } else {
          parts = trimmed.split(',');
        }
      } catch {
        parts = trimmed.split(',');
      }
    } else {
      parts = trimmed.split(',');
    }
  } else {
    throw new HttpError('tags must be an array of strings or a comma-separated string', 400, { field: 'tags' });
  }
  const tags = [...new Set(parts.map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 20) throw new HttpError('A post can have at most 20 tags', 400, { field: 'tags' });
  if (tags.some((tag) => tag.length > 40)) {
    throw new HttpError('Each tag must be 40 characters or fewer', 400, { field: 'tags' });
  }
  return tags.length ? tags.join(', ') : null;
}

function parseDraft(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new HttpError('draft must be a boolean', 400, { field: 'draft' });
}

function parsePublishedAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new HttpError('published_at must be an ISO 8601 date string', 400, { field: 'published_at' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError('published_at is not a valid date', 400, { field: 'published_at' });
  }
  return date.toISOString();
}

function parseSlug(value: unknown, title: string | undefined, required: boolean): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    const derived = title ? slugify(title) : '';
    if (!isValidSlug(derived)) {
      throw new HttpError('Could not derive a slug from the title. Pass slug explicitly.', 400, { field: 'slug' });
    }
    return derived;
  }
  if (typeof value !== 'string') throw new HttpError('slug must be a string', 400, { field: 'slug' });
  const slug = value.trim().toLowerCase();
  if (!isValidSlug(slug)) {
    throw new HttpError('slug must match ^[a-z0-9]+(?:-[a-z0-9]+)*$ and be at most 80 characters', 400, { field: 'slug' });
  }
  return slug;
}

interface CoverRequest {
  base64?: string;
  remoteUrl?: string;
  file?: File | null;
  imageUrl?: string | null;
  imageUrlSet: boolean;
}

function coverRequestFrom(fields: Record<string, unknown>, file: File | null): CoverRequest {
  if (fields.cover_image_base64 !== undefined && typeof fields.cover_image_base64 !== 'string') {
    throw new HttpError('cover_image_base64 must be a string', 400, { field: 'cover_image_base64' });
  }
  if (fields.cover_image_url !== undefined && fields.cover_image_url !== null && typeof fields.cover_image_url !== 'string') {
    throw new HttpError('cover_image_url must be a string', 400, { field: 'cover_image_url' });
  }
  return {
    base64: typeof fields.cover_image_base64 === 'string' ? fields.cover_image_base64 : undefined,
    remoteUrl: typeof fields.cover_image_url === 'string' ? fields.cover_image_url.trim() : undefined,
    file,
    imageUrl: fields.image_url === undefined ? undefined : (optionalString(fields.image_url, 'image_url', 2000) ?? null),
    imageUrlSet: fields.image_url !== undefined,
  };
}

async function resolveCover(env: Env, cover: CoverRequest, previous: string | null): Promise<string | null | undefined> {
  const sources = [cover.file && cover.file.size > 0 ? 'file' : '', cover.base64 ? 'base64' : '', cover.remoteUrl ? 'url' : ''].filter(Boolean);
  if (sources.length > 1) {
    throw new HttpError('Send only one of cover_image, cover_image_base64, or cover_image_url', 400);
  }
  if (cover.file && cover.file.size > 0) {
    const stored = await storeFile(env, cover.file);
    if (previous && previous !== stored.path) await deleteStoredImage(env, previous);
    return stored.path;
  }
  if (cover.base64) {
    const stored = await storeImage(env, decodeBase64Image(cover.base64));
    if (previous && previous !== stored.path) await deleteStoredImage(env, previous);
    return stored.path;
  }
  if (cover.remoteUrl) {
    const stored = await storeImage(env, await fetchRemoteImage(cover.remoteUrl));
    if (previous && previous !== stored.path) await deleteStoredImage(env, previous);
    return stored.path;
  }
  if (cover.imageUrlSet) {
    const next = cover.imageUrl ?? null;
    if (previous && previous !== next) await deleteStoredImage(env, previous);
    return next;
  }
  return undefined;
}

function contentFrom(fields: Record<string, unknown>, required: boolean): string | undefined {
  const raw = fields.content_md !== undefined ? fields.content_md : fields.content;
  if (raw === undefined) {
    if (required) throw new HttpError('content_md is required', 400, { field: 'content_md' });
    return undefined;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new HttpError('content_md is required', 400, { field: 'content_md' });
  }
  if (raw.length > MAX_CONTENT) {
    throw new HttpError(`content_md must be ${MAX_CONTENT} characters or fewer`, 400, { field: 'content_md' });
  }
  return raw;
}

export async function getPostBySlug(env: Env, slug: string): Promise<PostRow | null> {
  return env.DB.prepare('SELECT * FROM posts WHERE slug = ?').bind(slug).first<PostRow>();
}

export interface ListQuery {
  page: number;
  limit: number;
  category?: string;
  tag?: string;
  includeDrafts: boolean;
}

export async function listPosts(env: Env, query: ListQuery): Promise<{ posts: PostRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (!query.includeDrafts) conditions.push('draft = 0');
  if (query.category) {
    conditions.push('category = ?');
    params.push(query.category);
  }
  if (query.tag) {
    conditions.push("(',' || REPLACE(REPLACE(COALESCE(tags, ''), ', ', ','), ' ,', ',') || ',') LIKE ('%,' || ? || ',%')");
    params.push(query.tag);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM posts${where}`)
    .bind(...params)
    .first<{ total: number }>();
  const offset = (query.page - 1) * query.limit;
  const posts = await env.DB.prepare(
    `SELECT * FROM posts${where} ORDER BY datetime(COALESCE(published_at, created_at)) DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, query.limit, offset)
    .all<PostRow>();
  return { posts: posts.results, total: count?.total || 0 };
}

export async function listPublicForFeed(env: Env, limit?: number): Promise<PostRow[]> {
  const sql = `SELECT * FROM posts WHERE draft = 0 ORDER BY datetime(COALESCE(published_at, created_at)) DESC${limit ? ' LIMIT ?' : ''}`;
  const statement = env.DB.prepare(sql);
  const result = limit ? await statement.bind(limit).all<PostRow>() : await statement.all<PostRow>();
  return result.results;
}

async function insertPost(env: Env, row: {
  slug: string;
  title: string;
  content: string;
  tags: string | null;
  category: string | null;
  imageUrl: string | null;
  excerpt: string | null;
  cover: string | null;
  coverAlt: string | null;
  author: string;
  draft: number;
  publishedAt: string | null;
}): Promise<PostRow> {
  try {
    await env.DB.prepare(`
      INSERT INTO posts (
        slug, title, content, tags, category, image_url,
        excerpt, cover_image_url, cover_alt, author, draft, published_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      row.slug,
      row.title,
      row.content,
      row.tags,
      row.category,
      row.imageUrl,
      row.excerpt,
      row.cover,
      row.coverAlt,
      row.author,
      row.draft,
      row.publishedAt,
    ).run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (row.cover) await deleteStoredImage(env, row.cover);
      throw new HttpError('A post with this slug already exists', 409, { slug: row.slug });
    }
    throw error;
  }
  const created = await getPostBySlug(env, row.slug);
  if (!created) throw new HttpError('Failed to create post', 500);
  return created;
}

export async function createPost(env: Env, fields: Record<string, unknown>, file: File | null): Promise<PostRow> {
  const title = requiredString(fields.title, 'title', 200);
  const slug = parseSlug(fields.slug, title, true)!;
  const content = contentFrom(fields, true)!;
  const excerpt = optionalString(fields.excerpt, 'excerpt', MAX_EXCERPT);
  const category = optionalString(fields.category, 'category', 80);
  const author = optionalString(fields.author, 'author', 120) || DEFAULT_AUTHOR;
  const coverAlt = optionalString(fields.cover_alt, 'cover_alt', MAX_EXCERPT);
  const tags = parseTags(fields.tags);
  const draft = parseDraft(fields.draft) ?? false;
  const publishedAtInput = parsePublishedAt(fields.published_at);
  const existing = await getPostBySlug(env, slug);
  if (existing) throw new HttpError('A post with this slug already exists', 409, { slug });

  const hosted = await resolveCover(env, coverRequestFrom(fields, file), null);
  const legacyImage = optionalString(fields.image_url, 'image_url', 2000);
  const cover = hosted === undefined ? (legacyImage ?? null) : hosted;
  const publishedAt = publishedAtInput === undefined
    ? (draft ? null : new Date().toISOString())
    : publishedAtInput;

  return insertPost(env, {
    slug,
    title,
    content,
    tags: tags ?? null,
    category: category ?? null,
    imageUrl: cover,
    excerpt: excerpt ?? null,
    cover,
    coverAlt: coverAlt ?? null,
    author: author ?? DEFAULT_AUTHOR,
    draft: draft ? 1 : 0,
    publishedAt,
  });
}

export async function updatePost(env: Env, slug: string, fields: Record<string, unknown>, file: File | null): Promise<PostRow> {
  const existing = await getPostBySlug(env, slug);
  if (!existing) throw new HttpError('Post not found', 404);

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    updates.push(`${column} = ?`);
    values.push(value);
  };

  if (fields.title !== undefined) set('title', requiredString(fields.title, 'title', 200));
  if (fields.content_md !== undefined || fields.content !== undefined) {
    set('content', contentFrom(fields, true)!);
  }
  if (fields.excerpt !== undefined) set('excerpt', optionalString(fields.excerpt, 'excerpt', MAX_EXCERPT) ?? null);
  if (fields.category !== undefined) set('category', optionalString(fields.category, 'category', 80) ?? null);
  if (fields.author !== undefined) set('author', optionalString(fields.author, 'author', 120) || DEFAULT_AUTHOR);
  if (fields.cover_alt !== undefined) set('cover_alt', optionalString(fields.cover_alt, 'cover_alt', MAX_EXCERPT) ?? null);
  if (fields.tags !== undefined) set('tags', parseTags(fields.tags) ?? null);

  const draft = parseDraft(fields.draft);
  if (draft !== undefined) set('draft', draft ? 1 : 0);

  const publishedAt = parsePublishedAt(fields.published_at);
  if (publishedAt !== undefined) set('published_at', publishedAt);
  else if (draft === false && !existing.published_at) set('published_at', new Date().toISOString());

  let nextSlug = slug;
  if (fields.slug !== undefined) {
    const parsed = parseSlug(fields.slug, undefined, true);
    if (parsed && parsed !== slug) {
      const taken = await env.DB.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?')
        .bind(parsed, existing.id)
        .first<{ id: number }>();
      if (taken) throw new HttpError('A post with this slug already exists', 409, { slug: parsed });
      set('slug', parsed);
      nextSlug = parsed;
    }
  }

  const cover = await resolveCover(env, coverRequestFrom(fields, file), existing.cover_image_url);

  if (cover !== undefined) {
    set('cover_image_url', cover);
    set('image_url', cover);
  }

  if (updates.length === 0) throw new HttpError('No fields to update', 400);

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(slug);
  try {
    await env.DB.prepare(`UPDATE posts SET ${updates.join(', ')} WHERE slug = ?`).bind(...values).run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError('A post with this slug already exists', 409, { slug: nextSlug });
    }
    throw error;
  }
  const updated = await getPostBySlug(env, nextSlug);
  if (!updated) throw new HttpError('Post not found', 404);
  return updated;
}

export async function deletePost(env: Env, slug: string): Promise<void> {
  const existing = await getPostBySlug(env, slug);
  if (!existing) throw new HttpError('Post not found', 404);
  await env.DB.prepare('DELETE FROM posts WHERE slug = ?').bind(slug).run();
  await deleteStoredImage(env, existing.cover_image_url);
}

export function serializePost(post: PostRow, base: string) {
  const cover = coverSource(post);
  let coverUrl: string | null = null;
  if (cover) {
    coverUrl = /^https?:\/\//i.test(cover) ? cover : `${base}${cover.startsWith('/') ? cover : `/${cover}`}`;
  }
  return {
    id: post.id,
    slug: post.slug,
    url: `${base}/blog/${post.slug}`,
    draft: isDraft(post),
    cover_image_url: coverUrl,
    title: post.title,
    content: post.content,
    excerpt: post.excerpt,
    tags: post.tags,
    category: post.category,
    image_url: post.image_url,
    cover_alt: post.cover_alt,
    author: post.author || DEFAULT_AUTHOR,
    published_at: post.published_at,
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
}

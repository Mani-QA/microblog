import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import Papa from 'papaparse';

// Type definitions
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string; // Secret - set via wrangler secret or .dev.vars
}

interface Post {
  id?: number;
  slug: string;
  title: string;
  content: string;
  tags?: string;
  category?: string;
  image_url?: string;
  created_at?: string;
  updated_at?: string;
}

interface PostCSV {
  slug: string;
  title: string;
  content: string;
  tags?: string;
  category?: string;
  image_url?: string;
}

// ============================================
// Authentication Configuration
// ============================================

// Generate session token
async function generateSessionToken(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// In-memory session store (for production, use KV or D1)
const activeSessions = new Map<string, { expires: number }>();

// Clean expired sessions
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (session.expires < now) {
      activeSessions.delete(token);
    }
  }
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware for API routes
app.use('/api/*', cors());

// ============================================
// Admin Authentication Endpoints
// ============================================

// POST /api/admin/login - Authenticate admin
app.post('/api/admin/login', async (c) => {
  try {
    const body = await c.req.json<{ password: string }>();
    const password = body?.password;
    
    if (!password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    // Get admin password from environment variable (secret)
    const adminPassword = c.env.ADMIN_PASSWORD;
    
    if (!adminPassword) {
      console.error('ADMIN_PASSWORD secret not configured');
      return c.json({ error: 'Server configuration error' }, 500);
    }

    // Compare with environment variable
    const isValid = password === adminPassword;
    
    if (!isValid) {
      // Add delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 500));
      return c.json({ error: 'Invalid password' }, 401);
    }

    // Clean expired sessions
    cleanExpiredSessions();

    // Generate session token
    const sessionToken = await generateSessionToken();
    const expires = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
    
    // Store session
    activeSessions.set(sessionToken, { expires });

    // Set HTTP-only cookie (auto-detect HTTPS for secure flag)
    const isSecure = new URL(c.req.url).protocol === 'https:';
    setCookie(c, 'admin_session', sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60, // 24 hours
    });

    return c.json({ success: true, message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

// POST /api/admin/logout - Logout admin
app.post('/api/admin/logout', (c) => {
  const sessionToken = getCookie(c, 'admin_session');
  
  if (sessionToken) {
    activeSessions.delete(sessionToken);
  }
  
  deleteCookie(c, 'admin_session', { path: '/' });
  
  return c.json({ success: true, message: 'Logged out' });
});

// GET /api/admin/verify - Verify session
app.get('/api/admin/verify', (c) => {
  const sessionToken = getCookie(c, 'admin_session');
  
  if (!sessionToken) {
    return c.json({ authenticated: false }, 401);
  }

  const session = activeSessions.get(sessionToken);
  
  if (!session || session.expires < Date.now()) {
    activeSessions.delete(sessionToken);
    deleteCookie(c, 'admin_session', { path: '/' });
    return c.json({ authenticated: false }, 401);
  }

  return c.json({ authenticated: true });
});

// Middleware to protect admin routes
const requireAuth = async (c: any, next: any) => {
  const sessionToken = getCookie(c, 'admin_session');
  
  if (!sessionToken) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const session = activeSessions.get(sessionToken);
  
  if (!session || session.expires < Date.now()) {
    activeSessions.delete(sessionToken);
    return c.json({ error: 'Session expired' }, 401);
  }

  await next();
};

// ============================================
// Endpoint 1: Bulk Import (POST /api/posts/import) - Protected
// ============================================
app.post('/api/posts/import', requireAuth, async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ error: 'No CSV file provided' }, 400);
    }

    const csvText = await file.text();

    // Parse CSV using papaparse
    const parseResult = Papa.parse<PostCSV>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase(),
    });

    if (parseResult.errors.length > 0) {
      return c.json({ 
        error: 'CSV parsing errors', 
        details: parseResult.errors 
      }, 400);
    }

    const posts = parseResult.data;

    if (posts.length === 0) {
      return c.json({ error: 'No valid posts found in CSV' }, 400);
    }

    // Chunk size for D1 batch operations (respecting D1 limits)
    const CHUNK_SIZE = 50;
    let imported = 0;
    let updated = 0;

    // Process in chunks
    for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
      const chunk = posts.slice(i, i + CHUNK_SIZE);
      const statements: D1PreparedStatement[] = [];

      for (const post of chunk) {
        // Validate required fields
        if (!post.slug || !post.title || !post.content) {
          continue;
        }

        // Upsert: Insert or update on slug conflict
        const stmt = c.env.DB.prepare(`
          INSERT INTO posts (slug, title, content, tags, category, image_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            tags = excluded.tags,
            category = excluded.category,
            image_url = excluded.image_url,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          post.slug.trim(),
          post.title.trim(),
          post.content,
          post.tags || null,
          post.category || null,
          post.image_url || null
        );

        statements.push(stmt);
      }

      if (statements.length > 0) {
        const results = await c.env.DB.batch(statements);
        
        // Count inserts vs updates based on changes
        for (const result of results) {
          if (result.meta.changes > 0) {
            // Check if it was an insert or update by checking rows_written
            if (result.meta.last_row_id && result.meta.last_row_id > 0) {
              imported++;
            } else {
              updated++;
            }
          }
        }
      }
    }

    return c.json({
      success: true,
      message: `Import completed`,
      stats: {
        total: posts.length,
        processed: imported + updated,
      }
    });
  } catch (error) {
    console.error('Import error:', error);
    return c.json({ 
      error: 'Import failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// ============================================
// Endpoint 2: Bulk Export (GET /api/posts/export)
// ============================================
app.get('/api/posts/export', async (c) => {
  try {
    // Use raw() for better performance with streaming
    const result = await c.env.DB.prepare(`
      SELECT slug, title, content, tags, category, image_url, created_at, updated_at
      FROM posts
      ORDER BY created_at DESC
    `).raw({ columnNames: true });

    if (!result || result.length === 0) {
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="posts-export.csv"');
      return c.body('slug,title,content,tags,category,image_url,created_at,updated_at\n');
    }

    // Extract column names from first row
    const columns = result[0] as string[];
    const rows = result.slice(1);

    // Set response headers for CSV download
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="posts-export.csv"');

    // Stream CSV data
    return streamText(c, async (stream) => {
      // Write header row
      await stream.writeln(columns.join(','));

      // Stream each row
      for (const row of rows) {
        const csvRow = (row as (string | number | null)[]).map(value => {
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }).join(',');
        
        await stream.writeln(csvRow);
      }
    });
  } catch (error) {
    console.error('Export error:', error);
    return c.json({ 
      error: 'Export failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// ============================================
// Endpoint 3: CRUD Operations
// ============================================

// GET /api/posts - List posts (paginated, using read replicas)
app.get('/api/posts', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '10'), 100);
    const category = c.req.query('category');
    const tag = c.req.query('tag');
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM posts';
    let countQuery = 'SELECT COUNT(*) as total FROM posts';
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    if (tag) {
      // Search for tag in comma-separated tags field
      conditions.push("(',' || tags || ',' LIKE '%,' || ? || ',%')");
      params.push(tag);
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    // Get total count
    const countResult = await c.env.DB.prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();

    // Get paginated posts (hitting read replicas)
    const posts = await c.env.DB.prepare(query)
      .bind(...params, limit, offset)
      .all<Post>();

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    return c.json({
      posts: posts.results,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      }
    });
  } catch (error) {
    console.error('List posts error:', error);
    return c.json({ 
      error: 'Failed to fetch posts', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// GET /api/categories - List all unique categories
app.get('/api/categories', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT category, COUNT(*) as count 
      FROM posts 
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category 
      ORDER BY count DESC
    `).all<{ category: string; count: number }>();

    return c.json({ categories: result.results });
  } catch (error) {
    console.error('List categories error:', error);
    return c.json({ error: 'Failed to fetch categories' }, 500);
  }
});

// GET /api/tags - List all unique tags with counts
app.get('/api/tags', async (c) => {
  try {
    // Get all posts with tags
    const posts = await c.env.DB.prepare(`
      SELECT tags FROM posts WHERE tags IS NOT NULL AND tags != ''
    `).all<{ tags: string }>();

    // Parse and count tags
    const tagCounts = new Map<string, number>();
    
    for (const post of posts.results) {
      const tags = post.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Convert to sorted array
    const tags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    return c.json({ tags });
  } catch (error) {
    console.error('List tags error:', error);
    return c.json({ error: 'Failed to fetch tags' }, 500);
  }
});

// GET /api/posts/:slug - Get single post
app.get('/api/posts/:slug', async (c) => {
  try {
    const slug = c.req.param('slug');

    const post = await c.env.DB.prepare(`
      SELECT * FROM posts WHERE slug = ?
    `).bind(slug).first<Post>();

    if (!post) {
      return c.json({ error: 'Post not found' }, 404);
    }

    return c.json(post);
  } catch (error) {
    console.error('Get post error:', error);
    return c.json({ 
      error: 'Failed to fetch post', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// POST /api/posts - Create a post (Protected)
app.post('/api/posts', requireAuth, async (c) => {
  try {
    const body = await c.req.json<Omit<Post, 'id' | 'created_at' | 'updated_at'>>();

    // Validate required fields
    if (!body.slug || !body.title || !body.content) {
      return c.json({ 
        error: 'Missing required fields: slug, title, content are required' 
      }, 400);
    }

    // Check if slug already exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM posts WHERE slug = ?
    `).bind(body.slug).first();

    if (existing) {
      return c.json({ error: 'A post with this slug already exists' }, 409);
    }

    const result = await c.env.DB.prepare(`
      INSERT INTO posts (slug, title, content, tags, category, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      body.slug,
      body.title,
      body.content,
      body.tags || null,
      body.category || null,
      body.image_url || null
    ).run();

    // Fetch the created post
    const newPost = await c.env.DB.prepare(`
      SELECT * FROM posts WHERE id = ?
    `).bind(result.meta.last_row_id).first<Post>();

    return c.json(newPost, 201);
  } catch (error) {
    console.error('Create post error:', error);
    return c.json({ 
      error: 'Failed to create post', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// PUT /api/posts/:slug - Update a post (Protected)
app.put('/api/posts/:slug', requireAuth, async (c) => {
  try {
    const slug = c.req.param('slug');
    const body = await c.req.json<Partial<Omit<Post, 'id' | 'created_at' | 'updated_at'>>>();

    // Check if post exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM posts WHERE slug = ?
    `).bind(slug).first<{ id: number }>();

    if (!existing) {
      return c.json({ error: 'Post not found' }, 404);
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (body.title !== undefined) {
      updates.push('title = ?');
      values.push(body.title);
    }
    if (body.content !== undefined) {
      updates.push('content = ?');
      values.push(body.content);
    }
    if (body.tags !== undefined) {
      updates.push('tags = ?');
      values.push(body.tags || null);
    }
    if (body.category !== undefined) {
      updates.push('category = ?');
      values.push(body.category || null);
    }
    if (body.image_url !== undefined) {
      updates.push('image_url = ?');
      values.push(body.image_url || null);
    }
    if (body.slug !== undefined && body.slug !== slug) {
      // Check if new slug is available
      const slugExists = await c.env.DB.prepare(`
        SELECT id FROM posts WHERE slug = ? AND id != ?
      `).bind(body.slug, existing.id).first();

      if (slugExists) {
        return c.json({ error: 'A post with this slug already exists' }, 409);
      }
      updates.push('slug = ?');
      values.push(body.slug);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(slug);

    await c.env.DB.prepare(`
      UPDATE posts SET ${updates.join(', ')} WHERE slug = ?
    `).bind(...values).run();

    // Fetch updated post (use new slug if changed)
    const finalSlug = body.slug || slug;
    const updatedPost = await c.env.DB.prepare(`
      SELECT * FROM posts WHERE slug = ?
    `).bind(finalSlug).first<Post>();

    return c.json(updatedPost);
  } catch (error) {
    console.error('Update post error:', error);
    return c.json({ 
      error: 'Failed to update post', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// DELETE /api/posts/:slug - Delete a post (Protected)
app.delete('/api/posts/:slug', requireAuth, async (c) => {
  try {
    const slug = c.req.param('slug');

    const result = await c.env.DB.prepare(`
      DELETE FROM posts WHERE slug = ?
    `).bind(slug).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Post not found' }, 404);
    }

    return c.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    return c.json({ 
      error: 'Failed to delete post', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString() 
  });
});

// SPA catch-all: serve index.html for client-side routes
app.get('*', async (c) => {
  // Skip API routes (already handled above)
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  // Serve index.html for SPA routing
  return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
});

export default app;


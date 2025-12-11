# Microblog Platform Architecture

## Overview

This document describes the architecture of the Microblog platform, a serverless microblogging application built using the **Workers with Assets** deployment model on Cloudflare.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge Network                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌───────────────────┐    ┌────────────────────────────────────┐  │
│   │   Static Assets   │    │         Cloudflare Worker          │  │
│   │   (client/dist)   │    │         (Hono API)                 │  │
│   │                   │    │                                    │  │
│   │  - HTML/CSS/JS    │    │  ┌─────────────────────────────┐  │  │
│   │  - Images         │    │  │      API Routes             │  │  │
│   │  - Fonts          │    │  │                             │  │  │
│   └───────────────────┘    │  │  POST /api/posts/import     │  │  │
│           │                │  │  GET  /api/posts/export     │  │  │
│           │                │  │  GET  /api/posts            │  │  │
│           ▼                │  │  GET  /api/posts/:slug      │  │  │
│   ┌───────────────────┐    │  │  POST /api/posts            │  │  │
│   │   ASSETS Binding  │    │  │  PUT  /api/posts/:slug      │  │  │
│   │                   │    │  │  DELETE /api/posts/:slug    │  │  │
│   │   SPA Fallback    │    │  └─────────────────────────────┘  │  │
│   │   (index.html)    │    │              │                    │  │
│   └───────────────────┘    │              │                    │  │
│                            │              ▼                    │  │
│                            │  ┌─────────────────────────────┐  │  │
│                            │  │       D1 Database           │  │  │
│                            │  │       (blog-db)             │  │  │
│                            │  │                             │  │  │
│                            │  │   ┌─────────────────────┐   │  │  │
│                            │  │   │   posts table       │   │  │  │
│                            │  │   │   - id              │   │  │  │
│                            │  │   │   - slug (unique)   │   │  │  │
│                            │  │   │   - title           │   │  │  │
│                            │  │   │   - content         │   │  │  │
│                            │  │   │   - tags            │   │  │  │
│                            │  │   │   - category        │   │  │  │
│                            │  │   │   - image_url       │   │  │  │
│                            │  │   │   - created_at      │   │  │  │
│                            │  │   │   - updated_at      │   │  │  │
│                            │  │   └─────────────────────┘   │  │  │
│                            │  │                             │  │  │
│                            │  │   Read Replicas (5x)        │  │  │
│                            │  └─────────────────────────────┘  │  │
│                            └────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Deployment Model: Workers with Assets

This project uses the **Workers with Assets** deployment model, which provides:

1. **Unified Deployment** - Frontend and backend deploy together as a single Worker
2. **SPA Support** - Automatic fallback to `index.html` for client-side routing
3. **Edge Caching** - Static assets are cached at Cloudflare's edge
4. **Zero Cold Starts** - Workers start instantly worldwide

### Configuration (wrangler.toml)

```toml
[assets]
directory = "./client/dist"     # Static files location
binding = "ASSETS"               # Access static files programmatically
not_found_handling = "single-page-application"  # SPA routing support
```

## Data Flow

### 1. Static Asset Request

```
Client Request → Edge Network → Asset Check → Serve Static File
                     │
                     └── If not found → SPA fallback (index.html)
```

### 2. API Request

```
Client Request → Edge Network → Worker → Hono Router → D1 Database → Response
                                              │
                                              └── Read Replicas for GET requests
```

### 3. CSV Import Flow

```
CSV File Upload → Worker → PapaParse → Chunked Processing (50 records)
                              │
                              └── Batch Upsert to D1 (ON CONFLICT UPDATE)
```

### 4. CSV Export Flow

```
Export Request → Worker → D1 Query (.raw()) → Stream Response
                              │
                              └── streamText() for efficient memory usage
```

## Database Design

### Posts Table

| Column     | Type     | Constraints                | Description                        |
| ---------- | -------- | -------------------------- | ---------------------------------- |
| id         | INTEGER  | PRIMARY KEY, AUTOINCREMENT | Unique identifier                  |
| slug       | TEXT     | UNIQUE, NOT NULL           | URL-friendly identifier for upsert |
| title      | TEXT     | NOT NULL                   | Post title                         |
| content    | TEXT     | NOT NULL                   | Post body content                  |
| tags       | TEXT     | NULLABLE                   | Comma-separated tags               |
| category   | TEXT     | NULLABLE                   | Post category                      |
| image_url  | TEXT     | NULLABLE                   | Featured image URL                 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP  | Creation time                      |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP  | Last modified time                 |

### Indexes

| Index                | Column(s)       | Purpose                              |
| -------------------- | --------------- | ------------------------------------ |
| idx_posts_slug       | slug            | Fast slug lookups, upsert operations |
| idx_posts_category   | category        | Category filtering                   |
| idx_posts_created_at | created_at DESC | Pagination, sorting                  |

### Upsert Strategy

The import endpoint uses SQLite's `ON CONFLICT` clause for efficient upserts:

```sql
INSERT INTO posts (slug, title, content, ...)
VALUES (?, ?, ?, ...)
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  content = excluded.content,
  ...
  updated_at = CURRENT_TIMESTAMP
```

## API Design

### RESTful Endpoints

| Method | Path             | Description          | D1 Operation             |
| ------ | ---------------- | -------------------- | ------------------------ |
| GET    | /api/posts       | List paginated posts | SELECT with LIMIT/OFFSET |
| GET    | /api/posts/:slug | Get single post      | SELECT WHERE slug        |
| POST   | /api/posts       | Create post          | INSERT                   |
| PUT    | /api/posts/:slug | Update post          | UPDATE WHERE slug        |
| DELETE | /api/posts/:slug | Delete post          | DELETE WHERE slug        |

### Bulk Endpoints

| Method | Path              | Description          | Special Features                          |
| ------ | ----------------- | -------------------- | ----------------------------------------- |
| POST   | /api/posts/import | CSV bulk import      | PapaParse, Batch upsert, 50-record chunks |
| GET    | /api/posts/export | CSV streaming export | streamText(), raw() queries               |

### Pagination Response Format

```json
{
  "posts": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Performance Optimizations

### D1 Read Replicas

Read replicas are enabled for improved read performance:

```toml
[d1_databases.migrations]
read_replication = true
replica_count = 5
```

Benefits:

- Reduced latency for read-heavy workloads
- Geographic distribution of read capacity
- Primary database handles writes

### Streaming Export

CSV export uses Hono's `streamText()` for memory-efficient streaming:

```typescript
return streamText(c, async (stream) => {
  await stream.writeln(headers);
  for (const row of results) {
    await stream.writeln(formatRow(row));
  }
});
```

### Batch Processing

CSV imports process records in chunks of 50 to stay within D1 limits:

```typescript
const CHUNK_SIZE = 50;
for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
  const chunk = posts.slice(i, i + CHUNK_SIZE);
  await db.batch(statements);
}
```

## Frontend Architecture

### Component Structure

```
client/src/
├── App.tsx          # Routes and page components
├── api.ts           # API client with typed methods
├── types.ts         # TypeScript interfaces
├── main.tsx         # React entry point
└── index.css        # Global styles with CSS variables
```

### API Client

The `api.ts` module provides a typed interface to the backend:

```typescript
class ApiClient {
  getPosts(page, limit, category): Promise<PaginatedResponse>;
  getPost(slug): Promise<Post>;
  createPost(data): Promise<Post>;
  updatePost(slug, data): Promise<Post>;
  deletePost(slug): Promise<{ success: boolean }>;
  importPosts(file): Promise<ImportResult>;
  getExportUrl(): string;
}
```

### Styling Approach

- CSS Custom Properties for theming
- Dark theme with accent color (#ff6b35)
- Responsive design with mobile-first approach
- CSS animations for loading states and transitions

## Security Considerations

1. **Input Validation** - All inputs validated before database operations
2. **SQL Injection Prevention** - Parameterized queries via D1 bindings
3. **CORS** - Configured for API routes only
4. **Content-Type Validation** - Multipart form data for file uploads
5. **Error Handling** - Errors logged server-side, sanitized for client

## Deployment Pipeline

```
npm run build          # Build frontend (Vite)
        │
        ▼
npm run deploy         # Deploy to Cloudflare
        │
        ▼
┌───────────────────────────────────────┐
│ Wrangler bundles:                     │
│   - Worker code (src/index.ts)        │
│   - Static assets (client/dist/)      │
└───────────────────────────────────────┘
        │
        ▼
    Cloudflare Edge
```

## Monitoring & Debugging

- **Wrangler Logs**: `wrangler tail` for real-time logs
- **Console Logging**: Server-side errors logged to console
- **D1 Metrics**: Available in Cloudflare dashboard
- **Worker Analytics**: Request counts, CPU time, errors

## Future Enhancements

Potential improvements for the platform:

1. **Authentication** - Add user authentication (Cloudflare Access, JWT)
2. **Rate Limiting** - Implement rate limiting middleware
3. **Image Uploads** - Integrate with R2 for image storage
4. **Full-Text Search** - Add FTS5 search capabilities
5. **Caching** - Add KV or Cache API for frequently accessed posts
6. **Analytics** - Track post views with Analytics Engine
7. **Comments** - Add commenting system with D1
8. **RSS Feed** - Generate RSS/Atom feeds for posts

# Microblog - Serverless Microblogging Platform

A modern, serverless microblogging platform built with **Cloudflare Workers**, **Hono**, **React (Vite)**, and **D1 Database**.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)
![Hono](https://img.shields.io/badge/Hono-API-E36002)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

## Features

- 🚀 **Serverless Architecture** - Runs on Cloudflare's global edge network
- 📝 **Full CRUD API** - Create, read, update, and delete blog posts
- 🔐 **Admin Panel** - Password-protected admin interface at `/adminauthor`
- 📤 **Bulk Import** - Import posts from CSV files with upsert logic
- 📥 **Bulk Export** - Stream export posts to CSV
- 🔄 **Read Replicas** - D1 read replication for improved performance
- ⚡ **Fast Frontend** - React + Vite with modern, beautiful UI
- 🎨 **Dark Theme** - Elegant dark mode design with accent colors
- 📱 **Responsive** - Works on all device sizes
- 🔍 **SEO Optimized** - Semantic HTML and meta tags

## Architecture

```
microblog/
├── src/                    # Backend (Cloudflare Worker)
│   ├── index.ts           # Hono API routes
│   └── types.ts           # TypeScript types
├── client/                 # Frontend (React + Vite)
│   ├── src/
│   │   ├── App.tsx        # Main React app
│   │   ├── api.ts         # API client helper
│   │   ├── types.ts       # Shared types
│   │   └── index.css      # Styles
│   ├── index.html
│   └── vite.config.ts
├── schema.sql             # D1 database schema
├── wrangler.toml          # Cloudflare Worker config
└── package.json           # Root dependencies
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (Cloudflare Workers CLI)
- Cloudflare account

## Quick Start

### 1. Install Dependencies

```bash
# Install root dependencies (backend)
npm install

# Install client dependencies
cd client && npm install && cd ..
```

### 2. Create D1 Database

```bash
# Create the D1 database
npm run db:create

# Note the database_id from the output and update wrangler.toml
```

### 3. Update Configuration

Edit `wrangler.toml` and replace `YOUR_DATABASE_ID_HERE` with your actual database ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "blog-db"
database_id = "your-actual-database-id"
```

### 4. Run Database Migration

```bash
# Run locally
npm run db:migrate:local

# Run on production
npm run db:migrate
```

### 5. Development

```bash
# Run the full stack in development mode
npm run dev

# Or run frontend and backend separately:
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend (in /client directory)
npm run dev:client
```

The app will be available at `http://localhost:8787`

### 6. Deploy

```bash
# Build frontend and deploy to Cloudflare
npm run deploy
```

## API Endpoints

### Posts CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/posts` | List posts (paginated) |
| `GET` | `/api/posts/:slug` | Get single post |
| `POST` | `/api/posts` | Create a post |
| `PUT` | `/api/posts/:slug` | Update a post |
| `DELETE` | `/api/posts/:slug` | Delete a post |

### Bulk Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/posts/import` | Import posts from CSV |
| `GET` | `/api/posts/export` | Export posts to CSV |

### Query Parameters

**GET /api/posts**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10, max: 100)
- `category` - Filter by category

## Admin Panel

Access the admin panel at `/adminauthor` to manage your blog posts.

### Features
- 🔐 **Secure Login** - Password-protected with SHA-256 hashing
- ➕ **Create Posts** - Rich form with auto-slug generation
- ✏️ **Edit Posts** - Update existing posts
- 🗑️ **Delete Posts** - Remove posts with confirmation
- 📤 **CSV Import** - Bulk import posts from CSV files
- 📥 **CSV Export** - Download all posts as CSV

### Default Credentials
- **URL**: `/adminauthor`
- **Password**: Set via environment variable (see below)

### Setting the Admin Password

**Local Development** - Create `.dev.vars` file:
```env
ADMIN_PASSWORD=your-secure-password-here
```

**Production** - Use Cloudflare secrets:
```bash
# Set the secret
npx wrangler secret put ADMIN_PASSWORD

# Or with echo (careful with shell history)
echo "your-password" | npx wrangler secret put ADMIN_PASSWORD
```

> ⚠️ **Security**: The password is stored as a Cloudflare secret, never in source code. The `.dev.vars` file is git-ignored.

### Authentication
- Password is hashed using SHA-256 (never stored in plain text)
- Session tokens are stored in HTTP-only cookies
- Sessions expire after 24 hours
- Protected endpoints: POST, PUT, DELETE operations

## CSV Import Format

Create a CSV file with the following columns:

```csv
slug,title,content,tags,category,image_url
my-first-post,My First Post,This is the content...,tech,Technology,https://example.com/image.jpg
```

Required columns: `slug`, `title`, `content`
Optional columns: `tags`, `category`, `image_url`

### Import via cURL

```bash
curl -X POST http://localhost:8787/api/posts/import \
  -F "file=@posts.csv"
```

## Post Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Auto-incremented primary key |
| `slug` | string | Unique URL-friendly identifier |
| `title` | string | Post title |
| `content` | string | Post content |
| `tags` | string | Comma-separated tags |
| `category` | string | Post category |
| `image_url` | string | Featured image URL |
| `created_at` | datetime | Creation timestamp |
| `updated_at` | datetime | Last update timestamp |

## Technology Stack

### Backend
- **[Hono](https://hono.dev/)** - Ultrafast web framework for Cloudflare Workers
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** - Serverless SQLite database
- **[PapaParse](https://www.papaparse.com/)** - CSV parsing library

### Frontend
- **[React 18](https://react.dev/)** - UI library
- **[Vite](https://vitejs.dev/)** - Build tool
- **[React Router](https://reactrouter.com/)** - Client-side routing
- **TypeScript** - Type safety

### Infrastructure
- **[Cloudflare Workers](https://workers.cloudflare.com/)** - Serverless compute
- **Workers Assets** - Static asset serving with SPA support
- **D1 Read Replicas** - Distributed read performance

## Development Notes

### Local Database

Wrangler creates a local SQLite database in `.wrangler/` for development. This is separate from your production database.

### Environment Variables

Create a `.dev.vars` file for local development secrets:

```env
# Add any secrets here (not needed for basic setup)
```

### Deployment Regions

Cloudflare Workers run on 300+ edge locations globally. D1 read replicas distribute read queries across multiple regions for improved latency.

## License

MIT License - feel free to use this project as a template for your own applications.

---

Built with ❤️ using Cloudflare Workers


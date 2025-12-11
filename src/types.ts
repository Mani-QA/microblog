// Cloudflare Workers environment bindings
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

// Post entity
export interface Post {
  id: number;
  slug: string;
  title: string;
  content: string;
  tags: string | null;
  category: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

// Post creation input
export interface CreatePostInput {
  slug: string;
  title: string;
  content: string;
  tags?: string;
  category?: string;
  image_url?: string;
}

// Post update input
export interface UpdatePostInput {
  slug?: string;
  title?: string;
  content?: string;
  tags?: string;
  category?: string;
  image_url?: string;
}

// Pagination response
export interface PaginatedResponse<T> {
  posts: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// API error response
export interface ApiError {
  error: string;
  details?: string;
}

// Import result
export interface ImportResult {
  success: boolean;
  message: string;
  stats: {
    total: number;
    processed: number;
  };
}


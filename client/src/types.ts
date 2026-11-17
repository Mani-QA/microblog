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
  excerpt?: string | null;
  cover_image_url?: string | null;
  cover_alt?: string | null;
  author?: string | null;
  draft?: boolean | number;
  published_at?: string | null;
  url?: string;
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

// Pagination info
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Paginated response
export interface PaginatedResponse {
  posts: Post[];
  pagination: Pagination;
}

// API error response
export interface ApiError {
  error: string;
  details?: string;
}


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


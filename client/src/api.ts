import type { Post, PaginatedResponse, CreatePostInput, UpdatePostInput } from './types';

/**
 * API helper functions for communicating with the backend.
 * Uses relative paths (e.g., /api/posts) to leverage the same-origin deployment.
 */

class ApiClient {
  private baseUrl = '/api';

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      credentials: 'include', // Include cookies for authenticated requests
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP error ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get paginated list of posts
   */
  async getPosts(page = 1, limit = 10, category?: string, tag?: string): Promise<PaginatedResponse> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });

    if (category) {
      params.append('category', category);
    }

    if (tag) {
      params.append('tag', tag);
    }

    return this.request<PaginatedResponse>(`/posts?${params}`);
  }

  /**
   * Get all categories with post counts
   */
  async getCategories(): Promise<{ categories: { category: string; count: number }[] }> {
    return this.request<{ categories: { category: string; count: number }[] }>('/categories');
  }

  /**
   * Get all tags with post counts
   */
  async getTags(): Promise<{ tags: { tag: string; count: number }[] }> {
    return this.request<{ tags: { tag: string; count: number }[] }>('/tags');
  }

  /**
   * Get a single post by slug
   */
  async getPost(slug: string): Promise<Post> {
    return this.request<Post>(`/posts/${encodeURIComponent(slug)}`);
  }

  /**
   * Create a new post
   */
  async createPost(data: CreatePostInput): Promise<Post> {
    return this.request<Post>('/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing post
   */
  async updatePost(slug: string, data: UpdatePostInput): Promise<Post> {
    return this.request<Post>(`/posts/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a post
   */
  async deletePost(slug: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      `/posts/${encodeURIComponent(slug)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Import posts from CSV file
   */
  async importPosts(file: File): Promise<{
    success: boolean;
    message: string;
    stats: { total: number; processed: number };
  }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/posts/import`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Import failed' }));
      throw new Error(error.error || `HTTP error ${response.status}`);
    }

    return response.json();
  }

  /**
   * Export posts as CSV - returns the download URL
   */
  getExportUrl(): string {
    return `${this.baseUrl}/posts/export`;
  }

  /**
   * Check API health
   */
  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('/health');
  }
}

// Export singleton instance
export const api = new ApiClient();


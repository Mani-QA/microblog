import { Routes, Route, useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './api';
import type { Post, PaginatedResponse } from './types';
import { parseMarkdown } from './markdown';
import AdminPage from './AdminPage';

function HomePage() {
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchPosts = async () => {
      setLoading(true);
      try {
        const response = await api.getPosts(page);
        setData(response);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [page]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading posts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="home-page">
      <header className="hero">
        <h1>ManiG Blog</h1>
        <p className="tagline">Writing by Manivannan Gajendran</p>
      </header>

      <main className="posts-container">
        {data?.posts.length === 0 ? (
          <div className="empty-state">
            <h2>No posts yet</h2>
            <p>Import posts via CSV or create your first post using the API.</p>
          </div>
        ) : (
          <div className="posts-grid">
            {data?.posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}

        {data && data.pagination.totalPages > 1 && (
          <Pagination 
            pagination={data.pagination} 
            onPageChange={setPage} 
          />
        )}
      </main>
    </div>
  );
}

// Reusable Pagination Component
function Pagination({ 
  pagination, 
  onPageChange 
}: { 
  pagination: PaginatedResponse['pagination'];
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <button
        disabled={!pagination.hasPrev}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        ← Previous
      </button>
      <span className="page-info">
        Page {pagination.page} of {pagination.totalPages}
      </span>
      <button
        disabled={!pagination.hasNext}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        Next →
      </button>
    </div>
  );
}

// Get plain text excerpt from markdown content
function getExcerpt(markdown: string, maxLength = 200): string {
  // Remove markdown syntax for excerpt
  const plainText = markdown
    .replace(/#{1,6}\s/g, '') // headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/!\[.*?\]\(.+?\)/g, '') // images
    .replace(/^\s*[-*+]\s/gm, '') // list items
    .replace(/^\s*\d+\.\s/gm, '') // numbered lists
    .replace(/^\s*>/gm, '') // blockquotes
    .replace(/\n+/g, ' ') // newlines
    .trim();
  
  return plainText.length > maxLength 
    ? plainText.substring(0, maxLength) + '...' 
    : plainText;
}

// Post Card Component with clickable category and tags
function PostCard({ post }: { post: Post }) {
  const formattedDate = new Date(post.published_at || post.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const tags = post.tags?.split(',').map((t) => t.trim()).filter(Boolean) || [];
  const image = post.cover_image_url || post.image_url;

  return (
    <article className="post-card">
      {image && (
        <div className="post-image">
          <img src={image} alt={post.cover_alt || post.title} width={1200} height={630} loading="lazy" />
        </div>
      )}
      <div className="post-content">
        {post.category && (
          <Link 
            to={`/category/${encodeURIComponent(post.category)}`} 
            className="category-badge"
          >
            {post.category}
          </Link>
        )}
        <h2>
          <Link to={`/blog/${post.slug}`}>{post.title}</Link>
        </h2>
        <p className="excerpt">{getExcerpt(post.content)}</p>
        <footer className="post-meta">
          <time dateTime={post.published_at || post.created_at}>{formattedDate}</time>
          {tags.length > 0 && (
            <div className="tags">
              {tags.map((tag) => (
                <Link 
                  key={tag} 
                  to={`/tags/${encodeURIComponent(tag)}`} 
                  className="tag"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </footer>
      </div>
    </article>
  );
}

// Category Page - Shows posts filtered by category
function CategoryPage() {
  const { name } = useParams<{ name: string }>();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const categoryName = name ? decodeURIComponent(name) : '';

  useEffect(() => {
    const fetchPosts = async () => {
      if (!categoryName) return;
      setLoading(true);
      try {
        const response = await api.getPosts(page, 10, categoryName);
        setData(response);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [categoryName, page]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading posts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <Link to="/" className="back-link">← Back to Home</Link>
      </div>
    );
  }

  return (
    <div className="filter-page">
      <nav className="breadcrumb">
        <Link to="/">← Back to all posts</Link>
      </nav>

      <header className="filter-header">
        <span className="filter-type">Category</span>
        <h1>{categoryName}</h1>
        <p className="filter-count">
          {data?.pagination.total || 0} {data?.pagination.total === 1 ? 'post' : 'posts'}
        </p>
      </header>

      <main className="posts-container">
        {data?.posts.length === 0 ? (
          <div className="empty-state">
            <h2>No posts found</h2>
            <p>There are no posts in this category yet.</p>
          </div>
        ) : (
          <div className="posts-grid">
            {data?.posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}

        {data && data.pagination.totalPages > 1 && (
          <Pagination 
            pagination={data.pagination} 
            onPageChange={setPage} 
          />
        )}
      </main>
    </div>
  );
}

// Tags Page - Shows posts filtered by tag
function TagsPage() {
  const { name } = useParams<{ name: string }>();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const tagName = name ? decodeURIComponent(name) : '';

  useEffect(() => {
    const fetchPosts = async () => {
      if (!tagName) return;
      setLoading(true);
      try {
        const response = await api.getPosts(page, 10, undefined, tagName);
        setData(response);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load posts');
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [tagName, page]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading posts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <Link to="/" className="back-link">← Back to Home</Link>
      </div>
    );
  }

  return (
    <div className="filter-page">
      <nav className="breadcrumb">
        <Link to="/">← Back to all posts</Link>
      </nav>

      <header className="filter-header">
        <span className="filter-type">Tag</span>
        <h1>#{tagName}</h1>
        <p className="filter-count">
          {data?.pagination.total || 0} {data?.pagination.total === 1 ? 'post' : 'posts'}
        </p>
      </header>

      <main className="posts-container">
        {data?.posts.length === 0 ? (
          <div className="empty-state">
            <h2>No posts found</h2>
            <p>There are no posts with this tag yet.</p>
          </div>
        ) : (
          <div className="posts-grid">
            {data?.posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}

        {data && data.pagination.totalPages > 1 && (
          <Pagination 
            pagination={data.pagination} 
            onPageChange={setPage} 
          />
        )}
      </main>
    </div>
  );
}

// Single Post Page
function PostPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPost = async () => {
      if (!slug) return;
      setLoading(true);
      try {
        const response = await api.getPost(slug);
        setPost(response);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load post');
      } finally {
        setLoading(false);
      }
    };
    fetchPost();
  }, [slug]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading post...</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="error-container">
        <h2>Post Not Found</h2>
        <p>{error || 'The post you are looking for does not exist.'}</p>
        <Link to="/" className="back-link">← Back to Home</Link>
      </div>
    );
  }

  const formattedDate = new Date(post.published_at || post.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const tags = post.tags?.split(',').map((t) => t.trim()).filter(Boolean) || [];
  const image = post.cover_image_url || post.image_url;

  return (
    <div className="post-page">
      <nav className="breadcrumb">
        <Link to="/">← Back to all posts</Link>
      </nav>

      <article className="post-full">
        {image && (
          <div className="post-hero-image">
            <img src={image} alt={post.cover_alt || post.title} width={1200} height={630} />
          </div>
        )}

        <header className="post-header">
          {post.category && (
            <Link 
              to={`/category/${encodeURIComponent(post.category)}`} 
              className="category-badge"
            >
              {post.category}
            </Link>
          )}
          <h1>{post.title}</h1>
          <div className="post-meta">
            <time dateTime={post.published_at || post.created_at}>{formattedDate}</time>
            {tags.length > 0 && (
              <div className="tags">
                {tags.map((tag) => (
                  <Link 
                    key={tag} 
                    to={`/tags/${encodeURIComponent(tag)}`} 
                    className="tag"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </header>

        <div 
          className="post-body prose"
          dangerouslySetInnerHTML={{ __html: parseMarkdown(post.content) }}
        />
      </article>
    </div>
  );
}

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/blog/:slug" element={<PostPage />} />
        <Route path="/posts/:slug" element={<PostPage />} />
        <Route path="/category/:name" element={<CategoryPage />} />
        <Route path="/tags/:name" element={<TagsPage />} />
        <Route path="/adminauthor" element={<AdminPage />} />
      </Routes>
    </div>
  );
}

export default App;

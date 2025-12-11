import { useState, useEffect, useRef } from 'react';
import { api } from './api';
import type { Post, CreatePostInput } from './types';
import { parseMarkdown, markdownHelp } from './markdown';
import './admin.css';

// Admin authentication API
const adminApi = {
  login: async (password: string): Promise<{ success: boolean }> => {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Login failed');
    }
    return res.json();
  },

  logout: async (): Promise<void> => {
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'include',
    });
  },

  verify: async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/verify', { credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      return data.authenticated;
    } catch {
      return false;
    }
  },

  importCSV: async (file: File): Promise<{ success: boolean; stats: { total: number; processed: number } }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/posts/import', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Import failed');
    }
    return res.json();
  },
};

// Login Form Component
function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await adminApi.login(password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <div className="login-card">
        <div className="login-header">
          <h1>Admin Panel</h1>
          <p>Enter your password to access the admin panel</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              autoFocus
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="login-footer">
          <a href="/">← Back to Blog</a>
        </div>
      </div>
    </div>
  );
}

// Generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

// Post Form Component with Markdown Editor
function PostForm({ 
  onSuccess, 
  editPost,
  onCancel 
}: { 
  onSuccess: () => void; 
  editPost?: Post | null;
  onCancel?: () => void;
}) {
  const [formData, setFormData] = useState<CreatePostInput>({
    slug: editPost?.slug || '',
    title: editPost?.title || '',
    content: editPost?.content || '',
    tags: editPost?.tags || '',
    category: editPost?.category || '',
    image_url: editPost?.image_url || '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoSlug, setAutoSlug] = useState(!editPost);
  const [showPreview, setShowPreview] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleTitleChange = (title: string) => {
    setFormData(prev => ({
      ...prev,
      title,
      slug: autoSlug ? generateSlug(title) : prev.slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (editPost) {
        await api.updatePost(editPost.slug, formData);
      } else {
        await api.createPost(formData);
      }
      onSuccess();
      if (!editPost) {
        setFormData({ slug: '', title: '', content: '', tags: '', category: '', image_url: '' });
        setShowPreview(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save post');
    } finally {
      setLoading(false);
    }
  };

  // Insert markdown syntax at cursor position
  const insertMarkdown = (syntax: string, wrap = false) => {
    const textarea = document.getElementById('content') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = formData.content;
    const selectedText = text.substring(start, end);

    let newText: string;
    let newCursorPos: number;

    if (wrap && selectedText) {
      newText = text.substring(0, start) + syntax + selectedText + syntax + text.substring(end);
      newCursorPos = end + syntax.length * 2;
    } else {
      newText = text.substring(0, start) + syntax + text.substring(end);
      newCursorPos = start + syntax.length;
    }

    setFormData(prev => ({ ...prev, content: newText }));
    
    // Restore focus and cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  return (
    <form onSubmit={handleSubmit} className="post-form">
      {error && <div className="error-message">{error}</div>}

      <div className="form-row">
        <div className="form-group flex-2">
          <label htmlFor="title">Title *</label>
          <input
            type="text"
            id="title"
            value={formData.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Post title"
            required
          />
        </div>

        <div className="form-group flex-1">
          <label htmlFor="category">Category</label>
          <input
            type="text"
            id="category"
            value={formData.category}
            onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
            placeholder="e.g., Technology"
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="slug">
          Slug *
          {!editPost && (
            <button 
              type="button" 
              className="btn-link"
              onClick={() => setAutoSlug(!autoSlug)}
            >
              {autoSlug ? '(auto)' : '(manual)'}
            </button>
          )}
        </label>
        <input
          type="text"
          id="slug"
          value={formData.slug}
          onChange={(e) => {
            setAutoSlug(false);
            setFormData(prev => ({ ...prev, slug: e.target.value }));
          }}
          placeholder="post-url-slug"
          required
        />
      </div>

      {/* Markdown Editor */}
      <div className="form-group markdown-editor">
        <div className="editor-header">
          <label htmlFor="content">Content * (Markdown supported)</label>
          <div className="editor-tabs">
            <button 
              type="button" 
              className={`tab ${!showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(false)}
            >
              ✏️ Write
            </button>
            <button 
              type="button" 
              className={`tab ${showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(true)}
            >
              👁️ Preview
            </button>
            <button 
              type="button" 
              className="tab help-btn"
              onClick={() => setShowHelp(!showHelp)}
              title="Markdown Help"
            >
              ❓
            </button>
          </div>
        </div>

        {/* Markdown Toolbar */}
        {!showPreview && (
          <div className="markdown-toolbar">
            <button type="button" onClick={() => insertMarkdown('**', true)} title="Bold">
              <strong>B</strong>
            </button>
            <button type="button" onClick={() => insertMarkdown('*', true)} title="Italic">
              <em>I</em>
            </button>
            <button type="button" onClick={() => insertMarkdown('~~', true)} title="Strikethrough">
              <s>S</s>
            </button>
            <span className="divider" />
            <button type="button" onClick={() => insertMarkdown('# ')} title="Heading 1">
              H1
            </button>
            <button type="button" onClick={() => insertMarkdown('## ')} title="Heading 2">
              H2
            </button>
            <button type="button" onClick={() => insertMarkdown('### ')} title="Heading 3">
              H3
            </button>
            <span className="divider" />
            <button type="button" onClick={() => insertMarkdown('- ')} title="Bullet List">
              •
            </button>
            <button type="button" onClick={() => insertMarkdown('1. ')} title="Numbered List">
              1.
            </button>
            <button type="button" onClick={() => insertMarkdown('> ')} title="Quote">
              "
            </button>
            <span className="divider" />
            <button type="button" onClick={() => insertMarkdown('`', true)} title="Inline Code">
              {'</>'}
            </button>
            <button type="button" onClick={() => insertMarkdown('\n```\n\n```\n')} title="Code Block">
              {'{ }'}
            </button>
            <button type="button" onClick={() => insertMarkdown('[text](url)')} title="Link">
              🔗
            </button>
            <button type="button" onClick={() => insertMarkdown('![alt](url)')} title="Image">
              🖼️
            </button>
            <button type="button" onClick={() => insertMarkdown('\n---\n')} title="Horizontal Rule">
              —
            </button>
          </div>
        )}

        {/* Help Panel */}
        {showHelp && (
          <div className="markdown-help">
            <pre>{markdownHelp}</pre>
          </div>
        )}

        {/* Editor / Preview */}
        {showPreview ? (
          <div 
            className="markdown-preview prose"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(formData.content) || '<p class="empty">Nothing to preview</p>' }}
          />
        ) : (
          <textarea
            id="content"
            value={formData.content}
            onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
            placeholder="Write your post content using Markdown..."
            rows={15}
            required
          />
        )}
      </div>

      <div className="form-row">
        <div className="form-group flex-1">
          <label htmlFor="tags">Tags</label>
          <input
            type="text"
            id="tags"
            value={formData.tags}
            onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
            placeholder="tag1, tag2, tag3"
          />
        </div>

        <div className="form-group flex-1">
          <label htmlFor="image_url">Image URL</label>
          <input
            type="url"
            id="image_url"
            value={formData.image_url}
            onChange={(e) => setFormData(prev => ({ ...prev, image_url: e.target.value }))}
            placeholder="https://example.com/image.jpg"
          />
        </div>
      </div>

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Saving...' : editPost ? 'Update Post' : 'Create Post'}
        </button>
      </div>
    </form>
  );
}

// CSV Import Component
function CSVImport({ onSuccess }: { onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!file) return;
    
    setLoading(true);
    setResult(null);

    try {
      const data = await adminApi.importCSV(file);
      setResult({
        success: true,
        message: `Successfully imported ${data.stats.processed} of ${data.stats.total} posts`,
      });
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onSuccess();
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Import failed',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="csv-import">
      <h3>Import from CSV</h3>
      <p className="help-text">
        Upload a CSV file with columns: slug, title, content, tags, category, image_url
      </p>
      
      <div className="import-controls">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="file-input"
        />
        <button 
          onClick={handleImport} 
          disabled={!file || loading}
          className="btn-primary"
        >
          {loading ? 'Importing...' : 'Import'}
        </button>
      </div>

      {result && (
        <div className={`import-result ${result.success ? 'success' : 'error'}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

// Posts List Component
function PostsList({ 
  posts, 
  onEdit, 
  onRefresh 
}: { 
  posts: Post[];
  onEdit: (post: Post) => void;
  onRefresh: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (slug: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    
    setDeleting(slug);
    try {
      await api.deletePost(slug);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  if (posts.length === 0) {
    return (
      <div className="empty-posts">
        <p>No posts yet. Create your first post or import from CSV.</p>
      </div>
    );
  }

  return (
    <div className="posts-list">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <a href={`/posts/${post.slug}`} target="_blank" rel="noopener noreferrer">
                  {post.title}
                </a>
              </td>
              <td>{post.category || '—'}</td>
              <td>{new Date(post.created_at).toLocaleDateString()}</td>
              <td className="actions">
                <button 
                  className="btn-icon" 
                  onClick={() => onEdit(post)}
                  title="Edit"
                >
                  ✏️
                </button>
                <button 
                  className="btn-icon btn-danger" 
                  onClick={() => handleDelete(post.slug)}
                  disabled={deleting === post.slug}
                  title="Delete"
                >
                  {deleting === post.slug ? '...' : '🗑️'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Main Admin Dashboard
function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'posts' | 'create' | 'import'>('posts');
  const [editingPost, setEditingPost] = useState<Post | null>(null);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const data = await api.getPosts(1, 100);
      setPosts(data.posts);
    } catch (err) {
      console.error('Failed to fetch posts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  const handlePostSuccess = () => {
    fetchPosts();
    setActiveTab('posts');
    setEditingPost(null);
  };

  const handleEdit = (post: Post) => {
    setEditingPost(post);
    setActiveTab('create');
  };

  const handleLogout = async () => {
    await adminApi.logout();
    onLogout();
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <div className="header-left">
          <h1>Admin Panel</h1>
          <a href="/" className="view-blog">View Blog →</a>
        </div>
        <button onClick={handleLogout} className="btn-logout">
          Logout
        </button>
      </header>

      <nav className="admin-nav">
        <button 
          className={activeTab === 'posts' ? 'active' : ''} 
          onClick={() => { setActiveTab('posts'); setEditingPost(null); }}
        >
          📝 All Posts
        </button>
        <button 
          className={activeTab === 'create' ? 'active' : ''} 
          onClick={() => { setActiveTab('create'); setEditingPost(null); }}
        >
          ➕ {editingPost ? 'Edit Post' : 'New Post'}
        </button>
        <button 
          className={activeTab === 'import' ? 'active' : ''} 
          onClick={() => setActiveTab('import')}
        >
          📤 Import/Export
        </button>
      </nav>

      <main className="admin-content">
        {activeTab === 'posts' && (
          <div className="tab-content">
            <div className="tab-header">
              <h2>All Posts ({posts.length})</h2>
              <button onClick={fetchPosts} className="btn-secondary" disabled={loading}>
                {loading ? 'Loading...' : '🔄 Refresh'}
              </button>
            </div>
            {loading ? (
              <div className="loading">Loading posts...</div>
            ) : (
              <PostsList 
                posts={posts} 
                onEdit={handleEdit}
                onRefresh={fetchPosts}
              />
            )}
          </div>
        )}

        {activeTab === 'create' && (
          <div className="tab-content">
            <h2>{editingPost ? `Edit: ${editingPost.title}` : 'Create New Post'}</h2>
            <PostForm 
              onSuccess={handlePostSuccess}
              editPost={editingPost}
              onCancel={editingPost ? () => { setEditingPost(null); setActiveTab('posts'); } : undefined}
            />
          </div>
        )}

        {activeTab === 'import' && (
          <div className="tab-content">
            <h2>Import & Export</h2>
            
            <div className="import-export-section">
              <CSVImport onSuccess={fetchPosts} />
            </div>

            <div className="import-export-section">
              <h3>Export to CSV</h3>
              <p className="help-text">
                Download all posts as a CSV file for backup or migration.
              </p>
              <a 
                href={api.getExportUrl()} 
                download="posts-export.csv"
                className="btn-primary"
              >
                📥 Download CSV
              </a>
            </div>

            <div className="import-export-section">
              <h3>CSV Format</h3>
              <pre className="csv-example">
{`slug,title,content,tags,category,image_url
my-post,My Post Title,"Post content here",tag1,Category,https://...`}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Main Admin Page Component
export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    adminApi.verify().then(setAuthenticated);
  }, []);

  if (authenticated === null) {
    return (
      <div className="admin-loading">
        <div className="loading-spinner"></div>
        <p>Checking authentication...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm onLogin={() => setAuthenticated(true)} />;
  }

  return <AdminDashboard onLogout={() => setAuthenticated(false)} />;
}


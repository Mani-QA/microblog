import {
  DEFAULT_AUTHOR,
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  absoluteUrl,
  escapeHtml,
  formatDate,
  oneLine,
  readingMinutes,
  siteUrl,
  toIso,
} from './http';
import { renderMarkdown } from './markdown';
import { coverSource, isDraft, publicExcerpt, type PostRow } from './posts';

const CSS = `
:root {
  color-scheme: light;
  --bg: #f6f4f1;
  --text: #1c1917;
  --muted: #57534e;
  --faint: #6f6a64;
  --line: #e4e0da;
  --code: #efeae3;
  --focus: #1c1917;
  --accent: #9a3412;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #141311;
  --text: #f5f2eb;
  --muted: #c8c2b8;
  --faint: #a8a29e;
  --line: #2c2926;
  --code: #221f1c;
  --focus: #f5f2eb;
  --accent: #fdba74;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #141311;
    --text: #f5f2eb;
    --muted: #c8c2b8;
    --faint: #a8a29e;
    --line: #2c2926;
    --code: #221f1c;
    --focus: #f5f2eb;
    --accent: #fdba74;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--serif);
  font-size: 1.125rem;
  line-height: 1.7;
  text-rendering: optimizeLegibility;
}
.skip-link {
  position: absolute;
  left: 0.75rem;
  top: -4rem;
  background: var(--text);
  color: var(--bg);
  padding: 0.5rem 0.8rem;
  z-index: 10;
  font-family: var(--sans);
  font-size: 0.9rem;
}
.skip-link:focus { top: 0.75rem; }
.wrap {
  width: min(68ch, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 2.75rem 0 4.5rem;
}
a { color: inherit; }
a:hover { color: var(--accent); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.site-header { margin-bottom: 2.75rem; }
.wordmark, .wordmark a {
  font-size: clamp(2rem, 4vw, 2.6rem);
  line-height: 1.1;
  letter-spacing: -0.03em;
  text-decoration: none;
  font-weight: 500;
  color: inherit;
}
h1.wordmark { margin: 0; }
.domain, .meta, nav, time, footer, .theme-toggle, .pager, .kicker {
  font-family: var(--sans);
}
.domain { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.92rem; }
.nav-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem 1.1rem;
  margin-top: 1.1rem;
}
nav { display: flex; gap: 1rem; }
nav a { font-size: 0.92rem; text-underline-offset: 0.18em; }
.theme-toggle {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 0.92rem;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.18em;
}
.theme-toggle:hover { color: var(--accent); }
h1 { font-size: clamp(2rem, 5vw, 2.75rem); line-height: 1.15; letter-spacing: -0.03em; font-weight: 500; margin: 0 0 0.75rem; }
.lede { margin: 0 0 2.25rem; color: var(--muted); font-size: 1.15rem; }
.post-list { list-style: none; margin: 0; padding: 0; }
.post-row { padding: 1.45rem 0; border-top: 1px solid var(--line); }
.post-row a.title { text-decoration: none; }
.post-row h2 { font-size: 1.45rem; line-height: 1.25; font-weight: 500; letter-spacing: -0.02em; margin: 0.2rem 0 0.45rem; }
.post-row h2 a:hover { text-decoration: underline; text-underline-offset: 0.12em; }
.row-main { min-width: 0; }
.thumb { display: block; margin-bottom: 0.8rem; }
.thumb img, .cover img { display: block; width: 100%; height: auto; object-fit: cover; background: var(--line); }
.thumb img { aspect-ratio: 16 / 10; border-radius: 2px; }
.cover { margin: 0 0 1.5rem; }
.cover img { aspect-ratio: 1200 / 630; }
.excerpt, .meta { color: var(--muted); }
.excerpt { margin: 0; font-size: 1.05rem; }
.meta { display: flex; flex-wrap: wrap; gap: 0.45rem 0.8rem; font-size: 0.85rem; letter-spacing: 0.01em; }
.kicker { margin: 0 0 0.8rem; color: var(--faint); font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; }
.tags { display: flex; flex-wrap: wrap; gap: 0.55rem; }
.tags a { color: var(--muted); text-decoration: none; font-size: 0.85rem; }
.tags a:hover { color: var(--accent); }
.prose { font-size: 1.125rem; line-height: 1.75; }
.prose > :first-child { margin-top: 0; }
.prose h2, .prose h3, .prose h4 { line-height: 1.25; letter-spacing: -0.02em; font-weight: 500; margin: 2rem 0 0.6rem; }
.prose h2 { font-size: 1.55rem; }
.prose h3 { font-size: 1.28rem; }
.prose p, .prose ul, .prose ol, .prose blockquote, .prose pre, .prose table { margin: 0 0 1.1rem; }
.prose ul, .prose ol { padding-left: 1.3rem; }
.prose a { text-underline-offset: 0.15em; }
.prose blockquote { margin-left: 0; padding-left: 1rem; border-left: 2px solid var(--line); color: var(--muted); }
.prose code { font-family: var(--mono); font-size: 0.86em; background: var(--code); padding: 0.1em 0.35em; border-radius: 3px; }
.prose pre { overflow-x: auto; padding: 0.95rem 1rem; background: var(--code); border-radius: 4px; }
.prose pre code { background: transparent; padding: 0; font-size: 0.86rem; }
.prose img { max-width: 100%; height: auto; }
.prose hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
.prose table { width: 100%; border-collapse: collapse; font-size: 0.98rem; }
.prose th, .prose td { border-bottom: 1px solid var(--line); text-align: left; padding: 0.4rem 0.5rem 0.4rem 0; vertical-align: top; }
.pager { display: flex; justify-content: space-between; gap: 1rem; margin-top: 1rem; font-size: 0.92rem; }
.pager a { text-underline-offset: 0.15em; }
.back { font-family: var(--sans); font-size: 0.92rem; }
footer { margin-top: 3.5rem; padding-top: 1.2rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.88rem; display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; }
.empty { color: var(--muted); }
@media (min-width: 720px) {
  .post-row.has-thumb { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 1.2rem; align-items: start; }
  .post-row.has-thumb .thumb { margin: 0.35rem 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
}
`.trim();

const THEME_BOOT = `(function(){try{var k='theme',s=localStorage.getItem(k);var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

const THEME_TOGGLE = `(function(){var b=document.getElementById('theme-toggle');if(!b)return;function paint(){var dark=document.documentElement.dataset.theme==='dark';b.textContent=dark?'Light':'Dark';b.setAttribute('aria-pressed',dark?'true':'false');b.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');}paint();b.addEventListener('click',function(){var next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('theme',next);}catch(e){}paint();});})();`;

interface DocumentOptions {
  env: Env;
  title: string;
  description: string;
  canonical?: string | null;
  robots: string;
  type: 'website' | 'article';
  image: string;
  imageAlt: string;
  published?: string | null;
  modified?: string | null;
  jsonLd?: unknown;
  body: string;
  nonce: string;
  home?: boolean;
}

function meta(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}">`;
}

function property(name: string, content: string): string {
  return `<meta property="${name}" content="${escapeHtml(content)}">`;
}

export function documentPage(options: DocumentOptions): string {
  const base = siteUrl(options.env);
  const json = options.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(options.jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';
  const canonical = options.canonical ? `<link rel="canonical" href="${escapeHtml(options.canonical)}">` : '';
  const published = options.published ? property('article:published_time', options.published) : '';
  const modified = options.modified ? property('article:modified_time', options.modified) : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script nonce="${options.nonce}">${THEME_BOOT}</script>
<title>${escapeHtml(options.title)}</title>
${meta('description', options.description)}
${meta('author', DEFAULT_AUTHOR)}
${meta('robots', options.robots)}
${canonical}
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)}" href="${base}/rss.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f4f1">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141311">
${property('og:site_name', SITE_NAME)}
${property('og:title', options.title)}
${property('og:description', options.description)}
${property('og:type', options.type)}
${options.canonical ? property('og:url', options.canonical) : ''}
${property('og:image', options.image)}
${property('og:image:alt', options.imageAlt)}
${published}
${modified}
${meta('twitter:card', 'summary_large_image')}
${meta('twitter:title', options.title)}
${meta('twitter:description', options.description)}
${meta('twitter:image', options.image)}
${meta('twitter:image:alt', options.imageAlt)}
${json}
<style>${CSS}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="wrap">
<header class="site-header">
${options.home ? `<h1 class="wordmark"><a href="/">${SITE_NAME}</a></h1>` : `<a class="wordmark" href="/">${SITE_NAME}</a>`}
<p class="domain">blog.manig.dev</p>
<div class="nav-row">
<nav aria-label="Site">
<a href="/">Writing</a>
<a href="/rss.xml">RSS</a>
<a href="/sitemap.xml">Sitemap</a>
</nav>
<button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false">Dark</button>
</div>
</header>
${options.body}
<footer>
<span>${escapeHtml(DEFAULT_AUTHOR)}</span>
<a href="/rss.xml">RSS</a>
<a href="/sitemap.xml">Sitemap</a>
<a href="/adminauthor">Admin</a>
</footer>
</div>
<script nonce="${options.nonce}">${THEME_TOGGLE}</script>
</body>
</html>`;
}

export function htmlResponse(html: string, status = 200): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const rendered = html.replaceAll('__NONCE__', nonce);
  return new Response(rendered, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': [
        "default-src 'self'",
        `script-src 'nonce-${nonce}'`,
        "style-src 'unsafe-inline'",
        "img-src 'self' https: data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; '),
    },
  });
}

function shell(env: Env, options: Omit<DocumentOptions, 'env' | 'nonce'>): Response {
  const status = options.robots.includes('noindex') && !options.canonical ? 404 : 200;
  return htmlResponse(documentPage({ ...options, env, nonce: '__NONCE__' }), status);
}

function defaultImage(env: Env): string {
  return `${siteUrl(env)}/og-default.png`;
}

/** Root-relative covers stay on the current host. Open Graph still uses an absolute URL. */
function pageImageSrc(base: string, stored: string | null): string | null {
  if (!stored) return null;
  if (stored.startsWith('/')) return stored;
  return absoluteUrl(base, stored);
}

function postImage(env: Env, post: PostRow): { url: string; alt: string } {
  const base = siteUrl(env);
  const cover = absoluteUrl(base, coverSource(post));
  if (cover) return { url: cover, alt: post.cover_alt?.trim() || post.title };
  return { url: defaultImage(env), alt: SITE_NAME };
}

function tagsHtml(tags: string | null): string {
  const list = tags?.split(',').map((tag) => tag.trim()).filter(Boolean) ?? [];
  if (!list.length) return '';
  return `<div class="tags">${list.map((tag) => `<a href="/tags/${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`).join('')}</div>`;
}

function rowHtml(env: Env, post: PostRow): string {
  const base = siteUrl(env);
  const when = post.published_at || post.created_at;
  const cover = pageImageSrc(base, coverSource(post));
  const thumb = cover
    ? `<a class="thumb" href="/blog/${encodeURIComponent(post.slug)}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(cover)}" alt="" width="320" height="200" loading="lazy" decoding="async"></a>`
    : '';
  return `<li class="post-row${thumb ? ' has-thumb' : ''}">
${thumb}
<div class="row-main">
<p class="meta"><time datetime="${escapeHtml(toIso(when) || '')}">${escapeHtml(formatDate(when))}</time></p>
<h2><a class="title" href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
<p class="excerpt">${escapeHtml(oneLine(publicExcerpt(post)))}</p>
</div>
</li>`;
}

export function renderHome(env: Env, posts: PostRow[], page: number, totalPages: number): Response {
  const base = siteUrl(env);
  const canonical = page > 1 ? `${base}/?page=${page}` : `${base}/`;
  const description = DEFAULT_DESCRIPTION;
  const list = posts.length
    ? `<ol class="post-list">${posts.map((post) => rowHtml(env, post)).join('')}</ol>`
    : '<p class="empty">No published posts yet.</p>';
  const newer = page > 1 ? `<a href="${page === 2 ? '/' : `/?page=${page - 1}`}" rel="prev">Newer</a>` : '<span></span>';
  const older = page < totalPages ? `<a href="/?page=${page + 1}" rel="next">Older</a>` : '<span></span>';
  const pager = totalPages > 1 ? `<nav class="pager" aria-label="Pagination">${newer}<span>Page ${page} of ${totalPages}</span>${older}</nav>` : '';
  const body = `<main id="main">
<p class="lede">${escapeHtml(description)}</p>
${list}
${pager}
</main>`;
  return shell(env, {
    title: page > 1 ? `${SITE_NAME} · page ${page}` : SITE_NAME,
    description,
    canonical,
    robots: 'index,follow',
    type: 'website',
    image: defaultImage(env),
    imageAlt: SITE_NAME,
    home: true,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: SITE_NAME,
      description,
      url: `${base}/`,
      author: { '@type': 'Person', name: DEFAULT_AUTHOR },
    },
    body,
  });
}

export function renderFilter(env: Env, kind: 'Category' | 'Tag', name: string, posts: PostRow[], page: number, totalPages: number): Response {
  const base = siteUrl(env);
  const path = kind === 'Category' ? `/category/${encodeURIComponent(name)}` : `/tags/${encodeURIComponent(name)}`;
  const canonical = page > 1 ? `${base}${path}?page=${page}` : `${base}${path}`;
  const heading = kind === 'Tag' ? `#${name}` : name;
  const description = `${kind === 'Tag' ? 'Posts tagged' : 'Posts in'} ${name}.`;
  const list = posts.length
    ? `<ol class="post-list">${posts.map((post) => rowHtml(env, post)).join('')}</ol>`
    : '<p class="empty">No published posts here.</p>';
  const newer = page > 1 ? `<a href="${page === 2 ? path : `${path}?page=${page - 1}`}" rel="prev">Newer</a>` : '<span></span>';
  const older = page < totalPages ? `<a href="${path}?page=${page + 1}" rel="next">Older</a>` : '<span></span>';
  const pager = totalPages > 1 ? `<nav class="pager" aria-label="Pagination">${newer}<span>Page ${page} of ${totalPages}</span>${older}</nav>` : '';
  const body = `<main id="main">
<p class="back"><a href="/">← All writing</a></p>
<p class="kicker">${kind}</p>
<h1>${escapeHtml(heading)}</h1>
${list}
${pager}
</main>`;
  return shell(env, {
    title: `${heading} · ${SITE_NAME}`,
    description,
    canonical,
    robots: 'index,follow',
    type: 'website',
    image: defaultImage(env),
    imageAlt: SITE_NAME,
    body,
  });
}

export function renderPost(env: Env, post: PostRow): Response {
  if (isDraft(post)) return renderNotFound(env);
  const base = siteUrl(env);
  const canonical = `${base}/blog/${post.slug}`;
  const description = oneLine(publicExcerpt(post)) || DEFAULT_DESCRIPTION;
  const image = postImage(env, post);
  const when = post.published_at || post.created_at;
  const published = toIso(when);
  const modified = toIso(post.updated_at) || published;
  const author = post.author?.trim() || DEFAULT_AUTHOR;
  const category = post.category
    ? `<a href="/category/${encodeURIComponent(post.category)}">${escapeHtml(post.category)}</a>`
    : '';
  const cover = pageImageSrc(base, coverSource(post));
  const figure = cover
    ? `<figure class="cover"><img src="${escapeHtml(cover)}" alt="${escapeHtml(image.alt)}" width="1200" height="630" decoding="async" fetchpriority="high"></figure>`
    : '';
  const minutes = readingMinutes(post.content);
  const body = `<main id="main">
<p class="back"><a href="/">← All writing</a></p>
<article>
<header>
${post.category ? `<p class="kicker">${category}</p>` : ''}
<h1>${escapeHtml(post.title)}</h1>
<p class="meta">
<time datetime="${escapeHtml(published || '')}">${escapeHtml(formatDate(when))}</time>
<span>${escapeHtml(author)}</span>
<span>${minutes} min read</span>
</p>
${tagsHtml(post.tags)}
</header>
${figure}
<div class="prose">${renderMarkdown(post.content)}</div>
</article>
</main>`;
  return shell(env, {
    title: `${post.title} · ${SITE_NAME}`,
    description,
    canonical,
    robots: 'index,follow',
    type: 'article',
    image: image.url,
    imageAlt: image.alt,
    published,
    modified,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description,
      image: image.url,
      datePublished: published,
      dateModified: modified,
      author: { '@type': 'Person', name: author },
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      publisher: { '@type': 'Person', name: DEFAULT_AUTHOR },
    },
    body,
  });
}

export function renderNotFound(env: Env): Response {
  const body = `<main id="main">
<h1>Not found</h1>
<p class="lede">That page is not on this blog.</p>
<p class="back"><a href="/">← All writing</a></p>
</main>`;
  return shell(env, {
    title: `Not found · ${SITE_NAME}`,
    description: 'That page is not on this blog.',
    canonical: null,
    robots: 'noindex',
    type: 'website',
    image: defaultImage(env),
    imageAlt: SITE_NAME,
    body,
  });
}

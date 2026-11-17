import { DEFAULT_AUTHOR, DEFAULT_DESCRIPTION, SITE_NAME, escapeXml, siteUrl, toIso } from './http';
import { publicExcerpt, type PostRow } from './posts';

function lastModified(post: PostRow): string | null {
  return toIso(post.updated_at) || toIso(post.published_at) || toIso(post.created_at);
}

export function sitemapXml(env: Env, posts: PostRow[]): string {
  const base = siteUrl(env);
  const latest = posts.reduce<string | null>((current, post) => {
    const value = lastModified(post);
    if (!value) return current;
    if (!current || value > current) return value;
    return current;
  }, null);
  const home = latest ? `<lastmod>${escapeXml(latest)}</lastmod>` : '';
  const urls = posts.map((post) => {
    const modified = lastModified(post);
    return `<url><loc>${escapeXml(`${base}/blog/${post.slug}`)}</loc>${modified ? `<lastmod>${escapeXml(modified)}</lastmod>` : ''}</url>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${escapeXml(`${base}/`)}</loc>${home}</url>
${urls}

</urlset>`;
}

export function robotsTxt(env: Env): string {
  const base = siteUrl(env);
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api

Sitemap: ${base}/sitemap.xml
`;
}

export function rssXml(env: Env, posts: PostRow[]): string {
  const base = siteUrl(env);
  const items = posts.map((post) => {
    const link = `${base}/blog/${post.slug}`;
    const when = toIso(post.published_at) || toIso(post.created_at);
    const pubDate = when ? new Date(when).toUTCString() : '';
    const description = escapeXml(publicExcerpt(post));
    return `<item>
<title>${escapeXml(post.title)}</title>
<link>${escapeXml(link)}</link>
<guid isPermaLink="true">${escapeXml(link)}</guid>
${pubDate ? `<pubDate>${escapeXml(pubDate)}</pubDate>` : ''}
<description>${description}</description>
</item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(SITE_NAME)}</title>
<link>${escapeXml(`${base}/`)}</link>
<description>${escapeXml(DEFAULT_DESCRIPTION)}</description>
<language>en</language>
<managingEditor>${escapeXml(DEFAULT_AUTHOR)}</managingEditor>
${items}
</channel>
</rss>`;
}

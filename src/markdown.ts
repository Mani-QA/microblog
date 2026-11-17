import { Marked, Renderer } from 'marked';
import { escapeHtml } from './http';

function safeUrl(href: string | null | undefined, kind: 'link' | 'image'): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (kind === 'link' && trimmed.startsWith('#') && !trimmed.includes(':')) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.toLowerCase().includes('javascript:')) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    if (protocol === 'https:' || protocol === 'http:') return url.href;
    if (kind === 'link' && protocol === 'mailto:') return url.href;
  } catch {
    return null;
  }
  return null;
}

function stripDangerous(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

const renderer = new Renderer();

renderer.html = () => '';

renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const url = safeUrl(href, 'link');
  if (!url) return text;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(url)}"${titleAttr} rel="noopener noreferrer">${text}</a>`;
};

renderer.image = function ({ href, title, text }) {
  const url = safeUrl(href, 'image');
  if (!url) return '';
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const alt = escapeHtml(text || '');
  return `<img src="${escapeHtml(url)}" alt="${alt}"${titleAttr} loading="lazy" decoding="async">`;
};

const parser = new Marked({
  gfm: true,
  breaks: false,
  renderer,
});

export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';
  const raw = parser.parse(markdown, { async: false }) as string;
  return stripDangerous(raw);
}

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked options
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

/**
 * Parse markdown to sanitized HTML
 * Uses DOMPurify to prevent XSS attacks
 */
export function parseMarkdown(markdown: string): string {
  if (!markdown) return '';
  
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  
  // Sanitize HTML to prevent XSS
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'strong', 'em', 'del', 's',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
  });
  
  return cleanHtml;
}

/**
 * Markdown syntax help text
 */
export const markdownHelp = `
**Bold** or __bold__
*Italic* or _italic_
~~Strikethrough~~

# Heading 1
## Heading 2
### Heading 3

- Bullet list
- Item 2

1. Numbered list
2. Item 2

> Blockquote

\`inline code\`

\`\`\`
code block
\`\`\`

[Link text](https://url.com)
![Alt text](image-url.jpg)

---
Horizontal rule
`.trim();


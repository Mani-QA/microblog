import { HttpError } from './http';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface StoredImage {
  key: string;
  path: string;
  contentType: string;
}

interface ImageKind {
  ext: 'png' | 'jpg' | 'gif' | 'webp';
  contentType: string;
}

export function detectImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) return null;
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return { ext: 'gif', contentType: 'image/gif' };
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export function decodeBase64Image(input: string): Uint8Array {
  let data = input.trim();
  const dataUrl = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(data);
  if (dataUrl) {
    if (!dataUrl[2]) {
      throw new HttpError('Cover image data URLs must be base64 encoded', 400);
    }
    data = dataUrl[3];
  }
  data = data.replace(/\s/g, '');
  if (!data) throw new HttpError('Cover image base64 is empty', 400);
  if (data.length > Math.ceil(MAX_IMAGE_BYTES * 1.4)) {
    throw new HttpError('Cover image exceeds the 5 MB limit', 413);
  }
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw new HttpError('Cover image base64 could not be decoded', 400);
  }
  if (binary.length > MAX_IMAGE_BYTES) {
    throw new HttpError('Cover image exceeds the 5 MB limit', 413);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === '0.0.0.0'
  ) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
    if (host.startsWith('::ffff:')) return isPrivateHost(host.slice('::ffff:'.length));
  }
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError('cover_image_url must be an absolute http(s) URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError('cover_image_url must use http or https', 400);
  }
  if (url.username || url.password) {
    throw new HttpError('cover_image_url must not include credentials', 400);
  }
  if (isPrivateHost(url.hostname)) {
    throw new HttpError('cover_image_url must be a public URL', 400);
  }
  return url;
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new HttpError('Cover image exceeds the 5 MB limit', 413);
  }
  if (!response.body) throw new HttpError('Cover image response was empty', 400);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new HttpError('Cover image exceeds the 5 MB limit', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchRemoteImage(rawUrl: string): Promise<Uint8Array> {
  let current = assertPublicHttpUrl(rawUrl);
  for (let hop = 0; hop < 3; hop++) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
      });
    } catch {
      throw new HttpError('Could not fetch cover image', 400);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new HttpError('Cover image redirect had no location', 400);
      current = assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new HttpError('Could not fetch cover image', 400);
    return readLimited(response);
  }
  throw new HttpError('Cover image redirected too many times', 400);
}

export async function storeImage(env: Env, bytes: Uint8Array): Promise<StoredImage> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError('Cover image exceeds the 5 MB limit', 413);
  }
  const kind = detectImage(bytes);
  if (!kind) {
    throw new HttpError('Cover image must be a PNG, JPEG, WebP, or GIF file', 400);
  }
  const key = `covers/${crypto.randomUUID()}.${kind.ext}`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType: kind.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  return { key, path: `/media/${key}`, contentType: kind.contentType };
}

export async function storeFile(env: Env, file: File): Promise<StoredImage> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new HttpError('Cover image exceeds the 5 MB limit', 413);
  }
  return storeImage(env, new Uint8Array(await file.arrayBuffer()));
}

export function mediaKeyFromStoredPath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const path = /^https?:\/\//i.test(stored) ? new URL(stored).pathname : stored;
    if (!path.startsWith('/media/')) return null;
    const key = decodeURIComponent(path.slice('/media/'.length));
    if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) return null;
    return key;
  } catch {
    return null;
  }
}

export async function deleteStoredImage(env: Env, stored: string | null | undefined): Promise<void> {
  const key = mediaKeyFromStoredPath(stored);
  if (!key) return;
  await env.MEDIA.delete(key);
}

const EXT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export async function serveMedia(env: Env, key: string): Promise<Response> {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const object = await env.MEDIA.get(key);
  if (!object) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const ext = key.split('.').pop()?.toLowerCase() || '';
  if (!headers.get('Content-Type')) {
    headers.set('Content-Type', EXT_TYPES[ext] || 'application/octet-stream');
  }
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

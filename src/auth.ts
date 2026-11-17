import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

type AuthContext = Context<{ Bindings: Env }>;

interface Session {
  expires: number;
}

// Sessions live with the isolate. A restart or a different isolate asks for
// the password again. The cookie is httpOnly and is not readable by page scripts.
const sessions = new Map<string, Session>();

function pruneSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires < now) sessions.delete(token);
  }
}

export async function timingSafeEqualString(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function hasValidBearer(c: AuthContext): Promise<boolean> {
  const header = c.req.header('Authorization');
  if (!header) return false;
  const token = bearerToken(header);
  const expected = c.env.BLOG_API_TOKEN;
  if (!token || !expected) return false;
  return timingSafeEqualString(token, expected);
}

export function hasValidSession(c: AuthContext): boolean {
  const token = getCookie(c, 'admin_session');
  if (!token) return false;
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export async function isPrivileged(c: AuthContext): Promise<boolean> {
  const header = c.req.header('Authorization');
  if (header) return hasValidBearer(c);
  return hasValidSession(c);
}

/** Public when anonymous. 401 when an Authorization header is present but wrong. */
export async function readAccess(c: AuthContext): Promise<'privileged' | 'public' | Response> {
  const header = c.req.header('Authorization');
  if (header) {
    if (!(await hasValidBearer(c))) return c.json({ error: 'Unauthorized' }, 401);
    return 'privileged';
  }
  if (hasValidSession(c)) return 'privileged';
  return 'public';
}

/**
 * Machine clients authenticate with Authorization: Bearer <BLOG_API_TOKEN>.
 * The admin UI authenticates with the session cookie when that header is absent.
 * A present but invalid Authorization header is rejected and does not fall through.
 */
export async function requireWriter(c: AuthContext): Promise<Response | null> {
  const header = c.req.header('Authorization');
  if (header) {
    const ok = await hasValidBearer(c);
    if (!ok) return c.json({ error: 'Unauthorized' }, 401);
    return null;
  }
  if (hasValidSession(c)) return null;
  return c.json({ error: 'Unauthorized' }, 401);
}

export async function login(c: AuthContext): Promise<Response> {
  let body: { password?: unknown };
  try {
    body = await c.req.json<{ password?: unknown }>();
  } catch {
    return c.json({ error: 'Password is required' }, 400);
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return c.json({ error: 'Password is required' }, 400);

  const expected = c.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error(JSON.stringify({ message: 'ADMIN_PASSWORD is not configured' }));
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const valid = await timingSafeEqualString(password, expected);
  if (!valid) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return c.json({ error: 'Invalid password' }, 401);
  }

  pruneSessions();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const sessionToken = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  sessions.set(sessionToken, { expires: Date.now() + 24 * 60 * 60 * 1000 });

  const isSecure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, 'admin_session', sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 24 * 60 * 60,
  });

  return c.json({ success: true, message: 'Login successful' });
}

export function logout(c: AuthContext): Response {
  const token = getCookie(c, 'admin_session');
  if (token) sessions.delete(token);
  deleteCookie(c, 'admin_session', { path: '/' });
  return c.json({ success: true, message: 'Logged out' });
}

export function verify(c: AuthContext): Response {
  if (!hasValidSession(c)) {
    deleteCookie(c, 'admin_session', { path: '/' });
    return c.json({ authenticated: false }, 401);
  }
  return c.json({ authenticated: true });
}

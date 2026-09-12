import crypto from 'crypto';

const SALT = process.env.OBSERVE_SALT || process.env.AUTH_SALT || process.env.NEXTAUTH_SECRET || 'observe-fallback-salt';

export function hashUserId(userId: string): string {
  if (!userId) return 'anon';
  return crypto.createHmac('sha256', SALT).update(userId).digest('hex').slice(0, 16);
}

function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // Redact signed URLs, R2 keys, tokens
  if (value.includes('X-Amz-Signature') || value.includes('signature=')) return '[REDACTED_SIGNED_URL]';
  if (value.startsWith('exports/') || value.startsWith('local/') || value.startsWith('recordings/')) {
    // Keep prefix + last segment hash
    const parts = value.split('/');
    return `${parts[0]}/[REDACTED]`;
  }
  if (value.length > 200) return `[TRUNCATED:${value.length}]`;
  return value;
}

export function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (['blob', 'video', 'base64', 'arrayBuffer', 'script', 'videoUrl', 'signedUrl', 'cookie', 'authorization', 'secret', 'password', 'token', 'signature', 'r2Secret', 'cashfreeSecret', 'jwt'].some(s => k.toLowerCase().includes(s))) {
      out[k] = '[REDACTED]';
    } else if (k === 'r2Key' || k === 'key') {
      out[k] = redactValue(v);
    } else if (typeof v === 'string' && v.includes('X-Amz-Signature')) {
      out[k] = '[REDACTED_SIGNED_URL]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, event: string, meta: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitizeMeta(meta),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, meta?: Record<string, unknown>) => log('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => log('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => log('error', event, meta),
};

export function getRequestId(request: Request): string {
  const headers: any = (request as any).headers;
  let incoming: string | null = null;
  if (headers && typeof headers.get === 'function') {
    incoming = headers.get('x-request-id') || headers.get('X-Request-Id') || null;
  } else if (headers) {
    incoming = headers['x-request-id'] || headers['X-Request-Id'] || null;
  }
  if (incoming && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(incoming)) {
    return incoming;
  }
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return id;
}

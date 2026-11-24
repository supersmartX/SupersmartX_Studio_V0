import { NextRequest } from 'next/server';

// The allowlist applies only to live webhooks. The environment is read
// directly from the process here: sandbox checkouts keep their existing
// behaviour, and a fleet-level test stub can still override it.

// Paddle publishes the source addresses of its live webhook deliveries at this
// public endpoint. The list is the source of truth and can change, so it is
// fetched at runtime and cached in process memory — never hard-coded here.
// https://developer.paddle.com/webhooks/understand stimulated: notification IPs
// can be allowlisted on the receiving server in addition to signature checks.
const PADDLE_IPS_ENDPOINT = 'https://api.paddle.com/ips';
const IP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface IpListCache {
  cidrs: string[];
  fetchedAt: number;
}

// Cached across warm invocations. Keeping the last successful list also lets a
// momentary API outage be served from cache instead of dropping deliveries.
let cache: IpListCache | null = null;

interface IpApiResponse {
  data?: {
    ipv4_cidrs?: string[];
    ipv6_cidrs?: string[];
  };
}

export async function getPaddleNotificationCidrs(): Promise<string[] | null> {
  if (cache && Date.now() - cache.fetchedAt < IP_CACHE_TTL_MS) return cache.cidrs;
  try {
    const response = await fetch(PADDLE_IPS_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as IpApiResponse;
    const cidrs = [
      ...(body.data?.ipv4_cidrs ?? []),
      ...(body.data?.ipv6_cidrs ?? []),
    ].filter((cidr) => typeof cidr === 'string' && /^\d/.test(cidr));
    if (cidrs.length === 0) throw new Error('empty ip list');
    cache = { cidrs, fetchedAt: Date.now() };
    return cache.cidrs;
  } catch (error) {
    // A stale list still proves the address was Paddle's at some point, so it
    // is preferred over blocking on a temporary API outage. Null (no list at
    // all) lets the caller reject rather than trust an unknown source.
    if (cache) console.warn('Paddle IP list refresh failed; using cached list', error);
    else console.error('Paddle IP list is unavailable');
    return cache ? cache.cidrs : null;
  }
}

function ipToBigInt(ip: string): bigint | null {
  const ipV4Parts = ip.split('.');
  if (ipV4Parts.length === 4) {
    let value = BigInt(0);
    for (const part of ipV4Parts) {
      if (!/^\d+$/.test(part)) return null;
      const octet = Number(part);
      if (octet > 255) return null;
      value = (value << BigInt(8)) | BigInt(octet);
    }
    return value;
  }
  const sections = ip.split('::');
  if (sections.length > 2) return null;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;
  const groups: number[] = [];
  for (const group of [...left, ...Array(missing).fill('0'), ...right]) {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  if (groups.length !== 8) return null;
  let value = BigInt(0);
  for (const group of groups) value = (value << BigInt(16)) | BigInt(group);
  return value;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split('/');
  if (!range || !prefixText) return false;
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0) return false;
  const address = ipToBigInt(ip);
  const network = ipToBigInt(range);
  if (address === null || network === null) return false;
  const bits = range.includes(':') ? 128 : 32;
  if (prefix > bits) return false;
  const shift = BigInt(bits - prefix);
  return address >> shift === network >> shift;
}

/**
 * The client address as reported by the platform edge. Only the first
 * `x-forwarded-for` hop is trusted — it is set by the host, not the caller.
 */
function requestClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || null;
}

/**
 * Verifies a webhook request originates from an address Paddle publishes as a
 * live notification source. Sandbox and unconfigured environments are exempt
 * (sandbox suffers no extra check, and tests drive the route directly), and
 * live signature verification remains mandatory in every case.
 *
 * False negatives must not silently accept an unknown source: without a
 * reachable list or a client IP the check cannot confirm or deny the source,
 * so the caller responds 503 and Paddle retries.
 */
export async function isPaddleNotificationSource(request: NextRequest): Promise<
  'allowed' | 'rejected' | 'unverifiable'
> {
  const environment = process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase();
  if (environment !== 'live') return 'allowed';
  const cidrs = await getPaddleNotificationCidrs();
  if (!cidrs) return 'unverifiable';
  const ip = requestClientIp(request);
  if (!ip) return 'unverifiable';
  return cidrs.some((cidr) => ipInCidr(ip, cidr)) ? 'allowed' : 'rejected';
}

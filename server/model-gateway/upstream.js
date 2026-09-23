// Hardened upstream transport: DNS resolve + bind to validated IP, private
// address rejection, manual redirects with origin checks, header blacklist,
// timeouts, response size limits and sanitized errors. No arbitrary client
// target URLs or dangerous headers ever reach the wire.
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export const FORBIDDEN_HEADER_NAMES = [
  'host',
  'cookie',
  'authorization',
  'proxy-authorization',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'forwarded',
  'via',
];

const METADATA_HOSTS = ['metadata.google.internal'];

export const isForbiddenHeader = (name) => {
  const lower = name.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.includes(lower)) return true;
  if (lower.startsWith('x-forwarded-')) return true;
  if (lower.startsWith('proxy-')) return true;
  return false;
};

export const isPrivateAddress = (ip) => {
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] >= 224) return true; // multicast + reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
};

// Resolve a URL's host to validated addresses; all A/AAAA results must pass.
// Returns the URL object plus the bound address to connect to.
export const resolveAndBind = async (urlString) => {
  const url = new URL(urlString);
  const secure = url.protocol === 'https:';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const isLocalHttp = url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
  if (!secure && !isLocalHttp) throw new Error('insecure protocol');
  // Development/test environments may target localhost HTTP (e.g. local test
  // servers); production refuses it along with every other private address.
  const devLocal = isLocalHttp && net.isIP(host) && process.env.NODE_ENV !== 'production';
  if (devLocal) return { url, ip: host };
  if (METADATA_HOSTS.includes(host)) throw new Error('metadata address');
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    const entries = await dns.lookup(host, { all: true, verbatim: true });
    addresses = entries.map((e) => e.address);
  }
  if (addresses.length === 0) throw new Error('no addresses');
  for (const ip of addresses) {
    if (isPrivateAddress(ip)) throw new Error('private address');
  }
  return { url, ip: addresses[0] };
};

const sendRequest = ({ url, ip, method, headers, body, timeoutMs, maxBodyBytes, signal }) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        host: ip,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: { ...headers, Host: url.host },
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        timeout: timeoutMs,
        signal,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBodyBytes) {
            req.destroy(new Error('response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

// Reject client-supplied target URLs and dangerous headers before the wire.
export const buildUpstreamRequest = ({ targetUrl, method = 'POST', headers = {}, body }) => {
  if (targetUrl) throw new Error('forbidden: client must not supply target URL');
  for (const name of Object.keys(headers)) {
    if (isForbiddenHeader(name)) throw new Error('forbidden header');
  }
  return { method, headers, body };
};

export const fetchUpstream = async ({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 30000,
  maxBodyBytes = 50 * 1024 * 1024,
  maxRedirects = 2,
  allowPostRedirect = false,
  signal,
}) => {
  buildUpstreamRequest({ targetUrl: undefined, method, headers, body });
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url: bound, ip } = await resolveAndBind(currentUrl);
    const res = await sendRequest({
      url: bound,
      ip,
      method: currentMethod,
      headers,
      body: currentBody,
      timeoutMs,
      maxBodyBytes,
      signal,
    });
    const status = res.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(currentMethod) && !allowPostRedirect) {
        throw new Error('redirect denied');
      }
      const loc = res.headers.location;
      if (!loc) throw new Error('redirect without location');
      const next = new URL(loc, currentUrl);
      if (next.origin !== new URL(currentUrl).origin) throw new Error('cross-origin redirect denied');
      currentUrl = next.href;
      if ([301, 302, 303].includes(status) && currentMethod === 'POST') {
        currentMethod = 'GET';
        currentBody = undefined;
      }
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
};

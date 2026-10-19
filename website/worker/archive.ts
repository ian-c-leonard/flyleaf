import { literal, site } from './site.ts';

export function protect(response: Response): Response {
  const headers = new Headers(response.headers);
  // Prevent proxy-injected scripts without disabling compression for data and app bundles.
  const html =
    headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ===
    'text/html';
  headers.set(
    'Cache-Control',
    html ? 'private, no-store, no-transform' : 'private, no-store',
  );
  // Cloudflare compresses text/plain but not the registered GEDCOM type. A
  // family tree can be several megabytes, and the app reads it as bytes.
  if (
    headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ===
    'text/vnd.familysearch.gedcom'
  )
    headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  // HTTPS only, for a year; subdomains are left to their own settings.
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  // The site needs no camera, microphone, location, payments or USB devices.
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'wasm-unsafe-eval' ${site().clerkOrigin} https://challenges.cloudflare.com https://*.protect.clerk.com`,
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tile.openstreetmap.org https://img.clerk.com",
      "font-src 'self'",
      `connect-src 'self' blob: ${site().clerkOrigin} https://*.protect.clerk.com https://challenges.cloudflare.com`,
      "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  );
  return new Response(response.body, { status: response.status, headers });
}

export function message(status: number, text: string, headers?: HeadersInit) {
  return protect(new Response(text, { status, headers }));
}

export function archiveKey(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (
    !(
      path.startsWith('/data/images/') ||
      new RegExp(
        `^/data/publications/[a-f0-9]{64}/${literal(site().pdfName)}$`,
      ).test(path)
    ) ||
    path.includes('\\') ||
    Array.from(path).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    return null;
  const parts = path.slice('/data/'.length).split('/');
  if (parts.some((p) => !p || p.startsWith('.') || /%[0-9a-f]{2}/i.test(p)))
    return null;
  if (
    !/\.(jpe?g|png|webp|gif|tiff?|heic|heif|pdf|epub|txt|md|html?|json|xml|mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?)$/i.test(
      path,
    )
  )
    return null;
  return 'archive/' + parts.join('/');
}

export function byteRange(
  value: string,
  size: number,
): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!m || (!m[1] && !m[2]) || size < 1) return null;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(m[1]);
  const end = m[2] ? Number(m[2]) : size - 1;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(end) ||
    offset >= size ||
    end < offset
  )
    return null;
  return { offset, length: Math.min(end, size - 1) - offset + 1 };
}

const contentTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  html: 'text/plain; charset=utf-8',
  htm: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'text/plain; charset=utf-8',
};

export async function readArchive(request: Request, env: Env, key: string) {
  const meta = await env.ARCHIVE.head(key);
  if (!meta) return message(404, 'File not found.');
  const headers = new Headers({
    'Content-Type':
      contentTypes[key.split('.').pop()!.toLowerCase()] ||
      'application/octet-stream',
    'Content-Length': String(meta.size),
    'Accept-Ranges': 'bytes',
    ETag: meta.httpEtag,
    'Last-Modified': meta.uploaded.toUTCString(),
  });
  const extension = key.split('.').pop()!.toLowerCase();
  const download =
    new URL(request.url).searchParams.has('download') ||
    ['html', 'htm', 'json', 'xml', 'md'].includes(extension);
  if (download) {
    const filename = encodeURIComponent(key.split('/').pop()!).replace(
      /['()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16),
    );
    headers.set(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" + filename,
    );
  }
  if (request.method === 'HEAD')
    return protect(new Response(null, { headers }));
  const rangeHeader = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  // Honor If-Range only for an exact strong ETag or a current HTTP date.
  const validIfRange =
    !ifRange ||
    ifRange === meta.httpEtag ||
    (!ifRange.startsWith('W/') &&
      Number.isFinite(Date.parse(ifRange)) &&
      Math.floor(meta.uploaded.getTime() / 1000) <=
        Math.floor(Date.parse(ifRange) / 1000));
  const range =
    rangeHeader && validIfRange ? byteRange(rangeHeader, meta.size) : undefined;
  if (range === null)
    return message(416, 'Requested range is not available.', {
      'Content-Range': `bytes */${meta.size}`,
    });
  // If a concurrent upload replaced the object since HEAD, do not mix metadata
  // and bytes. A retry will read the new version coherently.
  const object = await env.ARCHIVE.get(key, {
    onlyIf: { etagMatches: meta.etag },
    ...(range ? { range } : {}),
  });
  if (!object) return message(404, 'File not found.');
  if (!('body' in object))
    return message(409, 'This file was updated. Please reload.');
  if (range) {
    headers.set(
      'Content-Range',
      `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`,
    );
    headers.set('Content-Length', String(range.length));
  }
  return protect(
    new Response(object.body, { status: range ? 206 : 200, headers }),
  );
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveKey, byteRange, readArchive } from '../worker/archive.ts';
import { configure } from '../worker/site.ts';
import { workerSettings } from './helpers/worker-settings.mjs';

configure(workerSettings);
function environment() {
  const calls = [];
  const body = new TextEncoder().encode('0123456789');
  const meta = {
    size: body.length,
    etag: 'same-bytes',
    httpEtag: '"same-bytes"',
    uploaded: new Date('2026-09-12T12:00:00Z'),
  };
  const env = {
    ALLOWED_EMAILS: workerSettings.ALLOWED_EMAILS,
    ALLOWED_HOSTS: workerSettings.ALLOWED_HOSTS,
    ASSETS: {
      fetch: async (request) => {
        calls.push(['static', new URL(request.url).pathname]);
        return new Response('private app');
      },
    },
    ARCHIVE: {
      head: async (key) => {
        calls.push(['head', key]);
        return key.endsWith('missing.pdf') ? null : meta;
      },
      get: async (key, options) => {
        calls.push(['get', key, options]);
        const range = options.range;
        const selected = range
          ? body.slice(range.offset, range.offset + range.length)
          : body;
        return { ...meta, body: new Response(selected).body };
      },
    },
  };
  return { env, calls };
}
async function read(request, env) {
  return readArchive(request, env, archiveKey(new URL(request.url).pathname));
}
function request(
  path = '/',
  headers = {},
  method = 'GET',
  host = 'example.family',
) {
  return new Request('https://' + host + path, { method, headers });
}

void test('authenticated archive streams full files and exact single ranges with coherent headers', async () => {
  const { env, calls } = environment();
  const path = '/data/publications/' + 'a'.repeat(64) + '/example-family.pdf';
  const full = await read(request(path), env);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), '0123456789');
  assert.equal(full.headers.get('Content-Type'), 'application/pdf');
  assert.equal(full.headers.get('Content-Length'), '10');
  for (const [range, bytes, expected] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-', '89', 'bytes 8-9/10'],
  ]) {
    const response = await read(request(path, { Range: range }), env);
    assert.equal(response.status, 206);
    assert.equal(await response.text(), bytes);
    assert.equal(response.headers.get('Content-Range'), expected);
    assert.equal(response.headers.get('Content-Length'), String(bytes.length));
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  const head = await read(request(path, {}, 'HEAD'), env);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Content-Length'), '10');
  const gets = calls.filter((c) => c[0] === 'get');
  assert.equal(gets.length, 4);
  assert.ok(gets.every((c) => c[2].onlyIf.etagMatches === 'same-bytes'));
});

void test('invalid ranges, absent files and changed objects do not return misleading bytes', async () => {
  const { env } = environment();
  const path = '/data/images/book.pdf';
  for (const Range of [
    'bytes=10-',
    'bytes=7-4',
    'bytes=-0',
    'bytes=0-1,3-4',
    'nonsense',
  ]) {
    const response = await read(request(path, { Range }), env);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), 'bytes */10');
  }
  const changed = await read(
    request(path, { Range: 'bytes=2-4', 'If-Range': '"old-bytes"' }),
    env,
  );
  assert.equal(changed.status, 200);
  assert.equal(await changed.text(), '0123456789');
  assert.equal(
    (await read(request('/data/images/missing.pdf'), env)).status,
    404,
  );
  env.ARCHIVE.get = async () => ({ size: 10 });
  assert.equal((await read(request(path), env)).status, 409);
});

void test('archive paths are bounded and saved HTML cannot execute on the family origin', async () => {
  for (const path of [
    '/data/images/../secret.txt',
    '/data/images/%2e%2e/secret.txt',
    '/data/images/%252e%252e/secret.txt',
    '/data/images/.env',
    '/data/images/a%5cb.txt',
    '/data/images/a%00.jpg',
    '/data/images/file.js',
    '/data/other/file.jpg',
    '/data/images/%',
  ])
    assert.equal(archiveKey(path), null, path);
  assert.equal(
    archiveKey('/data/images/A%20photo.jpg'),
    'archive/images/A photo.jpg',
  );
  assert.deepEqual(byteRange('bytes=-100', 10), { offset: 0, length: 10 });
  const { env } = environment();
  const response = await read(
    request('/data/images/saved.html'),
    env,
  );
  assert.equal(
    response.headers.get('Content-Type'),
    'text/plain; charset=utf-8',
  );
  assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
});

void test('held HEIC and HEIF originals retain exact private download paths and media types', async () => {
  for (const [extension, type] of [
    ['heic', 'image/heic'],
    ['HEIF', 'image/heif'],
  ]) {
    const pathname =
      '/data/images/family-contributions/Thanksgiving%20original.' + extension;
    assert.equal(
      archiveKey(pathname),
      'archive/images/family-contributions/Thanksgiving original.' + extension,
    );
    const { env } = environment();
    const response = await read(request(pathname + '?download'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), type);
    assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(await response.text(), '0123456789');
    const head = await read(request(pathname, {}, 'HEAD'), env);
    assert.equal(head.headers.get('Content-Type'), type);
    assert.equal(head.headers.get('Content-Length'), '10');
    assert.equal(await head.text(), '');
  }
  for (const pathname of [
    '/data/images/photo.heic.js',
    '/data/images/.hidden.heic',
    '/data/other/photo.heic',
    '/data/images/%252e%252e/photo.heic',
  ])
    assert.equal(archiveKey(pathname), null, pathname);
});

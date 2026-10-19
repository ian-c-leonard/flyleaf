import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPair } from 'jose';
import { clerkFixture } from './helpers/clerk-fixture.mjs';

void test('Clerk SDK in the real Worker protects every archive route', async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'family-clerk-'));
  const assets = path.join(temporary, 'assets');
  await mkdir(path.join(assets, 'data/previews'), { recursive: true });
  for (const [file, bytes] of [
    ['index.html', '<h1>PRIVATE fixture</h1>'],
    ['data/family.ged', 'PRIVATE GEDCOM'],
    ['data/previews/fixture.webp', 'PRIVATE preview'],
    ['app.js', 'PRIVATE application'],
  ])
    await writeFile(path.join(assets, file), bytes);
  await cp('public/login', path.join(assets, 'login'), { recursive: true });
  // The build writes the sign-in page only for a Worker family, so these
  // checks bring their own.
  await writeFile(
    path.join(assets, 'login/index.html'),
    '<!doctype html><title>Sign in</title><h1>Sign in fixture</h1>',
  );
  // These neighbours really exist: a directory-level public exception must fail.
  await writeFile(
    path.join(assets, 'login/fonts/unlisted.woff2'),
    'PRIVATE font neighbour',
  );
  await writeFile(
    path.join(assets, 'login/fonts/private-notes.txt'),
    'PRIVATE notes neighbour',
  );
  const f = await clerkFixture(assets);
  const book = '/data/publications/' + 'a'.repeat(64) + '/example-family.pdf';
  const paths = [
    '/',
    '/index.html',
    '/app.js',
    '/data/family.ged',
    '/data/previews/fixture.webp',
    '/data/images/page.pdf',
    '/data/images/index.json',
    '/data/images/finding-aid.xml',
    '/data/images/report.md',
    '/data/images/track.mp3',
    '/data/images/track.wav',
    '/data/images/original.heic',
    '/data/images/original.HEIF',
    book,
  ];
  try {
    const bucket = await f.mf.getR2Bucket('ARCHIVE');
    await bucket.put('archive/images/page.pdf', '0123456789');
    for (const ext of ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'aiff'])
      await bucket.put('archive/images/track.' + ext, '0123456789');
    for (const ext of ['heic', 'HEIF'])
      await bucket.put(
        'archive/images/original.' + ext,
        'PRIVATE original photo',
      );
    await bucket.put('archive/' + book.slice(6), '0123456789');
    const structuredFiles = [
      [
        '/data/images/report.md',
        '# PRIVATE retained report\n<script>window.untrusted = true</script>\n',
        'text/plain; charset=utf-8',
      ],
      [
        '/data/images/index.json',
        '{"body":"PRIVATE index — <script>"}',
        'application/json; charset=utf-8',
      ],
      [
        '/data/images/finding-aid.xml',
        '<?xml version="1.0"?><finding-aid>PRIVATE finding aid</finding-aid>',
        'text/plain; charset=utf-8',
      ],
    ];
    for (const [path, body] of structuredFiles)
      await bucket.put('archive/' + path.slice(6), body);
    await t.test(
      'anonymous and old Access headers cannot reach private GET/HEAD/ranges',
      async () => {
        for (const p of paths)
          for (const method of ['GET', 'HEAD']) {
            const r = await f.req(p, {
              method,
              headers: {
                Range: 'bytes=2-5',
                'Cf-Access-Jwt-Assertion': 'forged',
                Cookie: 'CF_Authorization=forged',
              },
            });
            assert.equal(
              r.status,
              p === '/' && method === 'GET' ? 302 : 401,
              p + ' ' + method,
            );
            assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
            assert.doesNotMatch(await r.text(), /PRIVATE|2345/);
          }
        for (const p of [
          '/login',
          '/login/',
          '/login/accept-invitation',
          '/login/style.css',
          '/login/app.js',
          '/login/runtime.js',
          '/login/fonts/eb-garamond-latin-400-normal.woff2',
          '/login/fonts/source-sans-3-latin-wght-normal.woff2',
          '/login/fonts/eb-garamond-OFL.txt',
          '/login/fonts/source-sans-3-OFL.txt',
          '/login/config.json',
        ]) {
          const response = await f.req(p);
          assert.equal(response.status, 200, p);
          assert.equal(
            response.headers.get('Cache-Control'),
            ['/login', '/login/', '/login/accept-invitation'].includes(p)
              ? 'private, no-store, no-transform'
              : 'private, no-store',
            p,
          );
          if (p.startsWith('/login/fonts/')) {
            const held = await readFile(path.join('public', p.slice(1)));
            assert.deepEqual(
              Buffer.from(await response.arrayBuffer()),
              held,
              p + ' exact bytes',
            );
            const head = await f.req(p, { method: 'HEAD' });
            assert.equal(head.status, 200, p + ' HEAD');
            assert.equal(
              (await head.arrayBuffer()).byteLength,
              0,
              p + ' HEAD body',
            );
            assert.match(
              response.headers.get('Content-Security-Policy'),
              /font-src 'self'/,
            );
            if (p.endsWith('.woff2'))
              assert.match(response.headers.get('Content-Type'), /font\/woff2/);
          }
        }
        for (const p of [
          '/login/index.html',
          '/login/runtime.d.ts',
          '/login/unlisted.js',
          '/login/fonts/unlisted.woff2',
          '/login/fonts/private-notes.txt',
          '/login/fonts/.env',
          '/login/fonts/eb-garamond-latin-400-normal.woff2.bak',
          '/login/fonts/%65b-garamond-latin-400-normal.woff2',
        ])
          assert.equal((await f.req(p)).status, 401, p);
        assert.deepEqual(
          Object.keys(await (await f.req('/login/config.json')).json()).sort(),
          ['clerkVersion', 'frontendApi', 'publishableKey', 'uiVersion'],
        );
        for (const host of [
          'https://evil.example',
          'https://www.example.family',
          'http://example.family',
          'https://example.family:444',
        ])
          assert.equal(
            (await f.mf.dispatchFetch(host + '/login', { redirect: 'manual' }))
              .status,
            403,
            host,
          );
        assert.equal((await f.req('/login', { method: 'POST' })).status, 405);
        const clean = await f.req(
          '/?view=book&__clerk_ticket=sensitive&__session=sensitive',
        );
        const login = new URL(clean.headers.get('Location'));
        assert.equal(login.searchParams.get('returnTo'), '/?view=book');
      },
    );
    await t.test(
      'verified invited member can read data, originals and exact book ranges',
      async () => {
        const Cookie = f.cookie(await f.token());
        for (const p of paths)
          for (const method of ['GET', 'HEAD']) {
            const response = await f.req(p, { method, headers: { Cookie } });
            assert.equal(
              response.status,
              p === '/index.html' ? 307 : 200,
              p + ' ' + method,
            );
            if (p === '/index.html')
              assert.equal(
                new URL(
                  response.headers.get('Location'),
                  'https://example.family',
                ).pathname,
                '/',
              );
          }
        const r = await f.req(book, {
          headers: { Cookie, Range: 'bytes=2-5' },
        });
        assert.equal(r.status, 206);
        assert.equal(await r.text(), '2345');
        assert.equal(r.headers.get('Content-Range'), 'bytes 2-5/10');
        assert.deepEqual(
          await (await f.req('/api/session', { headers: { Cookie } })).json(),
          { allowed: true, person: '', admin: false },
        );
        // An admin also learns which people the invited relatives are, by
        // id alone, to see the site as any of them. Nobody else does.
        const family = await clerkFixture(assets, {
          ALLOWED_EMAILS: 'ada@example.org,jory@example.org',
          ADMIN_EMAILS: 'ada@example.org',
          VIEWER_PEOPLE:
            'ada@example.org=ada-example,jory@example.org=jory-example,' +
            'tom@example.org=jory-example',
        });
        try {
          const session = async (claims) =>
            (
              await family.req('/api/session', {
                headers: { Cookie: family.cookie(await family.token(claims)) },
              })
            ).json();
          const admin = await session();
          assert.deepEqual(admin, {
            allowed: true,
            person: 'ada-example',
            admin: true,
            viewers: ['ada-example', 'jory-example'],
          });
          assert.doesNotMatch(JSON.stringify(admin), /@/);
          assert.deepEqual(await session({ email: 'jory@example.org' }), {
            allowed: true,
            person: 'jory-example',
            admin: false,
          });
        } finally {
          await family.dispose();
        }
        assert.equal(
          (await f.req('/api/anything', { headers: { Cookie } })).status,
          404,
        );
      },
    );
    await t.test(
      'private audio supports exact seeking, original downloads and HEAD without exposing anonymous bytes',
      async () => {
        const Cookie = f.cookie(await f.token());
        for (const [ext, type] of [
          ['mp3', 'audio/mpeg'],
          ['m4a', 'audio/mp4'],
          ['ogg', 'audio/ogg'],
          ['opus', 'audio/ogg'],
          ['wav', 'audio/wav'],
          ['flac', 'audio/flac'],
          ['aiff', 'audio/aiff'],
        ]) {
          const path = '/data/images/track.' + ext;
          for (const [Range, expected, span] of [
            ['bytes=2-5', '2345', 'bytes 2-5/10'],
            ['bytes=-3', '789', 'bytes 7-9/10'],
          ]) {
            const response = await f.req(path, { headers: { Cookie, Range } });
            assert.equal(response.status, 206);
            assert.equal(await response.text(), expected);
            assert.equal(response.headers.get('Content-Type'), type);
            assert.equal(response.headers.get('Content-Range'), span);
            assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
            assert.equal(
              response.headers.get('Cache-Control'),
              'private, no-store',
            );
          }
          const download = await f.req(path + '?download', {
            method: 'HEAD',
            headers: { Cookie },
          });
          assert.equal(download.status, 200);
          assert.equal(await download.text(), '');
          assert.equal(download.headers.get('Content-Length'), '10');
          assert.equal(download.headers.get('Content-Type'), type);
          assert.match(
            download.headers.get('Content-Disposition'),
            /^attachment;/,
          );
          const anonymous = await f.req(path, {
            headers: { Range: 'bytes=2-5' },
          });
          assert.equal(anonymous.status, 401);
          assert.doesNotMatch(await anonymous.text(), /2345/);
        }
      },
    );
    await t.test(
      'HEIC and HEIF originals download exact bytes through the invited identity gate',
      async () => {
        const Cookie = f.cookie(await f.token());
        for (const [ext, type] of [
          ['heic', 'image/heic'],
          ['HEIF', 'image/heif'],
        ]) {
          const path = '/data/images/original.' + ext;
          const full = await f.req(path + '?download', { headers: { Cookie } });
          assert.equal(full.status, 200);
          assert.equal(await full.text(), 'PRIVATE original photo');
          assert.equal(full.headers.get('Content-Type'), type);
          assert.match(full.headers.get('Content-Disposition'), /^attachment;/);
          const head = await f.req(path, {
            method: 'HEAD',
            headers: { Cookie },
          });
          assert.equal(head.status, 200);
          assert.equal(head.headers.get('Content-Type'), type);
          assert.equal(head.headers.get('Content-Length'), '22');
          assert.equal(await head.text(), '');
          const range = await f.req(path, {
            headers: { Cookie, Range: 'bytes=0-6' },
          });
          assert.equal(range.status, 206);
          assert.equal(await range.text(), 'PRIVATE');
          assert.equal(range.headers.get('Content-Range'), 'bytes 0-6/22');
        }
      },
    );
    await t.test(
      'structured originals retain exact bytes and safe headers behind the normal identity gate',
      async () => {
        const Cookie = f.cookie(await f.token());
        for (const [path, body, type] of structuredFiles) {
          const response = await f.req(path, { headers: { Cookie } });
          assert.equal(response.status, 200);
          assert.deepEqual(
            Buffer.from(await response.arrayBuffer()),
            Buffer.from(body),
          );
          assert.equal(response.headers.get('Content-Type'), type);
          assert.match(
            response.headers.get('Content-Disposition'),
            /^attachment;/,
          );
          assert.equal(
            response.headers.get('X-Content-Type-Options'),
            'nosniff',
          );
          assert.equal(
            response.headers.get('Cache-Control'),
            'private, no-store',
          );
          const range = await f.req(path, {
            headers: { Cookie, Range: 'bytes=0-4' },
          });
          assert.equal(range.status, 206);
          assert.deepEqual(
            Buffer.from(await range.arrayBuffer()),
            Buffer.from(body).subarray(0, 5),
          );
        }
      },
    );
    await t.test(
      'forgery, expiry, wrong instance/party, pending state and malformed identity fail closed',
      async () => {
        const invalid = [
          { exp: Math.floor(Date.now() / 1000) - 10 },
          { nbf: Math.floor(Date.now() / 1000) + 60 },
          { iss: 'https://other.clerk.accounts.dev' },
          { azp: 'https://evil.example' },
          { azp: undefined },
          { sts: 'pending' },
          { sub: '' },
          { sid: '' },
          { email: 'other@example.com' },
          { email_verified: false },
        ];
        const other = await generateKeyPair('RS256');
        const tokens = [
          'forged',
          await f.token({}, other.privateKey),
          ...(await Promise.all(invalid.map((x) => f.token(x)))),
        ];
        for (const token of tokens) {
          const r = await f.req('/data/family.ged', {
            headers: { Cookie: f.cookie(token) },
          });
          assert.ok([401, 403].includes(r.status), r.status);
          assert.doesNotMatch(await r.text(), /PRIVATE/);
        }
        const removed = await clerkFixture(assets, {
          ALLOWED_EMAILS: 'removed@example.com',
        });
        try {
          assert.equal(
            (
              await removed.req('/data/family.ged', {
                headers: { Cookie: removed.cookie(await removed.token()) },
              })
            ).status,
            403,
          );
        } finally {
          await removed.dispose();
        }
      },
    );
    await t.test(
      'a session token without the email claims explains the Clerk setup and reveals nothing',
      async () => {
        // What Clerk sends before the session token is customized, and the
        // shapes a mistyped template produces.
        for (const changes of [
          { email: undefined, email_verified: undefined },
          { email: undefined },
          { email: ['ada@example.org'] },
          { email: null },
          { email_verified: undefined },
          { email_verified: 'true' },
        ]) {
          const Cookie = f.cookie(await f.token(changes));
          for (const [p, accept] of [
            ['/data/family.ged', '*/*'],
            ['/', 'text/html'],
            ['/api/session', 'application/json'],
          ]) {
            const r = await f.req(p, { headers: { Accept: accept, Cookie } });
            const label = JSON.stringify(changes) + ' ' + p;
            assert.equal(r.status, 503, label);
            assert.equal(r.headers.get('Cache-Control'), 'private, no-store', label);
            const text = await r.text();
            assert.doesNotMatch(text, /PRIVATE|allowed/, label);
            assert.match(text, /Please tell Ada\./, label);
            assert.match(text, /"email" and "email_verified"/, label);
            assert.match(text, /Customize session token/, label);
            assert.match(text, /\{\{user\.primary_email_address\}\}/, label);
            assert.match(text, /\{\{user\.email_verified\}\}/, label);
          }
        }
        // A token Clerk did not sign gets no setup advice.
        const other = await generateKeyPair('RS256');
        const forged = await f.token({ email: undefined }, other.privateKey);
        const r = await f.req('/data/family.ged', {
          headers: { Cookie: f.cookie(forged) },
        });
        assert.equal(r.status, 401);
        assert.doesNotMatch(await r.text(), /PRIVATE|session token/);
      },
    );
    await t.test(
      'canonical refresh redirect, loop bound and SDK handshake cookies',
      async () => {
        const headers = {
          Accept: 'text/html',
          'Sec-Fetch-Dest': 'document',
          Cookie: '__client_uat=1',
          'X-Forwarded-Host': 'evil.example',
          'X-Forwarded-Proto': 'http',
        };
        const r = await f.req('/?view=book', { headers });
        assert.equal(r.status, 307);
        const target = new URL(r.headers.get('Location'));
        assert.equal(target.origin, 'https://clerk.example.family');
        assert.equal(target.pathname, '/v1/client/handshake');
        assert.equal(
          target.searchParams.get('redirect_url'),
          'https://example.family/?view=book',
        );
        assert.ok(
          r.headers
            .getSetCookie()
            .some((value) => value.includes('__clerk_redirect_count')),
        );
        const loop = await f.req('/', {
          headers: {
            ...headers,
            Cookie: '__client_uat=1; __clerk_redirect_count=3',
          },
        });
        assert.equal(loop.status, 302);
        assert.match(
          loop.headers.get('Location'),
          /^https:\/\/example.family\/login/,
        );
        assert.equal(
          (
            await f.req('/data/family.ged', {
              headers: { Cookie: '__client_uat=1', Accept: 'application/json' },
            })
          ).status,
          401,
        );
        const token = await f.token();
        f.setDirectives([
          '__session=' + token + '; Path=/; Secure; SameSite=Lax',
          '__client_uat=1; Path=/; Secure; SameSite=Lax',
        ]);
        const callback = await f.req(
          '/?__clerk_handshake_nonce=isolated-fixture',
          { headers: { Accept: 'text/html' } },
        );
        assert.equal(callback.status, 200);
        assert.match(await callback.text(), /PRIVATE/);
        assert.ok(
          callback.headers
            .getSetCookie()
            .some((value) => value.startsWith('__session=')),
        );
        assert.ok(
          callback.headers
            .getSetCookie()
            .some((value) => value.startsWith('__client_uat=')),
        );
        assert.equal(callback.headers.get('x-clerk-auth-status'), null);
      },
    );
  } finally {
    await f.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});

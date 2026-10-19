import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerSettings } from './worker-settings.mjs';

const site = fileURLToPath(new URL('../..', import.meta.url));
const compatibilityDate = '2026-09-12';
let bundle;

// The Worker as Wrangler bundles it for deployment, built once per test
// process from a minimal configuration. A family without Worker hosting has
// no wrangler.jsonc, and these checks do not need one.
function workerBundle() {
  if (bundle) return bundle;
  const dir = mkdtempSync(path.join(tmpdir(), 'family-worker-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, 'wrangler.json');
  writeFileSync(
    config,
    JSON.stringify({
      name: 'worker-fixture',
      main: path.join(site, 'worker/index.ts'),
      compatibility_date: compatibilityDate,
      compatibility_flags: ['nodejs_compat'],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(site, 'node_modules/wrangler/bin/wrangler.js'),
      'deploy',
      '--dry-run',
      '--outdir',
      path.join(dir, 'bundle'),
      '--config',
      config,
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  if (result.status !== 0)
    throw Error('Could not bundle the Worker:\n' + result.stdout + result.stderr);
  bundle = path.join(dir, 'bundle/index.js');
  return bundle;
}

/** The real Worker in Miniflare with a local Clerk mock. Settings default to
 * invented ones (helpers/worker-settings.mjs); `email` is the signed-in
 * member that token() vouches for unless a test changes it. */
export async function clerkFixture(
  assets,
  overrides = {},
  { email = 'ada@example.org' } = {},
) {
  const keys = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'local-fixture',
    alg: 'RS256',
    use: 'sig',
  };
  const calls = [];
  let directives = [];
  const bindings = { ...workerSettings, ...overrides };
  const origin = 'https://' + bindings.ALLOWED_HOSTS;
  const scriptPath = workerBundle();
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'family',
      modules: true,
      scriptPath,
      modulesRoot: path.dirname(scriptPath),
      compatibilityDate,
      compatibilityFlags: ['nodejs_compat'],
      host: '127.0.0.1',
      port: 0,
      assets: {
        directory: assets,
        binding: 'ASSETS',
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
        assetConfig: { not_found_handling: 'none' },
      },
      r2Buckets: ['ARCHIVE', 'SUBMISSIONS_FILES'],
      d1Databases: ['SUBMISSIONS_DB'],
      bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        assert.equal(
          url.origin,
          'https://api.clerk.com',
          'all provider requests stay in the local mock',
        );
        calls.push(url.pathname);
        if (url.pathname === '/v1/jwks') return Response.json({ keys: [jwk] });
        if (url.pathname === '/v1/clients/handshake_payload')
          return Response.json({ directives });
        throw Error('Unexpected Clerk fixture request: ' + url.pathname);
      },
    }),
  );
  async function token(changes = {}, otherKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: bindings.CLERK_FRONTEND_API,
      sub: 'user_fixture',
      sid: 'sess_fixture',
      azp: origin,
      iat: now,
      nbf: now - 5,
      exp: now + 60,
      v: 2,
      sts: 'active',
      email,
      email_verified: true,
      ...changes,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'local-fixture' })
      .sign(otherKey || keys.privateKey);
  }
  const cookie = (value) => '__session=' + value + '; __client_uat=1';
  const req = (pathname, options = {}) =>
    mf.dispatchFetch(origin + pathname, {
      redirect: 'manual',
      ...options,
    });
  return {
    mf,
    calls,
    token,
    cookie,
    req,
    setDirectives: (value) => {
      directives = value;
    },
    dispose: () => mf.dispose(),
  };
}

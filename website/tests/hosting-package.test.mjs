import '../flyleaf-globals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareHosting } from '../scripts/prepare-hosting.mjs';
import { checkLive, checkSignedOut } from '../scripts/verify-live.mjs';

async function fixture() {
  const site = await mkdtemp(path.join(tmpdir(), 'family-package-'));
  await mkdir(path.join(site, 'dist/client/data/images'), { recursive: true });
  await mkdir(path.join(site, 'dist/hosting/assets'), { recursive: true });
  await writeFile(
    path.join(site, 'dist/hosting/assets/index.html'),
    'old complete website',
  );
  await writeFile(
    path.join(site, 'dist/hosting/objects.json'),
    'old complete object plan',
  );
  await writeFile(
    path.join(site, 'dist/client/index.html'),
    'new complete website',
  );
  await writeFile(
    path.join(site, 'dist/client/data/images/photo.jpg'),
    'image fixture bytes',
  );
  await writeFile(
    path.join(site, 'dist/client/data/manifest.json'),
    JSON.stringify({
      assets: ['images/photo.jpg'],
      missingAssets: [],
      sourceSha256: 'fixture',
    }),
  );
  return site;
}

async function previewFixture(site) {
  const data = path.join(site, 'dist/client/data');
  const manifest = JSON.parse(
    await readFile(path.join(data, 'manifest.json'), 'utf8'),
  );
  const original = await readFile(path.join(data, 'images/photo.jpg'));
  const sourceSha256 = createHash('sha256').update(original).digest('hex');
  const gedcom = '0 HEAD\n0 TRLR\n';
  await writeFile(path.join(data, 'family.ged'), gedcom);
  const variants = {};
  for (const size of ['640', '1600']) {
    const relative = `previews/${'a'.repeat(16)}-${sourceSha256}/${size}.webp`;
    const bytes = Buffer.from('preview fixture ' + size);
    await mkdir(path.dirname(path.join(data, relative)), { recursive: true });
    await writeFile(path.join(data, relative), bytes);
    variants[size] = {
      path: relative,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const index = {
    schema: 1,
    gedcomSha256: createHash('sha256').update(gedcom).digest('hex'),
    files: {
      'images/photo.jpg': {
        sourceSha256,
        sourceBytes: original.length,
        variants,
      },
    },
  };
  manifest.previewImages = 1;
  manifest.previewFiles = Object.values(variants)
    .map((v) => v.path)
    .sort((a, b) => a.localeCompare(b));
  manifest.previewBytes = Object.values(variants).reduce(
    (n, v) => n + v.bytes,
    0,
  );
  await writeFile(path.join(data, 'previews.json'), JSON.stringify(index));
  await writeFile(path.join(data, 'manifest.json'), JSON.stringify(manifest));
  return { data, manifest, index };
}

void test('published Markdown and encoded filenames reach their exact archive keys', async () => {
  const site = await fixture();
  try {
    const relative = 'images/Nora’s report & notes.MD';
    const body = '# Retained report\n<script>inert original text</script>\n';
    await writeFile(path.join(site, 'dist/client/data', relative), body);
    const manifestPath = path.join(site, 'dist/client/data/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.assets.push(relative);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await prepareHosting(site);
    const original = result.files.find(
      (file) => file.key === 'archive/' + relative,
    );
    assert.equal(original.bytes, Buffer.byteLength(body));
    assert.equal(
      original.sha256,
      createHash('sha256').update(body).digest('hex'),
    );
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

void test('HEIC and HEIF originals are packaged byte for byte without becoming static public assets', async () => {
  const site = await fixture();
  try {
    const data = path.join(site, 'dist/client/data');
    const manifestPath = path.join(data, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const originals = [
      'images/Thanksgiving original.HEIC',
      'images/graduation.heif',
    ];
    const bytes = Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99,
    ]);
    for (const relative of originals) {
      await writeFile(path.join(data, relative), bytes);
      manifest.assets.push(relative);
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await prepareHosting(site);
    for (const relative of originals) {
      const original = result.files.find(
        (file) => file.key === 'archive/' + relative,
      );
      assert.equal(original.bytes, bytes.length);
      assert.equal(
        original.sha256,
        createHash('sha256').update(bytes).digest('hex'),
      );
      await assert.rejects(
        stat(path.join(site, 'dist/hosting/assets/data', relative)),
        { code: 'ENOENT' },
      );
    }
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

void test('unreachable archive URLs cannot replace the previous complete hosting package', async () => {
  for (const relative of [
    'images/report.doc',
    'images/source.js',
    'images/literal%2Fname.txt',
  ]) {
    const site = await fixture();
    try {
      await writeFile(
        path.join(site, 'dist/client/data', relative),
        'held bytes',
      );
      const manifestPath = path.join(site, 'dist/client/data/manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.assets.push(relative);
      await writeFile(manifestPath, JSON.stringify(manifest));
      await assert.rejects(prepareHosting(site), /Archive URL cannot resolve/);
      assert.equal(
        await readFile(
          path.join(site, 'dist/hosting/assets/index.html'),
          'utf8',
        ),
        'old complete website',
      );
      assert.equal(
        await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
        'old complete object plan',
      );
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  }
});

void test('previews stay with protected static assets while originals remain in the R2 object plan', async () => {
  const site = await fixture();
  try {
    const { manifest } = await previewFixture(site);
    const result = await prepareHosting(site);
    assert.equal(result.archiveFiles, 1);
    for (const relative of manifest.previewFiles)
      assert.ok(
        (
          await stat(path.join(site, 'dist/hosting/assets/data', relative))
        ).isFile(),
      );
    assert.equal(result.files[0].key, 'archive/images/photo.jpg');
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

void test('changed staged preview bytes cannot replace the prior complete hosting package', async () => {
  const site = await fixture();
  const realCopy = fs.promises.cp;
  let copied = false;
  try {
    const { manifest } = await previewFixture(site);
    fs.promises.cp = async (...args) => {
      await realCopy(...args);
      copied = true;
      await writeFile(
        path.join(args[1], 'data', manifest.previewFiles[0]),
        'changed during copy',
      );
    };
    syncBuiltinESMExports();
    await assert.rejects(prepareHosting(site), /Preview bytes changed/);
    assert.ok(copied);
    assert.equal(
      await readFile(path.join(site, 'dist/hosting/assets/index.html'), 'utf8'),
      'old complete website',
    );
    assert.equal(
      await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
      'old complete object plan',
    );
  } finally {
    fs.promises.cp = realCopy;
    syncBuiltinESMExports();
    await rm(site, { recursive: true, force: true });
  }
});

void test('changed previews, original bytes, genealogy and incomplete inventories cannot replace a valid hosting package', async () => {
  for (const damage of ['preview', 'original', 'genealogy', 'inventory']) {
    const site = await fixture();
    try {
      const { data, manifest } = await previewFixture(site);
      if (damage === 'preview')
        await writeFile(path.join(data, manifest.previewFiles[0]), 'changed');
      if (damage === 'original')
        await writeFile(path.join(data, 'images/photo.jpg'), 'changed');
      if (damage === 'genealogy')
        await writeFile(path.join(data, 'family.ged'), 'changed');
      if (damage === 'inventory') {
        manifest.previewFiles.pop();
        await writeFile(
          path.join(data, 'manifest.json'),
          JSON.stringify(manifest),
        );
      }
      await assert.rejects(prepareHosting(site), /Preview/);
      assert.equal(
        await readFile(
          path.join(site, 'dist/hosting/assets/index.html'),
          'utf8',
        ),
        'old complete website',
      );
      assert.equal(
        await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
        'old complete object plan',
      );
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  }
});

void test('failed static validation preserves the previous website and its matching object plan', async () => {
  const site = await fixture();
  try {
    await writeFile(
      path.join(site, 'dist/client/oversized.bin'),
      Buffer.alloc(25 * 1024 * 1024 + 1),
    );
    await assert.rejects(prepareHosting(site), /exceeds Workers limit/);
    assert.equal(
      await readFile(path.join(site, 'dist/hosting/assets/index.html'), 'utf8'),
      'old complete website',
    );
    assert.equal(
      await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
      'old complete object plan',
    );
    assert.ok(
      !(await readdir(path.join(site, 'dist'))).some((n) =>
        n.startsWith('.hosting-'),
      ),
    );
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

void test('successful preparation installs matching static files and hashed R2 plan without publishing originals', async () => {
  const site = await fixture();
  try {
    const result = await prepareHosting(site);
    assert.equal(
      await readFile(path.join(site, 'dist/hosting/assets/index.html'), 'utf8'),
      'new complete website',
    );
    const saved = JSON.parse(
      await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
    );
    assert.deepEqual(saved, result);
    assert.equal(result.files[0].key, 'archive/images/photo.jpg');
    assert.equal(
      result.files[0].sha256,
      createHash('sha256').update('image fixture bytes').digest('hex'),
    );
    await assert.rejects(
      stat(path.join(site, 'dist/hosting/assets/data/images')),
      { code: 'ENOENT' },
    );
    assert.ok(
      !(await readdir(path.join(site, 'dist'))).some((n) =>
        n.startsWith('.hosting-'),
      ),
    );
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

void test('a living PDF enters only private storage and mismatched edition metadata preserves the prior package', async () => {
  const site = await fixture();
  try {
    const { data, manifest } = await previewFixture(site);
    const body = Buffer.from('checked PDF fixture');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const book = {
      title: 'Family book',
      // The family's own PDF name: prepare-hosting reads it from flyleaf.json.
      path: `publications/${sha256}/${globalThis.__FLYLEAF_SITE__.pdfName}`,
      sha256,
      bytes: body.length,
      pages: 3,
    };
    await mkdir(path.dirname(path.join(data, book.path)), { recursive: true });
    await writeFile(path.join(data, book.path), body);
    manifest.assets.push(book.path);
    manifest.book = book;
    await writeFile(path.join(data, 'manifest.json'), JSON.stringify(manifest));
    const index = {
      schema: 1,
      gedcomSha256: createHash('sha256')
        .update(await readFile(path.join(data, 'family.ged')))
        .digest('hex'),
      book,
    };
    await writeFile(path.join(data, 'book.json'), JSON.stringify(index));
    const result = await prepareHosting(site);
    assert.equal(result.archiveFiles, 2);
    assert.ok(
      result.files.some(
        (file) => file.key === 'archive/' + book.path && file.sha256 === sha256,
      ),
    );
    await assert.rejects(
      stat(path.join(site, 'dist/hosting/assets/data/publications')),
      { code: 'ENOENT' },
    );
    const previous = await readFile(
      path.join(site, 'dist/hosting/objects.json'),
    );
    await writeFile(path.join(data, book.path), 'corrupted PDF');
    await assert.rejects(prepareHosting(site), /Book publication/);
    assert.deepEqual(
      await readFile(path.join(site, 'dist/hosting/objects.json')),
      previous,
    );
    await writeFile(path.join(data, book.path), body);
    index.gedcomSha256 = 'a'.repeat(64);
    await writeFile(path.join(data, 'book.json'), JSON.stringify(index));
    await assert.rejects(prepareHosting(site), /Book publication/);
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

void test('hosting omits OS metadata while retaining intentional hidden web files', async () => {
  const site = await fixture();
  try {
    const root = path.join(site, 'dist/client');
    for (const relative of [
      '.DS_Store',
      'data/.DS_Store',
      '._index.html',
      '__MACOSX/sidecar',
      'nested/Thumbs.db',
      'nested/desktop.ini',
      '.well-known/config.json',
    ]) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), relative);
    }
    const result = await prepareHosting(site);
    const assets = path.join(site, 'dist/hosting/assets');
    for (const relative of [
      '.DS_Store',
      'data/.DS_Store',
      '._index.html',
      '__MACOSX',
      'nested/Thumbs.db',
      'nested/desktop.ini',
    ])
      await assert.rejects(stat(path.join(assets, relative)), {
        code: 'ENOENT',
      });
    assert.equal(
      await readFile(path.join(assets, '.well-known/config.json'), 'utf8'),
      '.well-known/config.json',
    );
    assert.equal(result.archiveFiles, 1);
    assert.equal(result.files[0].key, 'archive/images/photo.jpg');
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

// A live site made from a hosting package: static files whole, and archive
// originals with the MD5 ETag and byte ranges that the Worker gives them.
async function liveSite(site) {
  const assets = path.join(site, 'dist/hosting/assets');
  const plan = JSON.parse(
    await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
  );
  const files = new Map();
  for (const entry of await readdir(assets, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      files.set('/' + path.relative(assets, file), { body: await readFile(file) });
    }
  for (const file of plan.files) {
    const body = await readFile(path.join(site, file.path));
    files.set('/data/' + file.key.slice('archive/'.length), {
      body,
      etag: '"' + createHash('md5').update(body).digest('hex') + '"',
    });
  }
  const requests = [];
  const request = async (method, pathname, headers = {}) => {
    const name = decodeURIComponent(pathname);
    requests.push([name, headers.Range]);
    const held = files.get(name);
    const response = (status, body, extra = {}) => ({
      status,
      ok: status >= 200 && status < 300,
      header: (key) => ({ etag: held?.etag, ...extra })[key],
      body: async () => body,
    });
    if (!held) return response(404, Buffer.from('File not found.'));
    if (headers.Range === 'bytes=0-0' && held.etag)
      return response(206, held.body.subarray(0, 1), {
        'content-range': `bytes 0-0/${held.body.length}`,
      });
    return response(200, held.body);
  };
  return { files, requests, request, plan };
}

void test('the live check reads every published file, originals included, and names each difference', async () => {
  const site = await fixture();
  try {
    const data = path.join(site, 'dist/client/data');
    await mkdir(path.join(site, 'dist/client/assets'), { recursive: true });
    await writeFile(path.join(site, 'dist/client/assets/app.js'), 'app');
    await writeFile(path.join(data, 'images/letter one.pdf'), 'letter bytes');
    await writeFile(path.join(data, 'images/census.png'), 'census bytes');
    const manifestPath = path.join(data, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.assets.push('images/letter one.pdf', 'images/census.png');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const packaged = await prepareHosting(site);

    const live = await liveSite(site);
    const clean = await checkLive(site, live.request);
    assert.deepEqual(clean.problems, []);
    assert.equal(clean.checked, packaged.staticFiles + packaged.archiveFiles);
    const asked = new Set(live.requests.map(([name]) => name));
    for (const name of live.files.keys()) assert.ok(asked.has(name), name);
    for (const file of live.plan.files)
      assert.ok(
        live.requests.some(
          ([name, range]) =>
            name === '/data/' + file.key.slice(8) && range === 'bytes=0-0',
        ),
        'an original costs one byte: ' + file.key,
      );

    // A changed static file, an original with the same size but other
    // bytes, a missing original, and one whose ETag is not an MD5.
    live.files.get('/assets/app.js').body = Buffer.from('old');
    const photo = live.files.get('/data/images/photo.jpg');
    photo.body = Buffer.alloc(photo.body.length, 65);
    photo.etag = '"' + createHash('md5').update(photo.body).digest('hex') + '"';
    live.files.delete('/data/images/letter one.pdf');
    live.files.get('/data/images/census.png').etag = '"aa11-2"';
    live.files.get('/data/images/census.png').body = Buffer.from('census BYTES');
    const damaged = await checkLive(site, live.request);
    assert.deepEqual(damaged.problems, [
      '200 DIFFERENT assets/app.js',
      '200 DIFFERENT data/images/census.png',
      '206 DIFFERENT data/images/photo.jpg',
      '404 DIFFERENT data/images/letter one.pdf',
    ]);

    // --full reads every original whole.
    const fresh = await liveSite(site);
    assert.deepEqual((await checkLive(site, fresh.request, { full: true })).problems, []);
    assert.ok(fresh.requests.every(([, range]) => range === undefined));

    // A local original that changed after packaging is reported, not trusted.
    await writeFile(path.join(data, 'images/census.png'), 'census BYTES');
    assert.deepEqual((await checkLive(site, fresh.request)).problems, [
      'local DIFFERENT data/images/census.png (changed since it was packaged)',
    ]);
    // So is a package whose static files changed after it was made.
    await writeFile(path.join(site, 'dist/hosting/assets/extra.txt'), 'extra');
    await assert.rejects(checkLive(site, fresh.request), /prepare:hosting again/);
  } finally {
    await rm(site, { recursive: true, force: true });
  }
});

// Invented settings for a family that publishes with the Worker.
const workerFamily = {
  flyleaf: 1,
  family: { name: 'The Example family' },
  site: {
    id: 'example',
    domain: 'example.family',
    origin: 'https://example.family',
    hosting: 'worker',
  },
  maintainer: {
    name: 'Ada Example',
    first_name: 'Ada',
    pronoun: 'she',
    email: 'ada@example.org',
  },
  paths: {
    source_gedcom: 'data/family.src.ged',
    generated_gedcom: 'data/family.ged',
    book: 'book',
    site_content: 'site',
    email: 'email',
  },
  book: { pdf_name: 'example-family.pdf' },
  auth: {
    clerk_publishable_key: 'pk_live_Y2xlcmsuZXhhbXBsZS5mYW1pbHkk',
    clerk_frontend_api: 'https://clerk.example.family',
    allowed_emails: ['ada@example.org'],
    admin_emails: ['ada@example.org'],
    viewer_people: {},
  },
  cloudflare: {
    worker_name: 'example-family',
    account_id: 'example-account',
    archive_bucket: 'example-archive',
    submissions_bucket: 'example-submissions',
    submissions_db: { name: 'example-db', id: 'example-db-id' },
  },
  email: { from: 'ada@example.org', invitation_subject: 'Our family history' },
  deploy: { credentials_dir: '~/.config/flyleaf-example' },
  features: { submissions: false },
};
const website = fileURLToPath(new URL('..', import.meta.url));

void test('the hosting scripts run from folders whose paths have spaces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flyleaf copy '));
  try {
    const site = path.join(root, 'web site');
    for (const part of ['scripts', 'email', 'shared', 'templates'])
      await fs.promises.cp(path.join(website, part), path.join(site, part), {
        recursive: true,
      });
    for (const file of ['flyleaf-settings.mjs', 'package.json'])
      await fs.promises.cp(path.join(website, file), path.join(site, file));
    await fs.promises.symlink(
      path.join(website, 'node_modules'),
      path.join(site, 'node_modules'),
    );
    const family = path.join(root, 'family folder');
    await mkdir(path.join(family, 'site'), { recursive: true });
    await mkdir(path.join(family, 'email'));
    await writeFile(path.join(family, 'flyleaf.json'), JSON.stringify(workerFamily));
    await writeFile(path.join(family, 'site/screens.json'), '[]');
    await writeFile(
      path.join(family, 'email/invitees.local.json'),
      JSON.stringify([
        { email: 'tom@example.com', firstName: 'Tom', person: 'tom-example' },
      ]),
    );
    await mkdir(path.join(site, 'public/login'), { recursive: true });
    for (const dir of ['dist/hosting/assets', 'work/worker-bundle', 'work/a', 'work/b'])
      await mkdir(path.join(site, dir), { recursive: true });
    await writeFile(path.join(site, 'dist/hosting/assets/index.html'), 'site');
    const run = (script, ...args) =>
      spawnSync(process.execPath, [path.join(site, script), ...args], {
        cwd: site,
        encoding: 'utf8',
        env: {
          ...process.env,
          FLYLEAF_FAMILY: family,
          LIVE_PROFILE: path.join(root, 'no profile'),
        },
      });
    const expect = (result, status, pattern) => {
      assert.equal(result.status, status, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, pattern);
    };
    expect(run('scripts/write-login-page.mjs'), 0, /Wrote public\/login\/index.html/);
    assert.match(
      await readFile(path.join(site, 'public/login/index.html'), 'utf8'),
      /The Example family/,
    );
    expect(run('scripts/write-login-page.mjs', '--check'), 0, /matches/);
    expect(run('scripts/write-wrangler.mjs'), 0, /Wrote wrangler.jsonc/);
    expect(run('scripts/write-wrangler.mjs', '--check'), 0, /matches/);
    expect(run('scripts/build-hashes.mjs', '--write', 'work/hashes.json'), 0, /Recorded 1 files/);
    expect(run('scripts/compare-screens.mjs', '--compare', 'work/a', 'work/b'), 0, /All 0 screenshots match/);
    // It finds its own packages, so it gets as far as the missing profile.
    expect(run('scripts/verify-live.mjs'), 2, /No signed-in browser profile/);
    expect(run('email/invite.mjs'), 0, /Family: The Example family[\s\S]*Preview written/);
    assert.match(
      await readFile(path.join(family, 'email/out/tom@example.com.html'), 'utf8'),
      /Tom/,
    );
    expect(run('email/invite.mjs', '--eml'), 0, /Email written/);
    assert.match(
      await readFile(path.join(family, 'email/out/tom@example.com.eml'), 'utf8'),
      /^From: ada@example\.org\r\nTo: tom@example\.com\r\n/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('deploy builds the book with flyleaf book, the same steps as the command', async () => {
  const family = await mkdtemp(path.join(tmpdir(), 'family deploy '));
  try {
    await writeFile(path.join(family, 'flyleaf.json'), JSON.stringify(workerFamily));
    // A stand-in Python records how deploy runs the book build, then stops it.
    const record = path.join(family, 'book-command.txt');
    const python = path.join(family, 'python');
    await writeFile(python, '#!/bin/sh\nprintf "%s\\n" "$@" > "$RECORD"\nexit 3\n', {
      mode: 0o755,
    });
    // Stand-ins for npm and npx, so a change in the order of steps can never
    // install or build for real here.
    const bin = path.join(family, 'bin');
    await mkdir(bin);
    for (const name of ['npm', 'npx'])
      await writeFile(path.join(bin, name), '#!/bin/sh\nexit 9\n', { mode: 0o755 });
    const result = spawnSync(path.join(website, 'scripts/deploy.sh'), ['--dry-run'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        FLYLEAF_FAMILY: family,
        PYTHON: python,
        RECORD: record,
      },
    });
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.deepEqual((await readFile(record, 'utf8')).trim().split('\n'), [
      path.join(website, '..', 'flyleaf'),
      'book',
      '--family',
      family,
    ]);
  } finally {
    await rm(family, { recursive: true, force: true });
  }
});

const git = (folder, ...args) => {
  const result = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
async function repository(root, files) {
  await mkdir(root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'ada@example.org');
  git(root, 'config', 'user.name', 'Ada Example');
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Start');
}

void test('deploy stops on an uncommitted change to anything it publishes, and only those', async () => {
  const { publishInputs, uncommitted } = await import('../scripts/check-committed.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'flyleaf committed '));
  try {
    const engine = path.join(root, 'flyleaf');
    const family = path.join(root, 'family');
    await repository(engine, {
      'flyleaf': 'command',
      'Makefile': 'book:',
      'scripts/book.py': 'print(1)',
      'website/package.json': '{}',
      'website/package-lock.json': '{}',
      'website/vite.config.ts': 'export default {}',
      'website/flyleaf-settings.mjs': '',
      'website/index.html': '<html>',
      'website/shared/submission-policy.json': '{}',
      'website/templates/login.html': '<html>',
      'website/content-defaults/screens.json': '[]',
    });
    const settings = {
      ...workerFamily,
      paths: { ...workerFamily.paths, source_gedcom: 'tree/family.src.ged' },
      book: {
        ...workerFamily.book,
        fonts: { files: ['fonts/Serif.otf', '/Library/Fonts/System.ttf'] },
      },
    };
    await repository(family, {
      'flyleaf.json': JSON.stringify(settings),
      'tree/family.src.ged': '0 HEAD\n',
      'data/family.ged': '0 HEAD\n',
      'data/representations.json': '{}',
      'book/book.yaml': 'title: A',
      'book/COVERAGE.md': 'old',
      'book/CLAIMS-MAP.json': '{}',
      'images/photo.jpg': 'photo',
      'site/edition.ged': '0 HEAD\n',
      'fonts/Serif.otf': 'font',
      'notes/research.md': 'notes',
    });
    const inputs = publishInputs(settings, family, engine);
    const check = () => ({
      family: uncommitted(family, inputs.family),
      engine: uncommitted(engine, inputs.engine),
    });
    assert.deepEqual(check(), { family: [], engine: [] });

    // Remade by every build, or not published: never a reason to stop.
    await writeFile(path.join(family, 'data/family.ged'), '0 HEAD\n1 NOTE new\n');
    await writeFile(path.join(family, 'book/COVERAGE.md'), 'new');
    await writeFile(path.join(family, 'book/CLAIMS-MAP.json'), '{"new": 1}');
    await writeFile(path.join(family, 'notes/research.md'), 'more notes');
    assert.deepEqual(check(), { family: [], engine: [] });

    // Everything the book and site builds read.
    for (const [file, text] of [
      ['tree/family.src.ged', '0 HEAD\n1 NOTE edited\n'],
      ['images/photo.jpg', 'retouched'],
      ['images/new scan.pdf', 'scan'],
      ['site/edition.ged', '0 HEAD\n1 NOTE edited\n'],
      ['data/representations.json', '{"x": 1}'],
      ['book/book.yaml', 'title: B'],
      ['fonts/Serif.otf', 'new font'],
      ['flyleaf.json', JSON.stringify({ ...settings, site: { ...settings.site, tagline: 'x' } })],
    ])
      await writeFile(path.join(family, file), text);
    assert.deepEqual(
      check().family.map((line) => line.slice(3).replace(/^"|"$/g, '')).sort(),
      [
        'book/book.yaml',
        'data/representations.json',
        'flyleaf.json',
        'fonts/Serif.otf',
        'images/new scan.pdf',
        'images/photo.jpg',
        'site/edition.ged',
        'tree/family.src.ged',
      ],
    );

    // Any file in Flyleaf's checkout.
    for (const file of [
      'flyleaf',
      'Makefile',
      'website/package.json',
      'website/package-lock.json',
      'website/vite.config.ts',
      'website/flyleaf-settings.mjs',
      'website/index.html',
      'website/shared/submission-policy.json',
      'website/templates/login.html',
      'website/content-defaults/screens.json',
      'website/content-defaults/new.json',
    ])
      await writeFile(path.join(engine, file), 'changed');
    assert.equal(check().engine.length, 11);

    // Flyleaf inside the family folder is checked as part of the family.
    assert.ok(publishInputs(settings, root, engine).family.includes('flyleaf'));
    assert.ok(!publishInputs(settings, family, engine).family.some((p) => p.includes('..')));
    assert.throws(() => uncommitted(path.join(root, 'nowhere'), ['.']), /git checkout/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('deploy stops on an ignored file it would publish unless the tree pins its bytes', async () => {
  const { ignoredFiles, publishInputs, unpinnedFiles } = await import('../scripts/check-committed.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'flyleaf ignored '));
  try {
    const family = path.join(root, 'family');
    const settings = workerFamily;
    const scan = 'a large scan';
    const sha = createHash('sha256').update(scan).digest('hex');
    const tree = (pin) =>
      '0 HEAD\n0 @O1@ OBJE\n1 FILE images/big/scan.pdf\n2 FORM pdf\n' + pin +
      '2 _PROVENANCE notes.json\n3 _HASH ' + '0'.repeat(64) + '\n0 TRLR\n';
    await repository(family, {
      '.gitignore': 'images/big/\nimages/loose/\n',
      'flyleaf.json': JSON.stringify(settings),
      [settings.paths.source_gedcom]: tree(''),
      'book/sketches/0001-ada.typ': 'Ada.',
    });
    await mkdir(path.join(family, 'images/big'), { recursive: true });
    await mkdir(path.join(family, 'images/loose'), { recursive: true });
    await writeFile(path.join(family, 'images/big/scan.pdf'), scan);
    await writeFile(path.join(family, 'images/big/.DS_Store'), 'junk');
    await writeFile(path.join(family, 'images/loose/unused.jpg'), 'never named');
    await writeFile(path.join(family, 'images/loose/figure.jpg'), 'a figure');
    const check = () =>
      unpinnedFiles(family, ignoredFiles(family, publishInputs(settings, family, root).family), settings);

    // Named by the tree with no _SHA256 of its own (the nested _HASH is not its).
    assert.deepEqual(check().map((line) => line.split(':')[0]), ['images/big/scan.pdf']);
    assert.match(check()[0], new RegExp(`_SHA256 ${sha}`));
    // A wrong _SHA256 stops too; the right one pins the bytes.
    const source = path.join(family, settings.paths.source_gedcom);
    await writeFile(source, tree('2 _SHA256 ' + 'f'.repeat(64) + '\n'));
    assert.match(check()[0], /does not match/);
    await writeFile(source, tree(`2 _SHA256 ${sha}\n`));
    assert.deepEqual(check(), []);
    // A story that uses an ignored picture: nothing would check its bytes.
    await writeFile(path.join(family, 'book/sketches/0001-ada.typ'), 'Ada.\n#fig("loose/figure.jpg")');
    assert.deepEqual(check(), [
      'images/loose/figure.jpg: git ignores it, and a story or site file names it. Commit it.',
    ]);
    // Outside images/, an ignored file the build reads always stops a deploy.
    await writeFile(path.join(family, '.gitignore'), 'images/big/\nimages/loose/\nsite/private.json\n');
    await mkdir(path.join(family, 'site'), { recursive: true });
    await writeFile(path.join(family, 'site/private.json'), '{}');
    await writeFile(path.join(family, 'book/sketches/0001-ada.typ'), 'Ada.');
    assert.deepEqual(check(), [
      'site/private.json: git ignores it, and the book or site reads it. Commit it, or stop ignoring it.',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('deploy installs the locked packages and runs every test suite before it packages', async () => {
  const family = await mkdtemp(path.join(tmpdir(), 'family deploy '));
  try {
    await writeFile(path.join(family, 'flyleaf.json'), JSON.stringify(workerFamily));
    // Stand-ins for Python, npm and npx record each command and succeed.
    // node runs for real, except a test run, which is recorded.
    const bin = path.join(family, 'bin');
    await mkdir(bin);
    const record = path.join(family, 'commands.txt');
    const stand = (name, body = '') =>
      writeFile(
        path.join(bin, name),
        `#!/bin/sh\n${body}printf '%s\\n' "${name} $*" >> "$RECORD"\nexit 0\n`,
        { mode: 0o755 },
      );
    await stand('python');
    await stand('npm');
    await stand('npx');
    await stand(
      'node',
      `case "$1" in --test) ;; *) exec "${process.execPath}" "$@" ;; esac\n`,
    );
    const result = spawnSync(path.join(website, 'scripts/deploy.sh'), ['--dry-run'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        FLYLEAF_FAMILY: family,
        PYTHON: path.join(bin, 'python'),
        RECORD: record,
      },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const engine = path.join(website, '..');
    const commands = (await readFile(record, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => line.replaceAll(engine + '/', '<flyleaf>/').replaceAll(family, '<family>'));
    assert.deepEqual(commands, [
      'python <flyleaf>/flyleaf book --family <family>',
      'npm ci',
      'npm run build',
      'python <flyleaf>/scripts/check-family-text.py',
      'npm run typecheck',
      'npm run lint',
      'npm run worker:typecheck',
      'npm run worker:lint',
      'npm run archive:lint',
      'node --test tests/login-branding.test.mjs',
      'python <flyleaf>/flyleaf test --family <family>',
      'npm run prepare:hosting',
      'npx wrangler deploy --dry-run --outdir work/worker-bundle',
    ]);
  } finally {
    await rm(family, { recursive: true, force: true });
  }
});

void test('deploy warns, at the end, when the live site would use a Clerk development key', async () => {
  const { deployWarnings, workerVars } = await import('../scripts/write-wrangler.mjs');
  assert.deepEqual(deployWarnings(workerFamily), []);
  const testing = {
    ...workerFamily,
    auth: { ...workerFamily.auth, clerk_publishable_key: 'pk_test_ZXhhbXBsZSQ' },
  };
  assert.match(deployWarnings(testing)[0], /development key \(pk_test_\)/);
  // Sending things needs features.submissions: true and the Worker.
  const sharing = (features, hosting = 'worker') =>
    workerVars(
      { ...workerFamily, features, site: { ...workerFamily.site, hosting } },
      { strict: false },
    ).SUBMISSIONS_OPEN;
  assert.equal(sharing({ submissions: true }), 'true');
  assert.equal(sharing({ submissions: false }), 'false');
  assert.equal(sharing({}), 'false');
  assert.equal(sharing(undefined), 'false');
  assert.equal(sharing({ submissions: 'yes' }), 'false');
  assert.equal(sharing({ submissions: true }, 'static'), 'false');
});

void test('the invitation letter escapes what it fills in, and an .eml file holds both letters', async () => {
  const { fill, emlMessage } = await import('../email/invite.mjs');
  const values = {
    firstName: 'Tom <script>alert(1)</script>',
    inviteUrl: 'https://example.family/login?a=1&b="2"',
  };
  const html = fill('<p>Dear {{firstName}},</p><a href="{{inviteUrl}}">x</a>{{missing}}', values, {
    html: true,
  });
  assert.equal(
    html,
    '<p>Dear Tom &lt;script&gt;alert(1)&lt;/script&gt;,</p>' +
      '<a href="https://example.family/login?a=1&amp;b=&quot;2&quot;">x</a>',
  );
  // The plain-text letter keeps the words as written.
  assert.equal(fill('Dear {{firstName}}', values), 'Dear Tom <script>alert(1)</script>');

  const eml = emlMessage({
    from: 'ada@example.org',
    to: 'tom@example.com',
    subject: 'Our family’s history',
    text: 'Dear Tom,\n',
    html: '<p>Dear Tom,</p>',
    boundary: 'fixed',
  });
  const [head, ...parts] = eml.split('\r\n--flyleaf-fixed');
  assert.match(head, /^From: ada@example\.org\r\nTo: tom@example\.com\r\n/);
  assert.match(head, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  assert.match(head, /Content-Type: multipart\/alternative; boundary="flyleaf-fixed"/);
  const decoded = (part) =>
    Buffer.from(part.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(parts[0], /text\/plain; charset=utf-8/);
  assert.equal(decoded(parts[0]), 'Dear Tom,\n');
  assert.match(parts[1], /text\/html; charset=utf-8/);
  assert.equal(decoded(parts[1]), '<p>Dear Tom,</p>');
  assert.equal(parts[2], '--\r\n');
  // A name with accents is encoded, and its address left as it is.
  const named = (from) =>
    emlMessage({ from, to: 'tom@example.com', subject: 's', text: '', html: '' }).split('\r\n')[0];
  const accented = named('André Example <andre@example.com>');
  assert.match(accented, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <andre@example\.com>$/);
  assert.equal(Buffer.from(accented.split('?')[3], 'base64').toString('utf8'), 'André Example');
  assert.equal(named('Ada Example <ada@example.org>'), 'From: "Ada Example" <ada@example.org>');
  assert.equal(named('"Ada, Example" <ada@example.org>'), 'From: "Ada, Example" <ada@example.org>');
  // A line break in a header could add headers of its own.
  assert.throws(
    () => emlMessage({ from: 'a@example.org', to: 'b@example.com\r\nBcc: c@example.com', subject: 's', text: '', html: '' }),
    /line break/,
  );
});

void test('the signed-out check passes a closed site and names every opening', async () => {
  const origin = 'https://example.family';
  const checks = [
    { path: '/', redirect: '/login' },
    { path: '/data/family.ged', status: 401 },
    { path: '/data/images/scan.jpg', status: 401 },
  ];
  const site = (answers) => async (url) => {
    const answer = answers[new URL(url).pathname];
    if (answer instanceof Error) throw answer;
    return {
      status: answer[0],
      header: (name) => (name === 'location' ? (answer[1] ?? null) : null),
    };
  };
  const closed = {
    '/': [302, '/login?returnTo=%2F'],
    '/data/family.ged': [401],
    '/data/images/scan.jpg': [401],
  };
  assert.deepEqual(await checkSignedOut(origin, site(closed), checks), []);
  const open = await checkSignedOut(
    origin,
    site({
      '/': [200],
      '/data/family.ged': [200],
      '/data/images/scan.jpg': new Error('connection reset'),
    }),
    checks,
  );
  assert.deepEqual(open, [
    '/: answered 200, not a redirect to /login',
    '/data/family.ged: answered 200, not 401',
    '/data/images/scan.jpg: no answer (connection reset)',
  ]);
  // A redirect to another site, or to another page, is not the sign-in page.
  for (const location of ['https://elsewhere.example/login', '/about'])
    assert.equal(
      (
        await checkSignedOut(origin, site({ ...closed, '/': [302, location] }), checks)
      ).length,
      1,
    );
});

void test('screenshots leave out the sign-in page on a static site', async () => {
  const { screensFor } = await import('../scripts/compare-screens.mjs');
  const entries = [
    { id: 'home', hash: '' },
    { id: 'login', hash: 'login/', wait: '#status' },
    { id: 'invite', hash: 'login/accept-invitation' },
    { id: 'share', hash: '#view=share', hosting: 'worker' },
    { id: 'tree', hash: '#view=tree' },
  ];
  assert.deepEqual(screensFor(entries, 'static').map((e) => e.id), ['home', 'tree']);
  assert.deepEqual(
    screensFor(entries, 'worker').map((e) => e.id),
    ['home', 'login', 'invite', 'share', 'tree'],
  );
});

void test('resetting the web book keeps uncommitted annotation edits unless forced', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flyleaf reset '));
  try {
    const site = path.join(root, 'website');
    await mkdir(path.join(site, 'scripts'), { recursive: true });
    for (const file of ['flyleaf-settings.mjs', 'package.json'])
      await fs.promises.cp(path.join(website, file), path.join(site, file));
    await fs.promises.cp(
      path.join(website, 'scripts/reset-web-book.sh'),
      path.join(site, 'scripts/reset-web-book.sh'),
    );
    await mkdir(path.join(site, 'work/deployed/native-book'), { recursive: true });
    await mkdir(path.join(site, 'public/data/native-book'), { recursive: true });
    await writeFile(path.join(site, 'work/deployed/native-book/chapter.json'), '{"live": 1}');
    await writeFile(path.join(site, 'public/data/native-book/chapter.json'), '{"local": 1}');
    const family = path.join(root, 'family');
    await repository(family, {
      'flyleaf.json': JSON.stringify(workerFamily),
      'site/book-annotations.json': '{"links": []}',
      'site/book-annotations/chapter.json': '{}',
    });
    const reset = (...args) =>
      spawnSync(path.join(site, 'scripts/reset-web-book.sh'), args, {
        encoding: 'utf8',
        env: { ...process.env, FLYLEAF_FAMILY: family },
      });
    const edited = path.join(family, 'site/book-annotations.json');
    await writeFile(edited, '{"links": ["reviewed by hand"]}');
    const refused = reset();
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /not committed[\s\S]*book-annotations\.json[\s\S]*--force/);
    assert.equal(await readFile(edited, 'utf8'), '{"links": ["reviewed by hand"]}');
    assert.equal(
      await readFile(path.join(site, 'public/data/native-book/chapter.json'), 'utf8'),
      '{"local": 1}',
    );
    const forced = reset('--force');
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    assert.equal(await readFile(edited, 'utf8'), '{"links": []}');
    assert.equal(
      await readFile(path.join(site, 'public/data/native-book/chapter.json'), 'utf8'),
      '{"live": 1}',
    );
    // With nothing to lose, no --force is needed.
    assert.equal(reset().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('a static build prints its warning on lines of its own', async () => {
  const { printStaticWarning, staticWarning } = await import('../scripts/static-warning.mjs');
  const lines = [];
  printStaticWarning((text) => lines.push(text));
  assert.deepEqual(lines, [`\n${staticWarning}\n`]);
  assert.match(staticWarning, /anyone with its address can read all of it, and every document in it/);
});

void test('CI reads with the least rights, checks Typst, and publishes only tested work', async () => {
  const workflows = path.join(website, '../.github/workflows');
  const ci = await readFile(path.join(workflows, 'ci.yml'), 'utf8');
  const pages = await readFile(path.join(workflows, 'pages.yml'), 'utf8');
  for (const [name, text] of [['ci.yml', ci], ['pages.yml', pages]]) {
    // Every workflow starts read-only.
    assert.match(text, /^permissions:\n {2}contents: read\n/m, name);
    // Every download of Typst is checked against its published SHA-256.
    const downloads = text.match(/curl [^\n]*typst[^\n]*\n[^\n]*/g) ?? [];
    assert.ok(downloads.length > 0, name);
    for (const step of downloads)
      assert.match(
        step,
        /\n\s*echo "[a-f0-9]{64} {2}typst\.tar\.xz" \| (?:sha256sum|shasum -a 256) --check --strict$/,
        name,
      );
  }
  // Pages runs the tests first, and only its deploy job may publish.
  assert.match(ci, /^ {2}workflow_call:/m);
  assert.match(pages, /^ {2}test:\n(?: {4}.*\n)* {4}uses: \.\/\.github\/workflows\/ci\.yml/m);
  assert.match(pages, /^ {2}build:\n {4}needs: test\n/m);
  const writes = [...pages.matchAll(/^( *)pages: write/gm)];
  assert.equal(writes.length, 1);
  const deploy = pages.slice(pages.indexOf('\n  deploy:'));
  assert.match(deploy, /permissions:\n {6}pages: write\n {6}id-token: write/);
});

void test('the home page can be read by keyboard and shared with a preview', async () => {
  const pages = path.join(website, '../pages');
  const html = await readFile(path.join(pages, 'index.html'), 'utf8');
  assert.match(html, /<body>\s*<a class="skip" href="#main">/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<pre tabindex="0"/);
  const image = html.match(/<meta property="og:image" content="https:\/\/flyleaf\.family\/([^"]+)">/)?.[1];
  assert.ok(image, 'og:image');
  assert.ok(fs.existsSync(path.join(pages, image)), image + ' is served from pages/');
  for (const property of ['og:title', 'og:description', 'og:url'])
    assert.match(html, new RegExp(`<meta property="${property}" content="[^"]+">`));
  assert.match(html, /href="https:\/\/github\.com\/ian-c-leonard\/flyleaf\/blob\/main\/docs\/README\.md">Docs</);
});

void test('flyleaf gate says plainly that a static site has no deploy to compare with', async () => {
  const family = await mkdtemp(path.join(tmpdir(), 'family gate '));
  try {
    const settings = { ...workerFamily, site: { ...workerFamily.site, hosting: 'static' } };
    await writeFile(path.join(family, 'flyleaf.json'), JSON.stringify(settings));
    const result = spawnSync(path.join(website, 'scripts/rebuild-and-compare.sh'), [], {
      encoding: 'utf8',
      env: { ...process.env, FLYLEAF_FAMILY: family },
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /only a Worker\nsite has\. This family's site is static/);
  } finally {
    await rm(family, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Invented Cloudflare names, so these checks do not depend on the current
// family's flyleaf.json. The archive scripts read the settings as they load.
const family = await mkdtemp(path.join(tmpdir(), 'family-settings-'));
test.after(() => rm(family, { recursive: true, force: true }));
await writeFile(
  path.join(family, 'flyleaf.json'),
  JSON.stringify({
    cloudflare: {
      account_id: 'example-account',
      archive_bucket: 'example-family-archive',
      submissions_bucket: 'example-family-submissions',
    },
    book: { pdf_name: 'example-family.pdf' },
  }),
);
process.env.FLYLEAF_FAMILY = family;
const {
  assessStorage,
  freezeArchive,
  loadBatch,
  originalPath,
  restoreArchive,
  runArchive,
  sha256,
  validatePlan,
  verifyObject,
} = await import('../scripts/archive-sync.mjs');
const { ARCHIVE_TARGET, collectObjects, metricBytes, R2Archive } = await import(
  '../scripts/r2-client.mjs'
);

async function fixture(t, count = 3) {
  const site = await mkdtemp(path.join(tmpdir(), 'family-upload-'));
  t.after(() => rm(site, { recursive: true, force: true }));
  await mkdir(path.join(site, 'dist/client/data/images/books'), {
    recursive: true,
  });
  await mkdir(path.join(site, 'dist/hosting/assets/data'), { recursive: true });
  const files = [];
  for (let i = 0; i < count; i++) {
    const body = Buffer.from('Original file ' + i);
    const relative = 'images/books/file-' + i + '.pdf';
    const file = {
      key: 'archive/' + relative,
      path: 'dist/client/data/' + relative,
      bytes: body.length,
      sha256: sha256(body),
    };
    files.push(file);
    await writeFile(path.join(site, file.path), body);
  }
  const plan = {
    sourceSha256: sha256('genealogy-input'),
    archiveFiles: files.length,
    archiveBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  await writeFile(
    path.join(site, 'dist/hosting/objects.json'),
    JSON.stringify(plan),
  );
  await writeFile(
    path.join(site, 'dist/hosting/assets/data/manifest.json'),
    JSON.stringify({
      sourceSha256: plan.sourceSha256,
      assets: files.map((file) => originalPath(file.key)),
      missingAssets: [],
    }),
  );
  return { site, plan };
}

class MemoryArchive {
  target = ARCHIVE_TARGET;
  objects = new Map();
  puts = [];
  gets = [];
  failKey;
  active = 0;
  maximumActive = 0;
  async inventory() {
    return {
      account: this.target.account,
      complete: true,
      privateTarget: true,
      metricsBytes: 0,
      buckets: [
        {
          name: this.target.bucket,
          jurisdiction: 'default',
          pendingUploads: 0,
          objects: [...this.objects.entries()].map(([key, body]) => ({
            key,
            bytes: body.length,
            etag: sha256(body),
          })),
        },
      ],
    };
  }
  async head(key) {
    const body = this.objects.get(key);
    return body ? { bytes: body.length, etag: sha256(body) } : null;
  }
  async get(key, etag) {
    this.gets.push(key);
    const body = this.objects.get(key);
    assert.equal(sha256(body), etag);
    return { body: Readable.from([body]), etag };
  }
  async put(file, filename) {
    if (file.key === this.failKey) throw new Error('Simulated interruption');
    assert.equal(this.objects.has(file.key), false);
    this.active++;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.objects.set(file.key, await readFile(filename));
    this.puts.push(file.key);
    this.active--;
  }
}

void test('frozen batch retains original bytes across a later build and verifies every uploaded file', async (t) => {
  const { site, plan } = await fixture(t, 7);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  await writeFile(path.join(site, plan.files[0].path), 'new build bytes');
  const store = new MemoryArchive();
  const { receipt } = await runArchive(batch, store, { upload: true });
  assert.equal(receipt.complete, true);
  // Every account snapshot must be attributable to the same rehashed frozen
  // plan as the completed receipt, including the final publication preflight.
  assert.ok(receipt.preflights.length >= 2);
  assert.ok(
    receipt.preflights.every(
      (snapshot) => snapshot.planSha256 === batch.planSha256,
    ),
  );
  assert.equal(store.puts.length, 7);
  assert.equal(store.gets.length, 7);
  assert.equal(store.maximumActive, 3);
  assert.equal(
    sha256(store.objects.get(plan.files[0].key)),
    plan.files[0].sha256,
  );
  assert.ok(
    receipt.files.every((file) => file.verification.sha256 === file.sha256),
  );
});

void test('interrupted batch resumes without re-uploading a completed object; old receipt is not trusted instead of reading bytes', async (t) => {
  const { site, plan } = await fixture(t);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  store.failKey = plan.files[1].key;
  await assert.rejects(
    runArchive(batch, store, { upload: true, concurrency: 1 }),
    /interruption/,
  );
  assert.equal(store.puts.length, 1);
  const partial = JSON.parse(
    await readFile(
      path.join(
        batch.batchDir,
        'runs',
        (await readdir(path.join(batch.batchDir, 'runs')))[0],
      ),
    ),
  );
  assert.equal(partial.complete, false);
  assert.equal(partial.files[0].status, 'verified');
  assert.equal(partial.files[1].status, 'failed');
  store.failKey = undefined;
  const { receipt } = await runArchive(batch, store, { upload: true });
  assert.equal(receipt.complete, true);
  assert.equal(store.puts.length, 3);
  assert.equal(store.gets.filter((key) => key === plan.files[0].key).length, 2);
});

void test('equal-length remote corruption is rejected without overwriting it', async (t) => {
  const { site, plan } = await fixture(t, 1);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  const corrupt = Buffer.alloc(plan.files[0].bytes, 65);
  store.objects.set(plan.files[0].key, corrupt);
  await assert.rejects(
    runArchive(batch, store, { upload: true }),
    /hash conflicts/,
  );
  assert.equal(store.puts.length, 0);
  assert.deepEqual(store.objects.get(plan.files[0].key), corrupt);
});

void test('stale source bytes, frozen bytes, manifest mismatch and source symlink prevent upload', async (t) => {
  for (const damage of ['source', 'frozen', 'manifest', 'symlink']) {
    const { site, plan } = await fixture(t, 1);
    if (damage === 'frozen') {
      const batch = await freezeArchive(site, ARCHIVE_TARGET);
      await writeFile(
        path.join(batch.batchDir, 'files', originalPath(plan.files[0].key)),
        'changed',
      );
      await assert.rejects(
        loadBatch(batch.batchDir, ARCHIVE_TARGET),
        /bytes changed/,
      );
    } else {
      if (damage === 'source')
        await writeFile(path.join(site, plan.files[0].path), 'changed');
      if (damage === 'manifest')
        await writeFile(
          path.join(site, 'dist/hosting/assets/data/manifest.json'),
          '{}',
        );
      if (damage === 'symlink') {
        const original = path.join(site, plan.files[0].path);
        const elsewhere = path.join(site, 'elsewhere.pdf');
        await writeFile(elsewhere, await readFile(original));
        await rm(original);
        await symlink(elsewhere, original);
      }
      await assert.rejects(freezeArchive(site, ARCHIVE_TARGET));
    }
  }
});

void test('unsafe keys, duplicate entries, false totals and arbitrary source paths are rejected', async (t) => {
  const { plan } = await fixture(t, 1);
  for (const key of [
    'archive/images/../secrets',
    'archive/images/a\\b',
    'archive/images/a\0b',
    '/absolute',
    'archive/images//a',
  ]) {
    assert.throws(() => originalPath(key), /Unsafe/);
  }
  for (const change of [
    (p) => p.files.push(p.files[0]),
    (p) => p.archiveBytes++,
    (p) => (p.files[0].path = '../../credentials'),
    (p) => (p.files[0].bytes = 6 * 1024 ** 3),
  ]) {
    const damaged = structuredClone(plan);
    change(damaged);
    assert.throws(() => validatePlan(damaged));
  }
});

void test('budget counts other buckets, retained objects and metadata reserve; unresolved or pending storage stops all writes', async (t) => {
  const { site } = await fixture(t);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  const snapshot = await store.inventory();
  snapshot.buckets.push({
    name: 'other-project',
    jurisdiction: 'eu',
    pendingUploads: 0,
    objects: [{ key: 'held', bytes: 900_000_000 }],
  });
  const budget = assessStorage(snapshot, batch);
  assert.equal(budget.payloadBytes, 900_000_000);
  assert.equal(budget.newObjects, 3);
  assert.ok(budget.metadataReserveBytes > 100_000_000);
  for (const change of [
    (s) => (s.complete = false),
    (s) => (s.privateTarget = false),
    (s) => (s.buckets[1].objects[0].bytes = 9_950_000_000),
    (s) => (s.metricsBytes = 9_950_000_000),
    (s) => (s.buckets[1].pendingUploads = 1),
  ]) {
    const damaged = structuredClone(snapshot);
    change(damaged);
    store.inventory = async () => damaged;
    await assert.rejects(runArchive(batch, store, { upload: true }));
    assert.equal(store.puts.length, 0);
  }
});

void test('submission reserve stays constant across concurrent intake and refuses allocation drift', async (t) => {
  const { site } = await fixture(t);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const snapshot = await new MemoryArchive().inventory();
  const before = assessStorage(snapshot, batch);
  assert.equal(before.submissionReserveBytes, 1_000_000_000);
  snapshot.buckets.push({
    name: 'example-family-submissions',
    jurisdiction: 'default',
    pendingUploads: 0,
    objects: [{ key: 'originals/one', bytes: 50_000_000 }],
  });
  const after = assessStorage(snapshot, batch);
  assert.equal(after.conservativeBytes, before.conservativeBytes);
  assert.equal(
    after.submissionReserveBytes,
    1_000_000_000 - 50_000_000 - 65_536,
  );
  snapshot.buckets[1].objects[0].bytes = 1_000_000_000;
  assert.throws(() => assessStorage(snapshot, batch), /reserved allocation/);
});

void test('restoration creates original paths, resumes matching files, and never overwrites different local bytes', async (t) => {
  const { site } = await fixture(t);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  const { receipt } = await runArchive(batch, store, { upload: true });
  const dest = path.join(site, 'restored');
  const first = await restoreArchive(receipt, store, dest);
  assert.equal(first.files.filter((f) => f.action === 'restored').length, 3);
  const second = await restoreArchive(receipt, store, dest);
  assert.equal(
    second.files.filter((f) => f.action === 'already-present').length,
    3,
  );
  const filename = path.join(dest, receipt.files[0].originalPath);
  await writeFile(filename, 'Keep this local file');
  await assert.rejects(restoreArchive(receipt, store, dest), /bytes changed/);
  assert.equal(await readFile(filename, 'utf8'), 'Keep this local file');
  await assert.rejects(
    restoreArchive(receipt, store, dest, ['unknown']),
    /Unknown/,
  );
});

void test('restoration rejects symlink directories and damaged remote bytes before installing files', async (t) => {
  const { site } = await fixture(t, 1);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  const { receipt } = await runArchive(batch, store, { upload: true });
  const dest = path.join(site, 'restore');
  await mkdir(dest);
  await symlink(
    path.join(site, 'dist/client/data/images'),
    path.join(dest, 'images'),
  );
  await assert.rejects(restoreArchive(receipt, store, dest), /symlink/);
  await rm(path.join(dest, 'images'));
  store.objects.set(
    receipt.files[0].key,
    Buffer.alloc(receipt.files[0].bytes, 42),
  );
  await assert.rejects(restoreArchive(receipt, store, dest), /do not match/);
  await assert.rejects(
    readFile(path.join(dest, receipt.files[0].originalPath)),
    { code: 'ENOENT' },
  );
});

void test('S3 pagination drains all pages and rejects missing, repeated or contradictory continuation state', async () => {
  const pages = [
    {
      IsTruncated: true,
      Contents: [{ Key: 'a', Size: 3 }],
      NextContinuationToken: 'next',
    },
    { IsTruncated: false, Contents: [{ Key: 'b', Size: 5 }] },
  ];
  let calls = 0;
  const objects = await collectObjects(
    {
      send: async (command) => {
        if (calls) assert.equal(command.input.ContinuationToken, 'next');
        return pages[calls++];
      },
    },
    'bucket',
  );
  assert.equal(objects.length, 2);
  for (const bad of [
    { IsTruncated: true },
    {},
    { IsTruncated: false, Contents: [{ Key: 'a', Size: -1 }] },
  ]) {
    await assert.rejects(collectObjects({ send: async () => bad }, 'bucket'));
  }
});

void test('S3 conditional single PUT recreates its stream and an ambiguous successful upload is verified by caller', async (t) => {
  const { site } = await fixture(t, 1);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const file = batch.files[0];
  const store = new R2Archive('test-token');
  let putInput;
  let uploaded;
  store.client = () => ({
    send: async (command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        putInput = command.input;
        uploaded = Buffer.concat(await Array.fromAsync(command.input.Body));
        throw Object.assign(new Error('Response lost'), { code: 'ECONNRESET' });
      }
      if (command.constructor.name === 'HeadObjectCommand')
        return { ContentLength: uploaded.length, ETag: 'etag' };
      assert.equal(command.input.IfMatch, 'etag');
      return { Body: Readable.from([uploaded]), ETag: 'etag' };
    },
  });
  await store.put(file, path.join(batch.batchDir, 'files', file.originalPath));
  const checked = await verifyObject(store, file);
  assert.equal(putInput.IfNoneMatch, '*');
  assert.equal(putInput.ContentMD5, file.md5);
  assert.equal(putInput.StorageClass, 'STANDARD');
  assert.equal(checked.sha256, file.sha256);
});

void test('provider metrics require all storage states and include metadata separately from payload', () => {
  const metrics = Object.fromEntries(
    ['standard', 'infrequentAccess'].map((type) => [
      type,
      Object.fromEntries(
        ['uploaded', 'published'].map((state) => [
          state,
          { objects: 1, payloadSize: 10, metadataSize: 2 },
        ]),
      ),
    ]),
  );
  assert.equal(metricBytes(metrics), 48);
  delete metrics.standard.uploaded.metadataSize;
  assert.throws(() => metricBytes(metrics), /Incomplete/);
});

void test('final inventory rejects deletion or changed ETag after a file was verified and retains the earlier complete receipt', async (t) => {
  for (const damage of ['delete', 'replace']) {
    const { site } = await fixture(t, 1);
    const batch = await freezeArchive(site, ARCHIVE_TARGET);
    const store = new MemoryArchive();
    await runArchive(batch, store, { upload: true });
    const completePath = path.join(batch.batchDir, 'receipt.json');
    const before = await readFile(completePath);
    const realInventory = store.inventory.bind(store);
    let count = 0;
    store.inventory = async () => {
      if (++count === 2) {
        if (damage === 'delete') store.objects.clear();
        else
          store.objects.set(
            batch.files[0].key,
            Buffer.alloc(batch.files[0].bytes, 42),
          );
      }
      return realInventory();
    };
    await assert.rejects(runArchive(batch, store), /Final inventory/);
    assert.deepEqual(await readFile(completePath), before);
    assert.equal((await readdir(path.join(batch.batchDir, 'runs'))).length, 2);
  }
});

void test('nonadjacent S3 cursor cycles and page count contradictions fail; late federal page denial never erases prior buckets', async () => {
  let calls = 0;
  await assert.rejects(
    collectObjects(
      {
        send: async () => {
          assert.ok(++calls < 5, 'cursor cycle should terminate promptly');
          return {
            IsTruncated: true,
            KeyCount: 0,
            NextContinuationToken: calls % 2 ? 'A' : 'B',
          };
        },
      },
      'bucket',
    ),
    /pagination/,
  );
  await assert.rejects(
    collectObjects(
      { send: async () => ({ IsTruncated: false, KeyCount: 5 }) },
      'bucket',
    ),
    /Malformed/,
  );
  const store = new R2Archive('fixture-token');
  let pages = 0;
  store.rest = async () =>
    ++pages === 1
      ? {
          status: 200,
          success: true,
          result: { buckets: [{ name: 'federal-held-bucket' }] },
          result_info: { cursor: 'next' },
        }
      : { status: 403, success: false, errors: [{ code: 10003 }] };
  await assert.rejects(store.bucketPages('fedramp'), /after a successful page/);
});

void test('malformed pending-upload inventory is not an empty multipart listing', async () => {
  const store = new R2Archive('fixture-token');
  store.scopeEvidence = async () => ({ nonEnterprise: true });
  store.bucketPages = async (jurisdiction) => {
    if (jurisdiction === 'fedramp')
      return { status: 403, errors: [{ code: 10003 }] };
    if (jurisdiction === 'fedramp-high')
      return { status: 400, body: 'BadRequest: invalid jurisdiction' };
    return {
      status: 200,
      success: true,
      buckets:
        jurisdiction === 'default'
          ? [{ name: ARCHIVE_TARGET.bucket, jurisdiction }]
          : [],
    };
  };
  store.rest = async () => ({ result: {} });
  store.client = () => ({
    send: async (command) =>
      command.constructor.name === 'ListObjectsV2Command'
        ? { IsTruncated: false, KeyCount: 0 }
        : { IsTruncated: false, Uploads: {} },
  });
  await assert.rejects(store.inventory(), /Invalid multipart/);
});

void test('restore journal preserves completed files and exact receipt/target binding on failure', async (t) => {
  const { site } = await fixture(t);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  const { receipt } = await runArchive(batch, store, { upload: true });
  const dest = path.join(site, 'restore-journal');
  const report = path.join(site, 'restore-result.json');
  store.objects.delete(batch.files[1].key);
  const inputHash = sha256(JSON.stringify(receipt));
  await assert.rejects(
    restoreArchive(receipt, store, dest, undefined, {
      reportFile: report,
      inputReceiptSha256: inputHash,
    }),
    /missing/,
  );
  const journal = JSON.parse(await readFile(report));
  assert.equal(journal.complete, false);
  assert.equal(journal.files.length, 1);
  assert.equal(journal.bucket, ARCHIVE_TARGET.bucket);
  assert.equal(journal.inputReceiptSha256, inputHash);
  assert.equal(journal.destination, dest);
  assert.equal(journal.scope, 'all');
  assert.equal(journal.requestedFileCount, 3);
  assert.equal(journal.requestedBytes, batch.archiveBytes);
  assert.match(journal.error, /missing/);
});

void test('stalled and oversized remote bodies are cancelled during verification and restoration', async (t) => {
  const { site } = await fixture(t, 1);
  const batch = await freezeArchive(site, ARCHIVE_TARGET);
  const store = new MemoryArchive();
  const { receipt } = await runArchive(batch, store, { upload: true });
  const file = batch.files[0];
  const bodies = [];
  store.get = async () => {
    const body = new Readable({ read() {} });
    bodies.push(body);
    return { body, etag: sha256(store.objects.get(file.key)) };
  };
  await assert.rejects(
    verifyObject(store, file, { timeoutMs: 10 }),
    /deadline/,
  );
  assert.equal(bodies.length, 4);
  assert.ok(bodies.every((body) => body.destroyed));
  const dest = path.join(site, 'timed-restore');
  await assert.rejects(
    restoreArchive(receipt, store, dest, undefined, { timeoutMs: 10 }),
    /deadline/,
  );
  assert.ok(bodies.at(-1).destroyed);
  await assert.rejects(readFile(path.join(dest, file.originalPath)), {
    code: 'ENOENT',
  });
  store.get = async () => ({
    body: Readable.from([Buffer.alloc(file.bytes + 1)]),
    etag: sha256(store.objects.get(file.key)),
  });
  await assert.rejects(verifyObject(store, file), /exceeds the declared/);
  await assert.rejects(
    restoreArchive(receipt, store, dest),
    /exceeds the declared/,
  );
});

void test('successive PDF versions retain both immutable copies and reject a hash-mismatched key', async (t) => {
  const { site, plan } = await fixture(t, 1);
  const store = new MemoryArchive();
  for (const text of ['First checked edition', 'Second checked edition']) {
    const body = Buffer.from(text);
    const hash = sha256(body);
    const relative = `publications/${hash}/example-family.pdf`;
    const file = {
      key: 'archive/' + relative,
      path: 'dist/client/data/' + relative,
      bytes: body.length,
      sha256: hash,
    };
    plan.files = [file];
    plan.archiveBytes = body.length;
    await mkdir(path.dirname(path.join(site, file.path)), { recursive: true });
    await writeFile(path.join(site, file.path), body);
    await writeFile(
      path.join(site, 'dist/hosting/objects.json'),
      JSON.stringify(plan),
    );
    await writeFile(
      path.join(site, 'dist/hosting/assets/data/manifest.json'),
      JSON.stringify({
        sourceSha256: plan.sourceSha256,
        assets: [relative],
        missingAssets: [],
      }),
    );
    const batch = await freezeArchive(site, ARCHIVE_TARGET);
    const { receipt } = await runArchive(batch, store, { upload: true });
    assert.equal(receipt.complete, true);
    assert.deepEqual(store.objects.get(file.key), body);
    assert.throws(
      () =>
        validatePlan({ ...plan, files: [{ ...file, sha256: 'a'.repeat(64) }] }),
      /Invalid/,
    );
  }
  assert.equal(store.objects.size, 2);
});

// The deploy uploader against a fake R2: S3 commands for the files, and the
// Cloudflare API answers that say whether the bucket has a public address.
const { uploadNewOriginals } = await import(
  '../scripts/upload-new-originals.mjs'
);
const md5Hex = (bytes) => createHash('md5').update(bytes).digest('hex');

class FakeR2 extends R2Archive {
  objects = new Map();
  commands = [];
  settings = { enabled: false, domains: [] };
  // Settings for one bucket by name; the others use `settings`.
  bucketSettings = {};
  constructor() {
    super('fixture-token');
  }
  // Each Cloudflare read returns what the bucket's settings say, or fails.
  async rest(route) {
    this.commands.push(['rest', route]);
    const bucket = route.split('/')[3];
    const settings = this.bucketSettings[bucket] ?? this.settings;
    if (settings.fail) throw new Error('Cloudflare read failed: HTTP 403');
    const result = route.endsWith('/domains/managed')
      ? { enabled: settings.enabled }
      : route.endsWith('/domains/custom')
        ? { domains: settings.domains }
        : { name: bucket, jurisdiction: this.target.jurisdiction };
    return { status: 200, success: true, result };
  }
  // R2 gives a whole-file upload the MD5 of its bytes as its ETag.
  hold(key, body, etag = '"' + md5Hex(body) + '"') {
    this.objects.set(key, { body: Buffer.from(body), etag });
  }
  client() {
    return {
      send: async (command) => {
        const { Key, IfMatch, IfNoneMatch, ContentMD5, Body } = command.input;
        const name = command.constructor.name;
        this.commands.push([name, Key]);
        const held = this.objects.get(Key);
        if (name === 'ListObjectsV2Command') {
          const Contents = [...this.objects].map(([key, o]) => ({
            Key: key,
            Size: o.body.length,
            ETag: o.etag,
          }));
          return { IsTruncated: false, KeyCount: Contents.length, Contents };
        }
        if (name === 'HeadObjectCommand') {
          if (!held)
            throw Object.assign(new Error('Not found'), {
              $metadata: { httpStatusCode: 404 },
            });
          return { ContentLength: held.body.length, ETag: held.etag };
        }
        if (name === 'GetObjectCommand') {
          assert.equal(IfMatch, held.etag);
          return { Body: Readable.from([held.body]), ETag: held.etag };
        }
        if (name === 'PutObjectCommand') {
          assert.equal(IfNoneMatch, '*');
          const body = Buffer.concat(await Array.fromAsync(Body));
          if (held)
            throw Object.assign(new Error('Exists'), {
              $metadata: { httpStatusCode: 412 },
            });
          assert.equal(
            createHash('md5').update(body).digest('base64'),
            ContentMD5,
            'R2 rejects a body that does not match its Content-MD5',
          );
          this.hold(Key, body);
          return {};
        }
        throw new Error('Unexpected command ' + name);
      },
    };
  }
  writes() {
    return this.commands.filter(([name]) => name === 'PutObjectCommand');
  }
}

void test('deploy upload stops before touching any file when the bucket is public or its settings cannot be read', async (t) => {
  const { site } = await fixture(t, 2);
  for (const [settings, error] of [
    [{ enabled: true, domains: [] }, /has a public address/],
    [{ enabled: false, domains: [{ domain: 'files.example.org' }] }, /has a public address/],
    [{ enabled: undefined, domains: [] }, /Could not confirm/],
    [{ enabled: false, domains: undefined }, /Could not confirm/],
    [{ fail: true }, /Could not confirm .* private \(Cloudflare read failed: HTTP 403\)/],
  ]) {
    const store = new FakeR2();
    store.settings = settings;
    await assert.rejects(uploadNewOriginals(site, store, { log() {} }), error);
    assert.deepEqual(
      store.commands.filter(([name]) => name !== 'rest'),
      [],
      'no file was listed, read or written: ' + JSON.stringify(settings),
    );
  }
  // The bucket for what relatives send is checked the same way.
  for (const [settings, error] of [
    [{ enabled: true, domains: [] }, /submissions bucket example-family-submissions has a public address/],
    [{ enabled: false, domains: [{ domain: 'inbox.example.org' }] }, /submissions bucket .* has a public address/],
    [{ enabled: undefined, domains: [] }, /Could not confirm that the submissions bucket/],
    [{ fail: true }, /Could not confirm that the submissions bucket .* \(Cloudflare read failed: HTTP 403\)/],
  ]) {
    const store = new FakeR2();
    store.bucketSettings['example-family-submissions'] = settings;
    await assert.rejects(uploadNewOriginals(site, store, { log() {} }), error);
    assert.deepEqual(
      store.commands.filter(([name]) => name !== 'rest'),
      [],
      'no file was listed, read or written: ' + JSON.stringify(settings),
    );
    assert.ok(
      store.commands.some(([, route]) => route === '/r2/buckets/example-family-archive'),
      'the archive bucket was checked too',
    );
  }
  // Both private: the upload goes ahead.
  const store = new FakeR2();
  await uploadNewOriginals(site, store, { log() {} });
  for (const bucket of ['example-family-archive', 'example-family-submissions'])
    for (const part of ['', '/domains/managed', '/domains/custom'])
      assert.ok(
        store.commands.some(([, route]) => route === `/r2/buckets/${bucket}${part}`),
        bucket + part,
      );
});

void test('deploy upload compares contents, not sizes, and never overwrites a held file', async (t) => {
  const { site, plan } = await fixture(t, 3);
  const [kept, changed, multipart] = plan.files;
  const local = async (file) => readFile(path.join(site, file.path));
  const store = new FakeR2();
  store.hold(kept.key, await local(kept));
  // Same name and the same size, different bytes.
  const corrupt = Buffer.alloc(changed.bytes, 66);
  store.hold(changed.key, corrupt);
  // A file uploaded in parts has no MD5 in its ETag: it is read and hashed.
  store.hold(multipart.key, Buffer.alloc(multipart.bytes, 67), '"0f0f-2"');
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  await assert.rejects(
    uploadNewOriginals(site, store, { log() {} }),
    /2 archive files differ from the copies in R2/,
  );
  const byName = (a, b) => a.localeCompare(b);
  assert.deepEqual(errors.sort(byName), [
    'Different contents in R2: ' + changed.key,
    'Different contents in R2: ' + multipart.key,
  ].sort(byName));
  assert.deepEqual(store.writes(), []);
  assert.deepEqual(store.objects.get(changed.key).body, corrupt);
});

void test('deploy upload sends only missing originals and reads each one back', async (t) => {
  const { site, plan } = await fixture(t, 4);
  const local = async (file) => readFile(path.join(site, file.path));
  const store = new FakeR2();
  store.hold(plan.files[0].key, await local(plan.files[0]));
  store.hold(plan.files[1].key, await local(plan.files[1]), '"1a2b-3"');
  const checked = await uploadNewOriginals(site, store, {
    check: true,
    log() {},
  });
  assert.deepEqual(checked.uploaded, []);
  assert.deepEqual(store.writes(), [], '--check uploads nothing');
  const result = await uploadNewOriginals(site, store, { log() {} });
  const missing = plan.files.slice(2).map((file) => file.key);
  assert.deepEqual(result.uploaded, missing);
  assert.deepEqual(
    store.writes().map(([, key]) => key),
    missing,
  );
  for (const file of plan.files)
    assert.deepEqual(store.objects.get(file.key).body, await local(file));
  // Each upload, and the held file without an MD5, was read back in full.
  const reads = store.commands
    .filter(([name]) => name === 'GetObjectCommand')
    .map(([, key]) => key);
  for (const key of [...missing, plan.files[1].key])
    assert.ok(reads.includes(key), key + ' read back');
  assert.ok(!reads.includes(plan.files[0].key), 'an MD5 match needs no download');
});

void test('deploy upload refuses a local original that changed after packaging', async (t) => {
  const { site, plan } = await fixture(t, 2);
  await writeFile(path.join(site, plan.files[1].path), 'Original file X');
  const store = new FakeR2();
  await assert.rejects(
    uploadNewOriginals(site, store, { log() {} }),
    /File bytes changed/,
  );
  assert.deepEqual(store.writes(), []);
});

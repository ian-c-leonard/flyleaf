import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { retry, withDeadline } from './r2-client.mjs';
import submissionPolicy from '../shared/submission-policy.json' with { type: 'json' };
import { readSettings } from '../flyleaf-settings.mjs';

const settings = readSettings();
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The one book PDF a deploy may publish, named in flyleaf.json.
const publishedPdf = new RegExp(
  `^archive/publications/[a-f0-9]{64}/${literal(settings.book.pdf_name)}$`,
);

export const STORAGE_CEILING = 10_000_000_000;
const hashPattern = /^[a-f0-9]{64}$/;
const now = () => new Date().toISOString();
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const unsafeCharacters = (text) =>
  [...text].some(
    (char) =>
      char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

export function originalPath(key) {
  if (
    typeof key !== 'string' ||
    !(
      key.startsWith('archive/images/') ||
      publishedPdf.test(key)
    ) ||
    unsafeCharacters(key) ||
    Buffer.byteLength(key) > 1024 ||
    key.split('/').some((part) => !part || part.startsWith('.'))
  ) {
    throw new Error('Unsafe archive key: ' + key);
  }
  return key.slice('archive/'.length);
}

export function validatePlan(plan) {
  if (
    !plan ||
    !Array.isArray(plan.files) ||
    !plan.files.length ||
    !hashPattern.test(plan.sourceSha256)
  )
    throw new Error('Invalid object plan.');
  const keys = new Set();
  let total = 0;
  for (const file of plan.files) {
    const relative = originalPath(file.key);
    if (
      keys.has(file.key) ||
      file.path !== 'dist/client/data/' + relative ||
      !hashPattern.test(file.sha256) ||
      (relative.startsWith('publications/') &&
        relative.split('/')[1] !== file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > 5 * 1024 ** 3
    ) {
      throw new Error(
        'Invalid, duplicate or oversized planned file: ' + file.key,
      );
    }
    keys.add(file.key);
    total += file.bytes;
  }
  if (
    !Number.isSafeInteger(total) ||
    total !== plan.archiveBytes ||
    keys.size !== plan.archiveFiles
  )
    throw new Error('Object plan totals disagree.');
  return plan;
}

// Reject symlinks in every component below the trusted root, including directories.
export async function regularPath(root, relative, createParents = false) {
  let current = path.resolve(root);
  if (!(await lstat(current)).isDirectory())
    throw new Error('Root must be a real directory.');
  const parts = relative.split('/');
  if (
    parts.some((part) => !part || part.startsWith('.')) ||
    unsafeCharacters(relative)
  ) {
    throw new Error('Unsafe local path.');
  }
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (createParents)
      await mkdir(current, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    if (!(await lstat(current)).isDirectory())
      throw new Error(
        'Directory contains a symlink or non-directory: ' + current,
      );
  }
  const result = path.join(current, parts.at(-1));
  try {
    if (!(await lstat(result)).isFile())
      throw new Error('Path is not a regular file: ' + result);
  } catch (error) {
    if (error.code !== 'ENOENT' || !createParents) throw error;
  }
  return result;
}

export async function digestStream(body, { expectedBytes, signal } = {}) {
  const sha = createHash('sha256');
  const md5 = createHash('md5');
  let bytes = 0;
  const abort = () => body.destroy(signal.reason);
  if (signal?.aborted) {
    body.destroy();
    signal.throwIfAborted();
  }
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of body) {
      bytes += chunk.length;
      if (expectedBytes !== undefined && bytes > expectedBytes)
        throw new Error('Remote body exceeds the declared file size.');
      sha.update(chunk);
      md5.update(chunk);
    }
    return { bytes, sha256: sha.digest('hex'), md5: md5.digest('base64') };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export async function checkFile(filename, expected) {
  const actual = await digestStream(createReadStream(filename));
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error('File bytes changed: ' + filename);
  }
  return actual;
}

export async function atomicJson(filename, value) {
  const temp = filename + '.tmp-' + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temp, filename);
  } finally {
    await rm(temp, { force: true });
  }
}

// A private byte copy separates a running upload from later dist/ rebuilds.
export async function freezeArchive(site, target) {
  const planFile = await regularPath(site, 'dist/hosting/objects.json');
  const planBytes = await readFile(planFile);
  const plan = validatePlan(JSON.parse(planBytes));
  const planSha256 = sha256(planBytes);
  const root = path.join(site, 'work/archive-batches');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const batchDir = path.join(root, planSha256);
  try {
    await lstat(batchDir);
    return await loadBatch(batchDir, target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const stage = path.join(root, '.stage-' + randomUUID());
  await mkdir(stage, { mode: 0o700 });
  try {
    const manifestBytes = await readFile(
      await regularPath(site, 'dist/hosting/assets/data/manifest.json'),
    );
    const manifest = JSON.parse(manifestBytes);
    if (
      manifest.sourceSha256 !== plan.sourceSha256 ||
      manifest.missingAssets?.length !== 0 ||
      JSON.stringify(
        [...manifest.assets].sort((a, b) => a.localeCompare(b)),
      ) !==
        JSON.stringify(
          plan.files
            .map((file) => originalPath(file.key))
            .sort((a, b) => a.localeCompare(b)),
        )
    ) {
      throw new Error(
        'Object plan does not match the protected package manifest.',
      );
    }
    const files = [];
    for (const file of plan.files) {
      const relative = originalPath(file.key);
      const source = await regularPath(site, file.path);
      const dest = await regularPath(stage, 'files/' + relative, true);
      await copyFile(
        source,
        dest,
        constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
      );
      const digest = await checkFile(dest, file);
      files.push({ ...file, originalPath: relative, md5: digest.md5 });
    }
    // Detect a replaced package while taking the snapshot. Original files were
    // individually checked above; the frozen copy never follows the new build.
    if (
      !(await readFile(planFile)).equals(planBytes) ||
      !(
        await readFile(
          path.join(site, 'dist/hosting/assets/data/manifest.json'),
        )
      ).equals(manifestBytes)
    ) {
      throw new Error('Hosting package changed while freezing the archive.');
    }
    await writeFile(path.join(stage, 'objects.json'), planBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(stage, 'manifest.json'), manifestBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    await atomicJson(path.join(stage, 'batch.json'), {
      schema: 1,
      ...target,
      createdAt: now(),
      planSha256,
      manifestSha256: sha256(manifestBytes),
      sourceSha256: plan.sourceSha256,
      archiveFiles: plan.archiveFiles,
      archiveBytes: plan.archiveBytes,
      files,
    });
    await rename(stage, batchDir);
    return {
      batchDir,
      ...JSON.parse(await readFile(path.join(batchDir, 'batch.json'))),
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function loadBatch(batchDir, target) {
  const batch = JSON.parse(
    await readFile(await regularPath(batchDir, 'batch.json')),
  );
  const planBytes = await readFile(await regularPath(batchDir, 'objects.json'));
  const plan = validatePlan(JSON.parse(planBytes));
  if (
    batch.schema !== 1 ||
    batch.planSha256 !== sha256(planBytes) ||
    batch.manifestSha256 !==
      sha256(await readFile(await regularPath(batchDir, 'manifest.json'))) ||
    batch.sourceSha256 !== plan.sourceSha256 ||
    batch.archiveFiles !== plan.archiveFiles ||
    batch.archiveBytes !== plan.archiveBytes ||
    batch.files?.length !== plan.files.length ||
    ['account', 'bucket', 'jurisdiction'].some(
      (key) => batch[key] !== target[key],
    )
  ) {
    throw new Error('Frozen batch identity does not match its plan or target.');
  }
  for (let i = 0; i < plan.files.length; i++) {
    const file = batch.files[i];
    if (
      ['key', 'path', 'bytes', 'sha256'].some(
        (key) => file[key] !== plan.files[i][key],
      ) ||
      file.originalPath !== originalPath(file.key)
    )
      throw new Error('Frozen file identity changed.');
    const actual = await checkFile(
      await regularPath(batchDir, 'files/' + file.originalPath),
      file,
    );
    if (actual.md5 !== file.md5) throw new Error('Frozen MD5 changed.');
  }
  return { ...batch, batchDir };
}

export function assessStorage(snapshot, batch) {
  if (
    !snapshot.complete ||
    !snapshot.privateTarget ||
    snapshot.account !== batch.account
  ) {
    throw new Error('Storage scope or private access is unresolved.');
  }
  const known = new Map();
  let payloadBytes = 0;
  let objectCount = 0;
  let foundTarget = false;
  let submissionAllocationUsed = 0;
  for (const bucket of snapshot.buckets) {
    if (bucket.pendingUploads !== 0)
      throw new Error(
        'Pending multipart uploads prevent a complete storage preflight.',
      );
    const isTarget =
      bucket.name === batch.bucket &&
      bucket.jurisdiction === batch.jurisdiction;
    foundTarget ||= isTarget;
    const seen = new Set();
    for (const object of bucket.objects) {
      if (
        !Number.isSafeInteger(object.bytes) ||
        object.bytes < 0 ||
        seen.has(object.key)
      ) {
        throw new Error('Incomplete or invalid remote inventory.');
      }
      seen.add(object.key);
      payloadBytes += object.bytes;
      objectCount++;
      if (bucket.name === settings.cloudflare.submissions_bucket) {
        if (bucket.jurisdiction !== 'default')
          throw new Error('Unexpected submissions bucket jurisdiction.');
        submissionAllocationUsed +=
          object.bytes + submissionPolicy.objectAllowanceBytes;
      }
      if (isTarget) known.set(object.key, object);
    }
  }
  if (!foundTarget)
    throw new Error('Archive bucket absent from storage inventory.');
  let newBytes = 0;
  let newObjects = 0;
  for (const file of batch.files) {
    const existing = known.get(file.key);
    if (!existing) {
      newBytes += file.bytes;
      newObjects++;
    } else if (existing.bytes !== file.bytes)
      throw new Error('Existing remote file conflicts: ' + file.key);
  }
  if (
    !Number.isSafeInteger(snapshot.metricsBytes) ||
    snapshot.metricsBytes < 0
  ) {
    throw new Error('Invalid provider storage metrics.');
  }
  // Provider internal metadata is not exposed exactly by S3. This is an
  // explicit conservative allowance, not a claim of exact billed storage.
  const metadataReserveBytes =
    100_000_000 + (objectCount + newObjects) * 65_536;
  // Intake atomically reserves a fixed 1 GB allocation in D1. Always hold its
  // unused portion here, even before the bucket exists. Independent submissions
  // can then arrive between these snapshots without consuming archive headroom.
  if (submissionAllocationUsed > submissionPolicy.storageBudgetBytes)
    throw new Error('Submission storage exceeds its reserved allocation.');
  const submissionReserveBytes =
    submissionPolicy.storageBudgetBytes - submissionAllocationUsed;
  const conservativeBytes =
    Math.max(payloadBytes, snapshot.metricsBytes) +
    newBytes +
    metadataReserveBytes +
    submissionReserveBytes;
  if (
    !Number.isSafeInteger(conservativeBytes) ||
    conservativeBytes > STORAGE_CEILING
  ) {
    throw new Error('Account-wide 10 GB storage ceiling would be exceeded.');
  }
  return {
    payloadBytes,
    objectCount,
    newBytes,
    newObjects,
    metadataReserveBytes,
    submissionReserveBytes,
    conservativeBytes,
    ceilingBytes: STORAGE_CEILING,
    headroomBytes: STORAGE_CEILING - conservativeBytes,
  };
}

export async function verifyObject(store, file, { timeoutMs } = {}) {
  return retry(() =>
    withDeadline(async (signal) => {
      const head = await store.head(file.key, signal);
      if (!head) throw new Error('Remote file missing: ' + file.key);
      if (head.bytes !== file.bytes || !head.etag)
        throw new Error('Remote file size or ETag conflicts: ' + file.key);
      const object = await store.get(file.key, head.etag, signal);
      const actual = await digestStream(object.body, {
        expectedBytes: file.bytes,
        signal,
      });
      if (
        object.etag !== head.etag ||
        actual.bytes !== file.bytes ||
        actual.sha256 !== file.sha256
      ) {
        throw new Error('Remote file hash conflicts: ' + file.key);
      }
      return {
        etag: head.etag,
        verifiedAt: now(),
        bytes: actual.bytes,
        sha256: actual.sha256,
      };
    }, timeoutMs),
  );
}

export async function runArchive(
  batch,
  store,
  { upload = false, concurrency = 3, progress = () => {} } = {},
) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('Concurrency must be 1–4.');
  // Also rehash on resume: old receipts or metadata are never sufficient proof.
  batch = await loadBatch(batch.batchDir, store.target);
  const runs = path.join(batch.batchDir, 'runs');
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const runId = Date.now() + '-' + randomUUID();
  const receiptFile = path.join(runs, runId + '.json');
  const { batchDir: _batchDir, ...manifest } = batch;
  const receipt = {
    ...manifest,
    runId,
    operation: upload ? 'upload-and-verify' : 'verify',
    startedAt: now(),
    complete: false,
    preflights: [],
    files: batch.files.map((file) => ({ ...file, status: 'pending' })),
  };
  let saving = Promise.resolve();
  const save = () => {
    const copy = structuredClone(receipt);
    saving = saving.then(() => atomicJson(receiptFile, copy));
    return saving;
  };
  const preflight = async () => {
    const snapshot = await store.inventory();
    const budget = assessStorage(snapshot, batch);
    receipt.preflights.push({
      ...snapshot,
      planSha256: batch.planSha256,
      budget,
    });
    await save();
    return snapshot;
  };
  await save();
  try {
    await preflight();
    let completed = 0;
    let failed;
    // Recheck account usage between bounded waves. This does not reserve global
    // capacity against unrelated writers; those must not run during publication.
    for (let start = 0; start < receipt.files.length && !failed; start += 48) {
      if (start) await preflight();
      const wave = receipt.files.slice(start, start + 48);
      let cursor = 0;
      const workers = await Promise.allSettled(
        Array.from({ length: concurrency }, async () => {
          while (!failed && cursor < wave.length) {
            const file = wave[cursor++];
            try {
              let action = 'existing';
              if (upload && !(await store.head(file.key))) {
                const local = await regularPath(
                  batch.batchDir,
                  'files/' + file.originalPath,
                );
                // The adapter sends Content-MD5 and If-None-Match:*. A retry after
                // an ambiguous result cannot overwrite an object that arrived.
                await store.put(file, local);
                action = 'uploaded-or-raced';
              }
              const verification = await verifyObject(store, file);
              Object.assign(file, { status: 'verified', action, verification });
              completed++;
              await save();
              progress({
                completed,
                total: receipt.files.length,
                key: file.key,
                action,
              });
            } catch (error) {
              file.status = 'failed';
              file.error = error.message;
              failed ||= error;
              await save();
            }
          }
        }),
      );
      for (const worker of workers)
        if (worker.status === 'rejected') failed ||= worker.reason;
    }
    if (failed) throw failed;
    const finalSnapshot = await preflight();
    const target = finalSnapshot.buckets.find(
      (bucket) =>
        bucket.name === batch.bucket &&
        bucket.jurisdiction === batch.jurisdiction,
    );
    const finalObjects = new Map(
      target.objects.map((object) => [object.key, object]),
    );
    for (const file of receipt.files) {
      const current = finalObjects.get(file.key);
      if (
        !current ||
        current.bytes !== file.bytes ||
        !current.etag ||
        current.etag !== file.verification?.etag
      ) {
        throw new Error(
          'Final inventory no longer matches the verified file: ' + file.key,
        );
      }
    }
    receipt.complete = true;
    receipt.completedAt = now();
    await save();
    // A later failed verify must not destroy the earlier recovery receipt.
    await atomicJson(path.join(batch.batchDir, 'receipt.json'), receipt);
    return { receipt, receiptFile };
  } catch (error) {
    receipt.complete = false;
    receipt.error = error.message;
    receipt.failedAt = now();
    await save();
    error.receiptFile = receiptFile;
    throw error;
  }
}

export async function restoreArchive(
  receipt,
  store,
  destination,
  selectedKeys,
  { reportFile, inputReceiptSha256, timeoutMs } = {},
) {
  if (
    receipt.schema !== 1 ||
    receipt.complete !== true ||
    ['account', 'bucket', 'jurisdiction'].some(
      (key) => receipt[key] !== store.target[key],
    )
  ) {
    throw new Error('Restore needs a complete receipt for this target.');
  }
  validatePlan(receipt);
  const selection = selectedKeys && new Set(selectedKeys);
  if (
    selection &&
    [...selection].some(
      (key) => !receipt.files.some((file) => file.key === key),
    )
  ) {
    throw new Error('Unknown restore selection.');
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const requested = receipt.files.filter(
    (file) => !selection || selection.has(file.key),
  );
  const result = {
    schema: 1,
    ...store.target,
    destination: path.resolve(destination),
    inputReceiptSha256,
    receiptContentSha256: sha256(JSON.stringify(receipt)),
    startedAt: now(),
    planSha256: receipt.planSha256,
    scope: selection ? 'selected' : 'all',
    requestedFiles: requested.map((file) => file.key),
    requestedFileCount: requested.length,
    requestedBytes: requested.reduce((sum, file) => sum + file.bytes, 0),
    complete: false,
    files: [],
  };
  const save = async () => {
    if (reportFile) await atomicJson(reportFile, result);
  };
  await save();
  try {
    for (const file of receipt.files) {
      if (selection && !selection.has(file.key)) continue;
      const relative = originalPath(file.key);
      if (file.status !== 'verified' || file.originalPath !== relative)
        throw new Error('Unverified restore entry.');
      const dest = await regularPath(destination, relative, true);
      try {
        await lstat(dest);
        await checkFile(dest, file);
        result.files.push({
          key: file.key,
          originalPath: relative,
          action: 'already-present',
          sha256: file.sha256,
          bytes: file.bytes,
        });
        await save();
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await withDeadline(async (signal) => {
        const head = await store.head(file.key, signal);
        if (!head || head.bytes !== file.bytes || !head.etag)
          throw new Error('Restore object is missing or changed.');
        const object = await store.get(file.key, head.etag, signal);
        const temp = dest + '.restoring-' + randomUUID();
        const hash = createHash('sha256');
        let bytes = 0;
        try {
          await pipeline(
            object.body,
            new Transform({
              transform(chunk, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > file.bytes)
                  return callback(
                    new Error('Remote body exceeds the declared file size.'),
                  );
                hash.update(chunk);
                callback(null, chunk);
              },
            }),
            createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
          if (
            object.etag !== head.etag ||
            bytes !== file.bytes ||
            hash.digest('hex') !== file.sha256
          ) {
            throw new Error(
              'Restored bytes do not match the receipt: ' + file.key,
            );
          }
          // Exclusive install prevents replacing even a file created during download.
          signal.throwIfAborted();
          await link(temp, dest);
          result.files.push({
            key: file.key,
            originalPath: relative,
            action: 'restored',
            sha256: file.sha256,
            bytes,
            etag: head.etag,
            verifiedAt: now(),
          });
          await save();
        } finally {
          await rm(temp, { force: true });
        }
      }, timeoutMs);
    }
    result.completedAt = now();
    result.complete = true;
    await save();
    return result;
  } catch (error) {
    result.complete = false;
    result.error = error.message;
    result.failedAt = now();
    await save();
    error.receiptFile = reportFile;
    throw error;
  }
}

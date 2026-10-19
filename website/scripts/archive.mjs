import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ARCHIVE_TARGET, R2Archive } from './r2-client.mjs';
import {
  assessStorage,
  atomicJson,
  freezeArchive,
  loadBatch,
  restoreArchive,
  runArchive,
  sha256,
} from './archive-sync.mjs';

const site = fileURLToPath(new URL('..', import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    batch: { type: 'string' },
    receipt: { type: 'string' },
    destination: { type: 'string' },
    key: { type: 'string', multiple: true },
    concurrency: { type: 'string', default: '3' },
  },
});
const command = positionals[0];
if (
  positionals.length !== 1 ||
  !['freeze', 'preflight', 'upload', 'verify', 'restore'].includes(command)
) {
  throw new Error(
    'Usage: node scripts/archive.mjs freeze|preflight|upload|verify|restore [--batch PATH] [--receipt PATH --destination DIR --key KEY]',
  );
}
if (
  (values.receipt || values.destination || values.key) &&
  command !== 'restore'
)
  throw new Error('Restore arguments require restore.');
const config = await readFile(path.join(site, 'wrangler.jsonc'), 'utf8');
if (
  config.match(/"account_id"\s*:\s*"([^"]+)"/)?.[1] !==
    ARCHIVE_TARGET.account ||
  config.match(/"bucket_name"\s*:\s*"([^"]+)"/)?.[1] !== ARCHIVE_TARGET.bucket
) {
  throw new Error(
    'Uploader target must match the reviewed Worker configuration.',
  );
}
if (
  command !== 'freeze' &&
  process.env.CLOUDFLARE_ACCOUNT_ID !== ARCHIVE_TARGET.account
) {
  throw new Error(
    'Load the shared Cloudflare environment for the expected account.',
  );
}
const work = path.join(site, 'work');
await mkdir(work, { recursive: true, mode: 0o700 });
const lockPath = path.join(work, 'archive-operation.lock');
const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
  if (error.code === 'EEXIST')
    throw new Error(
      'An archive operation is locked. Check work/archive-operation.lock and its PID before removing a stale lock.',
    );
  throw error;
});
let store;
try {
  await lock.writeFile(
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      command,
    }) + '\n',
  );
  if (command === 'restore') {
    if (!values.receipt || !values.destination || values.batch)
      throw new Error(
        'Restore requires --receipt and --destination; it does not use --batch.',
      );
    store = await new R2Archive(process.env.CLOUDFLARE_API_TOKEN).connect();
    const receiptBytes = await readFile(path.resolve(values.receipt));
    const receipt = JSON.parse(receiptBytes);
    const report = path.join(work, 'restore-' + Date.now() + '.json');
    const result = await restoreArchive(
      receipt,
      store,
      path.resolve(values.destination),
      values.key,
      { reportFile: report, inputReceiptSha256: sha256(receiptBytes) },
    );
    console.log(
      JSON.stringify({
        restored: result.files.filter((f) => f.action === 'restored').length,
        alreadyPresent: result.files.filter(
          (f) => f.action === 'already-present',
        ).length,
        bytes: result.files.reduce((n, f) => n + f.bytes, 0),
        report,
      }),
    );
  } else {
    const batch = values.batch
      ? await loadBatch(path.resolve(values.batch), ARCHIVE_TARGET)
      : await freezeArchive(site, ARCHIVE_TARGET);
    console.log(
      JSON.stringify({
        batchDir: batch.batchDir,
        files: batch.archiveFiles,
        bytes: batch.archiveBytes,
        planSha256: batch.planSha256,
      }),
    );
    if (command !== 'freeze') {
      store = await new R2Archive(process.env.CLOUDFLARE_API_TOKEN).connect();
      if (command === 'preflight') {
        const snapshot = await store.inventory();
        const budget = assessStorage(snapshot, batch);
        const report = path.join(batch.batchDir, 'preflight.json');
        await atomicJson(report, {
          ...snapshot,
          planSha256: batch.planSha256,
          budget,
        });
        console.log(JSON.stringify({ budget, report, uploaded: false }));
      } else {
        const result = await runArchive(batch, store, {
          upload: command === 'upload',
          concurrency: Number(values.concurrency),
          progress: ({ completed, total, key, action }) => {
            if (completed % 25 === 0 || completed === total)
              console.log(JSON.stringify({ completed, total, key, action }));
          },
        });
        console.log(
          JSON.stringify({
            complete: result.receipt.complete,
            files: result.receipt.files.length,
            receipt: result.receiptFile,
          }),
        );
      }
    }
  }
} catch (error) {
  console.error(error.message);
  if (error.receiptFile)
    console.error('Operation report: ' + error.receiptFile);
  process.exitCode = 1;
} finally {
  store?.close();
  await lock.close();
  await rm(lockPath);
}

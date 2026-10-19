// Upload private archive files that the R2 bucket does not hold yet.
// Run from website/ after `npm run prepare:hosting`:
//   node --env-file=<deploy.credentials_dir>/cloudflare.env scripts/upload-new-originals.mjs
//   ... scripts/upload-new-originals.mjs --check   compare only; upload nothing
//
// It stops before reading or writing any file if the archive bucket, or the
// bucket that holds what relatives send, has a public address. It compares contents, not sizes: R2 reports the MD5 of each file
// it holds (its ETag), and a file without one is read back and hashed.
// Existing objects are never overwritten. A same-name file with different
// contents stops the run: a changed original needs a new filename. Each new
// upload is read back and its SHA-256 checked.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_TARGET, R2Archive, collectObjects } from './r2-client.mjs';
import {
  checkFile,
  regularPath,
  validatePlan,
  verifyObject,
} from './archive-sync.mjs';
import { readSettings } from '../flyleaf-settings.mjs';
import { isMain } from './is-main.mjs';

/** The MD5 in an R2 ETag, or undefined when the ETag is not one (a file
 * uploaded in parts has an ETag ending in "-<parts>"). */
export function etagMd5(etag) {
  return /^(?:W\/)?"?([a-f0-9]{32})"?$/.exec(etag ?? '')?.[1];
}

export async function uploadNewOriginals(
  site,
  archive,
  { check = false, log = console.log } = {},
) {
  const saved = JSON.parse(
    await readFile(path.join(site, 'dist/hosting/objects.json'), 'utf8'),
  );
  // A site with no originals has nothing to upload.
  const plan = saved.files?.length === 0 ? saved : validatePlan(saved);
  await archive.checkPrivate();
  // Each file must still be the one the package was made from.
  const files = [];
  for (const file of plan.files) {
    const filename = await regularPath(site, file.path);
    const { md5 } = await checkFile(filename, file);
    files.push({ ...file, filename, md5 });
  }
  const held = new Map(
    (await collectObjects(archive.client(), archive.target.bucket)).map((o) => [
      o.key,
      o,
    ]),
  );
  const conflicts = [];
  const missing = [];
  for (const file of files) {
    const object = held.get(file.key);
    if (!object) missing.push(file);
    else if (object.bytes !== file.bytes) conflicts.push(file);
    else if (etagMd5(object.etag) === undefined)
      await verifyObject(archive, file).catch((error) => {
        if (!/conflicts/.test(error.message)) throw error;
        conflicts.push(file);
      });
    else if (
      etagMd5(object.etag) !== Buffer.from(file.md5, 'base64').toString('hex')
    )
      conflicts.push(file);
  }
  if (conflicts.length) {
    for (const f of conflicts) console.error('Different contents in R2:', f.key);
    throw new Error(
      `${conflicts.length} archive files differ from the copies in R2. ` +
        'A changed original needs a new file name.',
    );
  }
  log(`${files.length} archive files; ${missing.length} to upload.`);
  if (check) return { files: files.length, uploaded: [] };
  const uploaded = [];
  for (const file of missing) {
    await archive.put(file, file.filename);
    await verifyObject(archive, file);
    uploaded.push(file.key);
    log('Uploaded', file.key);
  }
  return { files: files.length, uploaded };
}

if (isMain(import.meta.url)) {
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== ARCHIVE_TARGET.account)
    throw new Error(
      `Load cloudflare.env for the ${readSettings().site.domain} account.`,
    );
  const archive = await new R2Archive(process.env.CLOUDFLARE_API_TOKEN).connect();
  try {
    await uploadNewOriginals(fileURLToPath(new URL('..', import.meta.url)), archive, {
      check: process.argv.includes('--check'),
    });
  } finally {
    archive.close();
  }
}

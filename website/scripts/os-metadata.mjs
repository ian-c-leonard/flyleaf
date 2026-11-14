// Files an operating system leaves in folders it has shown: never part of a
// site. macOS can write one into the hosting package at any moment a Finder
// window shows it, so the package is swept again just before each upload.
//   node scripts/os-metadata.mjs <folder>   removes them and names each one
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { isMain } from './is-main.mjs';

const NAMES = new Set(['.DS_Store', '__MACOSX', 'Thumbs.db', 'desktop.ini']);

/** True for a file or folder name the operating system made. */
export const isOsMetadata = (name) => NAMES.has(name) || name.startsWith('._');

/** True when any part of a relative path is operating-system metadata. */
export const holdsOsMetadata = (relative) =>
  relative.split(/[\\/]/).some(isOsMetadata);

/** Remove operating-system metadata under `folder`. Returns what it removed,
 * as paths relative to `folder`. */
export async function removeOsMetadata(folder) {
  const removed = [];
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!isOsMetadata(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    await rm(full, { recursive: true, force: true });
    removed.push(path.relative(folder, full).split(path.sep).join('/'));
  }
  return removed.sort();
}

if (isMain(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('usage: node scripts/os-metadata.mjs <folder>');
    process.exit(2);
  }
  for (const name of await removeOsMetadata(folder))
    console.log(`Removed ${name}, which the operating system added.`);
}

import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Install reviewed bytes without exposing a partial file or replacing an existing asset. */
export function writeReviewedAsset(destination, contents) {
  const expected = Buffer.from(contents);
  const verifyExisting = () => {
    try {
      if (!readFileSync(destination).equals(expected))
        throw new Error(
          'An existing reviewed asset has different bytes: ' + destination,
        );
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };
  if (verifyExisting()) return;

  const temporary = destination + '.' + randomUUID() + '.tmp';
  let descriptor;
  let owned = false;
  try {
    descriptor = openSync(temporary, 'wx');
    owned = true;
    writeFileSync(descriptor, expected);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (!readFileSync(temporary).equals(expected))
      throw new Error('A staged reviewed asset has incomplete bytes.');
    try {
      // A hard link installs the complete sibling atomically and refuses an
      // existing destination, including one created by a concurrent build.
      linkSync(temporary, destination);
    } catch (error) {
      if (error.code !== 'EEXIST' || !verifyExisting()) throw error;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (owned) unlinkSync(temporary);
  }
}

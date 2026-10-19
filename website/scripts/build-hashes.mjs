// Record or compare the SHA-256 of every file a deploy publishes.
//
//   node scripts/build-hashes.mjs --write work/baseline.json
//   node scripts/build-hashes.mjs --compare work/baseline.json
//
// Covers the hosting package (dist/hosting/assets) and the dry-run Worker
// bundle (work/worker-bundle). A compare exits 1 and lists every added,
// removed or changed file, so "no output" never stands in for "no change".
import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const roots = ['dist/hosting/assets', 'work/worker-bundle'];

// Wrangler stamps its bundle README with the time; it is never deployed.
const skip = new Set(['work/worker-bundle/README.md']);

// Hash in chunks through one buffer. Reading thousands of files whole made
// Node deadlock on exit (a compiler thread waiting on garbage collection).
const chunk = Buffer.alloc(1 << 20);
function digest(file) {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    let read;
    while ((read = readSync(fd, chunk, 0, chunk.length, null)) > 0)
      hash.update(chunk.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (skip.has(path.relative(site, full))) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out[path.relative(site, full)] = digest(full);
  }
  return out;
}

function hashes() {
  const out = {};
  for (const root of roots) walk(path.join(site, root), out);
  return out;
}

const [mode, file] = process.argv.slice(2);
if (!['--write', '--compare'].includes(mode) || !file) {
  console.error('Usage: build-hashes.mjs --write|--compare <file>');
  process.exit(2);
}
const target = path.resolve(site, file);
const now = hashes();
if (mode === '--write') {
  writeFileSync(target, JSON.stringify(now, null, 1) + '\n');
  console.log(`Recorded ${Object.keys(now).length} files in ${file}`);
} else {
  const then = JSON.parse(readFileSync(target, 'utf8'));
  const names = [...new Set([...Object.keys(then), ...Object.keys(now)])].sort();
  const diff = names.flatMap((name) =>
    !(name in now)
      ? [`removed  ${name}`]
      : !(name in then)
        ? [`added    ${name}`]
        : then[name] !== now[name]
          ? [`changed  ${name}`]
          : [],
  );
  for (const line of diff) console.log(line);
  console.log(
    diff.length
      ? `${diff.length} of ${names.length} files differ from ${file}`
      : `All ${names.length} files match ${file}`,
  );
  process.exitCode = diff.length ? 1 : 0;
}

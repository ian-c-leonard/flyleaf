// Stop unless everything a deploy publishes from is committed, so the live
// site always matches a commit.
//
//   node scripts/check-committed.mjs
//
// It checks the whole Flyleaf checkout, and each family path the book and
// site builds read: flyleaf.json, the tree, data/, the book folder, images/,
// the site content and any book font kept in the family folder. Three files
// that every build remakes are left out: the generated tree, the book's
// coverage report and its citation map.
//
// A family may keep large originals in images/ out of git with .gitignore.
// The tree must then give each one it names a _SHA256, which the site build
// checks, so the commit still fixes what is published. No story or site file
// may name an ignored file, because nothing checks those bytes. Any other
// file git ignores among the inputs stops the deploy.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { engineRoot, familyRoot, readSettings } from '../flyleaf-settings.mjs';
import { isMain } from './is-main.mjs';

const inside = (root, file) => {
  const relative = path.relative(root, path.resolve(root, file));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.split(path.sep).join('/')
    : null;
};

/** The git pathspecs to check in each folder: the family's inputs, minus the
 * files its builds remake, and the whole engine. */
export function publishInputs(settings, family, engine) {
  const paths = settings.paths || {};
  const book = paths.book || 'book';
  const wanted = [
    'flyleaf.json',
    paths.source_gedcom || 'data/family.src.ged',
    'data',
    book,
    'images',
    paths.site_content || 'site',
    paths.source_tier_patterns,
    ...(settings.book?.fonts?.files || []),
    // Flyleaf kept inside the family folder, as a submodule: it shows as
    // changed when it holds a commit the family has not recorded.
    engine,
  ];
  const familyPaths = [
    ...new Set(
      wanted
        .filter(Boolean)
        .map((file) => inside(family, file))
        .filter(Boolean),
    ),
  ];
  const generated = [
    paths.generated_gedcom || 'data/family.ged',
    `${book}/COVERAGE.md`,
    `${book}/CLAIMS-MAP.json`,
  ].map((file) => `:(exclude)${file}`);
  return {
    family: [...familyPaths, ...generated],
    // Every file in Flyleaf's checkout; its builds write only ignored files.
    engine: ['.'],
  };
}

/** The uncommitted changes in one folder's paths, as `git status` lists
 * them, or an error when the folder is not a git checkout. */
export function uncommitted(folder, pathspecs) {
  const result = spawnSync(
    'git',
    [
      '-C',
      folder,
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      ...pathspecs,
    ],
    // Read only: no index refresh, so a check never races another git command.
    { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  );
  if (result.status !== 0)
    throw new Error(
      `Deploy needs ${folder} to be a git checkout: ${(result.stderr || result.error?.message || '').trim()}`,
    );
  return result.stdout.split('\n').filter(Boolean);
}

// Files a computer adds by itself, which no build reads.
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** The files git ignores in one folder's paths. */
export function ignoredFiles(folder, pathspecs) {
  const result = spawnSync(
    'git',
    [
      '-C',
      folder,
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
      '--',
      ...pathspecs,
    ],
    { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  );
  if (result.status !== 0)
    throw new Error(
      `Deploy needs ${folder} to be a git checkout: ${(result.stderr || result.error?.message || '').trim()}`,
    );
  return result.stdout
    .split('\0')
    .filter((file) => file && !JUNK.has(path.basename(file)));
}

const textFiles = (folder) => {
  let files;
  try {
    files = readdirSync(folder, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return files
    .filter((entry) => entry.isFile() && /\.(typ|json|ya?ml)$/.test(entry.name))
    .filter((entry) => entry.name !== 'CLAIMS-MAP.json')
    .map((entry) => path.join(entry.parentPath, entry.name));
};

/** Why each ignored file would reach the site or book unchecked. */
export function unpinnedFiles(family, files, settings) {
  if (!files.length) return [];
  const paths = settings.paths || {};
  const tree = readFileSync(
    path.join(family, paths.source_gedcom || 'data/family.src.ged'),
    'utf8',
  )
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+)\s+(\S+)(?:\s(.*))?$/.exec(line))
    .map((m) =>
      m ? { level: Number(m[1]), tag: m[2], value: (m[3] || '').trim() } : null,
    );
  const words = [paths.book || 'book', paths.site_content || 'site']
    .flatMap((folder) => textFiles(path.join(family, folder)))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const problems = [];
  for (const file of files) {
    // Only an original in images/ may stay out of git; settings, the tree,
    // the stories and the site content are always committed.
    if (!file.startsWith('images/')) {
      problems.push(
        `${file}: git ignores it, and the book or site reads it. Commit it, or stop ignoring it.`,
      );
      continue;
    }
    const pins = [];
    let named = false;
    tree.forEach((line, i) => {
      if (!line || line.value !== file) return;
      named = true;
      for (
        let j = i + 1;
        j < tree.length && tree[j] && tree[j].level > line.level;
        j++
      )
        if (
          tree[j].level === line.level + 1 &&
          (tree[j].tag === '_SHA256' || tree[j].tag === '_HASH')
        )
          pins.push(tree[j].value.toLowerCase());
    });
    if (!named) {
      if (words.includes(file.replace(/^images\//, '')))
        problems.push(
          `${file}: git ignores it, and a story or site file names it. Commit it.`,
        );
      continue;
    }
    const actual = createHash('sha256')
      .update(readFileSync(path.join(family, file)))
      .digest('hex');
    if (!pins.length)
      problems.push(
        `${file}: git ignores it, and the tree gives no _SHA256 for it. ` +
          `Commit it, or add "_SHA256 ${actual}" under it in the tree.`,
      );
    else if (pins.some((pin) => pin !== actual))
      problems.push(
        `${file}: its _SHA256 in the tree does not match the file.`,
      );
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const family = familyRoot();
  const inputs = publishInputs(readSettings(), family, engineRoot);
  let problems = 0;
  for (const { folder, pathspecs } of [
    { folder: family, pathspecs: inputs.family },
    { folder: engineRoot, pathspecs: inputs.engine },
  ]) {
    let changes;
    try {
      changes = uncommitted(folder, pathspecs);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    if (!changes.length) continue;
    problems += changes.length;
    console.error(`Uncommitted changes in ${folder}:`);
    for (const line of changes) console.error('  ' + line);
  }
  let unpinned;
  try {
    unpinned = unpinnedFiles(
      family,
      ignoredFiles(family, inputs.family),
      readSettings(),
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (unpinned.length) {
    problems += unpinned.length;
    console.error(`Files git ignores in ${family}:`);
    for (const line of unpinned) console.error('  ' + line);
  }
  if (problems) {
    console.error('Commit them first, or use --dry-run.');
    process.exit(1);
  }
  console.log('Everything the deploy publishes is committed.');
}

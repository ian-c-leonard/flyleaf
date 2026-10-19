import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishedContent } from '../app/lib/published-content.ts';
import { siteContent } from '../vite.config.ts';
import previewConfig from '../preview.config.ts';

const published = new Set(['joan-treloar', 'harold-penhallow']);

void test('content about people outside the published tree is left out', () => {
  const aliases = publishedContent(
    'name-aliases.json',
    {
      description: 'Other names',
      aliases: { 'joan-treloar': ['Jo'], 'living-cousin': ['Kit'] },
    },
    published,
  );
  assert.deepEqual(aliases.value, {
    description: 'Other names',
    aliases: { 'joan-treloar': ['Jo'] },
  });
  assert.deepEqual(aliases.removed, [
    'other names for living-cousin (living-cousin)',
  ]);

  const collections = publishedContent(
    'family-collections.json',
    [
      { id: 'letters', people: ['joan-treloar', 'harold-penhallow'] },
      { id: 'diaries', people: ['joan-treloar', 'living-cousin'] },
    ],
    published,
  );
  assert.deepEqual(
    (collections.value as { id: string }[]).map((c) => c.id),
    ['letters'],
  );
  const readings = publishedContent(
    'place-readings.json',
    [{ place: 'Penzance', people: ['living-cousin'] }],
    published,
  );
  assert.deepEqual(readings.value, []);
  const albums = publishedContent(
    'albums.json',
    [
      { id: 'songs', person: 'harold-penhallow' },
      { id: 'tapes', person: 'living-cousin' },
    ],
    published,
  );
  assert.deepEqual(
    (albums.value as { id: string }[]).map((a) => a.id),
    ['songs'],
  );

  // A recipe book belongs to one person; its index goes with it.
  const book = { labels: { person: 'living-cousin' }, volumes: [] };
  assert.equal(
    publishedContent('family-recipes.json', book, published).value,
    null,
  );
  assert.deepEqual(
    publishedContent(
      'recipe-index.json',
      {
        version: 1,
        volumes: { a: 'A' },
        recipes: [{ name: 'Pasty', credit: 'Kit' }],
      },
      published,
      'living-cousin',
    ),
    {
      value: { version: 1, volumes: {}, recipes: [] },
      removed: ['recipe index (living-cousin)'],
    },
  );
  // An index with no recipe book to name its person shows nothing.
  const orphan = publishedContent(
    'recipe-index.json',
    {
      version: 1,
      volumes: { a: 'A' },
      recipes: [{ name: 'Pasty', credit: 'Kit' }],
    },
    published,
  );
  assert.deepEqual(orphan.value, { version: 1, volumes: {}, recipes: [] });
  assert.equal(orphan.removed.length, 1);
  // Files that name no one are untouched.
  const copy = { description: 'x', replacements: [] };
  assert.equal(
    publishedContent('display-copy.json', copy, published).value,
    copy,
  );
});

void test('the site build filters content against the published tree, once it exists', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'flyleaf-content-'));
  try {
    const file = path.join(folder, 'name-aliases.json');
    writeFileSync(
      file,
      JSON.stringify({
        description: '',
        aliases: { 'joan-treloar': ['Jo'], 'living-cousin': ['Kit'] },
      }),
    );
    const tree = path.join(folder, 'family.ged');
    // Before the export writes the tree, the content is used as it is.
    assert.deepEqual(
      Object.keys(
        (siteContent('name-aliases.json', file, tree) as { aliases: object })
          .aliases,
      ),
      ['joan-treloar', 'living-cousin'],
    );
    writeFileSync(
      tree,
      '0 HEAD\n0 @I1@ INDI\n1 NAME Joan /Treloar/\n1 REFN 12\n1 REFN joan-treloar\n2 TYPE jsonid\n0 TRLR\n',
    );
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (line: string) => warnings.push(line);
    try {
      assert.deepEqual(
        Object.keys(
          (siteContent('name-aliases.json', file, tree) as { aliases: object })
            .aliases,
        ),
        ['joan-treloar'],
      );
    } finally {
      console.warn = warn;
    }
    assert.match(
      warnings.join('\n'),
      /living-cousin.*not in the published family tree/,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

void test('the preview server serves the build under its base path', async () => {
  // Whatever the family's own site.base_path, preview and build agree.
  assert.equal(
    previewConfig.base,
    (await import('../vite.config.ts')).default.base,
  );
  const saved = process.env.FLYLEAF_BASE_PATH;
  process.env.FLYLEAF_BASE_PATH = '/demo/';
  try {
    // A fresh copy of each module reads the base path again.
    const load = (file: string) =>
      import(`../${file}?demo`) as Promise<{ default: { base?: string } }>;
    const fresh = await load('preview.config.ts');
    const build = await load('vite.config.ts');
    assert.equal(fresh.default.base, '/demo/');
    assert.equal(build.default.base, fresh.default.base);
  } finally {
    if (saved === undefined) delete process.env.FLYLEAF_BASE_PATH;
    else process.env.FLYLEAF_BASE_PATH = saved;
  }
});

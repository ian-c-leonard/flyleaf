import test from 'node:test';
import assert from 'node:assert/strict';
import type { Source } from '../app/lib/gedcom.ts';
import {
  validateRecipeCatalog,
  recipeVolumesForSource,
  recipeCategoryAtPage,
  searchRecipes,
  type RecipeIndex,
} from '../app/lib/family-recipes.ts';

const volume = (
  id: string,
  shortTitle: string,
  pages: number,
  contentsPages: number,
  categories: [string, number][],
  sha: string,
) => ({
  id,
  shortTitle,
  path: `images/recipes/${id}.pdf`,
  sha256: sha.repeat(64),
  kind: 'volume',
  pages,
  contentsPages,
  summary: `${shortTitle} of the family recipes.`,
  categories: categories.map(([label, page]) => ({
    label,
    heading: label.toUpperCase(),
    page,
  })),
});
const raw = {
  version: 1,
  source: '@FAMILY_RECIPES@',
  letterImage: 'images/recipes/letter.png',
  labels: {
    title: 'Joan’s Kitchen',
    person: 'joan-treloar',
    byline: 'Joan Penhallow',
    open: 'Open the recipe books',
    credit: 'Family recipes Joan wrote down.',
    compiledBy: 'Written down by Joan Penhallow.',
    letter: 'Read Joan’s letter',
    letterDetail: '1 page',
    letterContext: 'Joan’s letter',
    searchPlaceholder: 'Find a recipe',
    searchLabel: 'Find a recipe in Joan’s volumes',
  },
  volumes: [
    {
      id: 'letter',
      shortTitle: 'Joan’s letter',
      path: 'images/recipes/letter.pdf',
      sha256: 'a'.repeat(64),
      kind: 'letter',
      pages: 1,
      contentsPages: 0,
      summary: 'The letter that came with the recipes.',
      categories: [],
    },
    volume(
      'blue-notebook',
      'Blue notebook',
      96,
      2,
      [
        ['Soups', 3],
        ['Pasties & pies', 18],
        ['Breads', 31],
        ['Puddings', 52],
        ['Cakes', 64],
        ['Preserves', 88],
      ],
      'b',
    ),
    volume(
      'red-notebook',
      'Red notebook',
      72,
      3,
      [
        ['Harbour suppers', 3],
        ['Jams & jellies', 60],
      ],
      'c',
    ),
    volume(
      'clippings',
      'Clippings to try',
      40,
      1,
      [
        ['Soups', 2],
        ['Sweets', 39],
      ],
      'd',
    ),
  ],
};
const catalog = validateRecipeCatalog(raw);
const source: Source = {
  id: 'family-recipes',
  pointer: catalog.source,
  label: 'Collection citation with the covering letter',
  locator: 'Covering letter, Easter 2008',
  url: '',
  archivePath: '',
  note: '',
  archives: catalog.volumes.map((volume) => ({
    path: volume.path,
    title: `Original ${volume.shortTitle}`,
    kind: volume.kind === 'letter' ? 'document' : 'book',
    nature: volume.summary,
    locator:
      volume.kind === 'letter'
        ? 'Covering letter, Easter 2008'
        : '2 April 2008; bound copy',
    status: 'Complete original',
  })),
};

void test('recipe navigation binds only retained files on the canonical source and preserves volume metadata', () => {
  const volumes = recipeVolumesForSource(source, catalog);
  assert.equal(volumes.length, 4);
  assert.equal(volumes[1].file.title, 'Original Blue notebook');
  assert.equal(volumes[1].file.locator, '2 April 2008; bound copy');
  assert.equal(
    recipeVolumesForSource({ ...source, pointer: '@OTHER_SOURCE@' }, catalog)
      .length,
    0,
  );
  assert.deepEqual(
    recipeVolumesForSource(
      { ...source, archives: source.archives.slice(2) },
      catalog,
    ).map((volume) => volume.id),
    ['red-notebook', 'clippings'],
  );
});

void test('current recipe category follows real first pages while contents and letter stay distinct', () => {
  const blue = catalog.volumes.find((volume) => volume.id === 'blue-notebook')!;
  assert.equal(recipeCategoryAtPage(blue, 1), null);
  assert.equal(recipeCategoryAtPage(blue, 63)?.label, 'Puddings');
  assert.equal(recipeCategoryAtPage(blue, 64)?.label, 'Cakes');
  assert.equal(recipeCategoryAtPage(blue, 96)?.label, 'Preserves');
  assert.equal(recipeCategoryAtPage(catalog.volumes[0], 1), null);
});

void test('invalid pages, ordering and ambiguous or unsafe volume identities fail before display', () => {
  const variant = () => structuredClone(raw);
  const invalidPage = variant();
  invalidPage.volumes[1].categories[0].page = 97;
  assert.throws(() => validateRecipeCatalog(invalidPage), /page/);
  const reversed = variant();
  reversed.volumes[1].categories.reverse();
  assert.throws(() => validateRecipeCatalog(reversed), /order/);
  const duplicate = variant();
  duplicate.volumes[2].id = duplicate.volumes[1].id;
  assert.throws(() => validateRecipeCatalog(duplicate), /identity/);
  const traversal = variant();
  traversal.volumes[1].path = '../outside.pdf';
  assert.throws(() => validateRecipeCatalog(traversal), /identity/);
  const letter = variant();
  letter.volumes[0].categories = [
    { label: 'Recipes', heading: 'RECIPES', page: 1 },
  ];
  assert.throws(() => validateRecipeCatalog(letter), /single page/);
});

void test('recipe search finds names, cooks and categories', () => {
  const index: RecipeIndex = {
    version: 1,
    volumes: Object.fromEntries(
      catalog.volumes
        .filter((v) => v.kind === 'volume')
        .map((v) => [v.id, v.sha256]),
    ),
    recipes: [
      { name: 'Steak Pasty', volume: 'blue-notebook', page: 20 },
      {
        name: 'Pasty with Swede',
        volume: 'blue-notebook',
        page: 21,
        credit: 'Edith Penhallow',
      },
      {
        name: 'Harbour Pasty',
        volume: 'red-notebook',
        page: 12,
        credit: 'Joan Penhallow',
      },
      { name: 'Saffron Buns', volume: 'blue-notebook', page: 33 },
      {
        name: 'Stargazy Pie',
        volume: 'blue-notebook',
        page: 25,
        credit: 'Mary Treloar',
      },
      { name: 'Easter Saffron Loaf', volume: 'clippings', page: 30 },
      {
        name: 'Figgy Pudding',
        volume: 'blue-notebook',
        page: 55,
        credit: 'Edith Penhallow',
      },
    ],
  };
  const pasty = searchRecipes(index, catalog.volumes, 'pasty');
  assert.ok(pasty.length >= 3);
  // Names that start with the search come before names that contain it.
  const saffron = searchRecipes(index, catalog.volumes, 'saffron');
  assert.match(saffron[0].name, /^Saffron/);
  assert.doesNotMatch(saffron.at(-1)!.name, /^Saffron/);
  assert.ok(
    searchRecipes(index, catalog.volumes, 'penhallow').every((r) =>
      r.credit?.includes('Penhallow'),
    ),
  );
  const steak = searchRecipes(index, catalog.volumes, 'steak pasty')[0];
  assert.deepEqual(
    { volume: steak.volume, page: steak.page, category: steak.category },
    { volume: 'blue-notebook', page: 20, category: 'Pasties & pies' },
  );
  assert.deepEqual(searchRecipes(index, catalog.volumes, '  '), []);
  // A volume whose PDF no longer matches the index is not searched.
  const changed = catalog.volumes.map((v) => ({
    ...v,
    sha256: '0'.repeat(64),
  }));
  assert.deepEqual(searchRecipes(index, changed, 'pasty'), []);
});

void test('a collection without a letter needs only a cover picture and the general labels', () => {
  const { letterImage: _letter, ...rest } = structuredClone(raw);
  const {
    letter: _l,
    letterDetail: _d,
    letterContext: _c,
    ...labels
  } = rest.labels;
  const booklet = {
    ...rest,
    coverImage: 'images/recipes/cover.jpg',
    labels,
    volumes: rest.volumes.filter((volume) => volume.kind !== 'letter'),
  };
  const checked = validateRecipeCatalog(booklet);
  assert.equal(checked.coverImage, 'images/recipes/cover.jpg');
  assert.equal(checked.letterImage, undefined);
  assert.equal(checked.labels.letter, undefined);
  // A letter needs its labels.
  assert.throws(
    () => validateRecipeCatalog({ ...booklet, volumes: rest.volumes }),
    /label/,
  );
  assert.throws(
    () => validateRecipeCatalog({ ...booklet, coverImage: '../cover.jpg' }),
    /image/,
  );
  // Older files name only the letter picture; it is the cover too.
  const older = validateRecipeCatalog(raw);
  assert.equal(older.coverImage, raw.letterImage);
  assert.equal(older.letterImage, raw.letterImage);
  assert.equal(older.labels.letterContext, raw.labels.letterContext);
});

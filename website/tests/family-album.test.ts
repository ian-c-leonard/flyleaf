import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGedcom, type AtlasData } from '../app/lib/gedcom.ts';
import {
  albumCaptionYears,
  albumCollection,
  albumFilters,
  albumMatches,
  familyAlbum,
  type AlbumFilter,
} from '../app/lib/family-album.ts';
import { readRoute, routeHref } from '../app/lib/navigation.ts';
import { resolveDocument } from '../app/lib/archive.ts';
import type { VisualMedia } from '../app/lib/visuals.ts';
import type { SiteSettings } from '../app/lib/settings.ts';

function fixture() {
  return parseGedcom(`0 HEAD
1 _ATLAS
2 _ROOT @A@
0 @A@ INDI
1 REFN david-penhallow
1 NAME David /Penhallow/
2 NICK Davy
0 @B@ INDI
1 NAME Beatrice /Other/
0 TRLR`);
}
function add(
  data: AtlasData,
  path: string,
  changes: Partial<VisualMedia> = {},
) {
  const asset = {
    id: path,
    path: `images/${path}.jpg`,
    title: path,
    credit: '',
    rights: '',
  };
  const visual: VisualMedia = {
    path: asset.path,
    assetId: asset.id,
    title: path,
    content: 'photograph',
    album: 'display',
    role: 'portrait',
    avatarEligible: false,
    avatarPosition: 'top',
    qualified: false,
    subjectIds: ['david-penhallow'],
    associatedIds: [],
    captionPeople: [],
    commemoratedIds: [],
    otherSubjects: [],
    publicNote: '',
    note: '',
    ...changes,
  };
  data.assets.push(asset);
  (data.visuals ||= []).push(visual);
  return visual;
}

void test('Photos opens All by default and an explicit collection survives its share link', () => {
  const data = fixture();
  const ordinary = readRoute('#view=photos&branch=david-penhallow', data);
  assert.equal(ordinary.photoSection, 'all');
  assert.equal(
    new URLSearchParams(routeHref(ordinary).slice(1)).has('photoSection'),
    false,
  );
  for (const photoSection of Object.keys(albumFilters) as AlbumFilter[]) {
    const restored = readRoute(routeHref({ ...ordinary, photoSection }), data);
    assert.equal(restored.photoSection, photoSection);
    assert.equal(restored.branch, 'david-penhallow');
    assert.equal(restored.view, 'photos');
  }
  for (const invalid of ['unknown', 'constructor', '__proto__'])
    assert.equal(
      readRoute('#view=photos&photoSection=' + invalid, data).photoSection,
      'all',
    );
});
function link(
  data: AtlasData,
  parent: VisualMedia | string,
  child: VisualMedia,
  role: string,
) {
  (data.representations ||= []).push({
    id: `${typeof parent === 'string' ? parent : parent.path}-${child.path}`,
    parent: typeof parent === 'string' ? parent : parent.path,
    child: child.path,
    role,
    method: 'Recorded operation',
    recipe: '',
    witness: '',
  });
}

void test('identified family pictures lead while captioned groups, memorials and qualified faces stay distinct', () => {
  const data = fixture();
  add(data, 'portrait', { avatarEligible: true });
  add(data, 'painting', { content: 'artwork' });
  add(data, 'unkeyed', {
    role: 'group',
    subjectIds: [],
    captionPeople: ['david-penhallow'],
    qualified: true,
  });
  add(data, 'marker', {
    role: 'memorial',
    subjectIds: [],
    commemoratedIds: ['david-penhallow'],
  });
  add(data, 'possible', { qualified: true });
  const entries = familyAlbum(data);
  assert.equal(entries[0].asset.id, 'portrait');
  assert.deepEqual(
    new Map(entries.map((entry) => [entry.asset.id, entry.section])),
    new Map([
      ['portrait', 'family'],
      ['painting', 'artwork'],
      ['unkeyed', 'captioned'],
      ['marker', 'places'],
      ['possible', 'context'],
    ]),
  );
  assert.equal(
    entries.find((entry) => entry.asset.id === 'painting')!.visual.content,
    'artwork',
  );
});
void test('occasion collections retain whole photographs and uncertainty; artwork is separate', () => {
  const data = fixture();
  const wedding = add(data, 'whole wedding', {
    title: 'Family wedding — 2009',
    role: 'group',
    subjectIds: ['david-penhallow', 'B'],
  });
  const crop = add(data, 'portrait detail');
  link(data, wedding, crop, 'crop');
  add(data, 'unassigned wedding', {
    title: 'Tamsin and Erik’s wedding — 2009',
    role: 'group',
    qualified: true,
    subjectIds: [],
    associatedIds: ['david-penhallow'],
  });
  add(data, 'cartoon', {
    content: 'artwork',
    role: 'object',
    subjectIds: [],
    associatedIds: ['david-penhallow'],
  });
  const map = add(data, 'map', {
    content: 'artwork',
    role: 'place',
    subjectIds: [],
    associatedIds: ['david-penhallow'],
  });
  const entries = familyAlbum(data);
  const whole = entries.find((entry) => entry.asset.id === 'whole wedding')!;
  assert.equal(whole.section, 'occasions');
  assert.deepEqual(
    whole.views.map((view) => view.asset.id),
    ['whole wedding', 'portrait detail'],
  );
  const unassigned = entries.find(
    (entry) => entry.asset.id === 'unassigned wedding',
  )!;
  assert.equal(unassigned.section, 'occasions');
  assert.equal(unassigned.visual.qualified, true);
  assert.deepEqual(unassigned.visual.subjectIds, []);
  assert.equal(
    entries.find((entry) => entry.asset.id === 'cartoon')!.section,
    'artwork',
  );
  assert.equal(
    entries.find((entry) => entry.asset.id === map.assetId)!.section,
    'places',
  );
});

void test('family occasions are a dated timeline without inventing dates or identities', () => {
  const data = fixture();
  add(data, 'a-old-wedding', { title: 'Wedding — 1943', role: 'group' });
  add(data, 'b-new-engagement', {
    title: 'Engagement party 2006',
    role: 'group',
  });
  add(data, 'z-undated-graduation-2008', {
    title: 'Family graduation',
    role: 'group',
    publicNote: 'The photograph date is unknown.',
  });
  add(data, 'c-other-2006', { title: 'Wedding — 2006', role: 'group' });
  add(data, 'unidentified-ball', {
    title: 'At a harvest supper in Dodgeville',
    role: 'group',
    qualified: true,
    subjectIds: [],
    otherSubjects: ['Two guests whose names are not known'],
  });
  const entries = familyAlbum(data),
    before = structuredClone(entries);
  assert.equal(albumCollection(entries, 'all'), entries);
  assert.deepEqual(
    albumCollection(entries, 'occasions').map((e) => e.asset.id),
    [
      'b-new-engagement',
      'c-other-2006',
      'a-old-wedding',
      'z-undated-graduation-2008',
    ],
  );
  assert.equal(
    entries.find((e) => e.asset.id === 'unidentified-ball')!.section,
    'context',
  );
  assert.deepEqual(entries, before);
  assert.deepEqual(
    albumCollection(entries, 'occasions').at(-1)!.captionYears,
    [],
  );
});

void test('a family’s own occasion and dating words come from its settings', async () => {
  const words = (album: typeof import('../app/lib/family-album.ts')) => {
    const data = fixture();
    const supper = add(data, 'supper', {
      title: 'Harvest supper 2011',
      role: 'group',
    });
    const senior = add(data, 'senior', { title: 'Senior portrait, 1958' });
    return {
      occasion: album.familyAlbum(data).find((e) => e.asset.id === 'supper')!
        .section,
      years: [album.albumCaptionYears(supper), album.albumCaptionYears(senior)],
    };
  };
  // A fresh copy of the module reads the words in force when it loads. The
  // tests may run inside a family folder, so set every word list.
  const photos = (globalThis as { __FLYLEAF_SITE__?: SiteSettings })
    .__FLYLEAF_SITE__!.photos;
  const saved = structuredClone(photos);
  const withWords = async (copy: string, words: Partial<typeof photos>) => {
    Object.assign(photos, {
      occasionWords: [],
      yearbookNames: [],
      datedWords: [],
      ...words,
    });
    try {
      return await import(`../app/lib/family-album.ts?${copy}`);
    } finally {
      Object.assign(photos, saved);
    }
  };
  // Built in, only general words: neither title is an occasion or a date.
  assert.deepEqual(words(await withWords('built-in', {})), {
    occasion: 'family',
    years: [[], []],
  });
  assert.deepEqual(
    words(
      await withWords('family-words', {
        occasionWords: ['harvest supper'],
        datedWords: ['senior'],
      }),
    ),
    { occasion: 'occasions', years: [[2011], [1958]] },
  );
});

void test('a preferred portrait from each relative leads before repeat sittings of one person', () => {
  const data = fixture();
  add(data, 'David preferred', { avatarEligible: true });
  add(data, 'David repeat', { avatarEligible: true });
  add(data, 'Beatrice preferred', {
    avatarEligible: true,
    subjectIds: ['B'],
  });
  assert.deepEqual(
    familyAlbum(data).map((entry) => entry.asset.id),
    ['David preferred', 'Beatrice preferred', 'David repeat'],
  );
});
void test('direct recorded crops are grouped with the family image, while a shared PDF never merges independent photographs', () => {
  const data = fixture();
  const group = add(data, 'group', {
    role: 'group',
    subjectIds: ['david-penhallow', 'B'],
  });
  const crop = add(data, 'crop');
  link(data, group, crop, 'crop');
  const alternate = add(data, 'alternate', {
    album: 'alternate',
    role: 'group',
    subjectIds: ['david-penhallow', 'B'],
  });
  link(data, group, alternate, 'derived');
  const first = add(data, 'first');
  const second = add(data, 'second');
  link(data, 'images/source.pdf', first, 'extracted-image');
  link(data, 'images/source.pdf', second, 'extracted-image');
  const entries = familyAlbum(data);
  assert.equal(entries.length, 3);
  const family = entries.find((entry) => entry.asset.id === 'group')!;
  assert.deepEqual(
    new Set(family.views.map((view) => view.asset.id)),
    new Set(['group', 'crop', 'alternate']),
  );
  assert.ok(entries.some((entry) => entry.asset.id === 'first'));
  assert.ok(entries.some((entry) => entry.asset.id === 'second'));
});
void test('a paired layout stays accessible without collapsing separate sittings into one photograph', () => {
  const data = fixture();
  const first = add(data, 'first');
  const second = add(data, 'second');
  const paired = add(data, 'paired');
  link(data, first, paired, 'composite');
  link(data, second, paired, 'composite');
  const entries = familyAlbum(data);
  assert.equal(entries.length, 2);
  assert.ok(
    entries.every((entry) =>
      entry.views.some((view) => view.asset.id === 'paired' && view.combined),
    ),
  );
  const onlyAlternate = fixture();
  const source = add(onlyAlternate, 'original', { album: 'alternate' });
  const composite = add(onlyAlternate, 'composite');
  link(onlyAlternate, source, composite, 'composite');
  assert.equal(
    familyAlbum(onlyAlternate)[0].asset.id,
    'composite',
    'A display layout with no displayed source cannot disappear',
  );
});
void test('a source association does not put an unrelated face into a selected branch’s family portraits', () => {
  const data = fixture();
  add(data, 'relative', {
    subjectIds: ['B'],
    associatedIds: ['david-penhallow'],
  });
  add(data, 'outside', { subjectIds: ['B'] });
  add(data, 'own');
  const entries = familyAlbum(data, new Set(['david-penhallow']));
  assert.deepEqual(
    new Set(entries.map((entry) => entry.asset.id)),
    new Set(['own', 'relative']),
  );
  assert.equal(
    entries.find((entry) => entry.asset.id === 'relative')!.section,
    'context',
  );
});
void test('caption periods use explicitly stated context, not capture filenames, lifespan or memorial dates', () => {
  const data = fixture();
  const clear = add(data, 'retrieved-2026', {
    title: 'William — 1923 passport photograph',
    publicNote:
      'Pasted onto his passport form. The photograph date is unknown.',
  });
  assert.deepEqual(albumCaptionYears(clear), [1923]);
  const published = add(data, 'published', {
    publicNote:
      'Printed in the parish magazine in March 1996. The exact photograph date is unknown.',
  });
  assert.deepEqual(albumCaptionYears(published), [1996]);
  const unknown = add(data, '1972-capture', {
    title: 'Family portrait',
    publicNote: 'A portrait of David. The photograph date is unknown.',
  });
  assert.deepEqual(albumCaptionYears(unknown), []);
  const marker = add(data, 'marker', {
    role: 'memorial',
    subjectIds: [],
    commemoratedIds: ['david-penhallow'],
    publicNote: 'The marker reads 1871–1934. The photograph is undated.',
  });
  assert.deepEqual(albumCaptionYears(marker), []);
  const ambiguous = add(data, 'uncertain', {
    publicNote: 'The publication year 1930 is uncertain.',
  });
  assert.deepEqual(albumCaptionYears(ambiguous), []);
  const graduation = add(data, '2011-family', {
    title: 'Graduation 2011 — Dodgeville',
    role: 'group',
    publicNote:
      'Family round the table at Dodgeville. Names written on the back by a cousin in May 2012.',
  });
  assert.deepEqual(albumCaptionYears(graduation), [2011]);
  const engagement = add(data, 'undated-file', {
    title: 'Tamsin and Erik’s engagement — 9 August 2008',
    role: 'group',
    publicNote:
      'Names, occasion and date written on the envelope by Nora Penhallow.',
  });
  assert.deepEqual(albumCaptionYears(engagement), [2008]);
  assert.ok(
    albumMatches(
      data,
      familyAlbum(data).find((entry) => entry.asset.id === 'published')!,
      { period: '1980on' },
    ),
  );
  assert.ok(
    albumMatches(
      data,
      familyAlbum(data).find((entry) => entry.asset.id === '1972-capture')!,
      { period: 'undated' },
    ),
  );
});
void test('album search uses public captions and accepted names but never research instructions', () => {
  const data = fixture();
  add(data, 'file-secret', {
    title: 'Family portrait',
    publicNote: 'David beside the garden.',
    note: 'Private-review-code secret-token 2026.',
  });
  const entry = familyAlbum(data)[0];
  assert.ok(albumMatches(data, entry, { query: 'Davy' }));
  assert.ok(albumMatches(data, entry, { query: 'garden' }));
  assert.ok(!albumMatches(data, entry, { query: 'secret-token' }));
  assert.ok(!albumMatches(data, entry, { personId: 'B' }));
});
void test('current selected album preserves every display visual, portraits and source originals without one quota', () => {
  const data = parseGedcom(
    readFileSync(new URL('../public/data/family.ged', import.meta.url), 'utf8'),
  );
  const entries = familyAlbum(data);
  const held = new Set(
    entries.flatMap((entry) => entry.views.map((view) => view.visual.path)),
  );
  for (const visual of (data.visuals || []).filter(
    (visual) => visual.album === 'display',
  ))
    assert.ok(held.has(visual.path), visual.path);
  for (const entry of entries)
    assert.ok(
      resolveDocument(data, entry.asset.id)?.archives.some(
        (file) => file.path === entry.asset.path,
      ),
    );
});
void test('cyclic image derivations terminate without losing or duplicating a display image', () => {
  const data = fixture();
  const a = add(data, 'a');
  const b = add(data, 'b');
  link(data, a, b, 'derived');
  link(data, b, a, 'derived');
  const entries = familyAlbum(data);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].views.length, 2);
});

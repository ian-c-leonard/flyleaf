import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGedcom,
  type AtlasData,
  type Representation,
} from '../app/lib/gedcom.ts';
import { familyFocus } from '../app/lib/branches.ts';
import {
  albumPictures,
  identifiedPortrait,
  peopleFirst,
  visualSources,
  visualCaptions,
  personGallery,
  portraitDescription,
  visualLabel,
  type VisualMedia,
} from '../app/lib/visuals.ts';
import { archiveCatalog, archiveGroups } from '../app/lib/archive.ts';

const hash = 'a'.repeat(64);
const header = `0 HEAD
1 _ATLAS
2 _ROOT @A@
1 _ARCHIVE_CATALOG
2 OBJE @V@
0 @A@ INDI
1 NAME Alice /Family/
1 REFN alice
1 SOUR @S@
1 OBJE @OLD@
0 @B@ INDI
1 NAME Beatrice /Family/
1 REFN beatrice
0 @S@ SOUR
1 TITL Source for Alice
1 OBJE
2 FILE images/shared.jpg
0 @OLD@ OBJE
1 FILE images/shared.jpg
1 TITL Original use caption; exact identity qualification.
1 _CREDIT Original photographer credit
1 _TYPE book-illustration
`;
const description = `0 @V@ OBJE
1 FILE images/shared.jpg
2 _SHA256 ${hash}
1 TITL Reviewed album title
1 _CONTENT photograph
1 _ALBUM display
1 _VISUAL_ROLE portrait
1 _SUBJECT @A@
1 _AVATAR Y
`;
const fixture = (visual = description, base = header) =>
  base + visual + '0 TRLR\n';

void test('a named group keeps its photograph label while unassigned faces stay qualified', () => {
  const named = description
    .replace('1 _VISUAL_ROLE portrait', '1 _VISUAL_ROLE group')
    .replace('1 _SUBJECT @A@', '1 _CAPTION_PERSON @A@')
    .replace(
      '1 _AVATAR Y',
      '1 _QUALIFIED Y\n1 _OTHER_SUBJECT Guests not individually identified',
    );
  const data = parseGedcom(fixture(named));
  const visual = data.visuals![0],
    before = structuredClone(visual);
  assert.equal(visualLabel(visual), 'Group photograph');
  assert.deepEqual(visual.subjectIds, []);
  assert.deepEqual(visual.captionPeople, ['alice']);
  assert.equal(visual.qualified, true);
  assert.equal(identifiedPortrait(data, 'alice'), undefined);
  assert.deepEqual(visual, before);
  const unknown = { ...visual, captionPeople: [] };
  assert.equal(visualLabel(unknown), 'Related photograph');
});

void test('a classified file retains its separate use captions and explicit portrait approval', () => {
  const data = parseGedcom(fixture());
  assert.equal(data.visuals?.length, 1);
  assert.equal(albumPictures(data)[0].title, 'Reviewed album title');
  assert.ok(
    data.assets.some(
      (a) =>
        a.title === 'Original use caption; exact identity qualification.' &&
        a.credit === 'Original photographer credit',
    ),
  );
  assert.equal(identifiedPortrait(data, 'alice')?.path, 'images/shared.jpg');
  assert.equal(identifiedPortrait(data, 'beatrice'), undefined);
  assert.equal(
    identifiedPortrait(
      parseGedcom(fixture(description.replace('1 _AVATAR Y\n', ''))),
      'alice',
    ),
    undefined,
  );
});

void test('public picture captions stay separate from research notes and retain paragraph breaks', () => {
  const withNotes =
    description +
    '1 _DISCOVERY_NOTE Internal extraction recipe and review procedure.\n' +
    '1 _PUBLIC_NOTE A family portrait.\n2 CONT The photographer is unknown.\n';
  const visual = parseGedcom(fixture(withNotes)).visuals![0];
  assert.equal(
    visual.publicNote,
    'A family portrait.\nThe photographer is unknown.',
  );
  assert.equal(visual.note, 'Internal extraction recipe and review procedure.');
  const researchOnly = parseGedcom(
    fixture(description + '1 _DISCOVERY_NOTE Never display this by default.\n'),
  ).visuals![0];
  assert.equal(researchOnly.publicNote, '');
  assert.equal(researchOnly.note, 'Never display this by default.');
  assert.throws(() =>
    parseGedcom(
      fixture(withNotes + '1 _PUBLIC_NOTE Conflicting public caption.\n'),
    ),
  );
  assert.throws(() =>
    parseGedcom(
      fixture(
        description,
        header.replace(
          '1 NAME Alice /Family/',
          '1 NAME Alice /Family/\n1 _PUBLIC_NOTE Wrong parent',
        ),
      ),
    ),
  );
});

void test('authored public captions reject process leaks while original source and private notes remain intact', () => {
  for (const caption of [
    'Subject @I0042@ is identified.',
    'Taken at the house of @P7@.',
    'Copied from @WEB_PENHALLOW_LETTERS@.',
    'Filed under @S-12.3@.',
  ])
    assert.throws(
      () => parseGedcom(fixture(description + `1 _PUBLIC_NOTE ${caption}\n`)),
      /Public visual caption contains internal research instructions/,
    );
  // A family's own working phrases are the build's check, from its settings;
  // ordinary captions in the browser are never mistaken for them.
  for (const caption of [
    'Do not miss the garden behind them.',
    'Write to carol@example.com for a copy.',
    'Two addresses: carol@example.com and jory@example.com.',
  ])
    assert.equal(
      parseGedcom(fixture(description + `1 _PUBLIC_NOTE ${caption}\n`))
        .visuals![0].publicNote,
      caption,
    );

  const original =
    'Do not assign a face. See reviews/original.txt; PDF object 24.';
  const data = parseGedcom(
    fixture(
      description +
        `1 _DISCOVERY_NOTE ${original}\n` +
        '1 _PUBLIC_NOTE Portrait supplied with the obituary.\n',
      header.replace(
        '1 TITL Source for Alice',
        `1 TITL Source for Alice\n1 NOTE ${original}`,
      ),
    ),
  );
  assert.equal(data.visuals![0].note, original);
  assert.equal(
    data.sources.find((source) => source.label === 'Source for Alice')?.note,
    original,
  );
  assert.equal(
    data.visuals![0].publicNote,
    'Portrait supplied with the obituary.',
  );
});

void test('all authored visual labels are guarded and only public captions enter archive search', () => {
  for (const authored of [
    description.replace(
      '1 TITL Reviewed album title',
      '1 TITL Portrait of @I0042@',
    ),
    description + '1 _OTHER_SUBJECT The man beside @I0043@\n',
  ])
    assert.throws(
      () => parseGedcom(fixture(authored)),
      /internal research instructions/,
    );
  const data = parseGedcom(
    fixture(
      description +
        '1 _DISCOVERY_NOTE Private extract recipe.\n1 _PUBLIC_NOTE Holds a sunflower beside the garden.\n',
    ),
  );
  const entry = archiveCatalog(data).find(
    (item) => item.file.path === 'images/shared.jpg',
  )!;
  assert.match(entry.searchText, /sunflower/);
  assert.doesNotMatch(entry.searchText, /private extract recipe/);
});

void test('source-only inline classification is discoverable without a person media attachment', () => {
  const base = header.replace('2 OBJE @V@\n', '').replace('1 OBJE @OLD@\n', '');
  const inline = description
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) =>
      line.replace(/^([12]) /, (_, level) => `${Number(level) + 1} `),
    )
    .join('\n');
  const data = parseGedcom(
    fixture(
      '',
      base.replace('1 OBJE\n2 FILE images/shared.jpg\n', `1 OBJE\n${inline}\n`),
    ),
  );
  assert.equal(albumPictures(data).length, 1);
  assert.equal(
    visualSources(data, 'images/shared.jpg')[0].label,
    'Source for Alice',
  );
  assert.equal(albumPictures(familyFocus(data, 'alice').data).length, 1);
});

void test('portrait artwork needs explicit approval and retains its actual medium', () => {
  const art = description
    .replace('_CONTENT photograph', '_CONTENT artwork')
    .replace('1 _AVATAR Y\n', '');
  const data = parseGedcom(fixture(art));
  assert.equal(albumPictures(data).length, 1);
  assert.equal(identifiedPortrait(data, 'alice'), undefined);
  const approved = parseGedcom(
    fixture(description.replace('_CONTENT photograph', '_CONTENT artwork')),
  );
  const portrait = identifiedPortrait(approved, 'alice');
  assert.ok(portrait);
  assert.equal(visualLabel(approved.visuals![0]), 'Portrait artwork');
  assert.equal(
    portraitDescription(approved, portrait),
    'Portrait artwork: Reviewed album title',
  );
  const alternate = parseGedcom(
    fixture(description.replace('_ALBUM display', '_ALBUM alternate')),
  );
  assert.equal(albumPictures(alternate).length, 0);
  assert.equal(alternate.visuals?.length, 1);
});

void test('ambiguous metadata and invalid person pointers fail instead of silently choosing a value', () => {
  const invalid = [
    description.replace(
      '1 _CONTENT photograph',
      '1 _CONTENT photograph\n1 _CONTENT artwork',
    ),
    description.replace(
      '1 _ALBUM display',
      '1 _ALBUM display\n1 _ALBUM alternate',
    ),
    description + description.replace('@V@ OBJE', '@V2@ OBJE'),
    description.replace('1 TITL', '1 FILE images/another.jpg\n1 TITL'),
    description.replace('_SUBJECT @A@', '_SUBJECT @S@'),
    description.replace('_SUBJECT @A@', '_SUBJECT @MISSING@'),
    description.replace(
      '_SUBJECT @A@',
      '_SUBJECT @A@\n2 NOTE not a person pointer',
    ),
    description.replace('_SUBJECT @A@', '_SUBJECT @A@\n1 _SUBJECT @B@'),
    description.replace('_VISUAL_ROLE portrait', '_VISUAL_ROLE group'),
    description.replace('_VISUAL_ROLE portrait', '_VISUAL_ROLE object'),
    description.replace('_SUBJECT @A@', '_RELATED @A@'),
    description.replace('1 _AVATAR Y', '1 _AVATAR Y\n1 _QUALIFIED Y'),
    description
      .replace('_CONTENT photograph', '_CONTENT artwork')
      .replace('1 _AVATAR Y', '1 _AVATAR Y\n1 _QUALIFIED Y'),
  ];
  for (const bad of invalid) assert.throws(() => parseGedcom(fixture(bad)));
  assert.throws(() =>
    parseGedcom(
      fixture(
        description,
        header.replace('2 OBJE @V@', '2 OBJE @V@\n3 _CONTENT photograph'),
      ),
    ),
  );
});

void test('person galleries rank depicted portraits before school and place context without losing selections', () => {
  const visual = (
    id: string,
    title: string,
    relation: string,
    role = 'group',
    extra = '',
  ) => `0 @${id}@ OBJE
1 FILE images/${id}.jpg
2 _SHA256 ${hash}
1 TITL ${title}
1 _CONTENT photograph
1 _ALBUM display
1 _VISUAL_ROLE ${role}
1 ${relation} @A@
${extra}`;
  const context = Array.from({ length: 8 }, (_, i) =>
    visual(`context${i}`, `School context ${i}`, '_RELATED'),
  ).join('');
  const data = parseGedcom(
    fixture(
      context +
        visual('captioned', 'Named band photograph', '_CAPTION_PERSON') +
        visual('group', 'Identified family group', '_SUBJECT') +
        visual('student', 'Student portrait', '_SUBJECT', 'portrait') +
        description +
        visual(
          'qualified',
          'Attributed portrait',
          '_SUBJECT',
          'portrait',
          '1 _QUALIFIED Y\n',
        ) +
        visual('alternate', 'Alternate scan', '_SUBJECT', 'portrait').replace(
          '_ALBUM display',
          '_ALBUM alternate',
        ),
    ),
  );
  const gallery = personGallery(data, 'alice');
  assert.deepEqual(
    gallery.depicted.map((entry) => entry.visual.title),
    ['Reviewed album title', 'Student portrait', 'Identified family group'],
  );
  assert.deepEqual(
    gallery.captioned.map((entry) => entry.visual.title),
    ['Named band photograph'],
  );
  assert.equal(gallery.related.length, 9);
  assert.equal(gallery.all.length, 13);
  assert.equal(gallery.related[0].label, 'Related photograph');
  assert.equal(
    gallery.all.some((entry) => entry.visual.title === 'Alternate scan'),
    false,
  );
  assert.equal(data.visuals?.length, 14);
  assert.deepEqual(personGallery(data, 'beatrice').all, []);
});

void test('gallery ordering is deterministic across insertion order and never promotes commemoration to depiction', () => {
  const memorial = description
    .replace('@V@ OBJE', '@M@ OBJE')
    .replace('images/shared.jpg', 'images/memorial.jpg')
    .replace('1 _AVATAR Y\n', '')
    .replace('_SUBJECT @A@', '_COMMEMORATES @A@')
    .replace('_VISUAL_ROLE portrait', '_VISUAL_ROLE memorial');
  const group = description
    .replace('@V@ OBJE', '@G@ OBJE')
    .replace('images/shared.jpg', 'images/group.jpg')
    .replace('1 _AVATAR Y\n', '')
    .replace('_VISUAL_ROLE portrait', '_VISUAL_ROLE group');
  const first = personGallery(
    parseGedcom(fixture(memorial + group + description)),
    'alice',
  );
  const reverse = personGallery(
    parseGedcom(fixture(description + group + memorial)),
    'alice',
  );
  assert.deepEqual(
    first.all.map((entry) => entry.visual.path),
    reverse.all.map((entry) => entry.visual.path),
  );
  assert.equal(first.related[0].visual.path, 'images/memorial.jpg');
  assert.ok(first.depicted.every((entry) => entry.visual.role !== 'memorial'));
});

void test('branch-retained source files keep classification even when reached via another representation', () => {
  const data = parseGedcom(
    fixture(
      description.replace('1 _SUBJECT @A@\n1 _AVATAR Y\n', ''),
      header
        .replace('1 OBJE @OLD@\n', '')
        .replace('2 FILE images/shared.jpg', '2 FILE images/root.pdf') +
        '0 @Q@ SOUR\n1 TITL Related source\n1 OBJE\n2 FILE images/page.jpg\n1 OBJE\n2 FILE images/shared.jpg\n',
    ),
  );
  // Include the related source as a catalogue source, as the ordinary parser does.
  const withSource = parseGedcom(
    fixture(
      description.replace('1 _SUBJECT @A@\n1 _AVATAR Y\n', ''),
      header
        .replace('2 OBJE @V@', '2 OBJE @V@\n2 SOUR @Q@')
        .replace('1 OBJE @OLD@\n', '')
        .replace('2 FILE images/shared.jpg', '2 FILE images/root.pdf') +
        '0 @Q@ SOUR\n1 TITL Related source\n1 OBJE\n2 FILE images/page.jpg\n1 OBJE\n2 FILE images/shared.jpg\n',
    ),
  );
  assert.equal(data.visuals?.length, 1);
  withSource.representations = [
    {
      id: 'page',
      parent: 'images/root.pdf',
      child: 'images/page.jpg',
      role: 'page',
      method: '',
      recipe: '',
      witness: '',
    },
  ];
  const branch = familyFocus(withSource, 'alice').data;
  assert.ok(branch.sources.some((s) => s.label === 'Related source'));
  assert.equal(branch.visuals?.length, 1);
  assert.equal(albumPictures(branch).length, 1);
});

void test('source context follows recorded parents without inheriting sibling photograph ownership', () => {
  const data = parseGedcom(
    fixture(
      description,
      header.replace('2 OBJE @V@', '2 OBJE @V@\n2 SOUR @Q@') +
        '0 @Q@ SOUR\n1 TITL Other portrait\n1 OBJE\n2 FILE images/other.jpg\n',
    ),
  );
  const edge = (id: string, parent: string, child: string): Representation => ({
    id,
    parent,
    child,
    role: 'crop',
    method: '',
    recipe: '',
    witness: '',
  });
  data.representations = [
    edge('a', 'images/page.jpg', 'images/shared.jpg'),
    edge('b', 'images/page.jpg', 'images/other.jpg'),
  ];
  assert.deepEqual(
    visualSources(data, 'images/shared.jpg').map((s) => s.label),
    ['Source for Alice'],
  );
});

void test('photograph discovery searches classified subjects and keeps distinct pictures on one page', () => {
  const second = description
    .replace('@V@ OBJE', '@V2@ OBJE')
    .replace('images/shared.jpg', 'images/beatrice.jpg')
    .replace('_SUBJECT @A@', '_SUBJECT @B@')
    .replace('_ALBUM display', '_ALBUM alternate');
  const data = parseGedcom(
    fixture(
      description + second,
      header.replace('2 OBJE @V@', '2 OBJE @V@\n2 OBJE @V2@'),
    ),
  );
  data.representations = ['images/shared.jpg', 'images/beatrice.jpg'].map(
    (child, i) => ({
      id: String(i),
      parent: 'images/page.jpg',
      child,
      role: 'crop',
      method: '',
      recipe: '',
      witness: '',
    }),
  );
  const groups = archiveGroups(data, 'photographs');
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.versions.length === 1));
  assert.deepEqual(
    groups
      .filter((g) => g.searchText.includes('beatrice family'))
      .map((g) => g.file.path),
    ['images/beatrice.jpg'],
  );
  assert.equal(
    archiveCatalog(data).find((e) => e.file.path === 'images/beatrice.jpg')
      ?.visual?.album,
    'alternate',
  );
});

void test('equal-caption media preserve every distinct credit regardless of arrival order', () => {
  const first = header.replace(
    'Original use caption; exact identity qualification.',
    'Reviewed album title',
  );
  const second = `0 @OTHER@ OBJE
1 FILE images/shared.jpg
1 TITL Reviewed album title
1 _CREDIT A separate credited use, with its qualification.
1 _RIGHTS Separate rights statement
`;
  for (const references of [
    '1 OBJE @OLD@\n1 OBJE @OTHER@\n1 OBJE @V@',
    '1 OBJE @V@\n1 OBJE @OTHER@\n1 OBJE @OLD@',
  ]) {
    const data = parseGedcom(
      fixture(description + second, first.replace('1 OBJE @OLD@', references)),
    );
    const captions = visualCaptions(data, 'images/shared.jpg');
    assert.equal(captions.length, 2);
    assert.ok(
      captions.some((c) => c.credit === 'Original photographer credit'),
    );
    assert.ok(
      captions.some(
        (c) =>
          c.credit === 'A separate credited use, with its qualification.' &&
          c.rights === 'Separate rights statement',
      ),
    );
    const focused = familyFocus(data, 'alice').data;
    assert.deepEqual(visualCaptions(focused, 'images/shared.jpg'), captions);
  }
});

void test('reviewed avatar framing is explicit and aliases cannot create contradictory file classifications', () => {
  const data = parseGedcom(
    fixture(
      description.replace(
        '1 _AVATAR Y',
        '1 _AVATAR Y\n1 _AVATAR_POSITION bottom',
      ),
    ),
  );
  assert.equal(data.visuals?.[0].avatarPosition, 'bottom');
  assert.throws(() =>
    parseGedcom(
      fixture(description.replace('1 _AVATAR Y', '1 _AVATAR_POSITION bottom')),
    ),
  );
  for (const path of [
    'images/./shared.jpg',
    'images//shared.jpg',
    'images/../shared.jpg',
  ])
    assert.throws(() =>
      parseGedcom(fixture(description.replace('images/shared.jpg', path))),
    );
});

void test('the home photograph opens on people by the picture’s role, not its folder', () => {
  const visual = (path: string, role: VisualMedia['role']) =>
    ({ path, role }) as VisualMedia;
  const data = {
    visuals: [
      visual('images/newspapers/wedding-portrait.jpg', 'portrait'),
      visual('images/land/farm.jpg', 'place'),
      visual('images/letters/reunion.jpg', 'group'),
    ],
  } as AtlasData;
  const section = (image: string) => ({ image });
  assert.deepEqual(
    peopleFirst(data, [
      section('images/portraits/census-page.jpg'),
      section('images/land/farm.jpg'),
      section(''),
      section('images/newspapers/wedding-portrait.jpg'),
      section('images/letters/reunion.jpg'),
    ]).map((s) => s.image),
    [
      'images/newspapers/wedding-portrait.jpg',
      'images/letters/reunion.jpg',
      'images/portraits/census-page.jpg',
      'images/land/farm.jpg',
    ],
  );
});

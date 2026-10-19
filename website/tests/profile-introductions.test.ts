import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  introductionRuns,
  introductionDisplayRuns,
  validProfileIntroductions,
  type ProfileIntroduction,
} from '../app/lib/profile-introductions.ts';
import {
  readWebBook,
  readWebBookBody,
  type WebBook,
} from '../app/lib/native-book.ts';
import { createHash } from 'node:crypto';
import { site } from '../app/lib/settings.ts';

const introduction: ProfileIntroduction = {
  person: 'tamsin-penhallow',
  blocks: [
    {
      passage: 'C1-004',
      section: 'nar-nora',
      chapter: 'ch-nora',
      sha256: '1'.repeat(64),
      contextSha256: '2'.repeat(64),
      text: 'Tamsin graduated. The date remains unknown.',
      mentions: [
        {
          id: 'C1-004-A01',
          passage: 'C1-004',
          kind: 'person',
          target: 'tamsin-penhallow',
          name: 'Tamsin Treloar /Penhallow/',
          label: 'Tamsin',
          qualifications: ['Nora’s sister.'],
        },
      ],
      qualifications: [
        { kind: 'linked-native-note', text: 'No year inferred.' },
      ],
      notes: [
        {
          offset: 17,
          anchor: 'loc-19',
          text: 'Family testimony. No year inferred.',
          citations: [
            {
              person: 'nora-penhallow',
              key: 'graduation',
              sourcePointer: '@SRC_PHOTO@',
              legacyNotes: [],
              label: 'Graduation photograph',
              url: '',
              locators: ['Family testimony'],
              files: ['images/photo.jpg'],
            },
          ],
        },
      ],
    },
  ],
};
const anchors = ['ch-nora', 'nar-nora'];

void test('source controls stay at claim boundaries without losing any prose or owner', () => {
  const before = structuredClone(introduction);
  const block = introduction.blocks[0];
  assert.equal(validProfileIntroductions([introduction], anchors), true);
  const runs = introductionRuns(block);
  assert.equal(
    runs.map((run) => ('text' in run ? run.text : '')).join(''),
    block.text,
  );
  assert.deepEqual(runs, [
    { text: 'Tamsin graduated.' },
    { note: block.notes[0], index: 0 },
    { text: ' The date remains unknown.' },
  ]);
  assert.equal(block.notes[0].citations[0].person, 'nora-penhallow');
  assert.deepEqual(introduction, before);
});

void test('source offsets count Unicode code points, including adjacent notes', () => {
  const block = structuredClone(introduction.blocks[0]);
  block.text = 'A 𐐀 letter. After.';
  block.notes = [
    { ...block.notes[0], offset: 11 },
    { ...block.notes[0], offset: 11, anchor: 'loc-20' },
  ];
  assert.deepEqual(
    introductionRuns(block).map((run) =>
      'text' in run ? run.text : run.note.anchor,
    ),
    ['A 𐐀 letter.', 'loc-19', 'loc-20', ' After.'],
  );
});

void test('a complete life account can retain twelve distinct whole Book paragraphs', () => {
  const entry = structuredClone(introduction);
  entry.blocks = Array.from({ length: 12 }, (_, i) => {
    const block = structuredClone(introduction.blocks[0]);
    block.passage = `C1-${String(i + 4).padStart(3, '0')}`;
    block.mentions[0].id = `${block.passage}-A01`;
    block.mentions[0].passage = block.passage;
    block.notes[0].anchor = `loc-${i + 19}`;
    return block;
  });
  assert.equal(validProfileIntroductions([entry], anchors), true);
  assert.equal(entry.blocks.length, 12);
  for (const block of entry.blocks) {
    const runs = introductionRuns(block);
    assert.equal(
      runs.map((run) => ('text' in run ? run.text : '')).join(''),
      block.text,
    );
    assert.equal(block.notes[0].citations[0].person, 'nora-penhallow');
  }
  const extra = structuredClone(entry.blocks[0]);
  extra.passage = 'C1-016';
  extra.mentions[0].id = 'C1-016-A01';
  extra.mentions[0].passage = extra.passage;
  entry.blocks.push(extra);
  assert.equal(validProfileIntroductions([entry], anchors), false);
});

void test('invalid profile identity, source shape, anchors and marker positions fail closed', () => {
  const mutations: ((entry: ProfileIntroduction) => void)[] = [
    (entry) => {
      entry.person = 'nora-penhallow';
    },
    (entry) => {
      entry.blocks[0].section = 'missing';
    },
    (entry) => {
      entry.blocks[0].chapter = 'register';
    },
    (entry) => {
      entry.blocks[0].notes[0].offset = -1;
    },
    (entry) => {
      entry.blocks[0].notes[0].offset = 1.5;
    },
    (entry) => {
      entry.blocks[0].notes[0].offset = 999;
    },
    (entry) => {
      entry.blocks[0].notes[0].anchor = 'https://example.com';
    },
    (entry) => {
      entry.blocks[0].notes[0].citations = [];
    },
    (entry) => {
      entry.blocks[0].notes[0].citations[0].files = ['../outside'];
    },
    (entry) => {
      entry.blocks[0].mentions[0].passage = 'another';
    },
    (entry) => {
      entry.blocks.push(entry.blocks[0]);
    },
  ];
  for (const mutate of mutations) {
    const entry = structuredClone(introduction);
    mutate(entry);
    assert.equal(validProfileIntroductions([entry], anchors), false);
  }
  for (const invalid of [
    null,
    {},
    [introduction, introduction],
    [{ person: 'nora-penhallow', blocks: [] }],
  ])
    assert.equal(validProfileIntroductions(invalid, anchors), false);
});

void test('introductions must agree between the delivered descriptor and full Book body', async () => {
  const pdf = {
    title: 'Book',
    subtitle: '',
    editionDate: '2026-10-04',
    sha256: 'a'.repeat(64),
    path: 'publications/' + 'a'.repeat(64) + '/' + site.pdfName,
    bytes: 100,
    pages: 1,
  };
  const section = {
    anchor: 'nar-nora',
    chapter: 'ch-nora',
    level: 2,
    title: 'Family',
    excerpt: '',
    image: '',
    people: ['tamsin-penhallow'],
  };
  const body = {
    schema: 1,
    pdfSha256: pdf.sha256,
    html: '<p>Checked Book.</p>',
    sections: [section],
    anchors,
    highlights: ['nar-nora'],
    legacyRoutes: {},
    citations: introduction.blocks[0].notes[0].citations,
    assets: [],
    profileIntroductions: [introduction],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const web: WebBook = {
    schema: 1,
    path: `native-book/${hash}.json`,
    sha256: hash,
    bytes: bytes.byteLength,
    pdfSha256: pdf.sha256,
    sections: [section],
    anchors,
    highlights: ['nar-nora'],
    legacyRoutes: {},
    profileIntroductions: [introduction],
  };
  const index = { schema: 1, gedcomSha256: 'family', webBook: web };
  assert.deepEqual(readWebBook(index, 'family', pdf), web);
  assert.equal(
    readWebBook(
      { ...index, webBook: { ...web, profileIntroductions: null } },
      'family',
      pdf,
    ),
    null,
  );
  assert.deepEqual(
    (await readWebBookBody(bytes.buffer, web)).profileIntroductions,
    [introduction],
  );
  const changed = structuredClone(web);
  changed.profileIntroductions![0].blocks[0].notes[0].text =
    'Date now certain.';
  await assert.rejects(
    readWebBookBody(bytes.buffer, changed),
    /does not match/,
  );
});

void test('verified register controls preserve whole words and reject unbound targets or overlap', () => {
  const entry = structuredClone(introduction);
  const block = entry.blocks[0];
  block.text = 'Tamsin is the child of Harold (no. 2).';
  block.notes[0].offset = Array.from(block.text).length;
  block.mentions.push({
    ...block.mentions[0],
    id: 'PARENT',
    target: 'harold-penhallow',
    label: 'Harold (no. 2)',
  });
  block.registerLinks = [
    {
      start: 23,
      end: 37,
      anchor: 'reg-parent',
      person: 'harold-penhallow',
      number: 2,
      label: 'Harold',
    },
  ];
  const publicAnchors = [...anchors, 'reg-parent'];
  assert.equal(validProfileIntroductions([entry], publicAnchors), true);
  const before = structuredClone(block);
  const runs = introductionDisplayRuns(block);
  assert.equal(
    runs
      .map((run) =>
        'text' in run ? run.text : 'register' in run ? run.label : '',
      )
      .join(''),
    block.text,
  );
  assert.deepEqual(block, before);
  for (const change of [
    'target',
    'person',
    'number',
    'range',
    'note-overlap',
    'duplicate',
  ]) {
    const bad = structuredClone(entry);
    const link = bad.blocks[0].registerLinks![0];
    if (change === 'target') link.anchor = 'missing';
    if (change === 'person') link.person = 'wrong-person';
    if (change === 'number') link.number = 3;
    if (change === 'range') link.end = 1000;
    if (change === 'note-overlap') bad.blocks[0].notes[0].offset = 30;
    if (change === 'duplicate') bad.blocks[0].registerLinks!.push(link);
    assert.equal(
      validProfileIntroductions([bad], publicAnchors),
      false,
      change,
    );
  }
});

void test('paired source display retains the literal separator and exact source objects', () => {
  const entry = structuredClone(introduction);
  const block = entry.blocks[0];
  block.text = 'Tamsin graduated. , The date remains unknown.';
  block.notes.push({
    ...structuredClone(block.notes[0]),
    offset: 19,
    anchor: 'loc-20',
  });
  block.sourceGroups = [[0, 1]];
  assert.equal(validProfileIntroductions([entry], anchors), true);
  const before = structuredClone(block);
  const runs = introductionDisplayRuns(block);
  const group = runs.find((run) => 'group' in run);
  assert.ok(group && 'group' in group);
  assert.deepEqual(
    group.group.map((part) => ('text' in part ? part.text : part.note.anchor)),
    ['loc-19', ' ,', 'loc-20'],
  );
  assert.equal(
    runs
      .map((run) =>
        'text' in run
          ? run.text
          : 'group' in run
            ? run.group
                .map((part) => ('text' in part ? part.text : ''))
                .join('')
            : '',
      )
      .join(''),
    block.text,
  );
  assert.deepEqual(block, before);
  for (const members of [[0, 9], [1, 0], [0], [0, 0], [0, 1, 1]]) {
    const bad = structuredClone(entry);
    bad.blocks[0].sourceGroups = [members];
    assert.equal(validProfileIntroductions([bad], anchors), false);
  }
  const factual = structuredClone(entry);
  factual.blocks[0].text = 'Tamsin graduated. and The date remains unknown.';
  factual.blocks[0].notes[1].offset = 21;
  assert.equal(validProfileIntroductions([factual], anchors), false);
});

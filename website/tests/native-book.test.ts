import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseGedcom } from '../app/lib/gedcom.ts';
import { homeRoute, readRoute, routeHref } from '../app/lib/navigation.ts';
import {
  readWebBook,
  readWebBookBody,
  fetchWebBookBody,
  citationDocuments,
  chapterHighlights,
  type WebBook,
  type BookCitation,
} from '../app/lib/native-book.ts';
import { site } from '../app/lib/settings.ts';

const pdf = {
  title: 'A family book',
  subtitle: '',
  editionDate: '2026-09-13',
  sha256: '1'.repeat(64),
  path: 'publications/' + '1'.repeat(64) + '/' + site.pdfName,
  bytes: 100,
  pages: 3,
};
const section = {
  anchor: 'reading-school',
  chapter: 'ch-penhallow',
  level: 3,
  title: 'School days',
  excerpt: 'A literal opening.',
  image: '',
  people: ['tamsin'],
};
const web: WebBook = {
  schema: 1,
  sha256: '2'.repeat(64),
  path: 'native-book/' + '2'.repeat(64) + '.json',
  bytes: 100,
  pdfSha256: pdf.sha256,
  sections: [section],
  anchors: ['ch-penhallow', section.anchor],
  highlights: [section.anchor],
  legacyRoutes: { 'penhallow/school': section.anchor },
};
const family = parseGedcom(
  '0 HEAD\n0 @I1@ INDI\n1 REFN tamsin\n1 NAME Tamsin /Penhallow/\n0 TRLR\n',
);

void test('native book metadata requires the same delivered family and PDF edition', () => {
  const index = { schema: 1, gedcomSha256: 'family', book: pdf, webBook: web };
  assert.deepEqual(readWebBook(index, 'family', pdf), web);
  assert.equal(readWebBook(index, 'different', pdf), null);
  for (const change of [
    { pdfSha256: '3'.repeat(64) },
    { path: 'https://example.com/book.json' },
    { highlights: ['missing'] },
    { sections: [section, section] },
    { sections: [{ ...section, opening: 42 }] },
    { anchors: ['loc-3'] },
  ])
    assert.equal(
      readWebBook({ ...index, webBook: { ...web, ...change } }, 'family', pdf),
      null,
    );
});

void test('body bytes and full contents must match before HTML can be rendered', async () => {
  const body = {
    schema: 1,
    pdfSha256: pdf.sha256,
    sections: web.sections,
    anchors: web.anchors,
    highlights: web.highlights,
    legacyRoutes: web.legacyRoutes,
    html: '<p>Not proven.</p>',
    citations: [],
    assets: [],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const bound = {
    ...web,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  assert.equal(
    (await readWebBookBody(bytes.buffer, bound)).html,
    '<p>Not proven.</p>',
  );
  await assert.rejects(
    readWebBookBody(
      new TextEncoder().encode(
        JSON.stringify(body).replace('Not proven', 'Proven'),
      ).buffer,
      bound,
    ),
  );
  await assert.rejects(
    readWebBookBody(bytes.buffer, {
      ...bound,
      sections: [{ ...section, title: 'A different text' }],
    }),
  );
});

void test('old story links open their book passage and preserve branch and note context on reload', () => {
  const route = readRoute(
    '#view=story&chapter=penhallow&passage=school&branch=tamsin',
    family,
    web,
  );
  assert.equal(route.view, 'book');
  assert.equal(route.bookAnchor, section.anchor);
  assert.equal(route.branch, 'tamsin');
  assert.equal(route.passage, '');
  assert.deepEqual(readRoute(routeHref(route), family, web), route);
  assert.equal(readRoute('#view=stories', family, web).view, 'book');
  const note = {
    ...homeRoute,
    view: 'book' as const,
    bookAnchor: section.anchor,
    bookNote: web.sha256 + ':loc-1017',
  };
  assert.equal(readRoute(routeHref(note), family, web).bookNote, note.bookNote);
  const registerNote = { ...note, bookNote: web.sha256 + ':book-note-291' };
  assert.equal(
    readRoute(routeHref(registerNote), family, web).bookNote,
    registerNote.bookNote,
  );
  assert.equal(
    readRoute('#view=book&bookAnchor=loc-99&bookNote=unbound', family, web)
      .bookAnchor,
    '',
  );
});

void test('highlights select only actual compiled sections for the chosen family members', () => {
  assert.deepEqual(chapterHighlights(web, new Set(['tamsin'])), [section]);
  assert.deepEqual(chapterHighlights(web, new Set(['someone-else'])), []);
});

void test('exact citation joins retain PAGE; an older note can link only its admitted exact file', () => {
  const data = {
    ...family,
    sources: [
      {
        id: 'one',
        pointer: '@SOURCE@',
        label: 'Record',
        url: '',
        locator: 'p. 1',
        note: 'Definition',
        archivePath: 'images/one.jpg',
        archives: [
          {
            path: 'images/one.jpg',
            kind: '',
            nature: '',
            locator: '',
            status: '',
          },
        ],
      },
      {
        id: 'two',
        pointer: '@SOURCE@',
        label: 'Record',
        url: '',
        locator: 'p. 2',
        note: 'Definition',
        archivePath: 'images/two.jpg',
        archives: [
          {
            path: 'images/two.jpg',
            kind: '',
            nature: '',
            locator: '',
            status: '',
          },
        ],
      },
    ],
  };
  const citation: BookCitation = {
    person: 'tamsin',
    key: 'qualified-use',
    sourcePointer: '@SOURCE@',
    legacyNotes: [],
    label: 'Record',
    url: '',
    locators: ['p. 2'],
    files: ['images/two.jpg'],
  };
  assert.deepEqual(
    citationDocuments(data, citation).map((d) => [d.id, d.bookMatch]),
    [['two', 'citation']],
  );
  const old = {
    ...citation,
    sourcePointer: null,
    legacyNotes: ['Older exact note; not proven.'],
    locators: [''],
  };
  const fallback = citationDocuments(data, old);
  assert.equal(fallback[0].bookMatch, 'file');
  assert.equal(fallback[0].locator, 'p. 2');
  assert.equal(fallback[0].archives[0].path, 'images/two.jpg');
  assert.deepEqual(
    citationDocuments(data, { ...old, files: ['images/unadmitted.jpg'] }),
    [],
  );
  assert.equal(old.legacyNotes[0], 'Older exact note; not proven.');
});

void test('a retired book requests a coherent collection refresh only for a different valid edition', async (t) => {
  const calls: { url: string; cache?: RequestCache }[] = [];
  const next = {
    ...web,
    sha256: '3'.repeat(64),
    path: 'native-book/' + '3'.repeat(64) + '.json',
  };
  const index = {
    schema: 1,
    gedcomSha256: '4'.repeat(64),
    book: pdf,
    webBook: next,
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, init?: RequestInit) => {
      calls.push({ url, cache: init?.cache });
      return url === '/data/' + web.path
        ? new Response('', { status: 404 })
        : Response.json(index);
    },
  );
  assert.equal(await fetchWebBookBody(web, new AbortController().signal), null);
  assert.deepEqual(calls, [
    { url: '/data/' + web.path, cache: undefined },
    { url: '/data/book.json', cache: 'no-store' },
  ]);
});

void test('a missing current edition or invalid replacement stops instead of looping', async (t) => {
  let candidate: unknown;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls++;
    return url === '/data/' + web.path
      ? new Response('', { status: 410 })
      : Response.json(candidate);
  });
  for (candidate of [
    { schema: 1, gedcomSha256: '4'.repeat(64), book: pdf, webBook: web },
    {
      schema: 1,
      gedcomSha256: '4'.repeat(64),
      book: pdf,
      webBook: { ...web, sha256: '3'.repeat(64) },
    },
    null,
  ]) {
    await assert.rejects(
      fetchWebBookBody(web, new AbortController().signal),
      /could not be opened/,
    );
  }
  assert.equal(calls, 6);
});

void test('auth and server failures never initiate an edition refresh', async (t) => {
  let status = 401;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return new Response('', { status });
  });
  for (status of [401, 403, 500])
    await assert.rejects(
      fetchWebBookBody(web, new AbortController().signal),
      /could not be opened/,
    );
  assert.deepEqual(calls, Array(3).fill('/data/' + web.path));
});

void test('successful responses still require exact Book integrity; cancellation never refreshes', async (t) => {
  const signal = new AbortController().signal;
  let cancel = false;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(init.signal, signal);
    if (cancel) throw new DOMException('Cancelled', 'AbortError');
    return Response.json({ html: '<p>Unverified content</p>' });
  });
  await assert.rejects(fetchWebBookBody(web, signal), /could not be verified/);
  cancel = true;
  await assert.rejects(fetchWebBookBody(web, signal), { name: 'AbortError' });
  assert.deepEqual(calls, Array(2).fill('/data/' + web.path));
});

void test('retired book anchors resolve to a reviewed surviving reading section', () => {
  const edition = {
    ...web,
    legacyRoutes: {
      ...web.legacyRoutes,
      'bookAnchor/nar-retired-parent': section.anchor,
      'bookAnchor/nar-invalid-target': 'reading-missing',
    },
  };
  const route = readRoute(
    '#view=book&bookAnchor=nar-retired-parent&person=tamsin',
    family,
    edition,
  );
  assert.equal(route.bookAnchor, section.anchor);
  assert.equal(route.person, 'tamsin');
  assert.equal(
    readRoute(routeHref(route), family, edition).bookAnchor,
    section.anchor,
  );
  assert.equal(
    readRoute('#view=book&bookAnchor=nar-invalid-target', family, edition)
      .bookAnchor,
    'nar-invalid-target',
  );
  assert.equal(
    readRoute('#view=book&bookAnchor=' + section.anchor, family, edition)
      .bookAnchor,
    section.anchor,
  );
});

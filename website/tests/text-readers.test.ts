import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveTextLink,
  capturedIndexText,
  indexSections,
  readJson,
  readablePageText,
  savedTextExtension,
  type JsonValue,
} from '../app/lib/text-readers.ts';

void test('explicit HTML capture suffixes use the safe HTML reader while ordinary text stays literal', () => {
  for (const file of [
    'images/web-sources/2019-05-11-parish-pages/st-just-choir-outing-1931-page.html.txt',
    'images/web-sources/2019-05-11-parish-pages/harbour-regatta-results-1927-page.html.txt',
    'images/web-sources/captured.HTM.TXT',
    'images/web-sources/notice.xhtml.txt',
  ])
    assert.equal(savedTextExtension(file, 'TXT'), 'html');
  for (const file of [
    'images/letter.txt',
    'images/html-notes.txt',
    'images/page.html.txt.bak',
  ])
    assert.equal(savedTextExtension(file, 'txt'), 'txt');
  assert.equal(savedTextExtension('images/page.html', 'html'), 'html');
  assert.equal(savedTextExtension('images/page.xhtml', 'xhtml'), 'html');
  assert.equal(savedTextExtension('images/page.html.txt', 'json'), 'json');
  // XML, published as text by a static site, still reads as XML.
  assert.equal(savedTextExtension('images/aids/finding-aid.xml.txt', 'txt'), 'xml');
});

void test('saved page layout whitespace cannot bury the first readable text', () => {
  const result = readablePageText([
    '\n '.repeat(300),
    { name: 'div', attributes: [], children: [] },
    { name: 'p', attributes: [], children: ['Header metadata'] },
    {
      name: 'p',
      attributes: [],
      children: ['Unknown body section\nwith qualifications.'],
    },
  ]);
  assert.equal(
    result,
    'Header metadata\n\nUnknown body section\nwith qualifications.',
  );
});

function entries(node: JsonValue | null) {
  assert.equal(node?.type, 'object');
  return (node as Extract<JsonValue, { type: 'object' }>).entries;
}

void test('readable JSON retains duplicate keys, numeric spelling, ordered fields and literal strings', () => {
  const parsed = entries(
    readJson(
      '{"2":9007199254740993,"1":-0,"note":"first\\nline","note":"<script>second</script>","precise":1.234567890123456789e100,"empty":null}',
    ),
  );
  assert.deepEqual(
    parsed.map((entry) => entry.key),
    ['2', '1', 'note', 'note', 'precise', 'empty'],
  );
  assert.deepEqual(
    parsed.map((entry) => ('value' in entry.value ? entry.value.value : null)),
    [
      '9007199254740993',
      '-0',
      'first\nline',
      '<script>second</script>',
      '1.234567890123456789e100',
      'null',
    ],
  );
  for (const malformed of [
    '[1,]',
    '{"note":"first",}',
    '{"a":01}',
    'true false',
    '{"a":"bad\nstring"}',
  ])
    assert.equal(readJson(malformed), null);
});

void test('every field and original wording of a held reading survives the reading model', () => {
  function materialize(node: JsonValue): unknown {
    if (node.type === 'object')
      return Object.fromEntries(
        node.entries.map(({ key, value }) => [key, materialize(value)]),
      );
    if (node.type === 'array') return node.items.map(materialize);
    return node.type === 'string' ? node.value : JSON.parse(node.value);
  }
  const raw = JSON.stringify(
    {
      title: 'Headstone photograph, Mineral Point cemetery',
      captured: '2019-05-11',
      provenance: {
        contributor: 'Example member tree',
        note: 'Uploaded image; the stone itself was not examined.\nCarving reads “1840–1912”.',
        steps: ['found', 'saved', { reviewed: false, score: 0.75 }],
      },
      records: [
        { name: 'John Penhallow', year: 1912, certain: null },
        { name: 'Elizabeth Penhallow', year: -0, tags: [] },
      ],
    },
    null,
    2,
  );
  const model = readJson(raw);
  assert.ok(model);
  assert.deepEqual(materialize(model), JSON.parse(raw));
});

void test('provider sections come from explicit unique headings and preserve the complete body', () => {
  const body = [
    'Skip main menu',
    'Main Menu',
    'View',
    'Ada Example',
    '',
    'Example County, Marriage Records, 1800-1950',
    'Save this record?',
    'Detail',
    'How to evaluate details',
    'Name',
    'Ada Example',
    'Marriage Date',
    '14 May 1906',
    'Film Number',
    '004817356',
    'Source',
    'Information',
    'Example County, Marriage Records, 1800-1950. Example index.',
    'Suggested records',
    'Ben Example',
    'Marriage record, 1906',
  ].join('\n');
  const raw = JSON.stringify({
    title: 'Ada Example in the Example County marriage index',
    url: 'https://example.org/record/1',
    body,
    records: [{ name: 'Ben Example' }],
    buttons: ['Save'],
  });
  const model = readJson(raw),
    text = capturedIndexText(model)!;
  assert.equal(text, JSON.parse(raw).body);
  const sections = indexSections(text);
  assert.equal(sections.length, 4);
  assert.equal(
    sections[3].text + sections[0].text + sections[1].text + sections[2].text,
    text,
  );
  assert.match(sections[0].text, /Film Number\n004817356/);
  assert.match(sections[2].text, /Suggested records/);
  assert.ok(entries(model).find((entry) => entry.key === 'records'));
  const duplicate = text + '\nSource\nInformation\n';
  assert.deepEqual(indexSections(duplicate), [
    { label: 'Page text', text: duplicate },
  ]);
  for (const input of [
    '{"body":"one","body":"two"}',
    '{"body":"one","text":"two"}',
    '{"body":{"name":"not text"}}',
  ])
    assert.equal(capturedIndexText(readJson(input)), null);
});

void test('Markdown links require the exact held target and reject active or private schemes', () => {
  const file = 'images/newspapers/treloar-1912/README.md';
  const paths = new Set([
    'images/newspapers/1912-03-07-iowa-county-lantern-treloar-p1.jpg',
  ]);
  assert.deepEqual(
    archiveTextLink(
      '../1912-03-07-iowa-county-lantern-treloar-p1.jpg',
      file,
      paths,
    ),
    {
      href: '/data/images/newspapers/1912-03-07-iowa-county-lantern-treloar-p1.jpg',
      external: false,
    },
  );
  for (const target of [
    '../../../book/notes/mary-treloar-letters-1912.md',
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,test',
    'file:///etc/passwd',
    'https://name:secret@example.com',
    '//elsewhere.invalid/picture.png',
    '/data/private-file',
    'bad%zz',
    '..\\secret',
  ])
    assert.equal(archiveTextLink(target, file, paths), null);
  assert.deepEqual(archiveTextLink('https://example.org/source', file, paths), {
    href: 'https://example.org/source',
    external: true,
  });
});

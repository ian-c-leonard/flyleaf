import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentKind, familyFirst } from '../app/lib/archive.ts';
import type { ArchiveFile } from '../app/lib/gedcom.ts';

const file = (path: string, kind = '', nature = ''): ArchiveFile => ({
  path,
  kind,
  nature,
  locator: '',
  status: '',
});
const entry = (
  path: string,
  names: string[] = [],
  kind = '',
  sourceIds: string[] = [],
) => ({
  file: file(path, kind),
  names,
  sourceIds,
  visual: undefined,
});

void test('the archive opens on family collections and the nearest family', () => {
  const family = [{ id: 'tamsin-penhallow', name: 'Tamsin Ada Penhallow' }];
  const ordered = familyFirst(
    [
      entry('images/1964-county-art-show.pdf', ['Distant In-law']),
      entry(
        'images/research/notes.txt',
        ['Tamsin Ada Penhallow'],
        'research-note',
      ),
      entry('images/search.html', [], 'search-capture'),
      entry('images/tamsin-graduation-program.pdf', ['Tamsin Ada Penhallow']),
      entry('images/albums/joan/track-01.mp3'),
      entry('images/joan/kitchen-book-1.pdf', [], '', ['S-cookbook']),
      // A folder name does not make a file a treasure, unless the family
      // chooses that word.
      entry('images/recipes/clipping.jpg'),
      entry('images/letters/1921-letter.pdf'),
    ],
    family,
    new Set(['S-cookbook']),
    ['Letters'],
  );
  assert.deepEqual(
    ordered.map((e) => e.file.path),
    [
      'images/albums/joan/track-01.mp3',
      'images/joan/kitchen-book-1.pdf',
      'images/letters/1921-letter.pdf',
      'images/tamsin-graduation-program.pdf',
      'images/1964-county-art-show.pdf',
      'images/recipes/clipping.jpg',
    ],
  );
});

void test('a saved page published as text is still a saved web page', () => {
  for (const path of ['a.html', 'a.htm.txt', 'a.html.txt', 'a.xhtml.txt'])
    assert.equal(documentKind(file(`images/${path}`)), 'Saved web page', path);
  assert.equal(documentKind(file('images/a.txt')), 'Text file');
});

void test('recordings in any common format are recordings', () => {
  for (const path of ['a.mp3', 'a.m4a', 'a.ogg', 'a.opus'])
    assert.equal(documentKind(file(`images/${path}`)), 'Recording', path);
  for (const path of ['a.wav', 'a.flac', 'a.aiff'])
    assert.equal(documentKind(file(`images/${path}`)), 'Original audio', path);
});

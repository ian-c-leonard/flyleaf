import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Leftover styles for markup the site no longer makes: a class selector in the
// app's stylesheets must name a class some code can put on the page.
const app = new URL('../app/', import.meta.url);
const scripts = new URL('../../scripts/', import.meta.url);
// Classes that libraries add at run time.
const library = /^(leaflet-|textLayer|annotationLayer)/;
// Class names the app builds from data: `family-album-${role}`.
const built = /^family-album-/;

const walk = (dir: URL, pattern: RegExp): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(new URL(entry.name + '/', dir), pattern)
      : pattern.test(entry.name)
        ? [new URL(entry.name, dir)]
        : [],
  );

/** Every word in a string literal of the app's code or Flyleaf's scripts. */
function wordsInStrings() {
  const words = new Set<string>();
  const add = (text: string) => {
    for (const word of text.match(/[A-Za-z_][\w-]*/g) || []) words.add(word);
  };
  for (const file of walk(app, /\.tsx?$/)) {
    const source = ts.createSourceFile(
      file.pathname,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node))
        add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const file of walk(scripts, /\.py$/))
    for (const [, text] of readFileSync(file, 'utf8').matchAll(
      /'([^'\n]*)'|"([^"\n]*)"/g,
    ))
      add(text || '');
  return words;
}

void test('every class the app styles is one its code can put on the page', () => {
  const words = wordsInStrings();
  const unused: string[] = [];
  for (const file of walk(app, /\.css$/)) {
    const css = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{[^{}]*\}/g, '{}');
    for (const [, name] of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g))
      if (!words.has(name) && !library.test(name) && !built.test(name))
        unused.push(`${file.pathname.split('/').pop()}: .${name}`);
  }
  assert.deepEqual([...new Set(unused)], []);
});

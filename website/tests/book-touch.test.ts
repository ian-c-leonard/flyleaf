import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The Book is dense with inline links. On iPhone Safari, a finger that rests
// on a link before swiping triggers the link preview or lifts the link for
// drag-and-drop, with a haptic buzz, instead of scrolling. These links open
// our own previews, so Safari's link gestures are switched off for them.
void test('Book links do not start Safari link previews or drags', async () => {
  const css = await readFile(
    new URL('../app/book-preview.css', import.meta.url),
    'utf8',
  );
  const rule = css.match(
    /\.native-book-content a\[data-book-mention\],\s*\.native-book-content a\[role=["']doc-noteref["']\]\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'Book link touch rule is missing');
  assert.match(rule[1], /-webkit-touch-callout:\s*none/);
  assert.match(rule[1], /-webkit-user-drag:\s*none/);
});

// iPhone Safari keeps a map of every element with a touch-action. When the
// Book's thousands of links (or every button) carried one, Safari rebuilt that
// map after each visible change, and each tap in the Book waited about a
// second. Only single gesture surfaces may set it.
void test('Only single gesture surfaces set a touch-action', async () => {
  const { readdir } = await import('node:fs/promises');
  const dir = new URL('../app/', import.meta.url);
  const allowed = new Set(['.kin-image-view > img', '.tree-viewport']);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.css'))) {
    const css = (await readFile(new URL(name, dir), 'utf8')).replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/touch-action\s*:\s*(?!auto)/.test(body)) continue;
      assert.ok(
        allowed.has(selector.trim()),
        `${name}: ${selector.trim()} sets a touch-action`,
      );
    }
  }
});

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import {
  basePath,
  contentFile,
  contentRoot,
  familyRoot,
  readSettings,
  siteDefines,
  siteHosting,
} from './flyleaf-settings.mjs';
import { personIds } from './app/lib/gedcom.ts';
import { publishedContent } from './app/lib/published-content.ts';
import { printStaticWarning } from './scripts/static-warning.mjs';

const contentFiles = new Map<string, string>();
let publicDir = '';

/** A content file as the site publishes it: entries about people outside
 * the published tree (public/data/family.ged) are left out. Before the tree
 * exists, as in a first dev run, the file is used as it is. */
export function siteContent(name: string, file: string, tree: string) {
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as unknown;
  const value = read(file);
  if (!existsSync(tree)) return value;
  const people = personIds(readFileSync(tree, 'utf8'));
  const recipes = contentFile('family-recipes.json');
  const recipePerson =
    name === 'recipe-index.json' && existsSync(recipes)
      ? ((read(recipes) as { labels?: { person?: string } } | null)?.labels
          ?.person ?? '')
      : '';
  const result = publishedContent(name, value, people, recipePerson);
  for (const line of result.removed)
    console.warn(
      `${name}: left out ${line}: not in the published family tree.`,
    );
  return result.value;
}

// "@content/<file>": the family's own content (recipes, albums, wording),
// or Flyleaf's empty default when the family has none.
const familyContent: Plugin = {
  name: 'flyleaf-content',
  enforce: 'pre',
  configResolved(config) {
    publicDir = config.publicDir;
  },
  resolveId(source) {
    if (!source.startsWith('@content/')) return;
    const name = source.slice('@content/'.length);
    const file = contentFile(name);
    if (name.endsWith('.json')) contentFiles.set(file, name);
    return file;
  },
  load(id) {
    const name = contentFiles.get(id);
    if (!name) return;
    this.addWatchFile(id);
    const tree = path.join(publicDir, 'data', 'family.ged');
    return JSON.stringify(siteContent(name, id, tree));
  },
  // The browser's theme colour (site.theme_color).
  transformIndexHtml(html) {
    const color = readSettings().site?.theme_color;
    return color && /^#[0-9a-fA-F]{3,8}$/.test(color)
      ? html.replace(
          /(<meta name="theme-color" content=")[^"]*(")/,
          `$1${color}$2`,
        )
      : html;
  },
};

// A static site has no sign-in, so its build leaves the sign-in files out.
let outDir = '';
export const staticSite: Plugin = {
  name: 'flyleaf-static-site',
  apply: 'build',
  configResolved(config) {
    outDir = path.resolve(config.root, config.build.outDir);
  },
  closeBundle() {
    if (siteHosting() !== 'worker') {
      rmSync(path.join(outDir, 'login'), { recursive: true, force: true });
      // Again at the very end, where a long build log cannot hide it.
      printStaticWarning();
    }
  },
};

export default defineConfig({
  base: basePath(),
  plugins: [familyContent, staticSite, react()],
  define: siteDefines(),
  // The app is one bundle of about 700 kB. A larger limit keeps Vite's size
  // note from burying the static-site warning at the end of the build.
  build: { outDir: 'dist/client', chunkSizeWarningLimit: 1000 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { useFsEvents: false, usePolling: true },
    fs: { allow: ['.', contentRoot(), familyRoot()] },
  },
});

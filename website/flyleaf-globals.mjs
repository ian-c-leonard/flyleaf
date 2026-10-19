// Import this first in any Node process that loads app or Worker code (tests
// and the prepare scripts). It gives that code the settings the Vite build and
// the Worker environment provide in production, read from flyleaf.json.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { contentDefaults, contentRoot, readSettings, siteSettings } from './flyleaf-settings.mjs';
import { workerVars } from './scripts/write-wrangler.mjs';
import { configure } from './worker/site.ts';

const settings = readSettings();
// "@content/..." imports read the family's content folder. Preload this file
// (node --import) so the hook is in place before the importing modules link.
register('./content-resolver.mjs', import.meta.url, {
  data: {
    content: pathToFileURL(contentRoot(settings) + '/').href,
    defaults: pathToFileURL(contentDefaults + '/').href,
  },
});
globalThis.__FLYLEAF_SITE__ = siteSettings(settings);
configure(workerVars(settings, { strict: false }));

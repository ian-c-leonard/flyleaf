import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { staticSite } from '../vite.config.ts';

// A static site has no sign-in, so its build must not ship the sign-in page.
void test('a static build leaves out the sign-in folder and ends with its warning; a Worker build keeps it', () => {
  const saved = process.env.FLYLEAF_FAMILY;
  const folders: string[] = [];
  const folder = () => {
    const made = mkdtempSync(path.join(tmpdir(), 'flyleaf-static-'));
    folders.push(made);
    return made;
  };
  try {
    for (const hosting of ['static', 'worker', undefined]) {
      const family = folder();
      writeFileSync(
        path.join(family, 'flyleaf.json'),
        JSON.stringify({ site: hosting ? { hosting } : {} }),
      );
      process.env.FLYLEAF_FAMILY = family;
      const site = folder();
      mkdirSync(path.join(site, 'dist', 'login'), { recursive: true });
      writeFileSync(path.join(site, 'dist', 'login', 'app.js'), '');
      writeFileSync(path.join(site, 'dist', 'index.html'), '');
      (staticSite.configResolved as (config: unknown) => void)({
        root: site,
        build: { outDir: 'dist' },
      });
      const warn = console.warn;
      const warnings: string[] = [];
      console.warn = (line: string) => warnings.push(line);
      try {
        (staticSite.closeBundle as () => void)();
      } finally {
        console.warn = warn;
      }
      assert.equal(
        existsSync(path.join(site, 'dist', 'login')),
        hosting !== 'static',
        `hosting: ${hosting ?? 'not set'}`,
      );
      // A static build ends by saying, on its own, that anyone can read it.
      assert.equal(
        warnings.some((line) => /anyone with its address/.test(line)),
        hosting === 'static',
        `hosting: ${hosting ?? 'not set'}`,
      );
      assert.ok(existsSync(path.join(site, 'dist', 'index.html')));
    }
  } finally {
    if (saved === undefined) delete process.env.FLYLEAF_FAMILY;
    else process.env.FLYLEAF_FAMILY = saved;
    for (const made of folders) rmSync(made, { recursive: true, force: true });
  }
});

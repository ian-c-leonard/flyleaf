import '../flyleaf-globals.mjs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  lstat,
  rm,
  writeFile,
  rename,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveKey } from '../worker/archive.ts';
import { readWebBook, readWebBookBody } from '../app/lib/native-book.ts';
import { isMain } from './is-main.mjs';

// The book PDF's file name, from flyleaf.json (loaded by flyleaf-globals.mjs).
const pdfName = globalThis.__FLYLEAF_SITE__.pdfName;
const publishedPdf = new RegExp(
  `^publications/[a-f0-9]{64}/${pdfName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
);

const defaultSite = fileURLToPath(new URL('..', import.meta.url));
const comparePaths = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function verifyPreviews(source, manifest, files) {
  if (manifest.previewFiles === undefined) return;
  const index = JSON.parse(
    await readFile(path.join(source, 'data/previews.json'), 'utf8'),
  );
  const gedcom = await readFile(path.join(source, 'data/family.ged'));
  if (
    index.schema !== 1 ||
    index.gedcomSha256 !== createHash('sha256').update(gedcom).digest('hex') ||
    !index.files ||
    Array.isArray(index.files) ||
    typeof index.files !== 'object'
  )
    throw new Error('Preview index does not match the delivered genealogy.');
  const held = new Map(
    files.map((file) => [file.key.slice('archive/'.length), file]),
  );
  const declared = new Map();
  for (const [original, entry] of Object.entries(index.files)) {
    const file = held.get(original);
    if (
      !file ||
      !entry ||
      entry.sourceSha256 !== file.sha256 ||
      entry.sourceBytes !== file.bytes
    )
      throw new Error('Preview source does not match a held file: ' + original);
    for (const size of ['640', '1600']) {
      const variant = entry.variants?.[size];
      if (
        !variant ||
        typeof variant.path !== 'string' ||
        !new RegExp(
          `^previews/[a-f0-9]{16}-${file.sha256}/${size}\\.webp$`,
        ).test(variant.path)
      )
        throw new Error('Invalid preview path for ' + original);
      const preview = path.join(source, 'data', variant.path);
      if (!(await lstat(preview)).isFile())
        throw new Error('Preview must be a regular file.');
      const bytes = await readFile(preview);
      if (
        bytes.length !== variant.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== variant.sha256
      )
        throw new Error('Preview bytes changed: ' + variant.path);
      declared.set(variant.path, variant.bytes);
    }
  }
  const expectedImages = manifest.assets
    .filter((p) => /\.(jpe?g|png|webp|gif|tiff?)$/i.test(p))
    .sort(comparePaths);
  if (
    JSON.stringify(Object.keys(index.files).sort(comparePaths)) !==
      JSON.stringify(expectedImages) ||
    JSON.stringify([...declared.keys()].sort(comparePaths)) !==
      JSON.stringify(manifest.previewFiles) ||
    manifest.previewImages !== expectedImages.length ||
    manifest.previewBytes !== [...declared.values()].reduce((a, b) => a + b, 0)
  )
    throw new Error('Preview inventory does not match the package manifest.');
}

export async function prepareHosting(site = defaultSite) {
  const source = path.join(site, 'dist/client');
  const target = path.join(site, 'dist/hosting');
  const stage = path.join(site, 'dist/.hosting-stage-' + randomUUID());
  const backup = path.join(site, 'dist/.hosting-backup-' + randomUUID());
  let movedOld = false;
  let installed = false;
  try {
    const manifestBytes = await readFile(
      path.join(source, 'data/manifest.json'),
    );
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.missingAssets.length)
      throw new Error('Cannot prepare hosting with missing source files.');
    const files = [];
    for (const relative of manifest.assets) {
      if (
        !(
          relative.startsWith('images/') ||
          publishedPdf.test(relative)
        ) ||
        relative.split(/[\\/]/).some((p) => !p || p.startsWith('.'))
      )
        throw new Error('Invalid archive path: ' + relative);
      // Use the actual private gateway policy before installing a package.
      // An exporter-supported format is unusable if its URL cannot reach R2.
      const pathname =
        '/data/' + relative.split('/').map(encodeURIComponent).join('/');
      if (archiveKey(pathname) !== 'archive/' + relative)
        throw new Error(
          'Archive URL cannot resolve to its original: ' + relative,
        );
      const file = path.join(source, 'data', relative);
      if (!(await lstat(file)).isFile())
        throw new Error('Archive entry is not a regular file: ' + relative);
      const bytes = await readFile(file);
      files.push({
        key: 'archive/' + relative,
        path: path.relative(site, file),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const assets = path.join(stage, 'assets');
    await mkdir(assets, { recursive: true });
    await cp(source, assets, {
      recursive: true,
      filter: (candidate) => {
        const name = path.basename(candidate);
        if (
          ['.DS_Store', '__MACOSX', 'Thumbs.db', 'desktop.ini'].includes(
            name,
          ) ||
          name.startsWith('._')
        )
          return false;
        return !['images', 'publications'].some(
          (folder) => candidate === path.join(source, 'data', folder),
        );
      },
    });
    if (
      !(await readFile(path.join(assets, 'data/manifest.json'))).equals(
        manifestBytes,
      )
    )
      throw new Error('Package manifest changed while preparing hosting.');
    // Verify the actual staged copies, after asynchronous copying, before
    // replacing the last complete static package and its object plan.
    await verifyPreviews(assets, manifest, files);
    const publications = files.filter((file) =>
      file.key.startsWith('archive/publications/'),
    );
    if (manifest.book || publications.length) {
      const book = manifest.book;
      const index = JSON.parse(
        await readFile(path.join(assets, 'data/book.json'), 'utf8'),
      );
      const gedcom = await readFile(path.join(assets, 'data/family.ged'));
      if (
        !book ||
        publications.length !== 1 ||
        index.schema !== 1 ||
        index.gedcomSha256 !==
          createHash('sha256').update(gedcom).digest('hex') ||
        JSON.stringify(index.book) !== JSON.stringify(book) ||
        book.path !== `publications/${book.sha256}/${pdfName}` ||
        publications[0].key !== 'archive/' + book.path ||
        publications[0].sha256 !== book.sha256 ||
        publications[0].bytes !== book.bytes
      )
        throw new Error(
          'Book publication does not match the delivered PDF and genealogy.',
        );
      if (manifest.webBook || index.webBook) {
        const web = readWebBook(index, index.gedcomSha256, book);
        if (!web || JSON.stringify(web) !== JSON.stringify(manifest.webBook))
          throw new Error(
            'Native Book does not match the delivered publication.',
          );
        const raw = await readFile(path.join(assets, 'data', web.path));
        const body = await readWebBookBody(Uint8Array.from(raw).buffer, web);
        const receipt = JSON.parse(
          await readFile(
            path.join(assets, 'data/native-book-receipt.json'),
            'utf8',
          ),
        );
        if (
          receipt.status !== 'checked-web-book' ||
          JSON.stringify(receipt.book) !== JSON.stringify(web) ||
          JSON.stringify(receipt.assets) !== JSON.stringify(body.assets)
        )
          throw new Error(
            'Native Book receipt differs from its installed contents.',
          );
        const charts = [];
        const held = new Map(
          files.map((file) => [file.key.slice('archive/'.length), file]),
        );
        for (const item of body.assets) {
          if (item.kind === 'chart') {
            if (
              !/^[a-f0-9]{64}$/.test(item.sha256) ||
              item.path !== `book-assets/${item.sha256}.svg`
            )
              throw new Error('Invalid private book chart path.');
            const chart = await readFile(path.join(assets, 'data', item.path));
            if (
              chart.length !== item.bytes ||
              createHash('sha256').update(chart).digest('hex') !== item.sha256
            )
              throw new Error('Private book chart bytes changed.');
            charts.push(item.path.slice('book-assets/'.length));
          } else if (
            item.kind !== 'figure' ||
            held.get(item.path)?.sha256 !== item.sha256 ||
            held.get(item.path)?.bytes !== item.bytes
          ) {
            throw new Error(
              'Native Book illustration is not an exact admitted original.',
            );
          }
        }
        const actualCharts = (
          await readdir(path.join(assets, 'data/book-assets'))
        ).sort(comparePaths);
        if (
          JSON.stringify(actualCharts) !==
          JSON.stringify(charts.sort(comparePaths))
        )
          throw new Error(
            'Private book chart inventory differs from the checked book.',
          );
      }
    }
    let count = 0,
      staticBytes = 0;
    async function check(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await check(file);
        else {
          if (!entry.isFile())
            throw new Error('Static asset must be a regular file.');
          const size = (await stat(file)).size;
          if (size > 25 * 1024 * 1024)
            throw new Error('Static asset exceeds Workers limit: ' + file);
          staticBytes += size;
          count++;
        }
      }
    }
    await check(assets);
    if (count > 20000)
      throw new Error('Static file count exceeds the Workers Free limit.');
    const output = {
      createdAt: new Date().toISOString(),
      sourceSha256: manifest.sourceSha256,
      staticFiles: count,
      staticBytes,
      archiveFiles: files.length,
      archiveBytes: files.reduce((n, f) => n + f.bytes, 0),
      files,
      uploaded: false,
    };
    // The object plan and static files move as one validated package. An upload
    // must recheck each source byte hash because another app build may follow.
    await writeFile(
      path.join(stage, 'objects.json'),
      JSON.stringify(output, null, 2) + '\n',
    );
    try {
      await rename(target, backup);
      movedOld = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(stage, target);
      installed = true;
    } catch (error) {
      if (movedOld) {
        try {
          await rename(backup, target);
          movedOld = false;
        } catch (rollback) {
          throw new AggregateError(
            [error, rollback],
            'Hosting replacement failed. Recover the previous package at ' +
              backup,
          );
        }
      }
      throw error;
    }
    if (movedOld) await rm(backup, { recursive: true });
    return output;
  } finally {
    if (!installed) await rm(stage, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const output = await prepareHosting();
  const { staticFiles, staticBytes, archiveFiles, archiveBytes } = output;
  console.log(
    JSON.stringify({
      staticFiles,
      staticBytes,
      archiveFiles,
      archiveBytes,
      uploaded: false,
    }),
  );
}

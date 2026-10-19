# How Flyleaf is built

A map for anyone changing Flyleaf itself: what runs when, what each step
reads and writes, and which tests guard it. [CONTRIBUTING.md](../CONTRIBUTING.md)
says how to set up and run the tests.

## The two outputs

Flyleaf reads a family folder ([family-folder.md](family-folder.md)) and
makes two things from it:

- **the book**, a PDF made with Typst, in the family's `build/`;
- **the website**, a React app, built in Flyleaf's own `website/dist/`.

The book is built first. The website reads the book's text and citations,
and stops if the book is out of date.

## The book: `flyleaf book`

`flyleaf book` runs `make book`, which runs `scripts/build-book.py`. In order:

| Step | Script | Reads | Writes |
|---|---|---|---|
| Enrich the tree | `enrich-gedcom.py` | `data/family.src.ged` | `data/family.ged`, with computed fields |
| Check the tree | `validate-gedcom.py` | `data/family.ged` | messages; stops on errors |
| Draw the charts | `book-figures.py`, `bookcharts.py` | the tree, `book/book.yaml` | `build/figures/` |
| Check the stories | `book-coverage.py` | the tree, `book/sketches/` | `book/COVERAGE.md`, warnings |
| Check the story markup | `extract-claims.py --validate` | the stories | stops on markup outside the list |
| Assemble | `book-assemble.py` | the tree, stories, chapters, settings | a Typst file |
| Compile | Typst, with `book/template.typ` | the Typst file | `build/book.pdf` |
| Check the PDF | `check-footnotes.py`, `check-register-sources.py`, `check-bibliography.py`, `check-charts.py` | the PDF | stops on errors |
| Record the build | `book_publication.py` | every input | `build/book-publication.json` |

Then `flyleaf book` runs `extract-claims.py` again, to write
`book/CLAIMS-MAP.json`: each passage with its citations. The website reads it.

Shared code lives in `booklib.py` (reading the tree and settings, names,
dates, places, the living rule), `source_tiers.py` (kinds of source),
`flyleaf_settings.py` (finding the family folder and its settings) and
`build_clock.py` (the fixed build date).

`build/book-publication.json` records a checksum of every input: the tree,
the stories, the settings, the templates and the book scripts listed in
`book_publication.py`. If any of them changes, the website build stops and
asks for `flyleaf book` again. So a change to a book script means building
the book again before the site.

## The website: `flyleaf site build`

`flyleaf site build` runs `npm run build` in `website/`. Its `prebuild` step
runs `website/scripts/prepare.mjs`, then Vite builds the app.

| Step | Script | Reads | Writes |
|---|---|---|---|
| Text versions | `scripts/render-source-text.py` | readable text versions of documents the tree declares | checks they still match their originals |
| Compose the edition | `scripts/compose-website.py` | `data/family.src.ged`, `site/edition.ged` | `website/work/current.ged` |
| Export the data | `scripts/export-website.py` and the `website_*.py` modules | the composed tree, the book's record, `book/CLAIMS-MAP.json`, `images/` | `website/public/data/` |
| Licences and fonts | `prepare.mjs`, `third-party-notices.mjs` | `node_modules/` | `website/public/licenses/`, `website/public/login/fonts/` |
| Base map | `website/scripts/prepare-places.mjs` | Natural Earth data in `website/geography/` | the places page's base map |
| Build the app | Vite | `website/app/`, `website/public/` | `website/dist/client/` |

For a public site, the export stops for people who may be living
([hosting.md](hosting.md)). For a private site, `flyleaf deploy` runs
`website/scripts/deploy.sh`: it builds, runs the tests, packages the site
with `prepare-hosting.mjs` into `website/dist/hosting/`, uploads originals to
private storage, publishes the Cloudflare Worker in `website/worker/`, and
checks every live file against the package.

## Generated files

Never edit these by hand; the next build replaces them.

| File or folder | Made by |
|---|---|
| `data/family.ged` | `enrich-gedcom.py` |
| `book/COVERAGE.md` | `book-coverage.py` |
| `book/CLAIMS-MAP.json` | `extract-claims.py` |
| `build/` | the book build |
| `website/work/` | the site build's staging |
| `website/public/data/` | `export-website.py` |
| `website/public/licenses/` | `prepare.mjs` (tracked, so the tests can check it) |
| `website/dist/` | Vite and `prepare-hosting.mjs` |

## Where the tests are

| Tests | Cover |
|---|---|
| `tests/test-book-pipeline.py` | the book: tree reading, assembly, register wording, charts, story checks |
| `tests/test-flyleaf-command.py` | the `flyleaf` command: new, import, doctor, questionnaire |
| `tests/test-website-*.py` | the site export, the web book and its annotations |
| `tests/test-docs.py` | the quick start's commands and every link between the guides |
| `website/tests/` | the site's code, the Worker, hosting and the archive tools |
| `website/e2e/` | the site in a browser, with Playwright |

Add a test with each change, near the tests for the same step. Run
`./flyleaf test --family sample` before a pull request; CI runs everything.

## Where to make a change

- **What the register says:** `book-assemble.py`, and its tests in
  `test-book-pipeline.py`.
- **A check on stories:** `book-coverage.py` (warnings) or `extract-claims.py`
  (markup that stops the build).
- **A check on the tree:** `validate-gedcom.py`.
- **How sources are sorted:** `source_tiers.py`.
- **Who may be living:** `booklib.possibly_living()`, and its twin for the
  website's own menus in `website/app/lib/branches.ts`.
- **A page of the website:** `website/app/components/`; the largest,
  `Atlas.tsx`, holds the home page and the site's routes.
- **A setting:** read it through `flyleaf_settings.py` (Python) or
  `website/flyleaf-settings.mjs` (the site), and document it in
  [family-folder.md](family-folder.md).

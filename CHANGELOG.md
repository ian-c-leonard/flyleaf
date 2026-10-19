# Changelog

## Unreleased

- The website runs over plain HTTP as well as HTTPS. It no longer needs a
  browser feature that works only over HTTPS.

## 0.1.0 (18 October 2026)

The first public release.

### The book

- A Typst PDF built from a GEDCOM tree and the stories you write: chapters
  for each family line, an ancestor register, family charts, a bibliography,
  an ancestor table and an index of names.
- Births, baptisms, christenings, marriages, divorces, deaths, burials and
  cremations print with their own footnotes. Other citations are grouped by
  person in "Sources for the Register".
- Text from the tree prints exactly as written and never runs as Typst
  code. Stories use a short list of markup, and the build checks every call
  and setting before it makes the PDF.
- Trees from other genealogy programs build: other programs' reference
  numbers, sources without titles, shared notes, several births or deaths,
  other calendars, names in any alphabet, and very deep trees. The bundled
  fonts print Latin, Greek, Cyrillic and Hebrew letters; for others, such as
  Chinese, the build warns and you name your own fonts.
- An ancestor reached by more than one line, as when cousins marry, is
  listed in full once in the ancestor table and the charts. Tested on a
  3,000-person royal pedigree.
- One general, international set of rules sorts sources into kinds. A
  family can add its own patterns, or use only its own.
- With a fixed build date, the same time zone and Typst 0.14.2, the same
  files make the same PDF, byte for byte.

### The website

- The book online, a family tree, profiles, photographs, a map of places, an
  archive and family treasures such as recipes and music.
- Two ways to publish: a static site for any host, or a private site on
  Cloudflare where only invited relatives can sign in and send photographs,
  memories and corrections.
- A static site publishes only what it shows. It stops and lists people who
  may be living unless the family chooses to publish them, honours RESN, stops
  when the book prints anything marked private, and publishes saved web pages
  and XML as plain text.
- Headings, menus and photo rules follow what each family has, with settings
  for the rest.
- Home's rotating photographs and records fade or slide from one to the
  next. Each picture sits in a frame of its own shape, and the page never
  moves while they change.
- The footer says "Built with Flyleaf", with the Flyleaf mark and a link to
  flyleaf.family. `site.credit: false` leaves it out.

### Hosting

- `flyleaf deploy` checks that everything it publishes is committed (a large
  original kept out of git needs its checksum in the tree), runs the tests
  and the type and lint checks (CI also runs the browser tests), checks that
  both storage buckets are private, publishes, and then checks the live site
  signed in and signed out.
- The Worker sends strict security headers, limits what one relative can send
  in a day, and refuses unsafe file names.

### The command and the docs

- `flyleaf import` checks a tree before it replaces the family's, and writes
  the underscores older programs put in names as spaces.
- `flyleaf`: `doctor`, `new`, `import`, `scaffold`, `sources`, `book`,
  `coverage`, `questionnaire`, `repin`, `site`, `test`, `gate` and `deploy`.
- The Penhallow sample family, used by the tests and the demo.
- Docs for getting started, writing the book (including with an AI
  assistant), research standards, hosting, the family folder and GEDCOM.
- The method behind the first book, as guides: the whole process, research
  standards, a research playbook, living relatives, photographs and
  documents, a style guide, review before sharing or print, and lineage
  societies.
- `flyleaf new` adds `AGENTS.md` (instructions for an AI assistant, with
  `CLAUDE.md` pointing to it), `PLAN.md`, and a research log, open questions
  and records to request in `research/`. The sample family has filled-in
  examples.
- `flyleaf coverage` also counts research wording in text readers see;
  `--wording` lists it. A public site's `flyleaf site build` runs the same
  check that deploy runs for a private site.
- CI runs the Python and site tests, type and lint checks, and browser tests
  on the sample family. A second job builds the book and site on macOS with
  the oldest Python and Node.js that Flyleaf supports.
- A code of conduct, a pull-request template and a roadmap.
- `flyleaf import --replace` keeps each person's id, so stories and the site
  still point at the right people; an id that is gone is named.
- `flyleaf --version`, and plain messages for a missing file, a mistyped
  `flyleaf.json`, or a book older than its stories.
- Every site build publishes `licenses/third-party.txt`: the licence of each
  package its code may include.
- The title page says "A Family History" unless `book.yaml`'s `strapline`
  says more, and each book build names the people who may be living.
- `docs/architecture.md` maps the build for anyone changing Flyleaf.

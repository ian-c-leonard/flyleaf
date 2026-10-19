# Contributing

Flyleaf puts three things ahead of new features: books that are honest about
their evidence, sites that stay private when they should, and builds that
come out the same every time.

Flyleaf is kept up by one person in spare time. Issues and pull requests
are welcome, and get a reply when there is time. Fixes to bugs, privacy
and other families' trees come first. A new feature may wait, or may be
declined if it would make Flyleaf harder to keep up. [ROADMAP.md](ROADMAP.md)
lists what may come next; open an issue before you start on an item.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Setup

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd website && npm ci)
./flyleaf doctor
```

## Tests

Build the sample family's book and site, then run the tests:

```sh
./flyleaf book --family sample
./flyleaf site build --family sample
./flyleaf test --family sample
```

`flyleaf test` runs the pipeline's tests, the site's unit tests, and the
tests for the Worker, the hosting scripts and the archive tools. It leaves
out the type and lint checks, the sign-in page tests and the browser tests.
Run those from `website/`, with the sample's site built:

```sh
export FLYLEAF_FAMILY="$PWD/../sample"
npx tsc --noEmit -p .
npm run lint
npm run worker:typecheck && npm run worker:lint && npm run archive:lint
node --test tests/login-branding.test.mjs

npx playwright install chrome   # once
npm run preview &               # serves the site at http://127.0.0.1:4173
npx playwright test
```

CI runs all of these, on every pull request and on every push to `main`.
The flyleaf.family site publishes only after they pass.

## Layout

[docs/architecture.md](docs/architecture.md) maps the whole build: each step, what it
reads and writes, and where its tests are.

| Path | Holds |
|---|---|
| `flyleaf` | The command. |
| `scripts/` | The book and site pipeline, in Python. |
| `book/` | The Typst templates and the bundled open fonts. |
| `website/` | The site (React and TypeScript) and its Cloudflare Worker. See [website/README.md](website/README.md). |
| `starter/` | What `flyleaf new` copies into a new family folder. |
| `sample/` | The Penhallow sample family, used by the tests and the demo. |
| `tests/` | The pipeline's tests. The site's tests are in `website/tests/` and `website/e2e/`. |
| `docs/` | The documentation. |
| `pages/` | The flyleaf.family home page. |

## Rules for changes

- Add a test with every fix. Make it catch the kind of mistake, not only the
  one case.
- Keep tests free of real people. Use the sample family or invented names.
- Do not edit generated files: `data/family.ged`, `build/`,
  `website/public/data/`, `website/dist/`.
- Keep every site content file optional. A new family must build its book
  and run its site with `flyleaf site dev` from what `flyleaf new` makes and
  a tree from `flyleaf import`, with nothing else. (A build to publish a
  static site also needs the family to choose about living people.)
- Read family details from `flyleaf.json` and the family folder, never from
  constants in the code.
- Write plain English in anything a reader sees: short sentences, no jargon.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under an "Unreleased" heading
  at the top. Add the heading if it is not there.

## Releasing

1. Move the "Unreleased" entries in CHANGELOG.md under a new version heading,
   with the date.
2. Set the same version in `flyleaf` (`VERSION`) and `website/package.json`.
   A test checks that all three agree.
3. Wait for CI to pass on `main`, then tag the commit, such as
   `git tag v0.2.0 && git push origin v0.2.0`.
4. Check flyleaf.family, its demo and the sample book.

## Reporting a problem

Open an issue with the command you ran, what you expected and what happened.
Do not attach a real family's tree. Reproduce the problem with the sample
family or a few invented people.

Report a security problem privately instead; see [SECURITY.md](SECURITY.md).

# The Flyleaf website

The family website: a React and TypeScript app built with Vite, and a small
Cloudflare Worker for families who use sign-in. Run commands here through the
`flyleaf` command, or directly with npm once `FLYLEAF_FAMILY` names the family
folder.

| Command | Does |
|---|---|
| `npm ci` | Install the packages once. |
| `npm run build` | Prepare the family's data, then build the site into `dist/client`. |
| `npm run dev` | Prepare the data and serve the site while you edit. |
| `npm run preview` | Serve the last build. |
| `npm test` | The app's unit tests. |
| `npm run test:worker`, `test:submissions`, `test:gateway` | The Worker's tests. |
| `npm run test:hosting` | The hosting, deploy and invitation scripts' tests. |
| `npm run test:archive` | The archive upload and sync tests. |
| `npm run typecheck`, `lint`, `worker:typecheck`, `worker:lint`, `archive:lint` | Type and lint checks. |
| `node --test tests/login-branding.test.mjs` | The sign-in page tests. |

Folders:

- `app/`: the site. `app/lib/` holds the logic, `app/components/` the pages.
- `worker/`: the Worker: sign-in, the private archive and submissions.
- `public/`: static files; `public/data/` is made by the build, and
  `public/licenses/` holds the site fonts' licences, which every build
  publishes.
- `scripts/`: data preparation, hosting, deploy and checks.
- `content-defaults/`: empty versions of each family content file.
- `email/`: the invitation script and a plain letter.
- `geography/`: Natural Earth map data (public domain).
- `tests/`, `e2e/`: unit tests and browser tests.

The build reads the family's settings from `flyleaf.json`. The browser gets
only public values (names, the site address, the maintainer's contact);
sign-in lists and account ids stay in the Worker's environment.

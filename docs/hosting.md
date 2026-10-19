# Hosting the website

Flyleaf builds the site two ways. Choose with `site.hosting` in
`flyleaf.json`.

The commands below run from Flyleaf's folder, for a family folder at
`../my-family`. Use your own family folder's path.

## A static site

`"hosting": "static"`. The site is plain files: no sign-in, and no way for
relatives to send things in. New families start this way, and the
flyleaf.family demo works this way.

    ./flyleaf site build --family ../my-family
    # then publish website/dist/client with any static host

Any host that serves files works: GitHub Pages, Netlify, Cloudflare Pages, or
a folder on your own server. To serve it from a folder rather than the root
of a domain, set `site.base_path` (such as `/demo/`) before building.

**A static site is public.** Anyone who finds the address can read the
whole site and every document in it. For a real family, use the Worker
below. The build prints this warning at its start and again at its end.

A static site has no deploy step, so `flyleaf site build` first runs the
check deploy runs on the text readers see. It stops on a phrase you list in
`text_checks`, and counts the warnings that `flyleaf coverage --wording`
lists.

Because a static site is public, the build checks for people who may be
living:

- A person may be living if the tree has no death, burial, cremation or
  probate record for them and they were born in the last 100 years.
- A death or burial record counts when its date, place or source holds
  something, or it reads `1 DEAT Y`. A record with only a note, or an empty
  date, does not.
- A birth with a range of dates, such as `BET 1900 AND 1980`, counts by its
  latest year. A date with no end, such as `AFT 1900`, does not count.
- Without a birth date, the latest of their dated facts counts, such as a
  marriage or a census.
- Without any date, the year is estimated from the nearest dated
  relatives: 30 years after a parent's, the same as a partner's, or 30 years
  before a child's.
- Someone with no date and no dated relative may be living.
- The check covers everyone the book names, because the site carries the
  book.

If anyone may be living, the build stops and lists them. Then do one of
these:

- Add a death or burial record, if they have died.
- Mark them private with `1 RESN privacy` (or `confidential` or `locked`).
  A static site leaves out people, facts and records marked this way. It
  cannot leave anything out of the book, so the build also stops when the
  book names someone marked private, or prints a fact, marriage, source or
  note marked private.
- Set `"publish_living_people": true` under `site` to publish them anyway.

A static site also publishes saved web pages and XML files as text files,
such as `page.html.txt`, so a browser cannot run them.

## A private site with sign-in

`"hosting": "worker"`. The site runs on Cloudflare behind a small Worker that
lets in only invited relatives, signed in with [Clerk](https://clerk.com).
Relatives can then send photographs, memories and corrections for you to
review.

### What you set up once

1. **A domain** on Cloudflare DNS, such as `example.family`.
2. **On Cloudflare**: two R2 buckets (one for the archive's original files,
   one for what relatives send) and one D1 database (for their messages).
   Note the account id, the bucket names and the database name and id. Keep
   both buckets private: no r2.dev address and no custom domain. Deploy
   checks both and stops if it finds either.
3. **On Clerk**: an application with email sign-in and invitations only. A
   production instance lives at `clerk.<your domain>`. While you set up, a
   development instance works too: Flyleaf accepts its `pk_test_` key, and
   deploy warns at the end that the live site still uses it.

   The Worker checks each relative's email address, which it reads from
   their Clerk session. Clerk leaves it out unless you add it. In the Clerk
   dashboard, open **Sessions**, then **Customize session token**, and add
   these two claims:

       {
         "email": "{{user.primary_email_address}}",
         "email_verified": "{{user.email_verified}}"
       }

   Save, then sign in again. Do this in each Clerk instance you use. Without
   these claims the site lets nobody in, and says that sign-in is not set up
   completely.
4. **In flyleaf.json**: `site.domain` and `site.origin`; the `auth` settings
   (publishable key, frontend API, allowed and admin emails, and which person
   each invited email belongs to); the `cloudflare` names; and
   `features.submissions: true` if relatives may send things. Without that
   setting, sending is off.
5. **Credentials**, in the folder `deploy.credentials_dir` names (outside any
   repository):
   - `cloudflare.env` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
     (the token must be able to read both buckets' settings);
   - `clerk.env` with `CLERK_SECRET_KEY`.
6. **The Worker's secret**: set `site.hosting` to `worker` and run
   `./flyleaf site build --family ../my-family` once, which writes
   `website/wrangler.jsonc`. Then, from `website/`, run wrangler with the
   token read straight from `cloudflare.env` (use your own folder):

       node --env-file="$HOME/.config/flyleaf/cloudflare.env" \
         node_modules/wrangler/bin/wrangler.js secret put CLERK_SECRET_KEY

   It asks for the Clerk secret key.
7. **Git**: deploy publishes only committed work, so the family folder and
   Flyleaf's folder must both be git repositories.

**Keep the family's repository private.** Deploy needs `flyleaf.json`
committed, and it lists every invited relative's email address and which
person in the tree each one is. The tree and the archive hold living
relatives too. Only Flyleaf's own folder is meant to be public.

### Publishing

    ./flyleaf deploy --family ../my-family             # build, test, publish
    ./flyleaf deploy --family ../my-family --skip-book # reuse the book PDF
    ./flyleaf deploy --family ../my-family --dry-run   # build and test only

Deploy goes step by step and stops at the first problem:

1. It checks that nothing it publishes has uncommitted changes: every file
   in Flyleaf's folder, and in the family folder `flyleaf.json`, the tree,
   `data/`, the book folder, `images/`, the site content and any book font
   kept there. Three files every build remakes are left out: the generated
   tree, `book/COVERAGE.md` and `book/CLAIMS-MAP.json`. A dry run skips this
   check.

   Very large originals in `images/`, such as whole scanned books, can stay
   out of git with `.gitignore`. Then the tree must give each one its
   checksum, as `_SHA256` under its `FILE` line, so the commit still fixes
   what is published. The site build checks the file against it, and deploy
   prints the line to add. A story or site file may not use an ignored file,
   and any other ignored file the builds read stops the deploy.
2. It builds the book the same way as `flyleaf book`.
3. It installs exactly the website packages in `package-lock.json`
   (`npm ci`), then builds the site.
4. It runs the tests: the same suites as `flyleaf test`, the type and lint
   checks, the Worker's type and lint checks, the sign-in page tests, and
   the family-text check.
5. It uploads new archive files to R2, applies database changes, and
   publishes the Worker and the files.
6. It checks the live site as a visitor who has not signed in: the home page
   must send them to `/login`, and the family tree and an original must be
   refused.
7. It reads every published file through a signed-in browser and compares
   it with the build.

Deploy runs with the same Python as the `flyleaf` command. Only `wrangler`
and the archive upload read `cloudflare.env`.

Before it uploads anything, deploy checks that neither bucket has a public
address. It also checks that each file R2 already holds has the same
contents as the local file of that name. If one differs, deploy stops: give
the changed original a new file name. Each new upload is read back and
checked.

The signed-in check reads each site file in full. It checks each original by
its size and by the checksum R2 keeps for it, so a large archive takes little
time. To read every original in full, run:

    FLYLEAF_FAMILY=../my-family node website/scripts/verify-live.mjs --full

The signed-in check needs Google Chrome. It uses a Chrome profile kept for
it, at `~/.local/state/<site id>/live-profile` (or set `LIVE_PROFILE` to
another folder). Sign in to the site in that profile once, before your
first deploy. On a Mac:

    open -na "Google Chrome" --args \
      --user-data-dir="$HOME/.local/state/<site id>/live-profile" \
      https://example.family/login

On Linux:

    google-chrome --user-data-dir="$HOME/.local/state/<site id>/live-profile" \
      https://example.family/login

Sign in, then close the window. If the session ends later, deploy stops at
this step and says so: sign in there again, then run the check on its own:

    FLYLEAF_FAMILY=../my-family node website/scripts/verify-live.mjs

To rebuild exactly what the last deploy published and compare every file,
run `./flyleaf gate --family ../my-family`; add `--book` to rebuild the PDF
too. It works only for a Worker site, because it compares with the last
deploy.

### What relatives can send

With `features.submissions: true`, each relative can send:

- files of up to 50 MB each, and up to 8 files and 150 MB in one submission;
- up to 10 submissions and 300 MB of files a day.

The whole inbox holds up to 1 GB and 5,000 submissions. The numbers live in
`website/shared/submission-policy.json` and in the database rules in
`website/migrations/submissions/`. Change both together.

### Seeing the site as a relative

An administrator can see the site as another relative would. The list holds
everyone who may be living, by the rule under "A static site", and every
relative with a sign-in. It leaves out people with no date and no dated
relative, who would only crowd it.

### Inviting relatives

1. Add each address to `auth.allowed_emails`, and to `auth.viewer_people`
   with the person they are in the tree.
2. List them in `email/invitees.local.json` in the family folder (keep it
   out of git):

       [{"email": "cousin@example.com", "firstName": "Tom", "person": "tom-penhallow"}]

3. Preview the letters. The script prints which family it is using:

       FLYLEAF_FAMILY=../my-family node website/email/invite.mjs

   Add `--create-invitations` to make Clerk invitation links, and `--eml`
   to save each letter as an `.eml` file in `email/out/`. Open that file in
   your mail program, check it, and send it. The script never sends email
   itself. Write your own letter in `email/family-invitation.html` and
   `.txt`, or use the plain one Flyleaf provides.
4. Deploy, so the new addresses can sign in.

## Privacy

- The map's pictures come from OpenStreetMap's tile servers
  (`tile.openstreetmap.org`). A reader's browser asks those servers for the
  part of the map on screen, so OpenStreetMap sees the reader's address on
  the internet and the area they look at. Nothing else about the family is
  sent.
- On a Worker site, sign-in runs through Clerk, which holds each invited
  relative's email address. Cloudflare keeps the Worker's request logs for
  you, with the part of each address after `?` removed.
- The site has no analytics or advertising. Apart from the map and sign-in,
  every file it loads comes from the site itself, fonts included.

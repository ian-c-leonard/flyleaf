# Quick start

This takes a GEDCOM file from any genealogy program to a book PDF and a
website you can open on your own computer.

## 1. Install what Flyleaf needs

Flyleaf runs on macOS and Linux. It needs:

- **git** and **make**. A Mac has both once you run
  `xcode-select --install`; on Linux, install your system's `git` and
  `make` packages.
- **Python 3.11 or later.** On a Mac, `brew install python`; on Linux, your
  system's Python 3.
- **Typst 0.14.2, exactly.** Download it from
  [Typst's release page](https://github.com/typst/typst/releases/tag/v0.14.2)
  and put the `typst` program on your PATH. Other versions can lay out pages
  differently, so the book build stops on any other version. (Homebrew
  installs the newest Typst, which is not 0.14.2.)
- **Poppler**, for reading PDFs: `brew install poppler`, or
  `sudo apt install poppler-utils`.
- **Node.js 22.13 or later**: from [nodejs.org](https://nodejs.org), or
  `brew install node`.

## 2. Get Flyleaf and its packages

    git clone https://github.com/ian-c-leonard/flyleaf.git
    cd flyleaf
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    (cd website && npm ci)
    ./flyleaf doctor

`flyleaf` uses the Python packages in a `.venv` folder in the family folder
if there is one, else the one in Flyleaf's folder, else the Python that runs
it. `doctor` prints
one line per requirement, `make` and `git` included, and says how to fix
anything missing.

`npm ci` may report vulnerabilities in the packages it installs. To see
each one and the package it is in, run `npm audit` in `website/`.

Use one copy of Flyleaf for each family. The site build writes into
Flyleaf's own `website/` folder.

## 3. Start a family folder

    ./flyleaf new ../penhallow --name "The Penhallow family" \
      --maintainer "Carol Penhallow" --email carol@example.com

This makes `../penhallow` with the family's settings (`flyleaf.json`), and
folders for its tree, book, pictures and site content. It will not write
over files that are already there. See [family-folder.md](family-folder.md).

In `flyleaf.json`, the values that matter first are `family.name` and the
`maintainer` details. `site.domain` and `site.origin` matter once you publish.

## 4. Bring in your tree

In your genealogy program, export the tree as GEDCOM, with the character set
UTF-8 (sometimes called Unicode). Then:

    ./flyleaf import my-tree.ged --family ../penhallow --root "Tamsin Penhallow"

Import keeps every line of your file, except blank lines and leading
spaces, which GEDCOM readers ignore. In names it writes underscores as
spaces, as older programs such as PAF used them ("Elizabeth_II"). It
refuses a tree the book cannot read. It adds two things to each person:

- An id made from the name, such as `tamsin-grace-penhallow`. The book and
  the website use it. People who already have one keep it.
- A starting confidence of `tree-link`. Raise it to `primary` as you cite
  original records. See [research-standards.md](research-standards.md).

`--root` names the person the book is about: usually the youngest generation
it is written for. Use part of a name, an id, or a record number such as
`@I15@`. If several people match, import lists them. Many programs do not
export which person is "home", so choose the root yourself. If you are not
sure yet, choose one for now and import again later with `--replace`. It then proposes
chapters in `book/book.yaml`: the root's father's side, the mother's side,
and the present generation.

Copy your photographs and documents into the family's `images/` folder, at
the paths your tree uses for them. The site build lists every file it
leaves out, with the reason, and writes them all to
`build/site-data-report.json`.

## 5. Build the book

    ./flyleaf book --family ../penhallow

The PDF is `../penhallow/build/book.pdf`. The build checks the tree first
and prints what it found. Warnings, such as a person with no source, do not
stop it.

At this point the book is the register: dates, places and sources from the
tree, with empty chapters. The stories come next.

The PDF names every ancestor, their partners and the descendants the tree
records for them, including people who may be living. It prints every fact
the tree holds about them. So keep in the tree only what you would print
(see [relatives.md](relatives.md#what-flyleaf-does)).

## 6. Write the stories

The stories turn the register into a family history. You write them, and
they are most of the work.

    ./flyleaf scaffold --family ../penhallow

This makes a story file in `book/sketches/` for each ancestor or couple.
Write each one by hand or with an AI assistant, and cite every fact with
`#src`. To list the sources you can cite for one person:

    ./flyleaf sources tamsin-grace-penhallow --family ../penhallow

To see the stories in place, build the book again:

    ./flyleaf book --family ../penhallow

The build stops on a citation to a source the tree does not have. To see
its warnings about the wording, such as a long paragraph with no citation,
run:

    ./flyleaf coverage --family ../penhallow

[book.md](book.md) explains the story format, every check, and a way to work
with an AI assistant.

## 7. Look at the website

    ./flyleaf site dev --family ../penhallow

Open the address it prints, usually http://127.0.0.1:5173. If that port is
busy, add `--port 5180`. This runs on your computer only, so it shows
everyone in the tree. It warns about people who may be living, such as
you.

## 8. Choose how to publish

A new family's site is static, and a static site is public. So
`flyleaf site build`, which makes the files to publish, stops and lists
everyone who may be living. Choose one:

- **A private site** that only invited relatives can open. Set
  `"hosting": "worker"` under `site` in `flyleaf.json`, and follow
  [hosting.md](hosting.md). This suits most families.
- **A public site.** Mark people who should not appear with
  `1 RESN privacy`. If everyone the book names agrees to be public, set
  `"publish_living_people": true` under `site`.

Then build the site and check it before you publish:

    ./flyleaf site build --family ../penhallow
    ./flyleaf site preview --family ../penhallow

## Keeping your tree up to date

You can edit `data/family.src.ged` directly, or keep working in your
genealogy program and import again. Importing again replaces the family's
tree, so Flyleaf asks for `--replace`. It keeps the old file beside the new
one, named with the date and time, such as
`data/family.src.ged.20261017-142530.bak`, and prints that name. Changes you
made by hand to `family.src.ged` are not carried over: make them in your
genealogy program instead, or edit the file directly from then on.

Everyone keeps their id. Import matches each person to the previous tree by
their record number and name or birth year, or failing that by a name and
birth year that only one person has. Anyone it cannot match gets a new id,
and never an id that belonged to someone else. If an id from the previous
tree is gone, import names it: a story that cites that person then stops
the build, until you point it at the person's new id.

Some genealogy programs drop tags they do not know, such as `_CONFLEVEL`,
when they export. Import keeps ids, but it does not carry these tags over
from the previous tree. After you import again, check the confidence levels
you raised: those people may be back at `tree-link`. Compare the new tree
with the `.bak` file, and set the levels again.

## Updating Flyleaf

Each release has a tag, such as `v0.1.0`, and a section in
[CHANGELOG.md](../CHANGELOG.md) that says what changed and what, if
anything, a family must do. `./flyleaf --version` says which you have.

To move to a new release:

1. Commit or back up your family folder.
2. In Flyleaf's folder, run `git fetch --tags`, read the changelog, then
   `git checkout v0.2.0` (the tag you want).
3. Install its packages: `.venv/bin/pip install -r requirements.txt` and
   `(cd website && npm ci)`. Then run `./flyleaf doctor`.
4. Build the book and look at the website. Compare them with the last ones.
5. If something is wrong, go back with `git checkout` and the old tag, and
   install its packages again. Your family folder is unchanged.

While Flyleaf is at 0.x, a release may change a setting or a file format.
The changelog says so, and how to update the family folder.

## Next steps

- Look at `sample/` for a complete family: settings, chapters, stories,
  images and site content.
- `./flyleaf --help` lists every command.
- `./flyleaf questionnaire <id> --family ../penhallow` writes a form for a
  relative to fill in, in `questionnaires/`. It shows that person's own
  record, names other people who may be living without their facts, and asks
  about unknown parents.
- Run `./flyleaf test` after you change Flyleaf itself; see
  [CONTRIBUTING.md](../CONTRIBUTING.md).

# Writing the book

`flyleaf book` builds the PDF from the tree and the family's `book/` folder.

## What comes from the tree, and what you write

From the tree, Flyleaf makes the register, the family charts, the ancestor
table, the bibliography and the index of names. `flyleaf scaffold` adds an
empty story file for each ancestor or couple. Before you write anything, the
book is a register with empty chapters.

You write the stories: one for each ancestor or couple, and an introduction
for each chapter. They are most of the work. You also write the front and
back matter, such as an introduction and a list of open questions.

## What the book contains

1. **Front matter**: the title page, contents, and the files in
   `book/front-matter/` (an introduction, a note on methods).
2. **Part I, the Narrative**: one chapter for each group of family lines.
   Each chapter opens with an introduction, then a story for each ancestor
   or couple, with family charts.
3. **Part II, the Register**: every ancestor in order, with dates, places,
   marriages and children. It is made from the tree. A cited birth,
   baptism, christening, marriage, divorce, death, burial or cremation gets
   a footnote on that fact; other citations are listed by person in
   "Sources for the Register".
4. **Sources for the Register**, the **Bibliography** (grouped by kind of
   source), the **Ahnentafel** (the numbered ancestor table), and an
   **Index of Names**.
5. **Back matter**: the files in `book/back-matter/`, such as open questions
   and an afterword.

## book/book.yaml

    title: The Penhallows of St Just and Mineral Point
    subtitle: Five generations from the Cornish tin mines to Wisconsin
    author: Compiled by Carol Penhallow
    strapline: A Family History
    root_refn: tamsin-penhallow
    trim_width: 6in
    trim_height: 9in

    chapters:
      - {id: penhallow, title: "Penhallow and Treloar", lines: [penhallow, treloar]}
      - {id: solberg, title: "Solberg and Kessler", lines: [solberg, kessler]}
      - {id: present, title: "The Present Generation", lines: [origin], charts: false}

- `strapline` sets the small line above the title, "A Family History" if
  you leave it out ([style-guide.md](style-guide.md#what-flyleaf-prints-in-order)).
- `root_refn` is the person the book is about: ancestor no. 1. Their
  parents are nos. 2 and 3, grandparents 4 to 7, and so on.
- `chapters` group **lines**. Flyleaf gives every ancestor a line: a man's
  line is the surname of his earliest known male-line ancestor; a woman
  belongs to her father's line, or her husband's when her father is unknown.
  The root and siblings are `origin`. Every line must be in exactly one
  chapter; the build says which are missing. `flyleaf import --root`
  proposes a first plan.
- `charts: false` leaves a chapter's family charts out.
- `other_lines: father` (or `mother`) gives a chapter every family line on
  that side that no chapter lists. `flyleaf import` writes this for a deep
  tree, so the plan names only the nearer lines.
- `trim_width` and `trim_height` set the page size. Write a length with its
  unit: `6in`, `152mm`, `15.2cm` or `432pt`. The default is 6 × 9 inches.
  Family charts and tall pictures fit the text column.

The file is read with a simple reader: `key: value` lines and the chapter
lines above. Do not put a `#` inside a value, because everything after it is
read as a comment.

## Stories: book/sketches/

Each story is a Typst file with a header of settings in comment lines:

    // ---
    // refn: william-henry-penhallow
    // covers: [william-henry-penhallow, edith-may-rowe]
    // ahnentafel: [8]
    // status: draft
    // title: William and Edith
    // line: penhallow
    // ---

    William Henry Penhallow was the youngest child of #refp("john-penhallow")
    and #refp("elizabeth-trembath"). The family Bible gives his birth at
    Mineral Point on 14 February 1878.#src("william-birth-bible")

- `refn` is the story's main person; `covers` lists everyone the story
  tells about. Each ancestor must be covered by exactly one story.
- `ahnentafel` and `line` must agree with what Flyleaf computes; the build
  says when they do not.
- `status` is `stub`, `draft` or `final`.
- `title` replaces the default heading (the names and years).
- `continuous: true` lets a story run on without its own heading, for an
  author who writes headings across several generations.
- `citation_people` lists other people whose sources the story may cite.
- `context_years` lists years the story may mention that are not in the
  records of the people it covers, such as `[1848, 1866]` for a gold rush
  and a war. Without it, such a year draws a warning (see below).

In the text:

- `#src("key")` cites a source by its `_KEY` and prints a footnote. For a
  source cited under another person, write `#src("person-id::key")`.
- `#refp("person-id")` names a person and links to their register entry.
- `#fig("photographs/file.jpg", caption: "...")` places a picture from
  `images/`.
- In the front matter, `{{stat:date}}` and `{{stat:persons}}` print the
  edition date and the number of ancestors.

Use the ids from your own tree. `flyleaf coverage` lists each ancestor's id,
and `flyleaf sources <id>` lists the source keys a story can cite for them.

Stories, chapter introductions and the front and back matter use part of
[Typst](https://typst.app/docs/)'s markup:

- paragraphs, separated by a blank line;
- headings: a line that starts with `=`, such as `== A heading`, holding plain
  text only;
- `*bold*`, `_italic_` and `` `raw text` ``;
- a backslash before a special character, to print it as itself: `\$300`,
  `\#1`, `\@`, `\*`;
- `#src("key")` or `#src("person-id::key")`;
- `#refp("person-id")`;
- `#fig("photographs/file.jpg", caption: "...")`, or
  `#figure(image("/images/file.jpg", width: 2in), caption: [...])`. `image`
  may take `width` and `height`. A caption is words in quotes, words in
  `[...]`, or either inside `text(size: 9pt, fill: iron, ...)`, with `#src`
  calls. `fill` is one of the template's colours: `ink`, `ember`, `pine` or
  `iron`;
- `#footnote[...]`, for a note of your own;
- `#block(...)[...]`, such as `#block(breakable: false)[...]`, to keep text
  together. It may take `breakable` and `sticky` (`true` or `false`), and
  `above`, `below`, `width`, `height` and `inset` (lengths such as `1.2em`);
- `#grid(columns: 2, gutter: 1em, [...], [...])`, with plain cells;
- `#pagebreak()` or `#pagebreak(weak: true)`;
- `#super[, ]`, between two `#src` calls;
- comments, on lines of their own, starting with `//`;
- in the front matter, `{{stat:date}}` and `{{stat:persons}}`.

Every call takes only the settings listed here, with plain values: numbers,
lengths, `true` or `false`, and words in quotes. A story is a `.typ` file; a
`.md` file in a book folder stops the build.

Anything else that starts with `#` stops the build before it makes the PDF.
The message names the file and the line.

`flyleaf scaffold` starts a stub for every ancestor no story covers yet.
Chapter introductions live in `book/chapters/<chapter id>-intro.typ`.

## Keeping stories current

`flyleaf coverage` writes `book/COVERAGE.md`: which ancestors are covered,
which stories are drafts or stubs, and which are **stale**. A story goes
stale when the tree record of anyone it covers changes after the story was
last marked current. The PDF prints a notice at the head of a stale story,
and `flyleaf coverage` lists every stale story. Reread each one against the
new records, then run `flyleaf coverage --mark <id>` for each person the
story covers: `--mark` takes a person's id, so a story about a couple needs
both. After rereading every story, run `flyleaf coverage --mark-all`.

## What the build checks

The build stops if any of these fails:

- the tree passes the research-standard checks (see
  [research-standards.md](research-standards.md));
- every story cites only sources the tree has;
- every story, introduction and essay uses only the markup above;
- no footnote starts on a page before its reference;
- every register reference appears once and matches its source;
- every cited source is in the bibliography;
- every family chart is numbered and placed.

It also looks for the problems below, without stopping. `flyleaf coverage`
prints them, and every build writes them to `book/COVERAGE.md`:

- a paragraph of more than 90 words with no citation;
- a sentence that gives a year and cites nothing;
- a year that is not in the records of the people a story covers (or in its
  `context_years`);
- a name one letter away from a name in the tree, which the tree never
  uses, such as "Elisabeth" in a tree that spells it "Elizabeth";
- words of certainty, such as "undoubtedly" or "it is certain";
- style slips: month-first dates, ordinal numbers such as "23rd", a comma
  before "Jr.", "ibid.", a web address in the text, first person such as
  "I found" or "my", two-letter
  state codes, small counts written as numerals ("3 children"), and "at"
  before a region named in `places.region_names`;
- in the tree: a two-letter state code (such as CA) or a comment in a place
  name, and a January to March date before 1752 without both years.

The checks on years read four-digit years, from 1000 to the year of the
build. A shorter number in a story, such as "in 950", is not checked.

The build itself warns about a footnote that runs on to the next page and
leaves a page holding only its end.

A comment line `// cite-lint: ok <reason>` just above a paragraph turns off
the story warnings for that paragraph, except the one about years. Write the
reason, so the next reader knows why.

`flyleaf coverage` also counts research wording in text that readers see,
such as "has not been verified", and `flyleaf coverage --wording` lists it.
`flyleaf deploy`, and `flyleaf site build` for a public site, run the same
check before publishing. Phrases you list in `text_checks` stop them.

A successful build means the book is consistent. It does not mean every
statement is proven. That judgement stays with the person who writes it.

## Writing with an AI assistant

Flyleaf grew out of a family history whose stories were drafted with an AI
assistant, and checked by a person against the records. The checks above
suit that way of working. A loop that works:

1. Run `flyleaf scaffold` once, to make a story file for each ancestor.
2. Run `flyleaf sources <id>` to list the sources a story about that person
   can cite.
3. Give the assistant that list, the story file and the records you hold.
   Ask for a draft that cites every fact with `#src` and adds nothing the
   records do not say.
4. Run `flyleaf book` to check the citations, then `flyleaf coverage` to
   read the warnings about the wording. If the book stops because a
   footnote starts on a page before its marker, keep the paragraph whole
   (see [what you check on the page](style-guide.md#what-you-check-on-the-page)).
5. You, not the assistant, read the draft against the records and correct
   it. Set its `status` to `final` only after the claim audit in
   [review.md](review.md#the-claim-audit).

An assistant can be wrong with confidence. A draft stays a draft until you
have checked it against the records.

**When `flyleaf sources` lists nothing**, the tree cites no source for that
person yet. A tree imported from another program often has none. Either
research first ([research-playbook.md](research-playbook.md)), or cite what
you hold for what it is: for example, the exported tree itself as a source
of kind `lead`, with a `PAGE` that says where in it the fact appears. Keep
the person at `tree-link` or below, and the story a draft, until records
support it.

## Other editions

`flyleaf book --archival` also makes `build/book-archival.pdf`, a PDF/A-2b
copy for a library. `--preview` makes pictures of the first eight pages.
Both use the book's own fonts.

## Reader links on the website

The website's book pages are plain by default. A family can add reviewed
reader links, such as a name that opens a profile. They live in
`book-annotations.json` in the site folder, with a folder per part under
`book-annotations/`. No command makes them, and a family without them gets
plain pages and no warnings.

Reader links are experimental. There is no starter file yet, the files are
long to write by hand, and their format may change in a later release.

- `book-annotations.json` has `schema: 1`, a `scope` (`authoredChapters`,
  and `separateChapters` with a lane for each generated chapter), and
  `parts`. Each part has an `id` and `sources`: the path and SHA-256 of its
  files.
- A prose part has `associations.json`, `qualification-guards.json` and
  `book-only-locations.json`. The part named `non-prose` covers headings,
  captions, charts and tables, and adds `required-context.json`,
  `coverage.json`, `preserve-existing.json` and
  `destination-corrections.json`.
- In `associations.json` each passage gives its chapter and section, its
  exact words and their SHA-256, and its links. A link names a person
  (refn) or a place, with the exact words, which occurrence, its start and
  end, and the text before and after. Every authored passage must be
  listed.

The build stops if a passage's words change. After a deliberate edit to a
story, run `BOOK_REANCHOR=1 flyleaf site build` once. It moves each link to
the same words in the new text, drops links whose words were removed,
records the new hashes, and prints each change, also for
`book/web-selections.json`. Review the changes in git, then build again
without it.

## Typefaces and Typst

The build gives Typst only the font files named in `book.fonts`, and checks
the Typst version against `book.typst.version`. With the same tree, prose,
fonts and Typst, a fixed date (`SOURCE_DATE_EPOCH`) and the same time zone
(`TZ`), the PDF comes out byte for byte the same.

The bundled Libertinus fonts have Latin, Greek, Cyrillic and Hebrew letters.
For names in another alphabet, such as Chinese, name fonts that have them in
`book.fonts` ([family-folder.md](family-folder.md)). The build warns when
the tree needs them.

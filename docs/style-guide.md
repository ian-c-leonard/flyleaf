# Style guide for the book

This guide is about writing a family history well: the register, names,
dates, places, citations, the stories, pictures, the index, the front and
back matter, and the checks before you share it.

[book.md](book.md) explains the mechanics: story files, `#src`, `#refp`,
`flyleaf scaffold`, `flyleaf sources`, `flyleaf coverage`, and what the build
checks. Read it first if you have not written a story yet.

Other guides cover the rest of the work:

- [research-standards.md](research-standards.md): kinds of source,
  confidence, and how to judge evidence.
- [research-playbook.md](research-playbook.md): how a research session runs.
- [relatives.md](relatives.md): questionnaires, interviews and living
  relatives.
- [photos-and-documents.md](photos-and-documents.md): scanning, saving
  originals, file names and rights.
- [review.md](review.md): the claim audit, independent reviewers and the
  human reader.
- [journey.md](journey.md): the whole process, start to finish.

## Contents

- [How to read this guide](#how-to-read-this-guide)
- [The shape of the book](#the-shape-of-the-book)
- [The register entry](#the-register-entry) and
  [children lists](#children-lists)
- [Names](#names), [dates and numbers](#dates-and-numbers) and
  [places](#places)
- [Writing when questions remain](#writing-when-questions-remain)
- [Citations](#citations)
- [Narrative](#narrative) and
  [drafting with an AI assistant](#drafting-with-an-ai-assistant)
- [Illustrations](#illustrations), including the family charts
- [Design and layout](#design-and-layout)
- [Index](#index)
- [Front and back matter](#front-and-back-matter)
- [Editorial checks](#editorial-checks)
- [Publishing and donating copies](#publishing-and-donating-copies)
- [Keeping a stylesheet](#keeping-a-stylesheet)
- Appendices: [citation patterns](#appendix-a-citation-patterns) and
  [abbreviations](#appendix-b-abbreviations)

## How to read this guide

Most rules come from Penelope L. Stratton and Henry B. Hoff, *Guide to
Genealogical Writing* (NEHGS, 2014), cited by chapter as "Stratton and Hoff,
ch. 5". "The *Guide*'s style manual" means the style manual in that book.
Other rules come from published advice on family-history writing, named where
they appear, and from making the family history Flyleaf grew out of.

Where the *Guide* allows a choice, this guide gives a **recommended
default** and says what the alternatives are. Pick one and keep to it. The
*Guide*'s one firm rule is consistency (Stratton and Hoff, ch. 3).

Markers after a rule say who applies it:

- **(Flyleaf does this)**: the build produces it from your tree. You check
  that the tree holds what it needs.
- **(the build warns, L4)**: `flyleaf book` and `flyleaf coverage` print a
  warning with that code, and every build lists it in `book/COVERAGE.md`.
- **(the build stops)**: the book is not made until you fix it.
- **(the text check warns)**: the family-text check prints a warning. It
  looks for research wording in text that readers see. `flyleaf coverage`
  counts these warnings, and `flyleaf coverage --wording` lists them (see
  [the build's checks](#the-builds-checks)).

A rule with no marker is your job, or your assistant's.

This guide describes a way of working. Following it does not by itself meet
the Genealogical Proof Standard or any other standard. Whether research and
writing meet a standard is the researcher's judgement.

## The shape of the book

### An ancestor book

Flyleaf builds an ancestor book. It starts with one person, no. 1, and goes
back in time, father and mother in pairs. The *Guide* calls this an
ahnentafel, or ancestor table (Stratton and Hoff, ch. 1 and 2).

- **Ahnentafel numbers.** An ahnentafel is an ancestor table numbered so a
  father is twice his child's number and a mother twice plus one. Men have
  even numbers and women odd ones, except no. 1. (Flyleaf does this.)
- **What a number means.** A number names a place in the pedigree. Finding a
  parent fills an empty number and leaves the others alone. Correcting a
  parent can change who holds a number. When that happens, reread every
  story, chart and cross-reference that used the old number.
- **Account for every number.** The ancestor table at the back lists each
  unknown parent of a known ancestor as a blank line. Readers can see where
  the research stops. (Flyleaf does this.)
- **Repeated ancestors.** When cousins marry, one person can be reached by
  two lines. This is called pedigree collapse. The *Guide* lists the person
  in full once and has the later number refer back (Stratton and Hoff,
  ch. 2). Flyleaf gives the person one register entry headed with all their
  numbers, such as "52/76". With the default setting
  `book.repeated_ancestors: "once"`, the ancestor table and the charts list
  them, and their own ancestors, under the first number only. Later numbers
  say "see no. 52". (Flyleaf does this; see
  [family-folder.md](family-folder.md#book).) Keep the default for a deep
  tree; `"every_line"` repeats the whole branch under each number.
- **No generational superscripts or lineage lines.** In an ancestor table the
  numbers already trace the descent (the *Guide*'s style manual). (Flyleaf
  does this.)

Flyleaf builds ancestor books. The *Guide* also describes descendant books
in Register and NGSQ style, which number forward from an early ancestor
(Stratton and Hoff, ch. 2).

### Two parts, two kinds of reader

- **Part I, the Narrative,** is the family's story, in chapters you write.
- **Part II, the Register,** is generated from the tree: every ancestor with
  dates, places, marriages, children and sources.
- The *Guide* allows narrative chapters in the main body with the genealogy
  after them (Stratton and Hoff, ch. 6). Guides to family-history writing
  commonly recommend this combination: the story in front, the formal
  genealogy behind it.
- Part I serves a reader following the family story. Part II and the index
  serve a reader looking up one person. In Part I, repeat an identification
  where it helps the reader find their place, such as a number or a
  relationship. Do not retell a person's whole life each time they appear.

**Register order.** The *Guide*'s ahnentafel runs in one numeric sequence:
1, 2, 3 and on. Flyleaf groups the register into the same chapters as Part I
and lists each chapter from the oldest generation to the youngest. A reader
who finishes a chapter finds its entries together. Every entry keeps its
number, and the ancestor table at the back gives the strict numeric order.
(Flyleaf does this.)

### Two shapes for the stories

Published family histories use two shapes, and Flyleaf supports both:

- **One section per couple,** walking each line from the oldest generation
  to the youngest. `flyleaf scaffold` starts one story per couple: the
  husband's file covers both spouses.
- **One continuous account** that follows households across generations,
  with headings you write. Set `continuous: true` in the story's settings
  ([book.md](book.md#stories-booksketches)).

A third shape opens with a narrative life of one central person and puts
the formal genealogy after it. In Flyleaf, write that person's story in the
chapter that `book.yaml` lists first.

### Chapters

A chapter groups family lines. For a descendant book the *Guide*'s default
is a chapter per generation. For an ancestor book a chapter per group of
lines works better: a reader can follow one family from its earliest record
to the present. [book.md](book.md#bookbookyaml) explains how Flyleaf
assigns each ancestor to a line.

- **Titles.** Name the families and the places: "Penhallow and Treloar: From
  St Just to the Lead Region". Flyleaf prints "Chapter 1." and the whole
  title in capitals at the top of each right-hand page. After you change a
  title, look at a right-hand page and shorten the title if it crowds the
  line.
- **Order.** Flyleaf prints the chapters in the order `book.yaml` lists
  them. A common order starts with the line the family knows best or the
  best-documented, and ends with the present generation. Some writers put the
  most interesting chapter first and the next most interesting last (Hazel
  Edwards). Choose for your readers.
- **Parallel lines.** Treat parallel lines the same way, and bring each one
  to the same generation where the evidence allows (Stratton and Hoff,
  ch. 7).

### Stories and their status

- Every ancestor is covered by exactly one story; the build stops when two
  stories cover the same person. A distant ancestor known from one record
  does not need a story of their own. Add them to the `covers` list of the
  story that mentions them.
- A story has a status: `stub`, `draft` or `final`. A stub prints a short
  note that an account is in preparation, with a link to the register entry.
  (Flyleaf does this.)
- Move a story to `final` only after the claim audit in
  [review.md](review.md).
- When the tree record of anyone a story covers changes, the story goes
  stale. Flyleaf prints a notice at the head of that story in the PDF,
  saying the records have changed since it was written. (Flyleaf does
  this.) Reread the story against the new record, then run
  `flyleaf coverage --mark <id>` before you share the book
  ([book.md](book.md#keeping-stories-current)). `--mark` takes one
  person's id. For a couple's story, run it once for each of them.
- Flyleaf watches for changes only to people it has a record of. `flyleaf
  scaffold` records the people of each story it creates. A story you made
  by hand is tracked only after you first mark each person it covers.
- Flyleaf heads each story with the names and years, and a line that gives
  the relationship to the book's subjects, such as "Paternal
  great-great-grandparents of Jory, Tamsin, and Nora". (Flyleaf does this.)
  `title:` replaces the names with your own heading, such as "John and
  Elizabeth". A continuous story has no heading from Flyleaf; you write its
  headings.
- Flyleaf never rewrites a story file. `flyleaf scaffold` only creates the
  files that are missing. Everything in `build/` is replaced by each build,
  so make every correction in your own files or the tree.

## The register entry

Flyleaf writes Part II from the tree. You shape it through the tree: the
names, events, places, dates and citations you record. This section says
what Flyleaf prints, and what the tree needs for it to print well. It follows
the ancestor-table entry in the *Guide*'s style manual.

Here is no. 16 from Flyleaf's sample family, as the register prints it.
Small capitals are shown as capitals, and footnote numbers are left out.

    16. JOHN PENHALLOW

    JOHN PENHALLOW was born at St Just in Penwith, Cornwall, England, about
    1845 and was baptized at St Just in Penwith, Cornwall, England, 6 April
    1845 and died at Mineral Point, Iowa County, Wisconsin, USA, 3 March
    1912. Burial was recorded at Mineral Point, Iowa County, Wisconsin, USA,
    6 March 1912.

    He married at Penzance, Cornwall, England, 9 October 1866, ELIZABETH ANN
    TREMBATH [no. 17].

    Children of John and Elizabeth Ann (Trembath) Penhallow:
         i. RICHARD JOHN PENHALLOW, b. 2 Sept. 1867; d. 1868.
        ii. MARY JANE PENHALLOW, b. ca. 1870; d. 1950.
    8  iii. WILLIAM HENRY PENHALLOW, b. 14 Feb. 1878.

### What Flyleaf prints

- **One entry for each person.** Each spouse has their own numbered entry,
  the man first and the woman next (2n, then 2n + 1). (Flyleaf does this.)
- **The heading.** The number and the name, in bold small capitals.
  (Flyleaf does this.) A small line under the heading links to the person's
  story in Part I and to their further references.
- **Order of facts.** Birth, then baptism or christening, then death, then
  burial or cremation, then marriage. (Flyleaf does this.)
- **Place before date.** The *Guide*'s style manual prefers this order in
  ancestor tables: "born at Mineral Point, Iowa County, Wisconsin, 14
  February 1878". (Flyleaf does this.)
- **"At" a town, "in" a larger area.** "Born at Mineral Point", "born in
  Iowa County, Wisconsin", "born in Norway". (Flyleaf does this.) Flyleaf
  writes "in" before:
  - a country, US state, province or older region named on its own: "in
    Norway", "in Wisconsin, USA", "in Prussia";
  - a place whose first part is a county, township, colony, province or
    territory: "in Iowa County, Wisconsin, USA".

  It writes "at" before anything else, so "Cornwall, England" would print
  as "at Cornwall, England". Add regions like this, such as "Cornwall" or
  "Yorkshire", to `places.region_names` in `flyleaf.json`. The build then
  also warns when a story says "at" before one of them (the build warns,
  L12).
- **Burials.** A burial has its own date, place and citation. Flyleaf prints
  three kinds of burial:
  - a recorded burial (`BURI`): "Burial was recorded at …";
  - a reported burial, such as one known only from a memorial website
    (`BURI` with `2 TYPE Reported burial`): "Burial is reported at …";
  - a planned burial from a death notice (`EVEN` with `2 TYPE Planned
    burial`): "Burial was planned at …".

  Record each kind as what it is. Do not give an undated burial the death
  date. A gravestone in a cemetery does not prove the person is buried
  beneath it.
- **Two records of one event.** When the tree has two births or two deaths,
  Flyleaf prints the first with its own notes, then "Birth was also recorded
  at …" with the other's notes (see [gedcom.md](gedcom.md)).
- **The marriage.** The man's entry carries the marriage and names the wife
  in bold small capitals with her number. A woman's entry carries it only
  when her husband has no entry of his own. (Flyleaf does this.)
- **Divorce.** "Their divorce was recorded at …", with its own citation.
  (Flyleaf does this.) The court's place is where the divorce was granted.
  It does not show where the couple lived.
- **Several marriages.** The families in a tree may not be a complete
  marriage history. Flyleaf names each recorded spouse without calling a
  marriage "first" or "second". (Flyleaf does this.) Keep an ordinal that a
  source states in that source's citation. Do not work one out from the order
  of families in the tree.
- **The subject restated.** After a list of children, Flyleaf names the
  entry's subject again before the next marriage, so the last child named
  cannot seem to be the one marrying. (Flyleaf does this.) Follow the same
  rule in your stories: write "He married" only straight after a clear
  mention of him.
- **A family link with no marriage.** When the tree links two people as a
  couple but records no marriage, Flyleaf does not claim a marriage. In a
  numbered ancestor's entry it writes "Partner:". Under a "Family of …"
  heading it writes "The family record links … and …; no marriage event is
  recorded." (Flyleaf does this.) Record a marriage event only where a
  record shows one.
- **Footnotes on facts.** A citation under a birth, baptism, christening,
  marriage, divorce, death, burial or cremation prints as a footnote on that
  fact. Other citations print in "Sources for the Register", grouped by
  family and entry number, with page links both ways. (Flyleaf does this.)
  A reference listed there does not prove every fact in the entry.
- **Confidence levels.** The person's confidence level (`_CONFLEVEL`) does
  not print. Readers judge the evidence from the footnotes and the Sources
  for the Register. The first full citation of each source ends with its
  kind in italics, such as "(Primary record.)". (Flyleaf does this.)
- **Dates.** "ABT", "BEF", "AFT" and "BET … AND" print as "about",
  "before", "after" and "between … and". A date the tree marks as Julian
  prints with "(Julian)" after it. (Flyleaf does this.)
- **Only vital events.** The register prints births, baptisms,
  christenings, deaths, burials, cremations, marriages and divorces.
  Occupations, homes, military service and migration belong in your story;
  their citations print in the Sources for the Register.

### What the tree needs

- **Places spelled out in full.** The register prints each place exactly as
  the tree holds it. Write "Shelby County, Indiana", not "Shelby Co., IN".
  The build warns about two-letter state codes in the places of the book's
  people (the build warns, G1).
- **No comments in place names.** Two notes are allowed in a place, because
  Flyleaf knows how to print them:
  - `(now Oslo)` after a historic name: "Christiania (now Oslo), Norway";
  - `(likely)`, `(probably)`, `(possibly)` or `(perhaps)` at the end, for an
    uncertain place. Flyleaf prints "probably at …" or "possibly at …".

  Put any other comment in a `NOTE`. The build warns about other brackets in
  a place (the build warns, G3).
- **Each citation under its fact.** Cite a baptism under the baptism, not
  under the person. See [gedcom.md](gedcom.md#sources-and-citations).
- **Children in the right order.** See the next section.

## Children lists

Flyleaf prints the children of each couple after the marriage, in the form
the *Guide*'s style manual sets out.

- **The introduction** restates both parents: the father's given names, the
  mother's given names with her maiden surname in brackets, and the shared
  surname once: "Children of John and Elizabeth Ann (Trembath) Penhallow:".
  When a parent has a suffix such as Jr., Flyleaf writes both parents' full
  names, so the suffix stays with the right person. (Flyleaf does this.)
- **One child** is introduced as "Recorded child of …", since one recorded
  child does not mean an only child. (Flyleaf does this.)
- **Numbering.** Children appear in birth order with lower-case roman
  numerals. A child who is also an ancestor has their ancestor number in bold
  before the numeral. (Flyleaf does this.)
- **Undated children.** When any child lacks a birth or baptism year,
  Flyleaf keeps the order the tree gives and adds "(listed in recorded
  order)". It never moves an undated child to the end. (Flyleaf does this.)
  Put the children in the tree in the order the records support. Do not
  invent a date to place a child.
- **Baptism years.** When some children are ordered by baptism year because
  their births are unknown, Flyleaf adds "(ordered by recorded birth or
  baptism year; birth order uncertain)". (Flyleaf does this.)
- **Type and page breaks.** The introduction and list are set in smaller
  type. The introduction stays with the first child, each child's line stays
  whole, and a list of up to three children stays together. (Flyleaf does
  this.)
- **Abbreviations.** Child lines use the short forms: `b.` born, `bp.`
  baptized, `chr.` christened, `d.` died, `bur.` buried, `crem.` cremated,
  `ca.` about, `bef.` before, `aft.` after. Months of six or more letters
  are shortened: Jan. Feb. March April May June July Aug. Sept. Oct. Nov.
  Dec. Semicolons separate the events. (Flyleaf does this.)
- **A child who is an ancestor** shows only birth and baptism. Everything
  else is in their own entry. (Flyleaf does this.)
- **A child who is not an ancestor.** The *Guide* gives everything known
  about such a child, including education and work. Flyleaf's child lines
  give each event's date, and its place only when there is no date; a
  burial gives both. Tell a child's fuller story in Part I, in their
  parents' story.
- **Adopted and foster children.** Record each set of parents with `FAMC`
  and `PEDI` ([gedcom.md](gedcom.md#parents)). Flyleaf marks "adopted" or
  "foster child" in that family's list, and numbers the birth parents as
  ancestors when the tree records them. (Flyleaf does this.) The *Guide*
  notes adoption in the introduction instead ("Adopted children of …").
  Say how the child joined the family plainly in the story.
- **Twins.** Flyleaf does not mark twins. Say so in the story. In child-style
  text you write yourself, put "(twin)" after the name. Child-style text is
  the short form a list of children uses, with abbreviations such as `b.`
  and `d.`, as in the child lines above.
- **Families of other relatives.** Flyleaf continues the recorded families
  of a numbered person's other children under unnumbered "Family of …"
  headings, with their marriages, spouses and children. A spouse's separately
  recorded children are continued too. These continuations do not change any
  ancestor number. They do not claim that every child has been found, and
  they do not bring in a spouse's own ancestry. (Flyleaf does this.)

When you write child-style text yourself, such as in an appendix:

- use the state abbreviations in [the appendix](#states) and "Co." for
  county. Do not use two-letter postal codes;
- write `m. (1) …; m. (2) …` only when the order of the marriages is
  supported by the records.

## Names

These rules follow the *Guide*'s style manual.

- **First mention.** Use the full name, first, middle and last, the first
  time a person appears in a story. After that, use the given name: "John",
  not "Penhallow". `#refp` prints the full name and the register number, so
  use it at the first mention.
- **Nicknames.** Put a nickname the records support in quotation marks after
  the middle name: Robert John "Bob" Penhallow. Record it in the tree with
  `NICK`. The register does not print nicknames; your story does.
- **Suffixes.** No comma before Jr., Sr. or III, unless the person wrote one
  (the build warns, L7). Flyleaf prints a suffix recorded in the tree after
  the name, without a comma. (Flyleaf does this.)
- **Married women.** Introduce a woman by her maiden name: "Edith May Rowe".
  Once her husband has been introduced, the married form puts the maiden name
  in brackets: "Edith (Rowe) Penhallow". A woman married more than once
  carries each earlier surname in its own brackets, with a space between
  them: "Hannah (Pell) (Ashby) Cole".
- **Unknown names.** Write an unknown name as five underscores: "Mary
  (\_\_\_\_\_) Treloar". In a story, type each underscore with a backslash
  (`\_\_\_\_\_`), because a bare underscore starts italics in Typst. In the
  tree, leave the unknown part empty (`Mary //`). `flyleaf import` turns
  underscores in names into spaces. Flyleaf prints "\_\_\_\_\_ \_\_\_\_\_"
  for a person with no name at all, and prints a partly known name as the
  tree has it.
- **Doubtful names.** Put a doubtful whole name in square brackets with a
  question mark: "\[Hester Quayle?\]". Put a question mark before a doubtful
  part: "Hester (?Quayle) Ashby". In a story, type the square brackets with a
  backslash: `\[Hester Quayle?\]`.
- **Titles.** Recommended default: leave out professional titles such as
  Dr., Rev. and Judge when you introduce a person. The alternative is to use
  them, every time. Either way, be consistent.
- **Spellings.** Choose the spelling the records use most as the main form.
  Quote a record's own spelling exactly, with missing letters in square
  brackets: "Will\[ia\]m". Use a slash where the person really used two
  spellings, with a note to explain: "Ashby/Ashbee". Mark a misspelling
  in a record with quotation marks, "\[sic\]" or a footnote.
- **Alternate names in the tree.** Record each alternate spelling or name as
  another `NAME` line. Flyleaf indexes it with the same numbers. (Flyleaf
  does this.)
- **Name drift.** The build warns about a capitalised word one letter away
  from a name in the tree that the tree never uses, such as "Elisabeth" in a
  tree that spells it "Elizabeth" (the build warns, L16). AI assistants tend
  to move names toward common spellings. Check every name against the tree.

## Dates and numbers

These rules follow the *Guide*'s style manual.

### Dates

- **Day, month, year:** "23 May 1951". No comma in a month and year: "May
  1951". No ordinals: "23", not "23rd". Flyleaf prints the register this
  way. (Flyleaf does this.) The build warns about month-first dates and
  ordinal numbers in stories (the build warns, L4 and L5). Dates inside
  quotation marks are left alone, since a quotation follows its record.
- **Centuries** are spelled out: "the nineteenth century" (the build warns,
  L5, on "19th").
- **Qualifiers** are words in running text: "about 1847", "before 1868",
  "after 1912". (Flyleaf does this in the register.)
- **Ranges.** Recommended default: full years, "1934–1986". The alternative
  is the last digits, "1934–86". Use an en dash. Flyleaf prints full years
  in story headings and charts. (Flyleaf does this.)

### Double dating

Before 1752, England, Wales, Ireland and the British colonies began the
year on 25 March. A date from 1 January to 24 March before 1752 belonged to one year in
the old reckoning and the next year in ours.

- Give both years: "14 February 1731/32".
- In the tree, GEDCOM writes the second year with two digits: `14 FEB
  1731/32`. The register prints it that way. Use the same form in your
  stories. Some writers use one digit ("1731/2"); pick one form.
- An inferred second year goes in square brackets: "1731\[/32\]". An
  uncertain one adds a question mark: "1731\[/32?\]". In a story, type the
  brackets with a backslash.
- Explain double dating in the front matter if your book uses it.
- The build warns about a January to March date before 1752 without both
  years, in the births, deaths and marriages of the book's people (the build
  warns, G2).
- Other places changed earlier. Scotland began its year on 1 January from
  1600, and much of continental Europe moved to the Gregorian calendar long
  before 1752. Keep such a date as the record gives it. Where the calendar
  matters, record it in the tree (`@#DJULIAN@`); Flyleaf prints "(Julian)"
  after the date. (Flyleaf does this.)

### Quaker month numbers

Members of the Society of Friends wrote months as numbers. Before 1752 they
counted March as the first month.

- So the 9th month of 1730 is November 1730, and the 11th month of 1700 is
  January 1700/01.
- Later compilers often printed these numbers as calendar months. When a
  compiled source gives a calendar month for a Quaker family, check it
  against any source that keeps the month number. Note any conflict.
- Some compilations made long afterwards counted the months from January,
  even before 1752. Find out how a compilation counted before you convert its
  dates.
- When a date before 1752 rests on such a compilation alone, give the year
  and note both readings.
- Records written at the time, such as the meetings' own registers, keep the
  old count.

### Numbers

- Spell out numbers up to ninety-nine. Use numerals for 100 and above, for
  measurements and for percentages. Do not start a sentence with a numeral.
  The build warns about small counts written as numerals, such as "3
  children" or "12 miles" (the build warns, L13).
- **Ages.** Recommended default: spell ages out in the stories, like other
  numbers under one hundred: "aged forty-three", "at ninety". The *Guide*
  uses numerals for ages in register data, and numerals suit child-style
  text you write yourself.

## Places

These rules follow the *Guide*'s style manual.

- **As specific as you can confirm.** Town, county, state or country. Give
  only as much as the records confirm.
- **Spell everything out** in stories and in the tree. Abbreviate states
  (see [the appendix](#states)) and "Co." only in child-style text and in
  citations. The build warns about two-letter state codes in stories (the
  build warns, L11) and in the tree (G1).
- **Commas** go between town, county and state. Recommended default: use the
  serial comma throughout ("Cornwall, Wisconsin, and Minnesota").
- **Full name first, short name after.** Give the full place at its first
  mention in a story. After that, use "there" or the town alone.
- **Historic names.** Give the modern name at the first mention:
  "Christiania (now Oslo), Norway". This is the recommended default.
- **Boundaries.** Name the county or country as it was at the time of the
  event. Where a boundary changed and it matters, say so once.
- **"At" and "in."** "At" a town or a cemetery, "in" a county, state,
  country or region. See [the register entry](#what-flyleaf-prints).

## Writing when questions remain

Gaps in the evidence should not stop the writing. Write what is known, and
say plainly what is not (Stratton and Hoff, ch. 4).

- **Qualify uncertainty** with "probably" or "perhaps". Put the certain fact
  before the uncertain one: "born about 1847, probably at Camborne".
- **Show the reasoning in brackets** when a date is worked out:
  - "Thomas Ashby and Martha Pell married before 3 May 1761, when their
    first child was baptised."
  - "Martha died between 14 June 1790, when she signed her will, and 9
    August 1790, when it was proved."
- **Say when a problem is unsolved.** State it as unsolved, and ask the open
  questions in the text, or gather them in an Open Questions chapter.
- **Do not present a guess as proved.** Never call an identification proved
  when it has not been. Do not cite a later writer who repeated your guess as
  if they confirmed it (Stratton and Hoff, ch. 12). The build warns about
  words of certainty such as "undoubtedly", "certainly", "it is certain",
  "beyond doubt" and "definitively" (the build warns, L15). Rewrite the
  sentence to match the evidence.
- **A record that matches is not proof.** When a birth, marriage or death
  entry is tied to your person only by name, place and date, write "probably
  the Hester Quayle baptised at …" and cite whatever makes the link, such as
  a household, a will or a compiled genealogy. Drop "probably" only when a
  record itself names the relationship.
- **Name the source as it is.** An index is not the record it indexes.
  Write "the index to her death certificate names her parents", not "her
  death record names her parents", unless you read the certificate. A
  newspaper notice transcribed on a memorial website is credited as copied
  there.
- **A place must be stated.** Do not give a birth, death or court act the
  family's home town because a compiler heads the entry with it. Record a
  place only where the source places that event. Check who acted, such as a
  colonial court or a town meeting, before you say where.
- **Keep every conflicting record.** Cite both, say which you follow, and
  say why. The sample family's arrival is dated 1867 by a county album and
  1868 by the passenger list and the obituary. The story follows 1868 and
  explains that the list was made at the time.
- **Infer with care.** For a person with few records, careful inference
  ("likely", "may have") with the evidence in a footnote is better than
  silence or invention.
- **Phrase limits against the records.** "Her maiden name is not known" is
  fine. "Her maiden name has not been verified" describes the research, not
  the family (the text check warns on "has not been verified",
  "identified", "located" and similar).
- **Say whose memory it is.** Write "Ruth remembered that …", not "the
  family remembers" (the text check warns on "family remembers", "family
  tradition holds", "family lore" and "according to the family").
- **Keep a needed qualification.** The text check's warnings are prompts to
  reread, not rules to obey. "According to his obituary, he was born in
  Cornwall" names a source plainly, and is better than a flat claim the
  evidence does not support. Keep it, and note in your claim audit that you
  reviewed the warning.

### Living people

You may include living relatives, as the *Guide* allows (Stratton and Hoff,
ch. 4). Write about them only from what they have shared and from public
records.

- Tell each living person that the book will include them, before you share
  it.
- Give at most a birth year. Leave out addresses, health and anything they
  ask you to leave out.
- See [relatives.md](relatives.md) and
  [research-standards.md](research-standards.md) for more.

## Citations

Every fact needs a source. These rules follow Stratton and Hoff, ch. 5, and
the *Guide*'s style manual.

### What to cite

- **Cite every statement of fact** that is not common knowledge.
- **Prefer the original when it matters.** A good secondary source is
  sometimes the better citation. When a point is crucial, cite the original
  record rather than an abstract of it.
- **Cite records, not finding aids.** An index or an abstract database helps
  you find a record. Find the record it points to and cite that (Stratton
  and Hoff, ch. 5 and 12).
- **Cite in two layers for online images.** First the original record, as
  if you held it: the register, volume, page and entry. Then where you saw
  it: the database, the website and the image number. Keep the two apart
  (Elizabeth Shown Mills, *Evidence Explained*, QuickLesson 25).
- **Cite so the record can be found when the link dies.** Give the
  collection's title and the volume, page, image, film or certificate
  number. A web address alone is not enough.
- **FamilySearch links.** FamilySearch supports only its ARK links (those
  containing `ark:`). The build warns about other FamilySearch record links
  in the book's sources (the build warns, G4).
- **AI transcription.** When an AI tool transcribed or translated a record
  that a claim rests on, say so in the citation's note, with the tool and
  the date.

### Where the note goes

- **Place the note after the fact,** or at the end of the sentence. In the
  register, each fact has its own note. (Flyleaf does this.) In the stories,
  put a `#src` at the end of each sentence that states a fact.
- **One note, one source.** A single note must never cover claims drawn
  from several sources. When a paragraph draws on a gravestone, an obituary
  and a census, each claim gets its own note at its own sentence.
- For example, write this, with the census and the obituary each cited at
  its own sentence:

      In 1880 the census found John working as a miner at Mineral
      Point.#src("john-census-1880") For more than thirty years he worked
      in the lead and zinc mines around the town.#src("john-mining-years")

  and not one `#src` after both sentences.
- **Two sources for one sentence** take two calls side by side:
  `#src("a")#src("b")`. Flyleaf prints a comma between the two note numbers.
  (Flyleaf does this.)
- The build warns about a paragraph of more than 90 words with no citation
  (L1) and a sentence that gives a year and cites nothing (L2).

### How the note reads

Flyleaf builds each footnote from the source record in the tree
([gedcom.md](gedcom.md#sources-and-citations)):

- **The first time** a source is cited, the note prints its title (`TITL`),
  the citation's locator (`PAGE`), any citation note (`NOTE`), "viewed at"
  and the website's name as a link when the source has a `_URL`, and the
  kind of source in italics. (Flyleaf does this.)
- **Later notes** print the short title (`ABBR`) with the locator. In the
  register, a later note can add where the full form is, such as "(cited in
  full at no. 16)". (Flyleaf does this.)
- So write `TITL` as the full citation you want readers to see first, and
  `ABBR` as its short title. A source with no `ABBR` repeats its full title
  in every later note. Keep a list of your short titles in your
  [stylesheet](#keeping-a-stylesheet).
- **No "ibid."** Genealogical notes use short titles instead (the build
  warns, L8).
- **Online sources** name the site, not the web address: "viewed at
  FamilySearch.org". Links change. (Flyleaf does this.) Keep web addresses
  out of the stories (the build warns, L9).
- **Italics.** Flyleaf prints a source's title from the tree as plain text.
  It cannot italicise part of it. Quotation marks you type in `TITL` do
  print. The italic forms below apply to notes you write yourself with
  `#footnote[...]`, where `_..._` sets italics.
- **A citation is not a research log.** A source's `TITL`, and a
  citation's `PAGE` and `NOTE`, print in the book. Keep research notes, such
  as "read in full" or "checked again", out of them: put them in a `NOTE` on
  the person, or in your research log. A note on the source record is not
  printed in the book, but the website sends it to readers' browsers
  ([research-standards.md](research-standards.md#where-notes-appear)).
  The tree check warns (`[PROCESS-IN-LABEL]`) about a few built-in phrases,
  such as "image queued", and about any phrase you list in
  `text_checks.source_process_phrases`. List your own shorthand there
  ([family-folder.md](family-folder.md)).
- **User names.** Leave a website member's user name out of the citation
  text. Write "posted by a member" or "member-contributed". Flyleaf replaces
  a user name written after the word "user" in brackets, such as `(user
  mapleleaf22)`, with "(member-contributed)". (Flyleaf does this.) Keep the
  user name in your research notes, so you can find the posting again.
  Credits with real names do print: "Photograph by …", "courtesy of …".
- **Footnotes can say more than where.** A footnote can evaluate a source,
  add a short remark, or say that your conclusion differs from an earlier
  published account. Write it with `#footnote[...]` in the story. The text
  check skips footnotes, so this is the place for discussion of evidence.

### Forms for each kind of source

[Appendix A](#appendix-a-citation-patterns) gives a pattern for each kind.

- **Censuses.** Keep the note short: year, place, sheet or page, household,
  and where you viewed it. A census needs no short form. Recommended default:
  leave census schedules out of the bibliography. List them in
  `book/bibliography-policy.json`; Flyleaf then keeps them in the notes and
  the Sources for the Register only, and says so at the head of the
  bibliography. (Flyleaf does this.) The file looks like this:

  ```json
  {
    "schema": 1,
    "description": "Census sources left out of the bibliography on purpose.",
    "census_sources": [
      {"source_id": "@SRC_US1880@"},
      {"source_id": "@SRC_US1930@"}
    ]
  }
  ```

  Each entry names one source record by its id in the tree, the `@…@` on
  its `0 @…@ SOUR` line. `schema` stays 1. `description` is a note for you.
  If an entry matches no source in the tree, the build stops.
- **Vital records.** Put the place first: "Town, State, Vital Records,
  volume:page."
- **Manuscripts.** Title in quotation marks, not italics, then the
  repository and the call number.
- **Newspapers.** Article title in quotation marks, newspaper in italics.
  If the place is not in the newspaper's title, add it in square brackets.
- **Databases.** Recommended default: database titles in italics, website
  names in plain type.
- **Family sources:** "Email from \[name\] to \[name\], \[date\]."
  "Questionnaire supplied by \[name\], \[date\]." "Ruth Solberg, interview
  by Tamsin Penhallow, Madison, March 2023; recording held by \[holder\]."
  Flyleaf sorts a source titled with "questionnaire supplied", "interview
  by", "oral history" or "family Bible" as family testimony. (Flyleaf does
  this.) Give emails, letters and other family sources `_TIER
  family-testimony` in the tree, so they are sorted the same way
  ([research-standards.md](research-standards.md)).

### The bibliography

The *Guide* calls a bibliography helpful but not essential. Flyleaf makes
one from the sources the book cites, each listed once, grouped by kind of
source, and in alphabetical order of title within each group. (Flyleaf does
this.) It prints the source's `TITL` as written. The *Guide*'s separate
bibliography forms do not apply to it: the first author's name inverted,
five underscores for a repeated author, and every author named where notes
give "et al." for four or more.

## Narrative

Part I should read as a connected family history. These rules draw on
Stratton and Hoff, ch. 6 and ch. 2, and on the writers named below.

### What Part I is for

- Follow households, relationships, work and moves across the generations.
- Bring an allied family, one that a direct ancestor married into, into
  the account where its marriage or household matters.
- Do not restart with a birth-to-death sketch every time a new ancestor
  appears. Part II already gives every ancestor complete coverage.
- Use plain, concrete sentences. Report documented events plainly, without
  telling the reader how to feel about them.
- Leave out decorative landscape, stories about what a surname means,
  claims of destiny, and repeated assurances that the book is candid or
  carefully sourced.
- Connect what the evidence connects. Do not supply a motive, or a cause,
  because two events happened close together.
- Give women, household work, education and ordinary family life the space
  the evidence allows.
- Describe each relationship as the records show it, in plain words:
  marriages, partnerships, adoptions, fostering and step-families. Treat
  both partners of a couple alike.

Here is the voice, using the sample family (citations left out):

> In October 1866 John Penhallow, a tin miner from St Just, married
> Elizabeth Ann Trembath at Penzance. Their first child, Richard John, was
> born there the next September.
>
> In the spring of 1868 the three of them sailed for America. They reached
> New York in May, bound for Wisconsin. Richard died at Mineral Point later
> that year.
>
> John worked in the lead and zinc mines around Mineral Point for more than
> thirty years. In 1880 he and Elizabeth had two children at home, Mary Jane
> and William Henry.

### Voice

- Third person. The build warns about first-person forms such as "I am",
  "I was", "I found" and "my" (the build warns, L10). An editorial "we" is
  acceptable, used sparingly.
- Active voice, plain words, short sentences, one topic to a paragraph.
- Do not explain complicated kinship in prose. Use a chart, or the register
  numbers that `#refp` prints.

### Structure

- **Start from chronology.** Rearrange by theme where that helps the reader.
- **Open with the strongest documented event or situation.** A birth date
  is a good opening when it begins the actual story. A chapter does not need
  an invented scene, mystery or conflict.
- **Make the links between generations clear** in the transitions. End a
  chapter with a short bridge to what follows (Daniel J. Tortora).
- **Vary the distance.** Give a well-documented moment the space it needs,
  and summarise the years between (Sharon DeBartolo Carmack, *You Can Write
  Your Family History*). Do not add sensory details or thoughts to make the
  reader feel present. Let paragraph length follow the idea.
- **Present choices as open.** Emigrating, enlisting or moving west was an
  open choice at the time, with something at stake (David Hackett Fischer).
  Say what the records show about the circumstances. Do not supply the
  reasons.
- **Use a through-line where the records offer one.** An heirloom, a farm,
  a document that recurs, or a household's work can connect events across
  generations (Edmund de Waal, *The Hare with Amber Eyes*). In the sample,
  the family Bible and a typed recipe booklet do this.
- **Keep context tied to the person.** Use social history only where it
  explains this family. Leave out general history lessons. A story that runs
  across several lines, such as several generations in one trade or a shared
  homeland, belongs in a chapter introduction or a chapter of its own. When a
  story names a year that is not in its people's records, such as the year of
  a war, list it in `context_years` ([book.md](book.md)).
- **Chapter introductions are roadmaps.** An introduction may name the
  people, the places and the chapter's shape. It may add one thing of its
  own, such as a record that confirms a family memory. It does not tell a
  story that a section after it tells. The sample's two chapter
  introductions show the pattern.

### Tell each event once

Two sections can each read well and still repeat each other when read
together.

- Tell each shared event in full in exactly one section: the story of the
  person whose record documents it.
  - A marriage belongs to the younger couple's story.
  - A house belongs to its builder's story, or its longest owner's.
  - A migration belongs to the story of the person who made it.
- Every other section that touches the event gets one clause at most, and a
  cross-reference. In the sample, John and Elizabeth's emigration is told in
  their story (no. 16). William's story says he was "the youngest child of
  John Penhallow (no. 16) and Elizabeth Ann Trembath (no. 17)" and moves
  on.
- Before you tell an event in full, search the book folder for its key
  words: the names, the place, the year. If another section already tells
  it, cross-refer to that section. An assistant should run this search
  before drafting.

### What to include

- **Topics.** Education, military service, work, homes, and personal
  details the records give.
- **Land records and wills.** Say you consulted the record, give its date,
  and summarise its main points. Put a full transcription in an appendix.
  Report a search that found nothing as well: "No will is recorded for him
  in the county's probate records."
- **Censuses.** Report patterns, not every enumeration. Each census finds
  everyone ten years older. Look for a pattern, or for something new: a
  farm bought, a trade changed, a relative living in. When a census detail
  overturns accepted research, give it in full.
- **Quotations.** Transcribe exactly. Paraphrase honestly. Set a quotation
  longer than about five printed lines as an indented block, without
  quotation marks:

      #block(inset: (left: 1.5em, right: 1.5em))[
      The quoted text, exactly as the record gives it.
      ]

  The build notes long quotations in quotation marks (the build warns, L14,
  as information).
- **Transcription policy.** Say in the front matter whether quotations keep
  the original spelling and punctuation or correct them (Clarke Historical
  Library, *A Guide to Editing and Publishing Family Manuscripts*).
- **Copyright of quoted text.** In the United States, works published 95 or
  more years ago are in the public domain. Each 1 January another year's
  works join them: in 2026, works published in 1930 or earlier. Check the
  line before you borrow text. Short quotations with a citation are usually
  fair use. When in doubt, ask permission. Rules differ for unpublished
  writing and in other countries. For pictures, see
  [photos-and-documents.md](photos-and-documents.md).

### Keep the research out of the story

The story tells the family's history. The research has its own places: the
research log (`research/log.md`), the methods chapter, and the Open
Questions chapter.

- **Leave out how facts were found.** Do not describe the book's own past or
  the research behind a fact: "found only as this book was being finished",
  "a line this book could not name until recently". State what the records
  show and cite them.
- **Leave out research plans.** Do not name the next record to consult, say
  what a future search would show, or describe where the research stands.
  "Her baptism in the Camborne registers would settle this" belongs in Open
  Questions, not in a story.
- **Evidence limits are fine,** phrased against the records: "her maiden
  name is not known", "the conflict remains", "the earliest Penhallow the
  records name".
- **Open Questions.** Gather unsolved problems, and the records that might
  help, in a back-matter chapter titled exactly "Open Questions". Flyleaf
  then points readers to it from the ancestor table. (Flyleaf does this.)
  List it, and your methods chapter, in `book.research_sections` in
  `flyleaf.json`, so the text check only warns there
  ([family-folder.md](family-folder.md#book)).
- An AI assistant's drafts often end with research talk such as "further
  research is needed". Remove it.

### Plain language

- **No metaphors or poetic figures.** Say the literal thing. Write "the
  Penhallow and Solberg families joined when David and Karin married in
  1993", not "two rivers met in Madison". A sentence a reader could take
  literally and be puzzled by fails this rule.
- **No nostalgia.** Leave out the sepia tone, "a simpler time" and elegiac
  generalisation. Use precise, documented detail instead (Edmund de Waal).
- **No invented dialogue or thoughts.** Build the world around a person from
  the records that survive, and infer with care (Annette Gordon-Reed, *The
  Hemingses of Monticello*).
- **No unsupported adjectives.** Words such as "prosperous" and "devout",
  and links such as "so they moved", often add claims the source does not
  make. The claim audit in [review.md](review.md) checks for them.

### Length

There is no fixed length. Each paragraph should earn its place.

- Many family readers prefer shorter books. Practitioners report that most
  family histories run 30,000 to 60,000 words, and that more photographs can
  make up for shorter text.
- A 6 × 9 inch page holds roughly 300 words.
- Some families make a short reading edition and a fully cited edition.
  Flyleaf builds one edition. Its notes sit at the foot of each page, where
  a reader can skip them.

### Saying that an AI assistant helped

Readers deserve to know how the book was made.

- In the front matter, include a plain statement of methods and tools. Name
  the AI tools, say what they did, and say that the compiler checked the
  work and is responsible for every conclusion.
- Where an AI transcription or translation supports a claim, the citation's
  note says so, with the tool and the date.
- Keep the statement current as the tools change. Do not soften it.

A statement might read: "Drafts of these stories were prepared with an AI
assistant (name and version), working from the records cited. \[Compiler's
name\] checked every statement against those records and is responsible for
the conclusions."

## Drafting with an AI assistant

[book.md](book.md#writing-with-an-ai-assistant) gives the working loop.
For writing, give the assistant:

- this guide and your [stylesheet](#keeping-a-stylesheet);
- the story file, and the output of `flyleaf sources <id>` for each person
  it covers;
- the records themselves, or your transcriptions.

Ask it to:

- cite every fact with `#src`, one source to a note;
- add nothing the records do not say: no motives, dialogue, thoughts or
  adjectives the sources do not support;
- qualify uncertain facts with "probably" or "perhaps";
- search the book folder before telling a shared event;
- keep the research out of the story.

Then check the draft yourself:

- every name against the tree (L16 helps);
- every year against the records (L3 helps);
- every adjective and every "so" or "because";
- the warnings from `flyleaf coverage`.

The assistant does not approve its own drafts. Leave the status at `draft`
until a person has read the story against the records.

## Illustrations

These rules follow Stratton and Hoff, ch. 8, with production advice from
practitioners. Scanning, saving originals, file names and rights are in
[photos-and-documents.md](photos-and-documents.md).

### Choosing pictures

- Choose pictures after the draft exists. The audience decides: a book for
  the family can be more personal.
- A picture earns its place when it passes at least one of these tests:
  1. **A face or a place:** a portrait, a house, a farm, a gravestone.
     These nearly always earn a place.
  2. **The story quotes it or leans on it.** When a story quotes a register
     line, an inscription or a certificate, show the original.
  3. **It carries a turning point.** Use one document for each turn in the
     story, not one for each person.
  4. **It is legible at the book's size, in greyscale.** Crop tight to the
     household's lines, the entry or the panel. A full page of grey columns
     fails this test.
- Leave out a picture that only repeats what the story already says.
- Use one or two pictures in a story, and at most one picture to set the
  scene in a chapter introduction. The family charts are separate and do not
  count.
- Groups across generations, such as the family's weddings, can work as a
  theme.

### Placing pictures

- **Place each picture next to the passage that discusses it.** Readers do
  not turn pages to find pictures. Do not put a gallery at the end of a
  chapter or the book.
- **At most about three pictures on a 6 × 9 page.**
- **In a story,** use `#fig("folder/file.jpg", caption: "...")` beside the
  paragraph it belongs to, or `#figure(image(...), caption: [...])` to set
  a size or cite in the caption ([book.md](book.md#stories-booksketches)).
  Flyleaf caps the height of a tall picture so a caption and some text fit
  on the page. (Flyleaf does this.)
- **Make a plate.** A plate is a clean crop of the part that matters: the
  article, not the whole newspaper page; the household's lines, not the
  census sheet; the panel of a certificate. A broadsheet page is unreadable
  at 6 × 9. Keep the full page as the archive copy. To find an article on a
  large page, look at a reduced copy of the page first, then crop.
- **Maps.** Label a partial map as a detail, with enough context to find the
  land. When the story compares parcels over time, show the whole township
  beside an enlarged excerpt of the sections that matter. Keep the map's
  title and boundaries. Label any modern locator boxes. Check that the
  caption's landmarks are in the crop.
- **Check every crop by eye** before you place it, and again on the printed
  page. A picture that fits the page can still be a poor crop.

### Files for the book

- Use a JPEG in sRGB colour or greyscale, without an unusual embedded colour
  profile. Some PDF viewers show such a picture as a blank space, even though
  the build succeeds. Look at the PDF in more than one viewer.
- Aim for 300 pixels per inch at the printed size. A picture's width in
  pixels divided by 300 is the widest it can print, in inches.
- For a black-and-white book, convert pictures to greyscale yourself. Do not
  leave it to the printer.
- Printed greys come out darker than they look on screen. A picture tuned to
  look slightly light on screen prints well. Proof on an office laser
  printer for a rough idea, then judge a printed proof after a few days.

### Captions

- Caption every archival picture. Say:
  - **who:** left to right, with maiden names, and surnames at first
    appearance;
  - **what** is happening;
  - **when:** "about 1912" when estimated;
  - **where:** at least the town and state;
  - **where it came from,** when that is interesting: "from the Penhallow
    family Bible".

  Ask: if I met this picture in a book, what would I want to know?
- Give the credit or source in the caption, or in an illustration credits
  page in the back matter. Use real names in credits: the photographer, the
  library.
- Say plainly when a picture only illustrates. The sample captions say, for
  example, that a stone house shows the kind the Cornish built, and was not
  the family's home.
- Captions are checked like the text around them. A year in a caption must
  appear in the records of the story's people, or in its `context_years`.
  This check always runs (the build warns, L3). For a caption that only
  identifies a picture, put `// cite-lint: ok figure caption` on the line
  above to quiet the other warnings. To cite in a caption, use `#figure` with
  `#src` in the caption.
- The text check reads captions too, and warns about research wording in
  them.

### Rights and sources, in brief

The *Guide* (ch. 8) sorts pictures this way:

- **Permission needed:** recent studio portraits, pictures of living people
  (tell them), photographs borrowed from relatives (get their agreement in
  writing), publications still in copyright, and pictures held by a
  repository.
- **Usually no permission needed:** publications in the public domain, many
  government works, and your own photographs.
- The owner of an old portrait is often not the public. Pictures from a
  subscription website follow that site's terms. Filter image searches by
  usage rights.
- Keep a picture log: file, caption, source, where it goes in the book, and
  whether you have permission.
- Free sources the *Guide* names include the Library of Congress prints and
  photographs, the David Rumsey Map Collection, the Leventhal Map Center at
  the Boston Public Library, Wikimedia Commons, Flickr Commons, state and
  local historical societies, NYPL Digital Collections, and memorial sites
  such as Find a Grave, where you ask the photographer. Check the rights
  statement on each item.

[photos-and-documents.md](photos-and-documents.md) has the full rules.

### Family charts

Flyleaf draws each chapter's descent chart after its introduction.
(Flyleaf does this.)

- Charts are numbered separately from pictures ("Chart 1"). Their captions
  give chart numbers and page references both ways. A note before each
  chapter's first chart explains the lines, and that "c." means about.
- Labels are 9 point, in the book's serif type. A chart never shrinks to
  fit. A chart too big for a page splits into panels; each panel repeats the
  people at its edge and says where they continue.
- Dates keep their qualifiers: "c.", "before", "after", "between".
- Each box shows the register number. "Other children" come only from the
  family that links the parents to the direct child.
- A chart does not prove parentage or a marriage. The evidence is in the
  register.
- `charts: false` in `book.yaml` leaves a chapter's charts out, as the
  sample does for the present generation.

After any change to the tree or the page size, look at every panel in the
PDF. Check the descent lines, the continuations, the names, and that the
children shown come from the right marriage. A clean build checks numbering
and placement only.

A simple drop chart, with lines dropping from parents to their children, or
a map of the family's homes, can also work as a picture in a story.

## Design and layout

Flyleaf's template applies the *Guide*'s design rules (Stratton and Hoff,
ch. 9). This section says what it does, and what you check on the page.

### What the template does

- **Page size.** 6 × 9 inches by default; set `trim_width` and
  `trim_height` in `book.yaml`. (Flyleaf does this.) A larger page suits a
  long, illustrated book: the family histories of NEHGS's Newbury Street
  Press run up to about 8¼ × 10¼ inches.
- **Margins.** Inside 0.95 inch, outside 0.7, top 0.8 and bottom 0.85. On a
  6 × 9 page the text column is 4.35 inches wide. The *Guide* suggests a
  column of about 4.5 inches and an inside margin of at least about an inch.
  The margins are fixed in the template. Ask your printer what inside margin
  it needs for your page count. (Flyleaf does this.)
- **Type.** A serif face for the text and a sans-serif for small headings,
  Libertinus by default. The *Guide* advises no more than two type families.
  (Flyleaf does this; see [family-folder.md](family-folder.md#book) to
  change them.)
- **Paragraphs.** Justified text, with Typst's control of widows and
  orphans: a paragraph's last line alone at the top of a page, or its first
  line alone at the foot. A paragraph straight after a heading has no
  indent. (Flyleaf does this.)
- **Headings** stay with the text that follows them. (Flyleaf does this.)
- **Openings.** Parts and chapters open on a right-hand page. A blank page
  before one has no running head or page number. (Flyleaf does this.)
- **Running heads.** The book's title on left-hand pages and the chapter's
  title on right-hand pages. None on a page where a chapter opens. (Flyleaf
  does this.)
- **Page numbers.** Centred at the foot. Roman in the front matter; Part I
  starts again at 1. (Flyleaf does this.)
- **Footnotes** at the foot of the page, in smaller type. (Flyleaf does
  this.)

### What you check on the page

- **A heading stranded at the foot of a page.** A heading needs four or five
  lines of text below it. Headings stay with the next block, but on a page
  full of footnotes that is not always enough. Wrap the first paragraph in
  `#block(breakable: false)[...]`, or put `#pagebreak(weak: true)` before
  the heading.
- **Footnotes before their marker.** The build stops if a footnote starts on
  a page before its marker, and warns about a page that holds only the end
  of a long footnote ([book.md](book.md#what-the-build-checks)). Short cited
  paragraphs kept whole with `#block(breakable: false, below: 1.36em)[...]`
  avoid most problems; the sample stories do this.
- **Uneven page bottoms** are fine. Easy reading matters more than level
  pages (Stratton and Hoff, ch. 9).
- **Dense register entries.** When an entry's footnotes push its facts and
  notes apart, add one of these to its chapter in `book.yaml`, with the
  person's id in the list:
  - `register_break_before: [id]` starts the whole entry on a new page;
  - `register_break_before_burial: [id]` starts its burial on a new page;
  - `register_break_before_marriage: [id]` starts its first marriage on a
    new page;
  - `register_break_before_child: [id]` starts a children list at that
    child, repeating the introduction;
  - `register_break_before_collateral: [id]` starts that relative's family
    continuation on a new page.

  The build stops when one of these cannot apply, such as a person who is
  not in that chapter, or an entry with no burial to break before. Use them
  only after looking at the page, and look again after the text changes.
- **A review copy.** Every build replaces `build/book.pdf`. A PDF viewer
  that has the file open can lose its place or show errors. Give reviewers a
  copy saved elsewhere, and replace it only when you tell them.

## Index

The *Guide* treats an index as essential (Stratton and Hoff, ch. 10).
Flyleaf makes an "Index of Names" from the register and the stories.
(Flyleaf does this.)

### What Flyleaf's index does

- **Register numbers.** References are register numbers, not page numbers,
  and a note at the head of the index says so. The *Guide* indexes by page.
  Indexing by number has long precedent in genealogy, and either is
  acceptable when the index says which it uses. (Flyleaf does this.)
- **Bold** marks the number of the person's own entry. "under 16" finds a
  relative inside entry 16 or its family continuations. (Flyleaf does this.)
- **Surname first,** then given names: "Penhallow, William Henry — 8".
  (Flyleaf does this.)
- **Married women** appear under their maiden surname and under each
  married surname from their recorded marriages: "Rowe, Edith May" and
  "Penhallow, Edith May (Rowe)". A woman who married a man of her own
  surname appears once. (Flyleaf does this.)
- **Alternate names** recorded as extra `NAME` lines are indexed with the
  same numbers. (Flyleaf does this.) Use them for spelling variants: they do
  the work of the *Guide*'s "see" cross-references, such as "Hoffe, see
  Hough".
- **Filing.** Case and accents are ignored, Mc is filed as if spelled Mac,
  and prefixes such as "van" and "de" are filed as written. (Flyleaf does
  this.)
- **Unknown surnames.** People with no recorded surname are listed first,
  by given name, under "Surname not recorded". A person with no name at all
  is not indexed. (Flyleaf does this.)

### Where the Guide goes further

The *Guide* adds conventions that Flyleaf's index does not apply. Know them,
so you can check the index and explain it in the headnote or your
introduction:

- dates to tell apart two people with the same name, such as "John (d.
  1680)". Flyleaf puts them on one line with all their numbers, which lead
  to the separate entries;
- unknown surnames under a final "No Surname" heading;
- a "family" subentry for a page range, before the given names;
- royalty under the country, British titles under both surname and title,
  and titled wives under their maiden name and their title;
- Mc and Mac filed as spelled, and O' filed as if there were no apostrophe;
- names that appear only in a caption or as plain text in a story. Flyleaf's
  index reads the register and `#refp` mentions, so a person named only in a
  caption or in plain text is not in it.

### Using the index as a check

Read the index once the content is final, and proofread it. Indexing is a
form of proofreading. Two entries for one person, two people merged into
one, or a spelling you never settled will show up there. Fix the cause in
the tree.

## Front and back matter

These rules follow Stratton and Hoff, ch. 7.

### The Guide's order

Front matter, with roman page numbers:

1. half title, a page with the title alone;
2. frontispiece, a picture facing the title page (optional; an overview
   chart works well);
3. title page;
4. copyright and permissions;
5. dedication;
6. epigraph, a short quotation;
7. contents;
8. list of illustrations;
9. foreword (by someone else) or preface (by the author);
10. acknowledgements;
11. how to use this book;
12. introduction.

Back matter:

1. appendices, lettered or numbered: documents, transcriptions, allied
   families;
2. endnotes, if used, divided by chapter;
3. glossary;
4. bibliography;
5. illustration credits;
6. index.

### What Flyleaf prints, in order

1. A title page, with the title, subtitle and author from `book.yaml`, a
   small line above the title, and an edition line giving the month and the
   number of people in the ancestor table. `strapline:` in `book.yaml` sets
   the small line. Without it, the line reads "A Family History". Set
   `strapline: A Documented Family History` only once the book's people
   rest on cited records. You can also mark an early edition in the
   subtitle, such as "A first family edition", and in the methods page.
2. The contents.
3. Your front-matter files from `book/front-matter/`, in file-name order.
4. Part I, the Narrative.
5. Part II, the Register.
6. Your back-matter files from `book/back-matter/`, in file-name order.
7. Sources for the Register, the Bibliography, the Ahnentafel, and the Index
   of Names, which always comes last.

(Flyleaf does this.)

Flyleaf has no separate half title, copyright page or dedication page before
the contents. Put a dedication, a copyright notice or acknowledgements in
front-matter files of their own; they print after the contents. Number the
files to set their order: `01-introduction.typ`, `02-how-to-use.typ`,
`03-methods.typ`, `04-acknowledgements.typ`.

### What to write

- **How to use this book.** This is the most useful page in the front
  matter. Explain:
  - the two parts, and which to read for what;
  - the ahnentafel numbers, with an example from the book;
  - the footnotes and the Sources for the Register;
  - that the index gives register numbers;
  - double dating, if the book uses it;
  - the abbreviations in the children lists;
  - your transcription policy.
- **Methods.** The kinds of source and how you judged them, the conventions
  for uncertainty, and the statement about AI assistance. The sample's
  methodology chapter is a starting point.
- **Introduction.** An introduction that sets the context belongs in the
  front matter. An opening that begins the family's story belongs on page 1
  of Part I.
- **Keep the front matter lean.** Readers should reach the first chapter
  quickly. A simple chart before chapter 1 helps them find their way; add it
  as a picture with `#fig`.
- `{{stat:date}}` and `{{stat:persons}}` print the edition date and the
  number of ancestors ([book.md](book.md)).
- **Back matter.** Write appendices, a glossary, illustration credits, Open
  Questions and an afterword as back-matter files. Flyleaf uses footnotes,
  so the book has no endnotes.
- **Research chapters.** Name your methods and Open Questions chapters in
  `book.research_sections` ([family-folder.md](family-folder.md#book)).
  They may discuss evidence, so the text check only warns there.
  `book.research_tab` shows one of them on the website's own tab.
- The build's story checks read stories and chapter introductions. Front
  and back matter are not checked for citations, so check them yourself.

## Editorial checks

Run these before you share any draft (Stratton and Hoff, ch. 7 and 11). The
claim audit, independent reviewers and the human reader are in
[review.md](review.md).

Proofread in several passes, each looking for one thing.

### The whole book

- Does it suit its readers?
- Is there enough context: double dating, changing county boundaries, terms
  a glossary should explain?
- Does the organisation match the contents?
- Are parallel lines treated alike, and brought to the same generation?
- Are there pictures where they would help?

### Consistency

Adapted from the *Guide*'s checklist (ch. 11):

- **Numbers.** Child numbers match the parents' entries across generations.
  The ahnentafel arithmetic holds: a father is twice his child's number.
  (Flyleaf does this.) Repeated ancestors are handled one way, and unknown
  numbers are listed. Numbers and words follow your rule.
- **Names.** Blanks for unknown names use one style. Alternate spellings,
  nicknames and record misspellings follow [the names rules](#names).
- **Dates.** One style throughout. Abbreviations appear only in child-style
  text. Running text spells months out.
- **Order of facts.** Birth, death, marriage; place before date; "at" and
  "in"; counties named.
- **Children.** The introduction's wording is the same everywhere; twins are
  marked one way; the serial comma is used throughout.
- **Across generations.** Every person appears at least twice: in a child
  list and in their own entry. Flyleaf makes both from the tree, so they
  agree. Your stories must match them: the same dates and spellings
  everywhere. Check each person.
- **Citations.** Every fact has a note; full and short forms are
  consistent; the bibliography matches the notes.

### The page

- Widows, orphans and bad breaks, such as a children's introduction parted
  from its list.
- Running heads, and odd page numbers on right-hand pages.
- No blank page you did not intend.
- Contents page numbers final.

### The build's checks

The build checks some of this for you. `flyleaf coverage` prints the
warnings, and every build writes them to `book/COVERAGE.md`
([book.md](book.md#what-the-build-checks)).

| Code | What it finds |
|---|---|
| L1 | A paragraph of more than 90 words with no citation |
| L2 | A sentence that gives a year and cites nothing |
| L3 | A year not found in the records of the story's people, their spouses, children and parents, or in `context_years` |
| L4 | A month-first date ("March 3, 1912") |
| L5 | An ordinal number ("23rd", "19th") |
| L7 | A comma before Jr., Sr. or III |
| L8 | "ibid." |
| L9 | A web address in the text |
| L10 | First-person forms such as "I am", "I was", "I found" and "my" |
| L11 | A two-letter state code in a story |
| L12 | "at" before a region listed in `places.region_names` |
| L13 | A small count written as a numeral ("3 children") |
| L14 | A long quotation that should be a block (information) |
| L15 | Words of certainty ("undoubtedly", "it is certain") |
| L16 | A name one letter from a name in the tree, which the tree never uses |
| G1 | A two-letter state code in a place in the tree |
| G2 | A January to March date before 1752 without both years |
| G3 | A comment in brackets in a place in the tree |
| G4 | A FamilySearch record link that is not an ARK |

- The year checks read four-digit years from 1000 to the current year.
- L3 and L16 test consistency with the tree. They do not prove a year or a
  name is right.
- Text in quotation marks is skipped by the style checks (L4 to L13, L15
  and L16), since a quotation follows its record.
- A comment line `// cite-lint: ok <reason>` just above a paragraph turns
  off the warnings for that one paragraph, except L3. Always give the
  reason. Use it for a quotation cited at its end, a reading of a record just
  quoted, a roadmap paragraph or a picture caption. Do not use it to quiet a
  warning about words of certainty, or about a fact with no source. Fix the
  sentence instead.
- `flyleaf coverage` also lists stories gone stale since their people's
  records changed. Reread them and mark them current.
- The family-text check looks for research wording in the text readers
  see: stories, introductions, front and back matter, and captions. It skips
  footnotes. `flyleaf coverage` runs it and prints a count of its warnings;
  `flyleaf coverage --wording` lists each one. Before anything is
  published, `flyleaf deploy` runs it for a private site, and
  `flyleaf site build` runs it for a public one. Phrases you list in three
  of the `text_checks` lists stop both: `errors`, `event_note_errors` and
  `printed_book_errors`. The other lists do other jobs
  ([family-folder.md](family-folder.md)).

A clean build means the book is consistent. It does not mean every
statement is right.

### Readers

The author reads the book, and so does someone else: a careful reader with a
good eye for grammar, and ideally a second reader who knows genealogy. An
assistant's review is useful, and does not replace a person. See
[review.md](review.md).

## Publishing and donating copies

These rules follow Stratton and Hoff, ch. 9, 11 and 14.

- **The print file.** `flyleaf book` makes `build/book.pdf`, ready for a
  printer. Choose trim size, paper, cover and binding when you order. Check
  the printer's rules for page count and inside margin.
- **Proofs.** Check a proof for placement: pictures, breaks, covers and
  spine. It is not the time for another full reread.
- **Printers.** Print-on-demand services such as Lulu, Blurb and Amazon KDP
  print small runs. IngramSpark adds bookshop and library distribution, and
  asks for a PDF/X file, which Flyleaf does not make. Short-run offset
  printing is worth pricing for a hundred copies or more. Paper options
  change, so check them when you order.
- **Greyscale photographs.** A book with black-and-white photographs can
  print with deeper blacks in colour on coated paper than in black only on
  uncoated paper. Order proofs from more than one printer if you are unsure,
  and compare them.
- **An archival copy.** `flyleaf book --archival` also makes a PDF/A-2b
  copy for a library ([book.md](book.md#other-editions)).
- **The title.** Make it concise and descriptive, not clever. Set it in
  `book.yaml`.
- **Donate copies.** Library copies reach researchers outside the family.
  Libraries that collect family histories include the Library of Congress,
  the Genealogy Center at the Allen County Public Library, NEHGS, the
  FamilySearch Library and the DAR Library. Also offer copies to libraries
  and historical societies in the places the book covers, including abroad.
  Check each library's donation rules first.
- **Pictures in a donated copy.** A donated copy is published. Check every
  picture from a subscription website against that site's terms, and replace
  it with a copy from the archive or a public-domain version where needed.
- **A first edition.** A modest first edition, shared with relatives, often
  brings out memories, photographs and corrections. Plan to revise it.

## Keeping a stylesheet

The *Guide* asks every writer to keep a stylesheet (Stratton and Hoff,
ch. 3). Readers who find details inconsistent start to doubt the research.

- Record each recurring decision as you make it: spellings, capitals,
  abbreviations, hyphens, place forms, short titles, and which alternatives
  you chose from this guide.
- Pick one spelling for words with two, such as "baptised" and "baptized",
  and keep it in your own prose. The register prints "baptized", so choose
  that spelling if you want your stories to match it.
- Reread the manuscript against it at each copy-editing pass.
- Keep it at `book/stylesheet.md`. A `.md` file inside `sketches/`,
  `chapters/`, `front-matter/` or `back-matter/` stops the build, so keep it
  out of those folders.
- An assistant should read the stylesheet before drafting, and add each new
  decision to it.

## Appendix A: citation patterns

Patterns for common sources, after Stratton and Hoff, ch. 5 and the style
manual. Square brackets mark what you fill in. The examples use Flyleaf's
fictional sample family. Write the full note as the source's `TITL` with the
locator in `PAGE`, and the short form as its `ABBR`.

| Kind | Full note | Short form |
|---|---|---|
| Census | 1880 U.S. census, Mineral Point, Iowa Co., Wisc., population schedule, sheet [no.], line [no.], John Penhallow household, viewed at [site]. | none needed |
| Parish register | St Just in Penwith parish register, baptisms 1840–1850, p. 31, entry 244. | St Just baptisms, 1840–1850, p. 31. |
| Civil register | Iowa County, Wisconsin, register of marriages, vol. 9, p. 88. | Iowa County marriages, 9:88. |
| Town vital records | [Town], [State abbr.], Vital Records, [vol.]:[page]. | [Town] Vital Records, [vol.]:[page]. |
| Database | *[Database title]*, online database, [site], citing [original record]. | *[Database title]*. |
| Gravestone | [Cemetery], [place]; photograph posted by a member at FindAGrave.com, memorial [no.]. | none needed |
| Church record | [Church], [place], [baptisms or marriages], p. [no.], [repository]. | [Church] records, [kind]. |
| Probate, deeds | [County], [State abbr.], Probate, file [no.]. / [County] Deeds, [vol.]:[page]. | none needed |
| Newspaper | "Obituary of John Penhallow," *The Iowa County Lantern* \[Mineral Point, Wisc.\], 7 March 1912, p. [no.]. | "Obituary of John Penhallow." |
| Manuscript | "[Title in quotation marks]," [repository], [call no.]. | "[Short title]," p. [no.]. |
| Book | [Author], *Men of the Lead Region: A Biographical Album of Iowa County, Wisconsin* ([City]: [Publisher], 1904), 212. | *Men of the Lead Region*, 212. |
| Journal article | [Author], "St Just Families in the Wisconsin Lead District," *Sample Genealogical Quarterly* 41 (1998): 113. | "St Just Families," 113. |
| Family Bible | Penhallow family Bible, family register kept by Edith Penhallow, births page. | Penhallow family Bible. |
| Letter | Edith Penhallow, Dodgeville, to Robert Penhallow, 9 April 1944; held by [holder]. | Edith Penhallow to Robert, 9 April 1944. |
| Interview | Ruth Solberg, interview by Tamsin Penhallow, Madison, March 2023; recording held by [holder]. | none needed |
| Email, questionnaire | Email from [name] to [name], [date]. / Questionnaire supplied by [name], [date]. | none needed |
| Online tree | "Rowe Family of Iowa County," online member family tree, viewed 12 October 2026. | Rowe family online tree. |

Flyleaf prints `TITL` in plain type, so the italics in this table apply to
notes you write with `#footnote[...]`.

Bibliography forms, for a bibliography you write yourself: invert the first
author's name only; use five underscores for a repeated author; in notes,
give the first of four or more authors and "et al.", and in the
bibliography name them all.

## Appendix B: abbreviations

Use these only in child-style text and citations. Running text spells the
words out (the *Guide*'s style manual).

| Abbreviation | Meaning |
|---|---|
| b. | born |
| bp., bap. | baptised |
| bur. | buried |
| chr. | christened |
| d. | died |
| d.y. | died young |
| d.s.p. | died without children (*sine prole*) |
| m. | married |
| unm. | unmarried |
| div. | divorced |
| int. | marriage intention |
| lic. | licence |
| dau. | daughter |
| wid. | widow |
| ca., c. | about (*circa*) |
| calc. | calculated |
| fl. | flourished |
| inst. | this month |
| ult. | last month |
| rem. | removed |
| res. | resided |
| unk. | unknown |
| cem. | cemetery |
| co. | county |
| twp. | township |
| ct. | court |
| dist. | district |
| ED | enumeration district |
| exec. | executor |
| inv. | inventory |
| PR | probate record(s) |
| TR | town record(s) |
| VR | vital record(s) |
| MS, MSS | manuscript, manuscripts |
| n.d. | no date |
| n.p. | no place or no publisher |
| N.S., O.S. | New Style, Old Style dates |
| obit. | obituary |
| p., pp. | page, pages |
| ff. | and following |
| vol., vols. | volume, volumes |
| ser. | series |
| supp. | supplement |
| repr. | reprint |
| rev. ed. | revised edition |
| comp. | compiler |
| trans. | translator |
| transcr. | transcriber |
| var. | variant |
| v., vs. | versus |
| £ s. d. | pounds, shillings, pence |
| y-m-d | age at death in years, months and days |
| RG | record group |
| PRO | Public Record Office |
| Soc. | Society |

Flyleaf's child lines use `b.`, `bp.`, `chr.`, `d.`, `bur.`, `crem.`
(cremated), `ca.`, `bef.` (before) and `aft.` (after).

### Months

Shorten months of six or more letters: Jan. Feb. March April May June July
Aug. Sept. Oct. Nov. Dec.

### States

NEHGS style, for child-style text and citations. Do not use two-letter
postal codes. States of five letters or fewer are spelled out.

Ala. · Alaska · Ariz. · Ark. · Calif. · Colo. · Conn. · Del. · D.C. · Fla. ·
Ga. · Hawaii · Idaho · Ill. · Ind. · Iowa · Kans. · Ky. · La. · Maine · Md. ·
Mass. · Mich. · Minn. · Miss. · Mo. · Mont. · Neb. · Nev. · N.H. · N.J. ·
N.Mex. · N.Y. · N.C. · N.Dak. · Ohio · Okla. · Ore. · Pa. · R.I. · S.C. ·
S.Dak. · Tenn. · Texas · Utah · Vt. · Va. · Wash. · W.Va. · Wisc. · Wyo.

## Sources for this guide

- Penelope L. Stratton and Henry B. Hoff, *Guide to Genealogical Writing:
  How to Write and Publish Your Family History* (Boston: New England
  Historic Genealogical Society, 2014).
- Elizabeth Shown Mills, *Evidence Explained*, and its QuickLesson 25 on
  citing online providers and digital images.
- FamilySearch developer documentation on linking to FamilySearch pages
  (ARK links).
- Sharon DeBartolo Carmack, *You Can Write Your Family History*.
- Clarke Historical Library, Central Michigan University, *A Guide to
  Editing and Publishing Family Manuscripts*.
- Edmund de Waal, *The Hare with Amber Eyes*, and his own account of
  writing it.
- Annette Gordon-Reed, *The Hemingses of Monticello*.
- David Hackett Fischer, *Paul Revere's Ride* and *Washington's Crossing*.
- Hazel Edwards and Daniel J. Tortora, published advice on writing family
  histories.
- *Vita Brevis*, the NEHGS blog, on proofreading and indexing a family
  history.

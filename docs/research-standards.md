# Research standards

This guide sets out how to judge evidence and record it in a Flyleaf family
history. It covers:

- the kinds of source, and confidence levels;
- how to read a record, and what it lets you claim;
- how to cite a record on the right fact;
- what to record when a search finds nothing;
- how to keep copies of what you cite.

It also says which rules the build checks, and which stay your judgement.

Read it before your first research session, and give it to your AI
assistant. Two other guides go with it:

- [research-playbook.md](research-playbook.md) explains how a research
  session runs: choosing a target, where to look, when to stop, and how to
  transcribe.
- [photos-and-documents.md](photos-and-documents.md) covers scanning, file
  names, captions and identifying people in pictures.

## Why standards matter

Most errors in family trees come from links copied without checking. They
are quick to add and hard to find later. The rules in this guide exist to
stop them.

> **Example.** Thirty online trees give Nathaniel Ashdown, an Ohio farmer,
> as the son of a Revolutionary War captain of the same name. The trees copy
> each other, and none cites a record for the link. The captain's pension
> file lists his children. Nathaniel is not among them, and the captain's
> own son Nathaniel died as a child. A session that copied the trees would
> have added four generations of someone else's family.

A tree built on records gives you:

- a picture of the family's origins that is accurate and can be defended;
- stories with colour and character that you can tell without later
  embarrassment;
- knowledge that grows, because each session leaves the tree better than it
  found it;
- a sound basis for a lineage-society application (see
  [lineage-societies.md](lineage-societies.md)).

So value accuracy over speed, and depth over breadth. Prefer ancestors you
can document to impressive ones you cannot. Claim only the lineage-society
credentials the records support.

## The proof standard

The Genealogical Proof Standard is set out by the Board for Certification of
Genealogists (BCG) in *Genealogy Standards*. A conclusion meets it when all
five of its elements hold:

1. **Reasonably exhaustive research.** You have searched the sources a
   competent researcher would expect to bear on the question, including the
   originals behind any index, before you conclude.
2. **Complete and accurate source citations.** Every fact can be traced to
   its source, and to the place in the source.
3. **Thorough analysis and correlation.** You have judged each source and
   each statement in it, and the sources together support the conclusion.
4. **Resolution of conflicting evidence.** You have explained every conflict
   between sources.
5. **A soundly reasoned, coherently written conclusion.** The reasoning is
   written down: in the tree's notes, and for the book, in the story or its
   source notes.

Flyleaf is built for people who work to this standard. Meeting it is the
researcher's work. No program can judge whether research was thorough or a
conflict resolved, and neither Flyleaf nor these guides can certify that a
tree meets the standard.

In practice: when a record contradicts a claim, either explain the conflict
in a note or lower the claim's confidence. Keep the inconvenient record in
the citations.

> **Example from the sample tree.** A county album compiled in 1904 says
> John Penhallow came to America in 1867. The 1868 passenger list and his
> 1912 obituary both give 1868. The tree cites all three. A note on John
> explains that the register uses 1868 because the album was compiled long
> after the event.

### What Flyleaf checks

`flyleaf book` checks the tree before it builds the book. The build
**stops** when:

- a person has no Flyleaf id, two people share one, or an id has characters
  other than lower-case letters, digits and hyphens;
- a person marked `primary` has only weaker sources (see
  [Confidence](#confidence));
- a person has a confidence level other than the four, or two of them;
- a source has a `_TIER` that is not one of the five kinds or
  `unclassified`, or two `_TIER` lines;
- a citation's `QUAY` is anything other than 0, 1, 2 or 3;
- a source's id is longer than 20 characters between the `@` signs;
- a citation has two `_KEY` lines;
- a `_KEY` on a source or a citation is badly formed: a key is lower-case
  letters and digits, in groups joined by single hyphens, such as
  `john-baptism-1845`;
- a citation points to a source record the tree does not have, or a media
  link points to an `OBJE` record the tree does not have;
- a `BURI` line has a value other than `Y`;
- one person cites the same source twice, with the same `PAGE` and note but
  different keys, outside the facts the register footnotes;
- a family link is recorded on one side only: a person names a family as
  their parents (`FAMC`) and the family does not list them as a child
  (`CHIL`), or the reverse; or a `FAMC` or `FAMS` line appears twice;
- a story cites a source the tree does not have.

It **warns** when:

- a person marked `primary` or `memoir` cites no source at all;
- a partner link is recorded on one side only (`FAMS` without the family's
  `HUSB` or `WIFE`, or the reverse);
- a person has more than one set of parents (more than one `FAMC`). It warns
  even when each has a `PEDI`. The book counts the family marked
  `PEDI birth` as the ancestors, else one with no `PEDI`, else the first
  recorded. Once each `FAMC` has the right `PEDI`, you can leave the
  warning;
- an older-format `[Source]` note holds research wording that would print in
  its footnote.

For people at `tree-link`, it reports how many cite no source yet, without
listing them. `flyleaf import` gives `tree-link` to everyone without a
level, so at first this count is the size of the job ahead.

A person with no confidence level at all is not flagged. The report counts
them under `no-conflevel`, and the source checks above skip them. Give each
person a level, so the checks cover them.

`flyleaf coverage` lists, without stopping:

- passages that look uncited, and years the records do not mention;
- words of certainty, such as "undoubtedly";
- names one letter away from a name in the tree;
- stories whose people's records changed since the story was last marked
  current;
- for the book's ancestors: two-letter state codes in places, January to
  March dates before 1752 without both years, and FamilySearch links that
  are not permanent links.

See [what the build checks](book.md#what-the-build-checks).

`flyleaf coverage --wording` lists research wording in text that readers
see. `flyleaf deploy`, and `flyleaf site build` for a public site, run the
same check before publishing.

None of these checks reads a record. A clean build means the tree and the
book are consistent. Whether the evidence supports each claim stays your
judgement.

## Kinds of source

Every source is one of five kinds. Set the kind with `_TIER` on the source
record, or let Flyleaf classify it from its title. A source it cannot place
is `unclassified` until you set its kind.

| Kind (`_TIER`) | Examples |
|---|---|
| `primary` | Birth, marriage and death registers; census schedules; original parish registers; wills and probate files; military service records; passenger lists |
| `authoritative-secondary` | Peer-reviewed genealogical journals; accepted lineage-society applications; scholarly compilations that cite their records |
| `compiled-secondary` | Published family genealogies and county histories; transcriptions; memorials with a photographed inscription |
| `family-testimony` | Memoirs, interviews, letters, family Bibles, questionnaires |
| `lead` | Online family trees and collaborative profiles that cite nothing checkable |

The kind also decides where the source appears in the book's bibliography,
which groups sources by kind.

Use `unclassified` honestly for a source you cannot yet place. The sample
tree uses it for an undated typed list of family names and dates, found as a
photocopy among a relative's papers.

### How Flyleaf classifies a source without a `_TIER`

Flyleaf reads the source's title (or, without one, its short title or
author), its `_URL`, its repository call numbers, and any note on the source
that contains a web address. It matches these against patterns for general
kinds of record:

- **primary**: birth, death, marriage, baptism and burial certificates;
  civil and statutory registers; parish and church registers; censuses;
  wills and probate; passenger lists and ship manifests; military, service
  and pension records, muster rolls and draft registrations;
  naturalisation. Also their names in German, Dutch, Scandinavian, French,
  Spanish, Italian and Portuguese, such as Kirchenbuch, état civil and
  registro parroquial.
- **compiled-secondary**: newspapers and obituaries; county, town and family
  histories; biographical dictionaries; city and trade directories. Also
  any index or abstract, such as a census index: it is compiled from the
  records it names.
- **family-testimony**: titles that contain "family knowledge", "family
  memoir", "family Bible", "family papers", "oral history", "questionnaire
  supplied" or "interview by".
- **lead**: online trees (WikiTree, Geni, Ancestry member trees, the
  FamilySearch Family Tree, MyHeritage), Find a Grave, BillionGraves,
  RootsWeb, Genealogy.com and Wikipedia.

Flyleaf tries these in order: an index or abstract first, then primary,
compiled-secondary, family-testimony and lead. The first match decides.

No general pattern marks a source authoritative-secondary: set `_TIER`, or
name your journals in your own patterns.

Some results need a `_TIER` to correct them:

- Words for records are matched before the online-tree patterns. So an
  online tree whose title names a record is sorted as primary. A WikiTree
  profile titled "Penhallow family in the 1880 census" is an example. Set
  `_TIER lead` on such a source.
- The word "index" anywhere in the title or a web address makes the source
  compiled-secondary, unless one of your own patterns matches first. A
  record page whose address ends in `index.html` counts too. Set `_TIER`
  when that is wrong.
- A Find a Grave memorial is a lead by its address. If it has a photograph
  of the stone and you have read the inscription yourself, set
  `_TIER compiled-secondary`. Better still, cite the photograph of the stone
  as the thing you read.
- An obituary printed within days of a death is a judgement call. The
  general patterns call it compiled-secondary. You may treat it as the
  original record of the death and set `_TIER primary`. Then give its other
  facts, such as a birth or an arrival years before, a lower `QUAY`. The
  sample tree does this for John Penhallow's obituary.

A lead is a reason to look for a record. It is not evidence on its own. Many
online trees now contain plausible text that nobody checked, some of it
generated by machines. Do not accept a fact from a tree unless you can follow
it back to a record. See [Online trees, profiles and AI](#online-trees-profiles-and-ai).

### Your own patterns

To teach Flyleaf your own source titles, list title patterns for each kind in
a JSON file and name it in `paths.source_tier_patterns`. Each pattern is a
regular expression, so a plain phrase works, but characters such as `(`, `.`
and `*` have special meanings:

    {"patterns": {"primary": ["County Marriage Register"],
                  "compiled-secondary": ["History of Iowa County"]}}

Your patterns are tried before the general ones, so they decide for the
sources they name. To use only your own, add `"general_patterns": false` to
the file.

### Sources, information and evidence

Most reviewers judge a record with three separate questions, set out by
Elizabeth Shown Mills in *Evidence Explained* (ch. 1). Flyleaf's single kind
folds them into one. Use the three questions whenever you judge a record.
Use their terms when you write for a journal, a lineage society or a
reviewer.

| Question | Term | Meaning |
|---|---|---|
| What is the source? | Original | The first recording of the information, such as a register entry |
| | Derivative | Made from another source: a copy, transcription, abstract, index or database |
| | Authored | A work that studies sources and draws conclusions, such as a family history or a journal article |
| Who supplied the information? | Primary | Someone with first-hand knowledge, such as a witness to the event |
| | Secondary | Someone who learned it from another person |
| | Undetermined | You cannot tell |
| How does it answer your question? | Direct | It answers the question on its own |
| | Indirect | It answers the question only together with other evidence |
| | Negative | An absence, where a record was expected, answers the question |

How Flyleaf's kinds relate to the source question:

- `primary` is close to an original source.
- `authoritative-secondary` and `compiled-secondary` are mostly authored
  works. Indexes, abstracts and transcriptions are derivative, and Flyleaf
  classes them as compiled-secondary.
- `family-testimony` can be original (a letter, or a Bible entry made at the
  time) or authored (a memoir written decades later). Its information can be
  primary or secondary.
- `lead` is authored or derivative work whose sources you cannot check.

Your `[NEGATIVE]` notes record searches that can become negative evidence
(see [Negative findings](#negative-findings)). A chain of records that
together name a parent, such as a census household, a will and a deed, is
indirect evidence.

The word "primary" has two meanings here. In Flyleaf, `primary` names a kind
of source. In *Evidence Explained*, primary describes information. A death
register is an original source. Its death date is usually primary
information. Its birth date is usually secondary, because the informant was
not at the birth.

### One record, different strengths

A single document can be strong for one fact and weak for another. A death
register entry is good evidence for the death, recorded at the time by
someone present. Its birth date came from an informant years later. Cite the
same record under both facts, and say in the citation how far it can be
trusted for each. Give each citation its own `QUAY` (see
[Citation quality](#citation-quality-quay)).

> **Example from the sample tree.** John Penhallow's 1912 obituary is cited
> for his death with `QUAY 3`, and for his arrival in America, 44 years
> earlier, with `QUAY 2`. His birth year is estimated from his age in his
> 1866 marriage entry, cited with `QUAY 2` and a note that says so.

## Confidence

Each person carries one confidence level (`_CONFLEVEL`):

| Level | Means | Needs |
|---|---|---|
| `primary` | The person and their place in the family rest on good records. | At least one `primary` or `authoritative-secondary` source. |
| `tree-link` | The connection comes from compiled work or other trees. | At least one source of any kind. |
| `memoir` | The connection comes from family testimony. | A family-testimony source, and no record that contradicts it. |
| `unknown` | Not yet researched. | Nothing. Use it honestly. |

The check stops the build when a person marked `primary` has only weaker
sources. It warns when a person marked `primary` or `memoir` has no source at
all. It does not check the other rules in the "Needs" column: those are
yours to keep. `flyleaf import` gives `tree-link` to everyone without a
level, because an imported tree is compiled work until you cite its records.
List people the source checks should skip, such as the compiler, in
`research.exempt_refns` ([family-folder.md](family-folder.md)).

Confidence appears in `book/COVERAGE.md`, beside each ancestor. The book and
the website do not show it.

How to set the level:

- Choose the level the evidence supports. When you are unsure, choose the
  lower one.
- A person who rests on inference alone, with no source, is `unknown`.
- Raise a level only when a record you have cited supports it. Lower it when
  a record contradicts it and you cannot explain the conflict.
- `primary` speaks to the person **and** their place in the family. A good
  death record supports the death. The person's place in the family needs
  evidence of its own.
- The build counts every source cited anywhere on the person, including on
  their marriages. Passing the check does not show that the link to the
  parents is proven. A primary source on a person also does not oblige you to
  rate them `primary`.

> **Examples from the sample tree.** John Penhallow is `primary`: his
> baptism, marriage, arrival and death all rest on records made at the time.
> Elizabeth Trembath stays `tree-link`, although her marriage entry is an
> original record. Her birthplace comes from a journal article that does not
> cite the register entry it used. Harold Penhallow is `memoir`: he is known
> only from the family Bible.

## Citing a record on the right fact

A source's title cannot say which person's birth, death or marriage it
supports. The citation's place in the tree does. Cite each record under the
fact it supports, on the right person.

- **Births, baptisms, christenings, deaths, burials and cremations:** cite
  under that event on the person. The register prints the citation as a
  footnote on that fact.
- **Marriages and divorces:** cite under `MARR` or `DIV` in the family record
  (`FAM`). Both spouses' stories can then cite it. Each marriage, including a
  second or later one, gets its own references.
- **Other facts**, such as a residence, an occupation or an arrival: cite
  under that fact. The book lists these citations, and citations made
  directly on the person, under that person in "Sources for the Register".
- A citation inside a note, or deeper inside an event, is a general
  reference. It does not support the event's date.
- A record about one person can appear as family context on another's
  record. A child's birth certificate cited on a parent is not evidence of
  the parent's death, even when it mentions the parent.

Some events need care:

- A baptism never supplies a birth date. Record the birth only when a record
  gives it, and estimate it in a note when you must.
- A burial without a known date is left without one. Do not copy the death
  date into it.
- A burial you know of only from a report: `1 BURI` with `2 TYPE Reported
  burial`. The register prints it as "burial reported".
- A burial announced in advance: `1 EVEN` with `2 TYPE Planned burial`. The
  register prints it as "burial planned". A `BURI` with that type stops the
  build, because a `BURI` with a date or place says the burial happened.
- A `BURI` with only notes or citations, and no date, place or `Y`, does not
  say the burial happened. `1 BURI Y` says it happened when neither date nor
  place is known.
- Record a `MARR` only when a record shows a marriage. A family record
  without one prints as "The family record links … ; no marriage event is
  recorded."

The fields of a citation:

- On the source record: `TITL` names the source; `ABBR` is its short title
  for later notes; `_TIER` is its kind; `_URL` is where it is online;
  `_KEY` is a stable name that book prose cites. See
  [gedcom.md](gedcom.md#sources-and-citations).
- On the citation: `PAGE` locates the evidence in the source; a `NOTE`
  records a qualification or your assessment; `QUAY` is your assessed
  quality; `_KEY` names this use when one person cites a source in two
  ways.
- Keep a source record's id short: at most 20 characters between the `@`
  signs, which is GEDCOM's limit. The build stops on a longer one.
- When one person cites a source twice, make each `PAGE` say which part of
  the source it uses.

The book prints a citation's title, its `PAGE` and its note. Write the note
for a reader: "The informant was her son", not "re-checked against the
image". Keep the history of a source, such as where you found it and earlier
readings, in your research notes. See
[Where notes appear](#where-notes-appear).

Placing a citation records your claim that the record supports the fact. It
does not prove you read the record correctly, or that it supports every
detail of the event. When a record supports only part of an event, say which
part in the citation note, or do more work.

### The older note format

Some trees keep sources as plain notes that start with `[Source]` (see
[gedcom.md](gedcom.md)). Such a note is a person-level reference: it cannot
attach a source to a fact. Everything in it prints as the source's text,
including words after a `[Notes]` or `[Confidence]` marker on the same line.
Keep each `[Source]` note to the citation alone, and put commentary in a
separate note. Use native `SOUR` citations for new work.

## Reading a record: what it supports

These rules govern what a record lets you claim. They apply to the tree, to
stories, and to your research log and progress reports. An assistant
reporting on a session follows them too.

### Say what the source says

- Write what the source says, and no more. "The index lists" is not "the
  record shows". Name the original that is still needed.
- Use "confirms" only for the particular claim that the evidence you
  examined supports. Explain any material conflicts and limits.
- A second copy of the same record, or an index reproduced on another site,
  is not independent confirmation.
- Keep the spelling a record uses, even when it differs from the family's.
- A record shows what it was made to record. A draft registration card
  shows that a man registered. It does not show that he served.
- When a new reading changes a conclusion, keep the old reading in a note.
  Update every place that relied on it: the tree, the stories, the captions
  and the register notes. Search the `book/` folder for the old wording.
- Keep research notes out of the story. The book's sources sections show the
  evidence; the narrative tells the family's history. See
  [style-guide.md](style-guide.md).

### Indexes and databases

An index tells you where to look. Someone compiled it from the record, and
any field in it can be wrong.

- Reading an index verifies what the index says. It does not confirm the
  event.
- Write "the index lists" and name the original you still need. Add it to
  `research/requests.md` if it must be ordered.
- One index on two websites is one index. Count it once.
- A saved copy of an index page is still an index. Saving it keeps your
  evidence. It does not turn it into an original record.

> **Example.** A state death index lists "Fenwick, Ada, 12 Mar 1903, vol. 4,
> p. 117". Write: "The state death index lists Ada Fenwick's death on
> 12 March 1903." The register entry at volume 4, page 117 is the record
> still to see.

### Published editions of vital records

Many towns' early births, marriages and deaths were printed in edited
volumes. Editors combined the town or church books with other material.

- Read the editor's introduction and the key to abbreviations before you
  read any entry.
- Separate what was transcribed from the town or church record from what the
  editor added from gravestones, family Bibles or private papers. Each
  addition is its own source.
- Keep the editor's brackets, and every conflicting reading the volume
  prints.
- A second scan of the same volume is the same source. So is the
  cross-entry of a marriage under the other spouse's surname.
- Counting how many times a reading is cited does not settle a conflict.
  Neither does the kind of source on its own: a primary-kind source does not
  prove which of two transcriptions is right.

> **Example.** A printed volume gives "PELL, Josiah, s. Amos and Sarah,
> b. 3 May 1788. G.R.2." The key says "G.R.2" is a gravestone in the second
> burial ground. The birth date comes from the stone, read by the editor more than
> a century later. The town book does not give it.

### Handwritten schedules and registers

Census schedules, registers and other forms put each fact in a column.

- Read the column headings, and the whole row, before you assign a
  birthplace, a relationship or a parent's birthplace.
- Keep abbreviations and ditto marks in your reading. Write your
  interpretation separately from what is on the page.
- Keep an unexpected spelling or initial in a printed name or address. Do
  not replace it with the family's usual form.
- Anyone who checks your reading reads the image, not your transcription.
  See [review.md](review.md).
- When a rereading changes a conclusion, keep the old transcription and
  update every use of it.

> **Example.** On a census schedule, the three columns after a girl's age
> read "Wis", "Eng" and "do". The headings show they are her birthplace, her
> father's and her mother's. "do" (ditto) repeats the entry above it in the
> same column, on the previous person's row. Read that row before you decide
> what her mother's birthplace was. Record the reading as "do" and your
> interpretation separately.

### Historical dates

- **The start of the year.** In England and its colonies, the year began on
  25 March until 1752. A date from 1 January to 24 March before then belongs
  to two years in modern reckoning. Write both: 2 March 1714/15. In GEDCOM,
  write `2 MAR 1714/15`. `flyleaf coverage` warns when an ancestor's birth,
  death or marriage date in that range lacks both years.
- **Numbered months.** Some records, Quaker records among them, number the
  months. Before 1752 the first month was March, so the seventh month was
  September. From 1752 the first month was January. Check which practice the
  record keeper used.
- **Julian and Gregorian dates.** Britain and its colonies dropped eleven
  days in September 1752. Other countries changed at other dates. Keep the
  date as the record gives it. If you convert it, say so. Mark a Julian date
  in GEDCOM with `@#DJULIAN@`; Flyleaf prints it with "(Julian)".
- **A later compiler's dates.** A compiler may have converted some dates and
  not others. The event's year alone does not tell you which. Look for the
  compiler's own statement of method.
- **An impossible date.** A printed date that cannot exist, such as
  30 February, is a reading to keep and investigate. Do not choose another
  month to make it valid.
- **Provisional dates.** Keep a reported or estimated date marked as such:
  in the tree with a qualifier such as `ABT`, and in the register and the
  story.

### The subject's boundaries on the page

- In a register, match each name, relationship and date to its numbered row
  and its column heading. When an entry runs across two facing pages, line
  up the rows before you combine fields.
- In a book with several biographies on one page, find where your subject's
  entry begins and ends. Text near your subject does not belong to them
  because it is on the same page.
- If an index or transcription took a field from a neighbouring row, record
  the shift. Do not carry the shifted field into the tree.

> **Example.** A county history page holds the end of one man's sketch and
> the start of the next. The sentence "He married Miss Lydia Hale in 1859"
> sits just above the heading for Nathaniel Ashdown. It closes the previous
> sketch. It says nothing about Nathaniel.

### Obituary indexes

- An obituary index often lists each survivor named in a notice as a
  separate entry.
- Find the notice. Identify who died, and each indexed person's role in it.
- Being in an obituary collection does not show that a person died.

> **Example.** An obituary index lists "Hester Quayle, 1931". The notice is
> her father's, and she is named among the survivors. The entry shows that
> she was alive in 1931.

### Newspaper clippings

- Separate the words you can see in the clipping from a date supplied by a
  file name, a caption or the person who shared it.
- Without the dated issue, "this evening" or "the 7th inst." (the seventh of
  this month) gives no calendar date. It cannot settle a conflict over the
  year.
- In a compiled profile, read the notes on alternative dates as well as the
  headline date.
- Compare the ages a notice gives with the exact dates in the tree.

> **Example.** A scrapbook clipping reads "married on the 7th inst." A later
> hand has written "1894" on the page. Until you find the issue, the clipping
> gives a day of the month and nothing more.

### Photographs shared by other researchers

- Open and read the whole caption, and keep its qualifications, such as
  "presumed" or "believed to be".
- Tell apart the photographer, the person who first shared the picture, and
  the later people who saved it.
- An upload date is not the date of the photograph.
- Keep the address of the page you viewed it on, and the pixel size of the
  file you saved. Do not call that file the camera original.
- In the source title, say that a member of the site shared the picture, and
  keep any real-name photographer credit. Keep the member's account name in
  your research notes. Do not rely on a program to recognise an account name.

> **Example.** A gravestone photograph on a tree-sharing site is captioned
> "Stone of Josiah Pell (presumed). Photo by M. Hale." Six members have saved
> it. Your citation keeps "presumed", credits M. Hale, and records the page
> you saw it on.

### What a record leaves out

- Do not turn an omission into a negative fact. A short biography of a
  doctor that never mentions military service does not show that he never
  served.
- Before you treat an absence as evidence, establish that the record would
  have included the fact if it were true.
- An earlier event does not by itself rule out a later one. Ordination as a
  minister in one year does not exclude a medical degree later.

### Names and roles

- A shared surname does not connect generations that have not been traced.
- In a deed, a will or a marriage entry, tell apart the parties: buyer and
  seller, the testator (the person making the will) and the witnesses, the
  bride, the groom and the witnesses. Each role says something different.
- Keep separate documents separate, even when they name the same people.
- A deed printed in a later county history is a transcription inside an
  authored work. Reading the book does not mean you have examined the deed.

> **Example from the sample tree.** John Penhallow's 1866 marriage entry
> names Richard Penhallow as a witness. His baptism names his father as
> Richard Penhallow. The witness may be his father, but the marriage entry
> does not say so. The sample tree waits for a second record before it
> enters John's parents.

### When records conflict

- Keep every conflicting record in the citations.
- Explain the conflict in a note. Say which record the tree follows and why:
  who made each record, when, and how they knew.
- If you cannot resolve it, lower the confidence and name the record that
  could settle it.
- Counting sources does not resolve a conflict. Five trees copied from one
  book are one source.
- The kind of source does not decide on its own. A primary record can be
  wrong, as when an informant guessed an age.

## Online trees, profiles and AI

### Following an online profile back to its records

Collaborative profiles, such as WikiTree, Geni and the FamilySearch Family
Tree, and member trees on subscription sites, can point you to records
quickly. Use them for leads:

1. Find the profile for your person. Read its biography and its list of
   sources carefully.
2. For each fact, find the record the profile cites.
   - **A record is cited**, such as "death certificate no. 4471, county
     registrar" or "1850 census, roll 512, page 198". Find that record
     yourself, read it, save it, and cite it directly.
   - **Another user is cited**, such as "per user Smith". That is a lead.
     Record it as an open question.
   - **Nothing is cited.** That is a hint. Do not enter it as a fact.
3. Cite the profile as a lead beside the record. The record is the evidence.
4. Do not enter a parent or spouse the profile links without a citation as
   anything above `tree-link`. Better still, leave them out until a record
   names them.

> **Example from the sample tree.** An online tree names Edith May Rowe's
> parents but cites nothing. The sample tree cites the profile as a lead and
> does not enter the parents.

### AI-generated trees and text

- Many online trees now contain text written by AI tools. It reads well,
  cites nothing, and is sometimes invented outright. Tree-sharing features
  copy it from tree to tree. Treat recent uncited text in member trees with
  extra suspicion.
- An answer from an AI assistant is not a source. Never cite one.
- Ask an assistant for work with words: drafting, transcribing, abstracting
  and tabulating records you give it. Genealogists put this as "words, not
  facts". Do not ask it for facts you would otherwise look up.
- An assistant states a gap as a gap. It never invents a source, a citation,
  a web address, a record, a person, a date, a place or an event to fill one.
- When an assistant reports what a record says, it quotes the words and
  gives the place in the record.

AI tools make errors of known kinds: two people of one name merged,
relationships reversed, names drifting toward common spellings, places
misread from abbreviations, facts dropped from summaries, false corrections
accepted, and facts inferred beyond the record. The
[research playbook](research-playbook.md#ways-assistants-go-wrong) lists
each with a guard against it.

`flyleaf coverage` catches some of these in stories: a name one letter away
from a name in the tree, a year not in the records of the people a story
covers, and words of certainty. It cannot catch a wrong person or a reversed
relationship. Reading the draft against the records does.

### Transcriptions made with AI

- A transcription made by AI is derivative, like any transcription. Check it
  against the image before you rely on it.
- Check every name, date and number letter by letter. These are where AI
  readers make the errors that matter, and those errors are the hardest to
  predict.
- Look for skipped lines and substituted words. A transcription can read
  smoothly and still leave out a line.
- Keep the spelling, capitals and abbreviations of the original. AI tools
  tend to modernise spelling without saying so, turning "perfict" into
  "perfect". Undo that. Expand an abbreviation only in square brackets.
- A search index made by machine reading of handwriting, such as
  FamilySearch's full-text search, is a finding aid. Cite the image you read.
- Say in the citation note that you transcribed with AI help and checked
  the result against the image.

The [research playbook](research-playbook.md#transcription-with-an-ai-assistant)
covers how to run AI transcription well.

### Saying how you used AI

- When AI wrote substantial text or helped with analysis, say so in the
  book's note on methods. Say that you checked every fact against the
  records and that the conclusions are yours. Spelling checks and search
  tools need no statement.
- Credentialing bodies, journals and lineage societies set their own rules
  on AI. Read the current policy before you submit work.

The [research playbook](research-playbook.md#saying-how-you-used-ai) gives
the details, and [style-guide.md](style-guide.md) covers the note on
methods.

## Citation quality (QUAY)

`QUAY` is GEDCOM's code for the quality of the evidence. It records your
assessment of one citation, for the one fact it supports. It goes under the
citation: `3 QUAY 2` under a `2 SOUR` on an event, or `2 QUAY 2` under a
`1 SOUR` on the person.

| `QUAY` | GEDCOM 5.5.1 meaning | In practice |
|---|---|---|
| `3` | Direct and primary evidence | A record made at or near the time by someone in a position to know, read in the original or an image, for this fact |
| `2` | Secondary evidence, recorded some time after the event | A later statement in a good record, such as a birth year from an age at marriage; a transcription, abstract or index of a good record; a scholarly work that cites its records |
| `1` | Evidence of questionable reliability | A recollection long after the event; a compiled work that cites nothing; an unsourced online tree; a source with a reason to shade the truth |
| `0` | Unreliable evidence or an estimate | A statement contradicted by better evidence, or a guess |

- Assess each citation for its own fact. One source can carry `3` on one fact
  and `1` on another.
- Leave `QUAY` out when you have not assessed the citation. Never derive it
  from the person's confidence or the source's kind.

> **Example from the sample tree.** Ruth Kessler Solberg's oral history is
> cited with `QUAY 2` for her own wedding and her parents' wedding. It is
> cited with `QUAY 1` for her husband's parents' wedding, an event a step
> further from her own knowledge.

What Flyleaf does with `QUAY`: the build stops on any value other than 0,
1, 2 or 3. Flyleaf keeps `QUAY` in the tree it writes and in the website's
data. The book and the website do not show it, and the confidence check
does not use it.

## Research notes in the tree

The tree can carry research notes beside the facts. Flyleaf reads some of
them and simply keeps others.

| Tag or note | What it records | What Flyleaf does with it |
|---|---|---|
| `1 REFN <id>` with `2 TYPE jsonid` | The person's Flyleaf id | Required. The build stops without it, on a duplicate, or on characters other than lower-case letters, digits and hyphens. |
| `1 _CONFLEVEL` | The person's confidence | Checked; see [Confidence](#confidence). |
| `1 _RESEARCH_STATUS` | How far research on the person has gone (below) | Keeps it. Does not print, show or check it. |
| `1 _LAST_CHECKED YYYY-MM-DD` | The date of the last real research on the person | Keeps it. Does not print, show or check it. |
| `1 NOTE [TODO] <question>` | An open question about the person | Does not print it. Leaves its words out of the website. `flyleaf questionnaire` collects it (see [Open questions](#open-questions)). |
| `1 NOTE [NEGATIVE] <date> — <search>` | A search that found nothing | Does not print it. Leaves its words out of the website. Does not read it. |
| `QUAY 0` to `3`, under a citation | Your assessment of the citation | The build stops on other values; see [Citation quality](#citation-quality-quay). |

Values for `_RESEARCH_STATUS`:

- `unchecked`: nobody has researched the person yet.
- `in-progress`: research is under way.
- `exhausted`: the standard records have been searched, and more research is
  unlikely to add detail. Such a person is often called a brick wall.
- `needs-primary`: the person is at `tree-link`, and the work now is to
  find a primary record that would raise them.

Years written in a note on the person count as that person's years for the
`flyleaf coverage` check on years in stories. The check does not read a
shared note record, a note the person points to (`1 NOTE @N1@`), as many
exported trees use. For a year that appears only there, list it in the
story's `context_years` ([book.md](book.md)), after you have checked it.

### Where notes appear

Where you write a note decides who reads it. Research notes belong on the
person.

| Where the note is | In the book | On the website |
|---|---|---|
| On a person or a family (`1 NOTE`) | Not printed | Its words are left out |
| On an event or fact (`2 NOTE` under `BIRT`, `RESI`, `OCCU` and the like) | Not printed | Shown on the person's page |
| On a citation (a `NOTE` under a `SOUR` citation) | Printed with the footnote or the source entry | Shown with the reference |
| On a source record (`1 NOTE` under `0 @…@ SOUR`) | Not printed | Included in the site's data, which readers' browsers receive |
| On a media record or a file | Not printed | Shown with the file |
| An older-format `[Source]` note | Printed as the source | Shown as the source |

So:

- Put `[TODO]` and `[NEGATIVE]` notes, research reasoning and source history
  on the person.
- Write a note on an event as a reader-facing qualification, such as
  "Estimated from his age at marriage." Relatives will read it.
- Write citation notes for readers of the footnotes.
- Write source-record notes as if a relative will read them.

`flyleaf deploy` flags research wording in notes on events. You can name
your own phrases that stop it (`text_checks` in
[family-folder.md](family-folder.md)). It also stops when the printed book
contains one of the tree's own labels, such as `[TODO]`, `[Source]`,
`tree-link` or `compiled-secondary`. It reads the PDF with `pdftotext`, so
this check runs only where that tool is installed. A `[TODO]` written in a
citation note would trip it.

## Negative findings

A search that finds nothing is a result. Record it when:

- the search took more than about five minutes;
- a future session might repeat it;
- the absence itself tells you something, such as a family missing from a
  census where they should appear.

Do not record quick searches that returned nothing.

Record it twice: in the session's log entry, and as a note on the person:

    1 NOTE [NEGATIVE] 2026-10-12 — Searched the sample St Just burial register for 1845–1868 for Richard Penhallow; not found. He may have died after John emigrated.

A useful negative note says:

- the date of the search;
- the source, with its years, place and form: the index, the images, or the
  original;
- the names and spellings you tried;
- what you did not find;
- what the absence means, and what it does not mean;
- the next step, if there is one.

Before you treat an absence as evidence, establish that the record would
have included the person (see [What a record leaves out](#what-a-record-leaves-out)).
`research/questions.md` also has a "Tried so far" column for searches that
bear on an open question.

## Open questions

Keep open questions in two places:

- **On the person**: `1 NOTE [TODO] <question>`. It stays with the person in
  the tree, and genealogy programs such as Gramps show it among the notes.
- **In `research/questions.md`**: questions that span several people, and
  threads for later. Each row gives the question, the people, why it
  matters, the next record to try, and what has been tried so far.

Records that must be ordered, bought or asked for go in
`research/requests.md`, with where to ask, the cost and the status.

`flyleaf questionnaire <id>` writes a questionnaire for a relative. It reads
the relative's own notes, and their ancestors' notes up to three
generations back. Under "Questions only you may be able to answer", it lists
each sentence there that is marked `[TODO]`, `TODO:`, `OPEN:` or
`INVESTIGATE NEXT:`. It also lists sentences that say "needs research",
"not yet found", "not yet known", "not yet determined" or "not yet
identified". So:

- Put `[TODO]` notes on the person, not on an event. The questionnaire reads
  only notes written on the person (`1 NOTE` followed by the text). It does
  not read a shared note record that the person points to
  (`1 NOTE @N1@`).
- Write each one as a single plain sentence a relative could answer, under
  300 characters, with the marker in that sentence. The questionnaire takes
  only the sentence that holds the marker.
- In a negative note, write "not found" rather than "not yet found", or the
  questionnaire will collect it.

See [relatives.md](relatives.md) for working with relatives.

## The research log

End every session that changed the tree, or searched records worth
remembering, with an entry in `research/log.md`. Put the newest entry at the
top. Use this format:

```markdown
## YYYY-MM-DD: <what the session was about>

**Question:** <the question the session set out to answer, and why it matters>

**Sources checked:**
- <source, with the years, places and names searched>: <found / not found / partly>

**Found:**
- <fact>: cited on `<person id>` (<event>), QUAY <n>
- <fact>: confirms / contradicts <earlier claim>

**Not found:**
- <source>: <what was not there, the spellings tried, and what the absence means>

**Conflicts:**
- <the records that disagree, and how the tree now handles it>

**Open questions:**
- <question>: added to research/questions.md

**Records to request:**
- <record>: added to research/requests.md

**Confidence changes:**
- `<person id>`: <old> → <new>, because <reason>

**Copies saved:**
- <file in images/>, attached to <source>
- Not saved: <source>, because <reason>

**Commit:** <commit id, if the folder is a git repository>
```

Write "None" after a heading with nothing to report, so a reader knows you
did not forget it. Use the same care as everywhere else: "the index lists",
not "confirmed", unless you read the record.

> **Example.**
>
> ```markdown
> ## 2027-03-14: Ada Fenwick's death
>
> **Question:** When and where did Ada Fenwick die? The tree's 1903 comes
> from an online tree that cites nothing.
>
> **Sources checked:**
> - State death index, 1900–1910, Fenwick: found
> - County death register, vol. 4: found, p. 117
> - The town newspaper, 12–31 March 1903, page by page: not found
>
> **Found:**
> - The death register, vol. 4, p. 117, entry 9, gives her death on 12 March
>   1903 at Hadley Cross, aged 61. Cited on `ada-fenwick` (death), QUAY 3.
> - Her age gives a birth year of about 1842. Cited on her birth, QUAY 2.
> - The online tree's year agrees. It stays cited as a lead.
>
> **Not found:**
> - No death notice in the town newspaper. The paper printed few notices in
>   those years, so the absence says little.
>
> **Conflicts:** None.
>
> **Open questions:**
> - Her parents. The register's informant column is blank. Added to
>   research/questions.md.
>
> **Records to request:** None.
>
> **Confidence changes:** None. The register supports her death. Her place
> in the family still rests on the online tree.
>
> **Copies saved:**
> - The whole register page, attached to the register source.
> - Not saved: the index page, which the site's terms do not let you
>   download. Its title and entry are in the citation.
>
> **Commit:** 4f2c9a1
> ```

## Choosing what to research

The [research playbook](research-playbook.md#choosing-targets) explains how
to choose and rank targets, with a table of priorities. The standards behind
it:

- Rank research by what it would add to the family's story or to a
  consequential line, by the chance that the records answer, and by the
  effort.
- An empty slot in the pedigree does not set the priority by itself.
- Judge importance within the family as well as in wider history. A person
  whose importance lay in family life can carry a chapter.
- Before you extend a branch, write down what the next source could change,
  why that matters, and when you will move on.
- Extend a line only from a generation that rests on good records.
- Leave out an attractive connection that has no records for the
  generations between. A famous name in a record does not make that person
  a relative.
- Keep the whole register and the open questions while you choose where
  deeper research will help most.

## Adding a new person

Before a new person goes into `data/family.src.ged`, check that they have:

1. **A Flyleaf id:** `1 REFN <id>` with `2 TYPE jsonid`, in lower-case
   letters, digits and hyphens. The build stops without one, on a duplicate,
   or on other characters.
2. **At least one citation,** on the fact it supports.
3. **A confidence level the sources justify.** The build stops when `primary`
   has no primary or authoritative-secondary source.
4. **A research status,** `unchecked` if nothing else. Flyleaf keeps it but
   does not read it.
5. **A short note on the person** saying how they connect to the family, and
   on what evidence.
6. **Family links on both sides:** the person's `FAMC` or `FAMS`, and the
   family's `CHIL`, `HUSB` or `WIFE`. The build stops on a child link recorded
   on one side only, and warns on a partner link recorded on one side only.
7. **A marriage event only if a record shows a marriage.**
8. **A `PEDI` on each `FAMC`** when the person has more than one set of
   parents, so the book counts the right family as ancestors. The build
   warns about every person with more than one set of parents. It does not
   read the `PEDI`, so the warning stays after you add one.

The build checks items 1 and 6, and item 3 for `primary`. Item 8 is your
judgement, like the rest.

## Habits that keep a tree sound

- Add an ancestor only on the strength of records. An online tree compiled
  by other users is a lead.
- Mark a person `primary` only when a primary or authoritative record
  supports them. An online profile and a cemetery website together still
  make `tree-link`.
- Record what you searched for and did not find.
- Hold a link to a noble, famous or royal family to the same standard as any
  other. Such links attract invention, so check each generation between with
  particular care.
- Keep every conflicting source in the citations, and explain the conflict.
- Rate confidence by the evidence. When unsure, choose the lower level.
- Work back a generation only when the current one rests on primary records.

## Saving your sources

Save a copy of every source a conclusion rests on, when you cite it. Websites
change and pages vanish.

> **Example.** An obituary read on a funeral home's site in March is gone by
> June, and no web archive holds a copy. A saved PDF is now the only
> evidence.

What to save:

- **Record images** (certificates, census pages, registers, deeds): the
  original image or PDF, at the full resolution the site provides. Use a
  screenshot only when no original file is available.
- **Web pages** (obituaries, online profiles, directories): save the page as
  a PDF from your browser.
- **Books and long texts:** for a public-domain book you can download whole,
  keep the whole PDF or the page scans. For a book in copyright, or one
  borrowed from a lending library, take notes in your own words, record the
  pages, and quote only short passages. See [style-guide.md](style-guide.md)
  for quoting.
- **The whole source, when the whole is available:** the whole book, the
  whole certificate, the whole census page. A crop of the relevant lines is
  for illustrating the book. The whole copy lets anyone re-check any claim
  later. Cite the page, and keep the whole.
- **Within each site's terms.** Save copies only where the terms allow. Where
  they do not, record the full citation and the image number so that you
  can find it again.

If you cannot save a source you cite, say so in the session's log entry and
add it to `research/requests.md`. Each citation should rest on a copy you
hold, or the log should say why it does not.

Attach a saved copy to its source or citation with `OBJE` and `FILE`, and
record its checksum with `_SHA256` (see [gedcom.md](gedcom.md#files)).

Attaching a file to the tree publishes it. The website carries every file in
`images/` that the tree attaches to a person, source or citation the site
shows. A new family folder starts as a public static site
(`"hosting": "static"` in `flyleaf.json`), which anyone can read. Files in
the folders named in `site.research_folders`, such as `images/research/`,
stay off the website unless the tree gives them a `_KIND` and a `_SHA256`.
So keep a living person's records, and any copy you may not share, in such a
folder, and do not attach them. File names and scanning are in
[photos-and-documents.md](photos-and-documents.md).

### Check what you saved

A download that finished may still be the wrong file. Before you attach a
file:

- **A book:** open several pages spread through it, and confirm they belong
  to the work you meant. Catalogue records are sometimes wrong, and a scan
  labelled as one book can hold another.
- **An image:** confirm it shows the record you meant, and that it differs
  from its neighbours. Comparing checksums (`shasum -a 256 FILE`) catches one
  image saved twice under two names.

### Original scans over OCR text

Text made by OCR (optical character recognition: software that reads
printed text from an image) is a searchable supplement. Keep the original
scans as the source, and the text beside them for searching. OCR misreads
names and numbers.

### Dead sources

A citation whose web page is gone, with no saved copy and no other route to
the same content, is no longer usable evidence. Then:

1. Look for another copy: the Internet Archive's Wayback Machine, the same
   notice printed elsewhere, or the record the page drew on.
2. If you find one, cite it and save it.
3. If you find none, mark the citation, and lower every claim that rests on
   it alone.

In the older `[Source]` format, end the note with a dash and a mark, such as
`— [DEAD 2026-01-02: page gone]`. The mark records this, and never prints. For a native source, remove or replace the
dead `_URL`, and record the change in the session's log entry.

A page that your region cannot open is not dead. Do not get around the
block. Rely on it only where sources you hold support the same facts.

## Online sources

Cite an online source so a reader can find it again if the link dies: the
collection's title and the image, film or certificate number, not just a
web address.

- **FamilySearch:** use the record's permanent link, which contains `ark:`.
  FamilySearch supports only that form; its other addresses can change.
  `flyleaf coverage` warns about a FamilySearch search or record link
  without `ark:` among the book's ancestors' sources.
- **Subscription sites:** cite the database title and the image number, and
  give the site's main address. Record links often need a sign-in, and they
  change.
- `_URL` adds to the title and the `PAGE` locator. It does not replace them.

Use your own subscriptions, by hand or with an assistant working at a
person's pace, and follow each site's terms. See the
[research playbook](research-playbook.md).

## Living people

Write about living people only from what they have shared or from public
records, and nothing more.

A static site is public: anyone can read everything in it, living relatives
included. For a real family, use the Worker with sign-in, so only invited
relatives can open the site (see [hosting.md](hosting.md)). Otherwise leave
living people out of the site.

Keep the family's own repository private too. Its `flyleaf.json` lists
invited relatives' email addresses.

The map on the site loads its pictures from OpenStreetMap's servers, which
see each reader's internet address and the area they look at. See
[Privacy](hosting.md#privacy).

## For an AI assistant

All of this guide applies to you. These points matter most:

- Report in the same terms the tree uses. Write "the index lists" until you
  have read the record. Use "confirms" only for what the record you read
  supports.
- Quote the words of a record, with the place in the record, when you report
  what it says.
- State a gap as a gap. Never invent a source, a record, a date or a
  relationship.
- Ask the person before you change a conclusion the book already states.
- Record every confidence change, with its reason, in the log entry.
- Put research notes on the person, where readers do not see them.
- End each session with an entry in `research/log.md` in the format above.

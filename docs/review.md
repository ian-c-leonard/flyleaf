# Reviewing before you share or print

Relatives trust a family history. They repeat what it says, and copy it into
their own trees. This guide explains how to check a book before the family
sees it or a printer makes it:

- how much review each change needs;
- what Flyleaf checks for you, and what it cannot;
- the claim audit, a hostile read of every sentence against its source;
- independent reviewers, and prompts you can give an AI assistant;
- how to act on what reviewers find;
- the readers only a person can supply;
- the habits that keep an assistant's reports honest.

Two other guides hold the rules a review applies:

- [style-guide.md](style-guide.md): how the book is written, with the
  editorial checklist and the proof pass to run before any shared draft.
- [research-standards.md](research-standards.md): the evidence rules, such as
  kinds of source, confidence, and what a source can support.

## How much review a change needs

Fit the checks to the change.

### Routine changes

A corrected date, a new draft story, a new photograph or a reworded caption
is routine. For each one:

1. Run `flyleaf book`. It must finish without stopping.
2. Run `flyleaf coverage` and read every warning about what you changed.
3. Open the PDF and look at the pages you changed. If the change shows on
   the website, look at it there too (`flyleaf site dev`).
4. Commit the change with a message that says what changed. Add one line to
   your plan or research log.

That is enough. The commit and the log line are the change's record.

### Milestones

These need the fuller review in the rest of this guide:

- a story or a chapter marked final;
- an edition shared with the family;
- printing;
- a large change to Flyleaf's own code, if you change it yourself. Run
  `flyleaf test`, and have the change reviewed on its own (see
  [CONTRIBUTING.md](../CONTRIBUTING.md)).

| Milestone | Claim audit | Independent reviewers | Naive reader | People who read it |
|---|---|---|---|---|
| A story marked final | Every sentence of the story | Not needed | Not needed | You |
| A chapter marked final | Every story in it not yet audited | Four, each on its own: facts, standards, style, privacy | Yes | You and one other reader |
| An edition shared with the family | Every story changed since its last audit | Facts, standards and style (one reviewer may do both), privacy | Not needed | You and one other reader |
| Print | Every story changed since its last audit | Four, each on its own, over the whole book | Yes, for any chapter not yet tested | You, a proofreader and, ideally, a reader who knows genealogy |

Declare a milestone only after the fixes from its review are in.

## What Flyleaf checks, and what it cannot

Run Flyleaf's checks first, so reviewers spend their time on what only a
reader can judge.

- **`flyleaf book`** stops when a story cites a source the tree does not
  have, uses markup outside the supported list, or when a person marked
  `primary` has only weaker sources. See
  [what the build checks](book.md#what-the-build-checks).
- **`flyleaf coverage`** lists problems without stopping. It prints a rule
  code with each: an uncited paragraph of more than 90 words (L1), a
  sentence that gives a year and cites nothing (L2), a year not in the
  records of the people a story covers (L3), words of certainty such as
  "undoubtedly" (L15), a name one letter away from a name in the tree (L16),
  and style slips. It also lists ancestors with no story, stories that are
  still stubs, and stories whose people's records changed since you last
  marked them current. Every build writes the same list to
  `book/COVERAGE.md`.
- **`flyleaf book`** also writes `book/CLAIMS-MAP.json`. It lists each
  passage of the book's text with the citations it carries: each citation as
  the tree records it (title, page and note), the kind of source, and any
  files the tree attaches to the source. It shows where citations sit. It
  does not say whether a source supports its passage.
- **`flyleaf coverage --wording`** lists research wording in text readers
  see, such as "has not been verified". `flyleaf deploy`, and
  `flyleaf site build` for a public site, run the same check. Phrases you
  list under `text_checks.errors` in `flyleaf.json` stop them (see
  [family-folder.md](family-folder.md)).
- **`flyleaf site build`** stops when a public site would show someone who
  may be living (see [hosting.md](hosting.md)).

None of these can tell you:

- whether a source says what the sentence says;
- whether a relationship is the right way round, or a "his" points at the
  right man;
- whether an adjective or a "so" is earned;
- whether a living relative agreed to appear;
- whether a relative will finish the chapter.

That is the work of the claim audit, the reviewers and the readers below. A
build that passes means the book is consistent. Whether it is right is a
judgement for the people who check it.

## Get the book ready for review

Before a milestone review:

1. `flyleaf book` passes.
2. Every warning from `flyleaf coverage` about the text under review is
   fixed or answered. A comment line `// cite-lint: ok <reason>` just above
   a paragraph silences the story warnings for that one paragraph, except
   the warning about years. Use it for a deliberate exception, such as a
   caption, and write the reason.
3. No story is stale. When a story's records change, re-audit the passages
   that rely on them, then run `flyleaf coverage --mark <id>` to say the
   story is current again. `--mark` takes one person's id, so for a
   couple's story run it once for each of them. A story you made by hand,
   not with `flyleaf scaffold`, is tracked only after its first mark.
4. The editorial checklist and the proof pass in
   [style-guide.md](style-guide.md) are done.
5. The review pack is gathered (see [The review pack](#the-review-pack)).

## The claim audit

The claim audit is a hostile read of every sentence against its footnote.
Do it before a story's `status` moves from `draft` to `final`. Do it again
for any passage whose records change after that.

For each sentence, open what the footnote cites: a saved copy of the
source, or the words the tree records in the citation's `PAGE` and note.
Then ask:

1. **Does the source state this?** Or does it state something next to it?
2. **Is every word earned?** Adjectives ("prosperous", "devout", "beloved")
   and connecting words ("so", "because", "in order to", "as a result") are
   where unsupported claims usually get in. So are motives, feelings, firsts
   and lasts, "always" and "never", and "the whole family".
3. **Is it the right person?** A matching name, place and date make a likely
   match, so the text says "probably". Drop "probably" only when a record
   names the relationship.
4. **Is the source what the sentence calls it?** An index is not the record
   it indexes. A transcription is not the original.
5. **Is the certainty right?** The wording should claim no more than the
   kind of source allows (see [research-standards.md](research-standards.md)).
6. **Does it stand on an earlier guess?** A possibility in one story must
   not become a fact in the next, or in the register. Refer to an
   identification as proved only when it has been (Stratton and Hoff,
   ch. 12).

Anything the source does not state is reworded as a possibility, with words
such as "probably" and the reasoning visible (see
[style-guide.md](style-guide.md)). Otherwise, cite a source that does state
it, or cut it.

Two examples from the sample family:

| Draft sentence | What the source says | Rewrite |
|---|---|---|
| "When the Cornish mines failed, John took his young family to America." (cited to the 1998 study of St Just families) | Many men of the parish left Cornwall when the mines failed. It does not say why John left. | "Many St Just miners left Cornwall when the mines failed. John may have been one of them. In the spring of 1868 he sailed for America with Elizabeth and their son." Cite the study and the passenger list. |
| "John was a devout Methodist." (cited to his obituary) | "a faithful member of the Methodist church and for many years a class leader" | "He was a faithful member of the Methodist church and for many years a class leader." |

"Devout" describes a man's inner faith. The notice describes his membership
and his role. Keep to the source's own terms.

### Record the outcome

Give each sentence one outcome:

| Outcome | Means | What to do |
|---|---|---|
| Supported | The cited source states it. | Nothing. |
| Partly supported | The source states part of it. | Trim it to what the source states, or cite a second source for the rest. |
| Cited to the wrong source | The fact is right, but a different source carries it. | Cite the source that states it. |
| Unsupported | No cited source states it. | Find a source, reword it as a possibility, or cut it. |
| Contradicted | A source says something else. | Correct it. If the tree has the same error, correct the tree first. |
| Nothing to check against | You have neither a copy nor a transcription of the source. | Find and save the source before the story is final. |

### With an assistant

An assistant can do the first pass. Give it one story at a time, with the
words of each source the story cites: the saved copies, or the citations'
`PAGE` and note text from the tree. `flyleaf sources <id>` lists the
citations a story about that person can use. The claims map gives each
passage with its citations and attached files. Ask the assistant to:

- quote the exact words in the source that support each sentence;
- give each sentence one of the outcomes above;
- change nothing.

Check every "unsupported" and "contradicted" verdict before you change the
text, yourself or in a second assistant session. Assistants misread sources
too, and a second look overturns some verdicts. Then make the changes, and
set the story's `status` to `final` yourself.

## Independent reviewers

For a milestone, ask several reviewers to read the same text, each through
one lens. Each lens finds different problems. A fact-checker catches a wrong
number and passes a sentence that tells the story of the research. A style
reviewer catches the reverse.

| Lens | Reads the text against | Finds |
|---|---|---|
| Facts | The tree and the cited sources | Wrong dates, places, names, ages, sums, ancestor numbers, generations and relationships |
| Evidence standards | The research standards and the sources | Certainty beyond the evidence, conflicts left out, weak identity links, description no source supports |
| Style | The style guide | Research told as story, self-reference, repetition, figures of speech, inconsistent forms |
| Privacy | The people who may be living | Private facts about living people, sensitive matters, what the website exposes |

For a chapter marked final and for print, run four separate reviewers:
facts, standards, style and privacy. For an edition shared with the family,
one reviewer may run both the standards and the style prompts below, so
three reviewers are enough.

### Rules for every reviewer

- **Independent.** Each reviewer works alone: a separate assistant session,
  or a person who has not seen the other reports. Do not tell a reviewer what
  the others found, or what you expect to be wrong.
- **Read-only.** Reviewers report. They do not edit the stories, the tree or
  anything else. You make the changes, after triage.
- **Evidence in every finding.** Each finding gives where it is, the exact
  words quoted, a severity, what is wrong with the evidence (the tree's value
  or the source's words), and a suggested fix.
- **A list of what is correct.** Each reviewer ends with what it checked and
  found correct. That shows how far it got, and spares the next review from
  re-checking settled points.
- **Nothing the build already lists.** Give reviewers the output of
  `flyleaf coverage`, so they skip what it reports.

Severity:

| Severity | Means |
|---|---|
| Blocker | A false statement, a private fact about a living person, or a breach of a rule your style guide treats as absolute. Fix it before the milestone. |
| Should fix | An error, or a clear breach of the style guide or the research standards. Fix it, or answer it with evidence. |
| Minor | A small improvement. Fix it, or record why you did not. |

### The review pack

Give every reviewer the same pack:

- the text under review: the stories in `book/sketches/` and the chapter
  introduction in `book/chapters/`, in reading order, or the matching pages
  of the built PDF;
- the tree, `data/family.src.ged`;
- the citations each story can use (`flyleaf sources <id>` for each person
  it covers) and the claims map, `book/CLAIMS-MAP.json`;
- saved copies of the sources, where you have them (in `images/`);
- the style guide and research standards you follow: Flyleaf's, or your
  family's own;
- the output of `flyleaf coverage`.

An assistant that can read files in your family folder can open these
itself. For a chat assistant, paste the stories and the tree entries for the
people they cover, with those people's parents, spouses and children.

### Running reviewers with an assistant

1. Start one fresh session for each lens. If your assistant can start
   separate helper sessions, start one per lens and run them side by side.
2. Give each the review pack and its own prompt, and nothing more. Leave out
   the other prompts and your own worries about the chapter.
3. Save each report exactly as written.
4. Do the triage yourself, or in a new session that has all the reports.

## Reviewer prompts

Each prompt is ready to paste. Replace the parts in angle brackets.

### Facts

```text
You are the facts reviewer for a family-history book. Check every statement
of fact in the text against the family tree and the cited sources. Work
alone. Change nothing: report only.

What you have
- The text: <the story and chapter files, in reading order>.
- The tree: data/family.src.ged, a GEDCOM file. Each person has an id (REFN).
  Each story's header names the people it covers ("covers:") and the main
  person's ancestor number ("ahnentafel:").
- The citations: each #src("key") in the text names a citation in the tree.
  To look one up, run flyleaf sources <id> for a person the story covers. It
  lists each source key a story about that person can cite, with the
  source's kind and title. The citation's PAGE line in the tree says where in
  the source the evidence is, and often gives its words. Saved copies of
  sources are in images/ where the tree attaches them.
- The output of flyleaf coverage. Do not repeat what it lists.

Check every sentence for:
1. Dates, places and names. Each matches the tree and the cited source. Each
   place belongs to that event: a birthplace is not a marriage place, and a
   neighbourhood is not a city. Names are spelled as the tree spells them.
2. Arithmetic. Work out every age, age gap, length of a marriage, "outlived
   her by", "two years later" and count of children from the tree's dates.
   "In his sixty-seventh year" means aged sixty-six.
3. Ancestor numbers. A father is twice his child's number; a mother is twice
   plus one, so a wife's number is her husband's plus one. A child's number
   is a parent's number halved, dropping any half. Check that every
   "(no. N)" sits on the person who has that number.
4. Generations. Nos. 2-3 are parents, 4-7 grandparents, 8-15
   great-grandparents and 16-31 great-great-grandparents. Each further
   doubling adds one "great". Check every label such as
   "great-great-grandmother".
5. Relationships. Each is the right way round: father and son, aunt and
   niece are not swapped. Every "his", "her" and "their" points at the
   person meant. Birth order ("fifth son") and "only child" match the tree.
6. Chronology. Events happen in a possible order. A marriage date fits the
   first child's birth. Nobody acts after death or before they could.
7. Cross-references. A mention of another story or chapter agrees with what
   that story says.
8. The tree itself. If the text repeats an error that is in the tree, say so.

Report each finding as:
- Where: file and paragraph.
- Text: the exact words, quoted.
- Severity: blocker (a false statement), should fix, or minor.
- Problem: what the tree or source says instead, quoted, with the person's id.
- Fix: corrected wording.

Then list what you checked and found correct: dates, ages, sums, ancestor
numbers, generations and cross-references. End with a count of findings by
severity.
```

### Evidence standards

```text
You are the evidence-standards reviewer for a family-history book. Judge
whether each statement claims only what its evidence supports. Work alone.
Change nothing: report only.

What you have
- The text: <the story and chapter files, in reading order>.
- The tree: data/family.src.ged. Each source has a kind (_TIER): primary,
  authoritative-secondary, compiled-secondary, family-testimony or lead.
  Each person has a confidence (_CONFLEVEL): primary, tree-link, memoir or
  unknown. Notes on each person record conflicts between sources and open
  questions.
- The research standards: <research-standards.md, or your family's own>.
- The style guide's rules for writing about uncertainty: <style-guide.md, or
  your family's own>.
- For each person the text covers, the output of flyleaf sources <id>: the
  citations a story about them can use.
- The output of flyleaf coverage. Do not repeat what it lists.

Check:
1. Support. The cited source states the claim, not something next to it.
   Flag any claim that rests on a source the story does not cite or cannot
   cite.
2. Certainty. The wording fits the kind of source. A claim from an online
   tree, a compiled history or family memory needs "probably", "according
   to" or the like. Words such as "proves" and "confirms" need a record that
   states the fact.
3. Identity. A record tied to a person by name, place and date alone is a
   probable match. Only a record that names the relationship lets the text
   drop "probably".
4. Kinds of copy. An index is not the record it indexes. A transcription is
   not the original. Two copies of one record count as one piece of
   evidence.
5. Conflicts. Every conflict recorded in the tree's notes appears in the text
   with its resolution, or is plainly left open. No contrary record is
   silently dropped.
6. Consistency. An uncertain link is hedged the same way in every story,
   introduction, caption and register note that mentions it.
7. Bootstrapping. A possibility treated as proved later on; an earlier guess
   used as evidence for itself; an old surname or a famous family lending
   standing to a person whose link to it is unproved.
8. Unsupported description. Adjectives, motives, feelings, causes ("so they
   moved") and summaries of a life that no source states.
9. Places and actors. A place is given for an event only where a source puts
   the event there. The right body is named as acting: a court, a parish, a
   town meeting.

Report each finding as:
- Where: file and paragraph.
- Text: the exact words, quoted.
- Severity: blocker, should fix, or minor.
- Problem: what the evidence supports, naming the source and its kind.
- Fix: wording that claims only what the evidence supports.

Then list the passages that handle evidence well, so they are not flagged
again. End with a count of findings by severity.
```

### Style

```text
You are the style reviewer for a family-history book. Read the text as an
editor who knows the style guide well. Work alone. Change nothing: report
only.

What you have
- The text, in reading order: <the story and chapter files, or the pages of
  the built PDF>.
- The style guide: <style-guide.md, or your family's own>. Check the text
  against its sections on narrative, names, dates and numbers, places, and
  citations.
- The output of flyleaf coverage. It already lists many mechanical slips.
  Do not repeat them.

Check:
1. The research told as story. Sentences about how a fact was found, what
   the book once said, what research remains, or which record to look at
   next: "for now", "the next record to read", "a name this book could not
   find until". Plain statements of what the records show, or do not show,
   are fine.
2. Records as actors. A certificate or register that "does the family a
   service", "hides" a person or "disguises" a name.
3. Self-reference. The book or chapter talking about itself ("this
   chapter's lesson", "as this book shows"), or announcing its own devices.
4. Figures of speech. Metaphors and allusions, above all any a reader could
   take literally, and any that clash with each other.
5. Repetition. The same sentence shape opening or closing several stories in
   a row. The same event told in full in more than one place. Two chapters
   that open the same way.
6. References tied to page layout, such as "two pages back". Page breaks
   move between editions.
7. House forms. The style guide's forms for names, dates, numbers, ages,
   places, ancestor numbers such as "(no. 16)" and other repeated phrases,
   applied the same way everywhere. Place names spelled correctly.
8. Conflicts with the style guide. Where the whole text departs from the
   guide in the same way, report it once as a conflict, with a count and
   examples, for the author to decide.
9. Readability. Kinship spelled out in long sentences, census years listed
   one after another, too many people introduced at once.

Report each finding as:
- Where: file and paragraph, or page.
- Text: the exact words, quoted.
- Severity: blocker (a breach of a rule the style guide treats as absolute),
  should fix, or minor.
- Problem: the rule it breaks, or why it reads badly.
- Fix: suggested wording.

Then list the passages you judged sound, so they are not flagged again. End
with a count of findings by severity.
```

### Privacy

```text
You are the privacy reviewer for a family-history book and its website.
Protect living people and their close family. Work alone. Change nothing:
report only.

What you have
- The text: <the story and chapter files, or the built PDF>, and the
  website's pages if it has one.
- The tree: data/family.src.ged. A person or fact marked RESN privacy,
  confidential or locked is private.
- flyleaf.json. Under "site", "hosting": "static" means the site is public,
  and "worker" means only invited relatives can sign in.
  "publish_living_people": true lets a public site show people who may be
  living.
- <Notes of what each living relative agreed to share, if you keep them,
  such as research/permissions.md.>

Check:
1. Who may be living. List everyone the text or site names who has no record
   of death, burial or cremation and was born in the last 110 years, or has
   no birth date. Flyleaf's own check uses 100 years; someone born just
   before that may still be alive.
2. Facts about living people. Each is one they shared for publication, or a
   public record. Flag birth dates, addresses, contact details, health,
   adoption, parentage, divorce, money, court matters, children's schools,
   DNA results, and anything from a letter or interview not given for
   publication.
3. The recently dead. Matters that affect living relatives: cause of death,
   illness, adoption, a child born outside marriage, crime. Report them for
   a family decision. Do not assume they must go.
4. Pictures and captions. Every living person shown or named, and what the
   caption says about them.
5. Private people in print. Anyone marked private whom the text names, or a
   private fact the text states.
6. The website. If it is public, list every living person it shows. If it
   uses sign-in, note anything that should not reach every invited relative.

Report each finding as:
- Where: file and paragraph, page, or site page.
- Text: the exact words, quoted.
- Severity: blocker (a private fact about a living person without their
  agreement), should fix, or minor.
- Problem: whom it concerns, and why it is sensitive.
- Fix: remove it, make it general, or ask the person.

Then list the living people whose treatment you found correct. End with a
count of findings by severity.
```

## Triage

Take every finding in turn. Each one ends one of two ways:

- **Fixed.** You change the text, the tree, or both.
- **Answered.** You write down why no change is needed, with the evidence.
  "The story already states the conflict and gives the date from the
  original register" is an answer. "Not needed" is not.

Rules:

1. **Check before you change.** Reviewers make mistakes too. Confirm each
   finding against the tree or the source before you act on it.
2. **Treat agreement as a signal.** When two lenses find the same problem,
   it is almost certainly real.
3. **Fix the tree when it shares the error.** If a wrong age gap came from
   the tree's own notes, correct `data/family.src.ged` as well as the story.
4. **Fix the kind of error.** A wrong number on one wife means checking
   every wife's number in the book (see
   [Keeping an assistant honest](#keeping-an-assistant-honest)).
5. **Settle conflicts with the style guide.** When the whole text departs
   from the guide in the same way, such as numerals for ages where the guide
   asks for them spelled out, decide which is right. Then change the guide
   or change the text, so the two agree.
6. **Defer with a condition.** A minor finding you choose not to fix can
   carry a condition, such as "revisit if a reader stumbles here".
7. **Rebuild and re-read.** After the fixes, run `flyleaf book` and
   `flyleaf coverage`, and read every changed passage once more.
8. **Declare the milestone last.** Mark the chapter final, share the
   edition, or send the book to print only when the fixes are in.

Write a short triage note and keep it with the reports, for example in a
`reviews/` folder in your family folder, one folder per milestone. The note
lists:

- the findings fixed, by lens, one line each;
- the findings answered, each with its reason;
- any decision still to make, and who makes it;
- what the reviewers found correct, so the next review can take it as
  settled.

An invented example, for the sample family's Penhallow chapter:

```text
Penhallow and Treloar chapter: facts, standards and style, privacy

Fixed (7)
- Facts: "Elizabeth Ann Trembath (no. 16)" changed to no. 17.
- Facts: "died aged sixty-seven" changed to "in his sixty-seventh year",
  the notice's own words.
- Standards: "When the mines failed, John took his family to America" now
  says he "may have been one of" the miners who left.
- ...

Answered (2)
- Standards: footnote the county album's 1867 in the arrival paragraph.
  The story already states the album's year and why the register uses 1868.
- Style: dashes in the burial paragraph. Kept; they read clearly.

To decide (1)
- Style: ages are spelled out throughout, but our style sheet asks for
  numerals. Choose one and update the other.

Found correct by every lens
- Each conflict recorded in the tree is stated and resolved in the text.
- No living person is named with a private fact.
```

## The naive-reader test

For a chapter marked final, and before print, ask one relative who knows no
genealogy to read a chapter cold. Do they finish it? Where do they stall?

1. Choose someone who will be honest with you and who has not helped with
   the research.
2. Give them the chapter as the family will see it: printed pages, or the
   website.
3. Tell them nothing about it beforehand.
4. Ask them to mark each place where they stopped, skimmed, read a passage
   twice or lost track of who was who.
5. Afterwards, ask: Did you finish? Who was this chapter about? What will you
   remember? Where did you lose the thread?

The places they stall usually show kinship explained in prose (a chart or
an ancestor number does it better), terms nobody explained, census years
listed one by one, or too many people introduced at once.

No machine reviewer can tell you whether a relative will finish a chapter.
Only a reader can. This is one half of a two-reader test described by Hazel
Edwards in *Writing a Non-Boring Family History*: one reader who knows no
genealogy, who tells you whether the chapter holds them, and one who knows
it well, who checks the facts and the citations.

## A person must read the book

An assistant can draft, check and review. It cannot approve its own work.
Before an edition goes to the family or to print:

- You read all of it yourself.
- Someone else reads it too: a careful proofreader who catches slips and,
  if you can find one, a reader who knows genealogy (Stratton and Hoff,
  ch. 11).
- Independent AI reviewers add to these readers. They do not replace them.

## Keeping an assistant honest

These habits apply to every session, not only to reviews. Put them in your
folder's `AGENTS.md`, so every session reads them.

1. **Empty output is not success.** A search that prints nothing, a check
   with no warnings, a script that ends silently: none of these means
   "clean" until you know the tool ran. A check that crashed can also print
   nothing.
2. **Check that the tool ran.** Look at the exit status. Look for the line a
   tool prints when it works: `flyleaf coverage` begins "book coverage —
   root" with the number of people, and names `book/COVERAGE.md`. It ends
   with the family-text count, such as "0 family-text error(s), 2
   warning(s)". Check that a file the tool should write has changed.
3. **Check a summary against the change.** Before a commit message or a
   report says "fixed", read the change itself (`git diff --staged`). Report
   what was done, what was skipped and what failed, with the output.
4. **Facts an assistant writes are claims until sourced.** This includes
   historical background. Adding a year to `context_years`, or a
   `// cite-lint: ok` comment, silences a warning. It is not evidence. Use
   them only for statements a source supports.
5. **Fix the kind of error, not only the instance.** When a review finds an
   error, ask what kind of error it is, then look for every other case. If
   you can, add a check for that kind: a test if you change Flyleaf itself,
   or a pattern under `text_checks` in `flyleaf.json`, or a line in your
   style sheet that every review applies.
6. **Fix the source, not the output.** Correct the tree in
   `data/family.src.ged` and the text in `book/`. The build rewrites
   `data/family.ged` and everything in `build/`, so an edit made there is
   lost at the next build.
7. **Change a conclusion everywhere.** When a conclusion changes, update
   every story, register note, caption and profile that states it. Once you
   have marked a story current, `flyleaf coverage` lists it as stale
   whenever its people's records change.
8. **Give the facts fresh.** Over a long session an assistant drifts: names
   slide towards their common spellings, and people with the same name
   merge. Give it the records and the tree entries with each task.
   `flyleaf coverage` warns about a name one letter away from a name in the
   tree (L16), but it cannot catch every drift.
9. **Ask for the source's words.** Ask for the exact words in the source
   behind each claim. Check what the assistant left out, as well as what it
   added.
10. **Test corrections against records.** An assistant tends to accept
    whatever it is told. When someone corrects a fact, check the correction
    against a record before you change the tree.
11. **Keep checks in proportion.** Routine work needs its checks, a look and
    a commit. Save the full review for milestones.

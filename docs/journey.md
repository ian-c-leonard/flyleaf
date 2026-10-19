# From a tree to a finished book

This guide walks through the whole process, in the order that works. Each
step links to the guide with the detail. Read it once before you start, and
come back to it when you finish a stage.

Most of the time goes into two things: research, and writing the stories.
Flyleaf does the rest. It builds the register, charts, sources and index
from the tree, and checks the stories against the tree each time it builds.

## What you will make

- **A book.** A PDF ready for print. Part I tells the family's story in
  chapters, one for each family line. Part II is the register: an entry for
  every ancestor, numbered so a father is twice his child's number. Charts,
  sources and an index follow. The [sample book](https://flyleaf.family/sample-book.pdf)
  shows the shape.
- **A website.** The same family, to browse: people, the tree, the book,
  photographs, documents and places. It can be private, behind sign-in, or
  public. The [demo](https://flyleaf.family/demo/) shows a made-up family.

## 1. Set up

Install Flyleaf and its tools, and start a family folder with
`flyleaf new`. See [quick-start.md](quick-start.md). The new folder holds
`AGENTS.md`, which tells an AI assistant how to work on it, and `PLAN.md`
for your plan.

## 2. Make a plan

Write down, in `PLAN.md`:

- **The goal.** What you will make, for whom, and by when. A family edition
  for a reunion is a different project from a book for a library.
- **The scope.** Whose ancestors, and how far back. A book can start from
  you, a parent or a grandchild. Flyleaf calls this person the root.
- **Your priorities,** in order.
- **Standing decisions,** so an assistant need not ask again: a research
  budget per session, what to publish about living relatives, whether the
  website is private, who reviews the book.

## 3. Bring in the tree and clean it

Export your tree from your genealogy program as GEDCOM, and import it with
`flyleaf import your-tree.ged --root "Your Name"`. Then build the book once
with `flyleaf book`. It will be thin, but it shows the shape and what is
missing.
See [quick-start.md](quick-start.md) and [gedcom.md](gedcom.md).

Clean the tree before you research:

- Fix what the build reports: people without sources, confidence levels
  their sources cannot support, family links recorded on one side only, and
  places written with two-letter state codes.
- Merge duplicate people in your genealogy program, then import again with
  `flyleaf import your-tree.ged --replace`, or edit `data/family.src.ged`
  directly.
- Every imported person starts at the confidence level `tree-link`: compiled
  work, until you cite records. That is honest. Raise it only when a record
  supports it. See [research-standards.md](research-standards.md#confidence).

## 4. Research

Read [research-standards.md](research-standards.md) first. It says what
counts as evidence, how to judge a record, and how to cite it. Then
[research-playbook.md](research-playbook.md) explains how a research
session runs: choosing what to look for, where to look, when to stop, and
how to record what you found and what you did not.

- Start with your direct ancestors. Give each one at least one good record
  for birth, marriage, death and parents.
- Then choose by what matters to the story: a migration, a war, a change of
  work, a loss, a photograph waiting to be identified.
- Keep a log of each session in `research/log.md`, open questions in
  `research/questions.md`, and records to order in `research/requests.md`.
- Save a copy of every source you cite. See
  [photos-and-documents.md](photos-and-documents.md).

## 5. Talk to relatives

Start early, and start with the oldest. Their memories, photographs and
papers are the sources most likely to be lost. `flyleaf questionnaire`
writes a questionnaire for a relative from what the tree already says. See
[relatives.md](relatives.md).

## 6. Gather photographs and documents

Scan photographs and papers, keep the whole original, and write down where
each came from. Identify people in a photograph only from evidence. See
[photos-and-documents.md](photos-and-documents.md).

## 7. Write the stories

Each ancestor's story is a file in `book/sketches/`. `flyleaf scaffold`
starts one for each ancestor, and `flyleaf sources` lists the sources a
story can cite. [style-guide.md](style-guide.md) explains how to write
them: the voice, names, dates, places, citations, and how to write when the
records leave questions. [book.md](book.md) explains the mechanics.

A loop that works with an AI assistant (if the list of sources is empty,
see [book.md](book.md#writing-with-an-ai-assistant) first):

1. Give the assistant the person's records and the list of sources.
2. Ask for a draft that cites every fact and adds nothing the records do not
   say.
3. Read the draft against the records. Correct it.
4. Build the book. Read the warnings from `flyleaf coverage`.
5. Mark the story final only when every sentence holds up.

## 8. Review

Before you share a chapter or an edition, review it. Read every sentence
against its source. For a milestone, ask independent reviewers to check
the facts, the standards and the privacy of living people. Ask one relative
who knows no genealogy to read a chapter, and note where they stop. See
[review.md](review.md).

## 9. Share a first edition

Share a first edition early. Relatives remember more when they see
something real, and they send corrections and photographs. A private
website with sign-in is a good way to share it. See [hosting.md](hosting.md).
Then go back to research and writing with what they send.

## 10. Print

When the book is ready, follow the print steps in
[style-guide.md](style-guide.md): proofs, the archival PDF
(`flyleaf book --archival`), and copies for libraries and societies.

## 11. Keep it going

- Each new edition is another build. The register updates itself from the
  tree; `flyleaf coverage` lists the stories that need revising.
- A documented line can support a lineage-society application. See
  [lineage-societies.md](lineage-societies.md).

## Working with an AI assistant

An AI assistant can do much of the work. It can search record sites with
your accounts, read and transcribe records, draft stories, check citations
and run the builds. The folder's `AGENTS.md` tells it how. Some ways to
start a session:

- "Read AGENTS.md and help me fill in PLAN.md."
- "Read AGENTS.md. Run a two-hour research session on my mother's father's
  line, following the research playbook."
- "Draft the story for ancestor 12 from the records, following the style
  guide. Cite every fact."
- "Review chapter 2 as the review guide describes, with three independent
  reviewers."

Some things stay with you:

- judging the evidence, and the final say on every conclusion;
- paying for records, and signing in to accounts;
- contacting relatives and archives;
- reading the book yourself before anyone else does.

An assistant can be wrong with confidence. A draft stays a draft until you
have checked it against the records.

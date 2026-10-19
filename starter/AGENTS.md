# Working on this family history

This folder holds one family's history. Flyleaf builds a book (a PDF) and a
website from it. You are helping the person who keeps it. These instructions
are for you, the assistant. The person can read them too.

Flyleaf itself lives in its own folder: `{{FLYLEAF}}` from here. Its guides
are in that folder's `docs/`, and online at
https://github.com/ian-c-leonard/flyleaf/tree/main/docs. If that path no
longer works, ask the person where they keep Flyleaf; `flyleaf doctor`, run
from there, prints its folder.

## Start here

1. Read [PLAN.md](PLAN.md). It holds the goal, the person's priorities, the
   task list and their standing decisions. If it is still empty, help the
   person fill it in first.
2. If this folder is a git repository, run `git status --short` and
   `git log --oneline -10`. Keep any unfinished work you did not create.
3. Pick the next open task in priority order.
4. Read the guide that task needs, before you start it:

| Task | Read |
|---|---|
| Any task, the first time | `{{FLYLEAF}}/docs/journey.md`: the whole process, start to finish |
| Setting up, importing a tree | `{{FLYLEAF}}/docs/quick-start.md`, `{{FLYLEAF}}/docs/gedcom.md` |
| Research | `{{FLYLEAF}}/docs/research-standards.md`, then `{{FLYLEAF}}/docs/research-playbook.md` |
| Talking to relatives | `{{FLYLEAF}}/docs/relatives.md` |
| Photographs and documents | `{{FLYLEAF}}/docs/photos-and-documents.md` |
| Writing or revising stories | `{{FLYLEAF}}/docs/book.md`, then `{{FLYLEAF}}/docs/style-guide.md` |
| Before sharing with family, or printing | `{{FLYLEAF}}/docs/review.md` |
| Publishing the website | `{{FLYLEAF}}/docs/hosting.md` |
| A lineage-society application | `{{FLYLEAF}}/docs/lineage-societies.md` |
| Settings | `{{FLYLEAF}}/docs/family-folder.md` |

## Where things are

| Path | What it holds |
|---|---|
| `flyleaf.json` | The family's settings, including invited relatives' email addresses |
| `data/family.src.ged` | The family tree. Edit this file. |
| `data/family.ged` | Made by the build. Never edit it; the next build replaces it. |
| `book/` | Book settings, chapters, stories (`book/sketches/`), front and back matter |
| `images/` | Original photographs and documents |
| `site/` | Website content. Every file is optional. |
| `research/log.md` | One entry for each research session |
| `research/questions.md` | Open questions, with the next record to try |
| `research/requests.md` | Records to order or ask for, and what each costs |
| `build/` | The book PDF and other output. The build rebuilds it. |

## Protect the facts

- Every fact in the tree needs a source. Cite it on the event it supports.
- Never invent a fact, a date, a relationship, a motive or a face. When the
  records do not say, write that they do not say.
- An online tree is a lead, not evidence. An index is not the record it
  indexes. A matching name and date is a match, not proof.
- Keep every record that conflicts with a conclusion. Explain the conflict,
  or lower the person's confidence. Never drop the record.
- Keep each person's id (the `REFN` line). Stories and the website use it.
- When a conclusion changes, update every story, caption and register note
  that states it. Search the `book/` folder for the old wording.
- Living people: use only public-record facts and what they agreed to share.
- Stories are for the family. Research notes and doubts about evidence go in
  the tree's notes and the sources, not in the story.

## How to work

- **Ask the person first** before you spend money, create an account, sign
  in anywhere, contact a relative or an archive, publish the website, delete
  a file, or change a conclusion the book already states.
- **Respect every website's terms.** Use the person's own accounts, at a
  person's pace. Do not download in bulk. Do not get around a sign-in, a
  paywall, a bot check or a regional block. If a site stops you, stop and
  tell the person.
- **Treat your own words as claims.** A fact you write is a claim until a
  source supports it. Read the record, not a summary of it.
- **Check that a check ran.** Empty output is not success. Look at the exit
  code. A crashed tool also prints nothing.
- **Check before you say done.** Before you report a change, look at the
  change itself: the file, the page, the PDF.
- **Re-read before you write.** Before drafting a story, read the people's
  records in `data/family.src.ged` again. Names and dates drift in a long
  session.
- **One writer for the tree.** If several assistants work at once, only one
  edits `data/family.src.ged` and the stories. The others return reports.
- **Fit the checks to the change.** A routine change needs `flyleaf book`
  and a look at the result. Independent review is for milestones: a chapter
  marked final, an edition for the family, and print. See `docs/review.md`.
- **Stay on what matters.** Before each task, ask: would a family member
  notice the result? If you make no progress for an hour, try a simpler
  route, or ask the person.

## Commands

Run these from this folder. If `flyleaf` is not on the PATH, use
`{{FLYLEAF}}/flyleaf`.

| Command | What it does |
|---|---|
| `flyleaf doctor` | Checks the tools this machine needs |
| `flyleaf import FILE.ged --root "Name"` | Brings in a tree from another program |
| `flyleaf book` | Checks the tree and builds `build/book.pdf` |
| `flyleaf coverage` | Lists ancestors without a story, stories out of date, and wording to check |
| `flyleaf scaffold` | Starts a story file for each ancestor without one |
| `flyleaf sources PERSON` | Lists the sources a story about that person can cite |
| `flyleaf questionnaire PERSON` | Writes a questionnaire for a relative |
| `flyleaf site dev` | Shows the website on this computer |
| `flyleaf deploy` | Publishes a private website, with sign-in. A public site is built with `flyleaf site build` and copied to a host by hand (`{{FLYLEAF}}/docs/hosting.md`). Ask the person first, either way. |

## End every session

1. Run `flyleaf book`. It must finish without errors.
2. Run `flyleaf coverage`. Note new ancestors without stories, and stories
   now out of date.
3. Add an entry to `research/log.md`. Move answered questions out of
   `research/questions.md`, and add new ones.
4. In `PLAN.md`, tick off finished tasks and add one dated line to the log.
5. If this is a git repository, commit the files you changed. Name each
   file; do not add everything. Push only if the person keeps a remote copy
   and has said to push.
6. Tell the person, briefly: what you found, what changed, what you spent,
   and the single best next step.

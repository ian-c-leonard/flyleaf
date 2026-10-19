# A Flyleaf family

- `flyleaf.json`: the family's settings (name, website, maintainer, hosting).
- `data/family.src.ged`: the family tree. Edit this file, or import your tree
  again with `flyleaf import your-tree.ged --replace` (the old file is kept
  as a `.bak`).
- `book/`: the book's settings, chapters, sketches and front matter.
- `images/`: photographs, documents and other originals.
- `site/`: website content, such as albums and the changelog. Every file is
  optional.
- `research/`: your research log, open questions and records to request.
- `PLAN.md`: your goal, priorities, decisions and tasks.
- `AGENTS.md`: instructions for an AI assistant working on this folder.
  `CLAUDE.md` points Claude Code to it.
- `build/`: the book PDF and other output. Flyleaf rebuilds it.

Run `flyleaf doctor` to check this machine, then `flyleaf book`, and
`flyleaf site dev` to see the website on your own computer. Flyleaf's `docs/journey.md` walks through the whole process.

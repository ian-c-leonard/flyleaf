#!/usr/bin/env python3
"""Propose the book's chapters from the tree, when book.yaml has none.

The book groups ancestors into chapters by family line.
This writes a first plan: the father's side, the mother's side, and the
present generation. Edit book.yaml afterwards to split or rename chapters.

  book-chapters.py [--tree FILE.ged] [--root PERSON] [--out FILE]
  book-chapters.py --tree FILE.ged --check

--tree and --root plan from a tree and a root that are not installed yet;
--out writes the planned book.yaml there instead of over book.yaml.
--check only checks that the book can read the tree.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ascii_ids  # noqa: E402
import booklib  # noqa: E402
from gedcom.parser import GedcomFormatViolationError  # noqa: E402


# A side with more lines than this names its nearer ones, those that start
# within four generations of the root, and leaves the rest to other_lines.
NAMED_LINES = 12
NEAR = 32


def chapter_id(surname, fallback, taken):
    """A slug from the surname, else the fallback, never one already taken:
    two sides with the same surname get smith and smith-2."""
    base = ascii_ids.slug(surname) or fallback
    chosen, counter = base, 2
    while chosen in taken:
        chosen = f"{base}-{counter}"
        counter += 1
    taken.add(chosen)
    return chosen


def proposal(tree, root_refn):
    table = tree.ahnentafel(root_refn)
    first_seen = {}
    for n in table:
        first_seen.setdefault(tree.line_of(n, table), n)
    sides = {2: [], 3: []}
    for line, n in first_seen.items():
        if line != "origin":
            sides[booklib.side_of(n)].append(line)
    chapters, taken = [], {"present"}
    for n, label in ((2, "father"), (3, "mother")):
        if not sides[n]:
            continue
        founder = tree.by_xref[table[2 * n if n == 3 and 2 * n in table else n]]
        # book.yaml reads a # as the start of a comment and " as a quote.
        surname = re.sub(r'[#"]', "", founder.get("surname") or "").strip()
        title = f"The {surname} Side" if surname else f"The {label.title()}'s Side"
        chapter = {"id": chapter_id(surname, label, taken), "title": title, "lines": sides[n]}
        if len(sides[n]) > NAMED_LINES:
            chapter.update(lines=[ln for ln in sides[n] if first_seen[ln] < NEAR],
                           other_lines=label, more=len([ln for ln in sides[n]
                                                        if first_seen[ln] >= NEAR]))
        chapters.append(chapter)
    chapters.append({"id": "present", "title": "The Present Generation", "lines": ["origin"],
                     "charts": "false"})
    return chapters


def render(chapter):
    extra = f', other_lines: {chapter["other_lines"]}' if chapter.get("other_lines") else ""
    extra += ", charts: false" if chapter.get("charts") == "false" else ""
    return (f'  - {{id: {chapter["id"]}, title: "{chapter["title"]}", '
            f'lines: [{", ".join(chapter["lines"])}]{extra}}}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tree", type=Path, default=booklib.SRC_GED)
    parser.add_argument("--root", help="the book's root person (default: root_refn in book.yaml)")
    parser.add_argument("--out", type=Path, default=booklib.BOOK_YAML)
    parser.add_argument("--check", action="store_true", help="only check that the tree can be read")
    args = parser.parse_args(argv)
    cfg = booklib.load_book_yaml()
    text = booklib.BOOK_YAML.read_text()
    try:
        # Reading the tree and walking up from the root checks them both.
        tree = booklib.Tree(args.tree)
        if args.check:
            # When the book has a root already, the new tree must hold it, and
            # its lines must not loop.
            if args.root or cfg.get("root_refn"):
                proposal(tree, args.root or cfg["root_refn"])
            return
        root = args.root or booklib.root_refn(cfg)
        chapters = proposal(tree, root)
    except (KeyError, ValueError, GedcomFormatViolationError) as problem:
        sys.exit(f"The tree cannot make a book yet: {' '.join(str(problem).split())}")
    if cfg["chapters"]:
        print("book.yaml already lists chapters; left as they are.")
        if args.out != booklib.BOOK_YAML:
            args.out.write_text(text)
        return
    block = "chapters:\n" + "\n".join(render(c) for c in chapters) + "\n"
    if re.search(r"^chapters:\s*$", text, re.M):
        text = re.sub(r"^chapters:\s*\n", lambda _: block, text, count=1, flags=re.M)
    else:
        text = text.rstrip("\n") + "\n\n" + block
    args.out.write_text(text)
    print(f"Proposed {len(chapters)} chapters for the book:")
    # Two lines have ids rather than surnames; name them for the reader.
    plain = {"origin": "the book's subject and their brothers and sisters",
             "unknown": "ancestors whose surname is not recorded"}
    for chapter in chapters:
        more = f", and {chapter['more']} more distant lines" if chapter.get("more") else ""
        lines = ", ".join(plain.get(line, line) for line in chapter["lines"])
        print(f"  {chapter['title']}: {lines}{more}")


if __name__ == "__main__":
    main()

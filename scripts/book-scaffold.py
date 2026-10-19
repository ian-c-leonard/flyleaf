#!/usr/bin/env python3
"""Create narrative-section stub files for ancestors that have none.

HARD GUARANTEE: never opens an existing file for writing (open(..., "x")).
Existing stories are never changed by a script.

Default grouping follows NEHGS/Newbury Street Press practice: one section per
ancestor-COUPLE — the husband's file `covers` both spouses (the wife of
ahnentafel 2n is 2n+1). Unmarried/root persons get their own file, and so
does a wife whose husband's existing story covers only him.

Usage:
  book-scaffold.py [--dry-run]
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import booklib  # noqa: E402
import flyleaf_settings  # noqa: E402

STUB_TEMPLATE = """// ---
// refn: {refn}
// covers: [{covers}]
// ahnentafel: [{ahnen}]
// status: stub
// line: {line}
// ---

// Write the story of {name}{spouse_note} here, below these notes.
// They are no. {n} in the ancestor table, generation {gen}, in the {line} chapter.
// Their facts and sources are in {gedcom} (id {refn}).
// List the sources you can cite: flyleaf sources {refn}
// Tell the story first, and keep the context about this person.
// Cite a source with #src("key"). Name a relative with #refp("their-id").
// Add a picture with #fig("photographs/file.jpg", caption: "...").
// Write plain paragraphs; the book adds the heading. See docs/book.md in
// Flyleaf's folder, or https://github.com/ian-c-leonard/flyleaf/blob/main/docs/book.md
// When the story is written, change status above from stub to draft.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tree = booklib.Tree()
    cfg = booklib.load_book_yaml()
    root = booklib.root_refn(cfg)
    table = tree.ahnentafel(root)
    nums = tree.numbers_by_xref(table)

    # existing claims
    claimed = set()
    if booklib.SKETCH_DIR.exists():
        for f in booklib.typ_files(booklib.SKETCH_DIR):
            meta, _ = booklib.parse_front_matter(f)
            for c in meta.get("covers") or ([meta["refn"]] if meta.get("refn") else []):
                claimed.add(c)

    sync = {}
    if booklib.SYNC_JSON.exists():
        sync = json.loads(booklib.SYNC_JSON.read_text())

    created = []
    for n in sorted(table):
        xref = table[n]
        p = tree.by_xref[xref]
        refn = p["refn"]
        # A wife is covered by her husband's couple section when one is made
        # below; when his existing story covers only him, she gets her own.
        if not refn or refn in claimed:
            continue

        covers = [refn]
        spouse_note = ""
        if n % 2 == 0 and (n + 1) in table:  # husband: pull in wife
            wife = tree.by_xref[table[n + 1]]
            if wife["refn"] and wife["refn"] not in claimed:
                covers.append(wife["refn"])
                spouse_note = f" and {(wife['given'] or '')} {(wife['surname'] or '')}".rstrip()

        ns = nums[xref]
        fname = booklib.SKETCH_DIR / f"{ns[0]:04d}-{refn}.typ"
        content = STUB_TEMPLATE.format(
            refn=refn,
            covers=", ".join(covers),
            ahnen=", ".join(str(x) for x in ns),
            line=tree.line_of(ns[0], table),
            name=f"{p['given'] or ''} {p['surname'] or ''}".strip(),
            spouse_note=spouse_note,
            n=ns[0],
            gen=tree.generation(ns[0]),
            gedcom=flyleaf_settings.require("paths.source_gedcom"),
        )
        if args.dry_run:
            print(f"would create {fname.name}  covers={covers}")
        else:
            booklib.SKETCH_DIR.mkdir(parents=True, exist_ok=True)
            with open(fname, "x", encoding="utf-8") as fh:  # create-only: never overwrite
                fh.write(content)
            for c in covers:
                sync[c] = {"gedcom_sha": tree.person_hash(c),
                           "accepted_at": date.today().isoformat()}
            print(f"created {fname.name}  covers={covers}")
        claimed.update(covers)
        created.append(fname)

    if not args.dry_run and created:
        booklib.SYNC_JSON.write_text(json.dumps(sync, indent=2, sort_keys=True) + "\n")
    if not created:
        print("nothing to scaffold — every ancestor is already covered")


if __name__ == "__main__":
    main()

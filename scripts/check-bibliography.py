#!/usr/bin/env python3
"""Check compiled bibliography coverage, source identity and census exceptions."""
import json
from pathlib import Path
import subprocess
import sys

import bookbib
import booklib


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    src = Path(args[0]) if args else booklib.ROOT / "build" / "book.typ"
    try:
        proc = subprocess.run(
            ["typst", "query", str(src),
             "selector(<bibliography-use>).or(<bibliography-entry>)",
             "--root", str(booklib.ROOT)], capture_output=True, text=True)
        if proc.returncode:
            raise ValueError(proc.stderr)
        tree = booklib.Tree()
        people = tree.register_people(booklib.root_refn(booklib.load_book_yaml()))
        stats, errors = bookbib.check_inventory(tree.sources_by_person(), bookbib.load_policy(),
                                               json.loads(proc.stdout), people=people)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        sys.stderr.write(f"check-bibliography: FAIL — {exc}\n")
        return 1
    if errors:
        for error in errors:
            sys.stderr.write(f"check-bibliography: FAIL — {error}\n")
        return 1
    print(f"check-bibliography: OK — {stats['entries']} entries; "
          f"{stats['sources']} sources in {stats['uses']} compiled keyed uses; "
          f"{stats['census_omissions']} reviewed census omissions")
    return 0


if __name__ == "__main__":
    sys.exit(main())

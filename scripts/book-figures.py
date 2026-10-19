#!/usr/bin/env python3
"""Generate the book's linked descent charts at their actual print size.

The geometry, family model and preservation checks live in bookcharts.py.
Only generated artifacts under build/figures are written or replaced.
"""
import bookcharts
import booklib


def main():
    manifest = bookcharts.generate()
    # Retire only the known outputs of the former one-sheet generator. Keeping
    # these stale files would make an obsolete, unreadable chart look current.
    directory = booklib.ROOT / 'build' / 'figures'
    for chapter in booklib.load_book_yaml()['chapters']:
        (directory / f"tree-{chapter['id']}.svg").unlink(missing_ok=True)
    (directory / 'tree-overview.svg').unlink(missing_ok=True)
    for chapter_id, chapter in manifest['chapters'].items():
        print(f"charts: {chapter_id}: {len(chapter['panels'])} panels, "
              f"{len(chapter['graph']['nodes'])} family boxes, 9pt text")


if __name__ == '__main__':
    main()

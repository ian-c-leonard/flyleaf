#!/usr/bin/env python3
"""Account for every general source key in the compiled register references.

Expected keys come from the source tree and named family scope, independently of
the assembler's chapter grouping. This checks preservation and attribution,
not whether a source supports a claim or the citation is visually readable.
"""
from collections import Counter
import json
from pathlib import Path
import subprocess
import sys

import booklib
import flyleaf_settings

ROOT = flyleaf_settings.family_root()


def expected_keys(tree, root_refn):
    # Follow descendant families and separately recorded children of named
    # partners, never a partner's ancestry or unrelated childless unions.
    # A limited partner visit must not suppress a later full descendant visit.
    # This walk is
    # independent of the renderer's entry ordering and emitted metadata.
    numbered = set(tree.ahnentafel(root_refn).values())
    pending = [(xref, False) for xref in numbered]
    included, expanded = set(numbered), set()
    while pending:
        xref, children_only = pending.pop()
        if (xref, children_only) in expanded:
            continue
        expanded.add((xref, children_only))
        for family in tree.spouse_families(xref):
            if children_only and not family["chil"]:
                continue
            for partner in (family["husb"], family["wife"]):
                if partner in tree.by_xref:
                    included.add(partner)
                    if partner != xref and partner not in numbered:
                        pending.append((partner, True))
            for child in family["chil"]:
                if child in tree.by_xref:
                    included.add(child)
                    pending.append((child, False))
    refns = {tree.by_xref[xref]["refn"] for xref in included}
    event_kinds = {"birth", "baptism", "christening", "death", "cremation", "burial",
                   "marriage", "divorce"}
    return Counter({(refn, key): 1
                    for refn, sources in tree.sources_by_person(refns).items()
                    for key, source in sources.items()
                    if not source.get("facts") or any(
                        fact["kind"] not in event_kinds for fact in source["facts"])})


def check_sources(expected, elements):
    actual = Counter()
    errors = []
    if not isinstance(elements, list):
        return 0, ["query result must be an array"]
    for element in elements:
        value = element.get("value") if isinstance(element, dict) else None
        if (not isinstance(value, dict)
                or any(not isinstance(value.get(k), str) or not value[k]
                       for k in ("refn", "key"))):
            errors.append("invalid <register-source> record; require refn and key")
            continue
        actual[(value["refn"], value["key"])] += 1
    for (refn, key), count in sorted((expected - actual).items()):
        errors.append(f"missing {refn}::{key} ({count})")
    for (refn, key), count in sorted((actual - expected).items()):
        errors.append(f"unexpected or duplicate {refn}::{key} ({count} extra)")
    return actual.total(), errors


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    src = Path(args[0]) if args else ROOT / "build" / "book.typ"
    try:
        expected = expected_keys(booklib.Tree(), booklib.root_refn(booklib.load_book_yaml()))
        proc = subprocess.run(["typst", "query", str(src), "<register-source>",
                               "--root", str(ROOT)], capture_output=True, text=True)
        if proc.returncode:
            raise ValueError(f"Typst query failed: {proc.stderr}")
        count, errors = check_sources(expected, json.loads(proc.stdout))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        sys.stderr.write(f"check-register-sources: FAIL — {exc}\n")
        return 1
    if errors:
        for error in errors:
            sys.stderr.write(f"check-register-sources: FAIL — {error}\n")
        return 1
    people = len({refn for refn, _ in expected})
    print(f"check-register-sources: OK — {count} reference{'' if count == 1 else 's'} for "
          f"{people} {'person' if people == 1 else 'people'}, each key present once")
    return 0


if __name__ == "__main__":
    sys.exit(main())

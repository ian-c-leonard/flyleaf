"""Bibliographic identity and the book's explicit census-omission policy.

Source identity is separate from a qualified citation use. This module never
infers a source kind from its title or changes any citation's evidence text.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path

import booklib

POLICY = booklib.BOOK_DIR / "bibliography-policy.json"


def identity(rec):
    return (rec.get("source_id"), rec.get("source_label", rec["label"]),
            rec.get("url") or "", rec["tier"])


def token(rec):
    return hashlib.sha256(json.dumps(identity(rec), ensure_ascii=False).encode()).hexdigest()


def load_policy(path=POLICY):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def census_omissions(src_keys, policy):
    """Resolve reviewed source selectors; stale/ambiguous selectors fail."""
    if (not isinstance(policy, dict) or type(policy.get("schema")) is not int
            or policy["schema"] != 1 or not isinstance(policy.get("census_sources"), list)):
        raise ValueError("bibliography policy requires schema 1 and census_sources array")
    records = [rec for sources in src_keys.values() for rec in sources.values()]
    omitted = set()
    for selector in policy["census_sources"]:
        if not isinstance(selector, dict):
            raise ValueError("invalid bibliography census selector")
        if set(selector) == {"source_id"}:
            pointer = selector["source_id"]
            if not isinstance(pointer, str) or not pointer.startswith("@") or not pointer.endswith("@"):
                raise ValueError("census source_id must be a native source pointer")
            matches = [r for r in records if r.get("source_id") == pointer]
        elif set(selector) == {"person", "key"}:
            person, key = selector["person"], selector["key"]
            if not all(isinstance(v, str) and v for v in (person, key)):
                raise ValueError("census person/key must be nonempty strings")
            rec = src_keys.get(person, {}).get(key)
            matches = [rec] if rec else []
        else:
            raise ValueError(f"invalid bibliography census selector: {selector!r}")
        ids = {token(r) for r in matches}
        if len(ids) != 1:
            raise ValueError(f"missing or ambiguous bibliography census selector: {selector!r}")
        if ids & omitted:
            raise ValueError(f"duplicate bibliography census selector: {selector!r}")
        omitted.update(ids)
    return omitted


def check_inventory(src_keys, policy, elements, people=None):
    """Compare actual compiled source uses with actual bibliography entries.

    The uses originate inside footnotes and general-reference paragraphs;
    the comparison is independent of the assembler's ancestor filter. Manual
    citations outside #src remain an editorial review responsibility.
    `people` are the ids of the people the book prints (Tree.register_people):
    only their sources must show up as uses.
    """
    omitted = census_omissions(src_keys, policy)
    used, entries, errors = {}, Counter(), []
    use_count = 0
    if not isinstance(elements, list):
        return {}, ["bibliography query must return an array"]
    for element in elements:
        if not isinstance(element, dict):
            errors.append("invalid bibliography query element")
            continue
        value, label = element.get("value"), element.get("label")
        if label == "<bibliography-use>":
            if (not isinstance(value, dict) or any(not isinstance(value.get(k), str)
                                                  or not value[k] for k in ("person", "key"))):
                errors.append("invalid bibliography source-use metadata")
                continue
            rec = src_keys.get(value["person"], {}).get(value["key"])
            if rec is None:
                errors.append(f"unknown bibliography source use: {value!r}")
                continue
            used[token(rec)] = rec
            use_count += 1
        elif label == "<bibliography-entry>":
            if not isinstance(value, str) or len(value) != 64:
                errors.append("invalid bibliography entry metadata")
                continue
            entries[value] += 1
    # A book whose people have no sources yet has nothing to list; one with
    # sources must show them being used, or the instrumentation is missing.
    # Sources of people the book does not print are not expected.
    printed = src_keys if people is None else {r: s for r, s in src_keys.items() if r in people}
    if not use_count and any(printed.values()):
        errors.append("zero compiled source uses; bibliography instrumentation is missing")
    expected = Counter({key: 1 for key in used if key not in omitted})
    for key in sorted((expected - entries)):
        rec = used[key]
        errors.append(f"missing bibliography entry: {identity(rec)!r}")
    for key, count in sorted((entries - expected).items()):
        errors.append(f"unexpected or duplicate bibliography entry: {key} ({count} extra)")
    return {"uses": use_count, "sources": len(used), "entries": entries.total(),
            "census_omissions": len(set(used) & omitted)}, errors

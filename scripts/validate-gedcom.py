#!/usr/bin/env python3
"""Validate the generated GEDCOM against the research standards (docs/research-standards.md).

Checks:
1. Every INDI with _CONFLEVEL primary has at least one primary or
   authoritative-secondary source.
2. Every INDI has a REFN jsonid (stable ID).
3. Every INDI with a known person (not unknown placeholders) has at least
   one source citation.
4. Source citations are classified into known tiers; warns on unrecognized.

Exits 0 on success, 1 on validation errors. The book build runs it
(flyleaf book).

Usage:
    .venv/bin/python3 scripts/validate-gedcom.py
"""
import re
import sys
from pathlib import Path
from gedcom_confidence import resolve_confidence
import flyleaf_settings

# People the source checks skip (flyleaf.json research.exempt_refns).
EXEMPT = set(flyleaf_settings.get("research.exempt_refns", []))

try:
    from gedcom.parser import Parser
    from gedcom.element.individual import IndividualElement
except ImportError:
    sys.exit("Install python-gedcom: .venv/bin/pip install python-gedcom")

HERE = Path(__file__).resolve().parent
ROOT = flyleaf_settings.family_root()
INPUT_GED = flyleaf_settings.path("generated_gedcom")


# ---------- Source classification ----------
# One classifier for the check and the book (scripts/source_tiers.py).
from source_tiers import SOURCE_TIERS, classify_source, record_text  # noqa: E402,F401


# Research-log wording that has no place in a printed citation, in the
# optional [Source] note format (docs/gedcom.md). A family adds its own
# shorthand as text_checks.source_process_phrases in flyleaf.json.
PROCESS_PHRASES = ("image queued", "locate by searching",
                   *flyleaf_settings.get("text_checks.source_process_phrases", []))
# acquisition-date clauses like "purchased 2026-07-21" / "SP purchase 2026-07-21"
PROCESS_RE = re.compile(r"purchase[d]?\s+(?:own-provenance\s+)?20\d\d-\d\d-\d\d",
                        re.IGNORECASE)


def process_text_hit(source_text):
    """Return the research-process phrase found in a [Source] label, or None.

    The display layer strips "image(s) archived <path> …" clauses wholesale, so
    provenance detail inside them is masked before scanning. Phrase matches are
    word-start anchored so e.g. "UNVERIFIED against" doesn't trip "VERIFIED against".
    """
    scan = re.sub(r"images?\s+archived\s+[^—]*", "", source_text)
    hit = next((p for p in PROCESS_PHRASES
                if re.search(r"(?<![A-Za-z])" + re.escape(p), scan, re.IGNORECASE)), None)
    if not hit:
        m = PROCESS_RE.search(scan)
        hit = m.group(0) if m else None
    return hit


def structural_issues(src_text):
    """Structural-integrity checks over the raw SSOT text. Pure function
    (testable). Returns (errors, warnings).

    They guard against these errors:
    - S1 duplicate Flyleaf id (REFN with TYPE jsonid) -> a person vanishes from the book
    - S2 duplicate FAMS/FAMC lines -> marriage/children blocks print twice
    - S3 FAM.CHIL without INDI.FAMC (and the reverse) -> pedigree walks
         silently drop a documented parent link
    - S4 FAMS without matching FAM HUSB/WIFE (and reverse)      -> warn
    - S5 more than one DISTINCT FAMC (adoptive/biological)      -> warn
    - S6 Flyleaf id charset (must be a slug: it becomes Typst labels) -> error
    - S7 a citation with two _KEY lines -> an edit landed between a
         citation and its key, so the key now names the wrong source
    """
    errors, warnings = [], []
    recs = {}
    rid = None
    for line in src_text.splitlines():
        m = re.match(r"^0 @(\w+)@ (INDI|FAM)", line)
        if m:
            rid = (m.group(1), m.group(2))
            recs[rid] = []
        elif line.startswith("0 "):
            rid = None
        elif rid:
            recs[rid].append(line)

    refns = {}
    fam_members = {}   # fam -> {"HUSB": [...], "WIFE": [...], "CHIL": [...]}
    indi_links = {}    # indi -> {"FAMC": [...], "FAMS": [...]}
    for (xid, typ), lines in recs.items():
        if typ == "FAM":
            fam_members[xid] = {"HUSB": [], "WIFE": [], "CHIL": []}
            for l in lines:
                m = re.match(r"^1 (HUSB|WIFE|CHIL) @(\w+)@", l)
                if m:
                    fam_members[xid][m.group(1)].append(m.group(2))
        else:
            indi_links[xid] = {"FAMC": [], "FAMS": []}
            for i, l in enumerate(lines):
                m = re.match(r"^1 (FAMC|FAMS) @(\w+)@", l)
                if m:
                    indi_links[xid][m.group(1)].append(m.group(2))
                if l.startswith("1 REFN"):
                    r = l[7:].strip()
                    # Only a REFN with TYPE jsonid is a Flyleaf id. Other
                    # programs keep their own reference numbers in REFN too.
                    subs = []
                    for following in lines[i + 1:]:
                        if not following.startswith("2 "):
                            break
                        subs.append(following.strip())
                    if r and "2 TYPE jsonid" in subs:
                        if r in refns:
                            errors.append(f"[S1-DUP-REFN] {r!r} on both {refns[r]} and {xid}")
                        refns[r] = xid
                        if not re.match(r"^[a-z0-9-]+$", r):
                            errors.append(f"[S6-REFN-CHARSET] {xid}: REFN {r!r} must be "
                                          f"lowercase slug [a-z0-9-] (becomes a Typst label)")

    for (xid, typ), lines in recs.items():
        cite = None  # [level, citation line, keys seen]
        for l in lines:
            m = re.match(r"^(\d+) ", l)
            if not m:
                continue
            lvl = int(m.group(1))
            if cite and lvl <= cite[0]:
                cite = None
            if re.match(r"^\d+ SOUR @", l):
                cite = [lvl, l.strip(), 0]
            elif cite and lvl == cite[0] + 1 and l.startswith(f"{lvl} _KEY "):
                cite[2] += 1
                if cite[2] == 2:
                    errors.append(f"[S7-MULTI-KEY] {xid}: citation {cite[1]!r} has more "
                                  f"than one _KEY; one may belong to the citation before it")

    for xid, links in indi_links.items():
        for tag in ("FAMC", "FAMS"):
            seen = set()
            for f in links[tag]:
                if f in seen:
                    errors.append(f"[S2-DUP-{tag}] {xid}: duplicate 1 {tag} @{f}@ "
                                  f"(would print marriage/children twice)")
                seen.add(f)
        if len(set(links["FAMC"])) > 1:
            warnings.append(f"[S5-MULTI-FAMC] {xid}: multiple FAMC "
                            f"{sorted(set(links['FAMC']))}; the book numbers the birth "
                            f"family (PEDI birth, else no PEDI) as ancestors. Give each "
                            f"FAMC a PEDI to make the choice explicit")
        for f in links["FAMS"]:
            fm = fam_members.get(f)
            if fm is not None and xid not in fm["HUSB"] + fm["WIFE"]:
                warnings.append(f"[S4-FAMS-ORPHAN] {xid}: FAMS @{f}@ but not "
                                f"HUSB/WIFE of that FAM")
        for f in links["FAMC"]:
            fm = fam_members.get(f)
            if fm is not None and xid not in fm["CHIL"]:
                errors.append(f"[S3-FAMC-NO-CHIL] {xid}: FAMC @{f}@ but that FAM "
                              f"has no matching 1 CHIL @{xid}@")

    for fid, fm in fam_members.items():
        for c in fm["CHIL"]:
            if c in indi_links and fid not in indi_links[c]["FAMC"]:
                errors.append(f"[S3-CHIL-NO-FAMC] FAM @{fid}@ lists CHIL @{c}@ but "
                              f"{c} has no 1 FAMC @{fid}@")
        for role in ("HUSB", "WIFE"):
            for x in fm[role]:
                if x in indi_links and fid not in indi_links[x]["FAMS"]:
                    warnings.append(f"[S4-{role}-NO-FAMS] FAM @{fid}@ {role} @{x}@ "
                                    f"lacks reciprocal 1 FAMS @{fid}@")
    return errors, warnings


def get_indi_field(indi, tag):
    for c in indi.get_child_elements():
        if c.get_tag() == tag:
            return c.get_value()
    return None


def citation_references(element):
    """Source presence is independent of the event tag; this does not place claims."""
    for child in element.get_child_elements():
        if child.get_tag() == "SOUR":
            value = child.get_multi_line_value() or ""
            yield "__SOUR_REF__" + value if value.startswith("@") else value
        yield from citation_references(child)


def collect_indi_data(indi, families=None):
    """Return dict with refn, conflevel, sources (list of label strings), name."""
    given, surname = indi.get_name()
    name = " ".join(filter(None, [given, surname])).strip()
    refn = None
    confidence = resolve_confidence(indi)
    research_status = None
    sources = []  # both inline [Source] notes (raw) and SOUR citations (xref)
    has_inline_source_notes = False
    # Confidence is resolved separately from source-label and metadata parsing.
    for c in indi.get_child_elements():
        t = c.get_tag()
        v = c.get_value() or ""
        # Append CONC continuations
        full = v
        for sub in c.get_child_elements():
            if sub.get_tag() == "CONC":
                full += sub.get_value() or ""
        if t == "REFN":
            for sub in c.get_child_elements():
                if sub.get_tag() == "TYPE" and (sub.get_value() or "") == "jsonid":
                    refn = v.strip()
                    break
        elif t == "_RESEARCH_STATUS":
            research_status = v.strip()
        elif t == "NOTE":
            if full.startswith("[Source]"):
                has_inline_source_notes = True
                sources.append(full[len("[Source]"):].strip())
    sources.extend(citation_references(indi))
    for child in indi.get_child_elements():
        if child.get_tag() == "FAMS" and families and child.get_value() in families:
            sources.extend(citation_references(families[child.get_value()]))
    sources = list(dict.fromkeys(sources))
    return {
        "xref": indi.get_pointer(),
        "name": name,
        "refn": refn,
        "conflevel": confidence["value"],
        "confidence_errors": confidence["errors"],
        "confidence_warnings": confidence["warnings"],
        "research_status": research_status,
        "sources": sources,
    }


def collect_sour_records(parser):
    """Return {sour_xref: the text the source is classified by}: the same
    title and addresses the book uses (source_tiers.record_text)."""
    return {el.get_pointer(): record_text(el) for el in parser.get_element_list()
            if el.get_tag() == "SOUR" and el.get_pointer()}


def collect_sour_tiers(parser):
    """Use only source-record classifications, never citation QUAY or person confidence."""
    result = {}
    for el in parser.get_root_child_elements():
        if el.get_tag() != "SOUR" or not el.get_pointer():
            continue
        tiers = [c.get_multi_line_value().strip() for c in el.get_child_elements()
                 if c.get_tag() == "_TIER"]
        if len(tiers) > 1 or (tiers and not tiers[0]):
            raise ValueError(f"source {el.get_pointer()} must have at most one nonempty _TIER")
        result[el.get_pointer()] = tiers[0] if tiers else None
    return result


def citation_issues(indi, families, loc):
    """[LONG-SOURCE-ID] and [DUP-CITATION-USE] errors for one person."""
    errors = []
    # Two uses of one source with the same page and note print as one
    # merged register reference, which the web book cannot split.
    seen_uses = {}
    def all_citations(node):
        for child in node.get_child_elements():
            if child.get_tag() == "SOUR" and child.get_value().startswith("@"):
                yield child
            yield from all_citations(child)
    vital = {"BIRT", "BAPM", "CHR", "DEAT", "BURI", "CREM", "MARR", "DIV"}
    def citations(node):
        # Citations on vital events print as their own footnotes; only
        # general references are grouped in the register's Sources.
        for child in node.get_child_elements():
            if child.get_tag() in vital:
                continue
            if child.get_tag() == "SOUR" and child.get_value().startswith("@"):
                yield child
            yield from citations(child)
    for cite in all_citations(indi):
        # GEDCOM allows identifiers of up to 20 characters between the @s.
        if len(cite.get_value()) > 22:
            errors.append(f"[LONG-SOURCE-ID] {loc}: {cite.get_value()} is longer than "
                          "GEDCOM's 20-character identifier limit")
    # A family's general citations print in the same register entry as
    # the spouses' own, so they share one set of uses.
    own_families = [families[c.get_value()] for c in indi.get_child_elements()
                    if c.get_tag() == "FAMS" and c.get_value() in families]
    for cite in [c for record in (indi, *own_families) for c in citations(record)]:
        kids = cite.get_child_elements()
        page = " ".join(k.get_value() for k in kids if k.get_tag() == "PAGE")
        note = " ".join(k.get_multi_line_value() for k in kids if k.get_tag() == "NOTE")
        key = next((k.get_value() for k in kids if k.get_tag() == "_KEY"), "")
        use = (cite.get_value(), page, note)
        if use in seen_uses and seen_uses[use] != key:
            errors.append(f"[DUP-CITATION-USE] {loc}: {cite.get_value()} is cited twice "
                          f"with the same page {page!r} ({seen_uses[use]} and {key}); "
                          "make each PAGE say which part of the source it uses")
        seen_uses.setdefault(use, key)
    return errors


def main():
    if not INPUT_GED.exists():
        sys.exit(f"ERROR: {INPUT_GED} not found")

    parser = Parser()
    parser.parse_file(str(INPUT_GED), strict=False)
    indis = [e for e in parser.get_element_list() if isinstance(e, IndividualElement)]
    sour_records = collect_sour_records(parser)
    try:
        sour_tiers = collect_sour_tiers(parser)
    except ValueError as exc:
        sys.exit(f"[SOURCE-TIER] {exc}")
    families = {e.get_pointer(): e for e in parser.get_root_child_elements()
                if e.get_tag() == "FAM" and e.get_pointer()}

    errors = []
    warnings = []
    unsourced_links = 0
    stats = {"primary": 0, "tree-link": 0, "memoir": 0, "unknown": 0, "no-conflevel": 0, "no-refn": 0, "no-source": 0}
    classification_stats = {"primary": 0, "authoritative-secondary": 0, "compiled-secondary": 0, "family-testimony": 0, "lead": 0, "unclassified": 0}

    for pointer, tier in sour_tiers.items():
        if tier and tier not in SOURCE_TIERS:
            errors.append(f"[SOURCE-TIER] {pointer}: invalid source _TIER {tier!r}")

    # Structural-integrity pass over the SSOT (see structural_issues docstring)
    src_path = flyleaf_settings.path("source_gedcom")
    if src_path.exists():
        s_err, s_warn = structural_issues(src_path.read_text(encoding="utf-8"))
        errors.extend(s_err)
        warnings.extend(s_warn)

    for indi in indis:
        data = collect_indi_data(indi, families)
        errors.extend(data["confidence_errors"])
        warnings.extend(data["confidence_warnings"])
        xref = data["xref"]
        name = data["name"] or "(unnamed)"
        refn = data["refn"]
        conf = data["conflevel"]
        sources = data["sources"]
        loc = f"{xref} ({refn or '?'}) {name}"

        errors.extend(citation_issues(indi, families, loc))

        # Rule 1: every INDI must have a REFN
        if not refn:
            errors.append(f"[NO-REFN] {xref} {name}: missing 1 REFN <slug> + 2 TYPE jsonid")
            stats["no-refn"] += 1

        # Resolve source labels — both inline [Source] notes and SOUR xref citations
        resolved = []
        classes = []
        for s in sources:
            if s.startswith("__SOUR_REF__"):
                xref_ref = s[len("__SOUR_REF__"):].strip("@ ")
                xref_ref = "@" + xref_ref + "@"
                label = sour_records.get(xref_ref)
                if label:
                    resolved.append(label)
                    tier = sour_tiers.get(xref_ref)
                    classes.append(classify_source(label, tier if tier in SOURCE_TIERS else None))
                # Skip silently if the SOUR xref doesn't resolve — Gramps will warn separately
            else:
                resolved.append(s)
                classes.append(classify_source(s))

        # Rule 3b: a source's text is a citation, not a research log. A family
        # that keeps notes in the optional [Source]/[Notes] format (docs/gedcom.md)
        # puts research commentary in a [Notes] note, or the footnotes print
        # phrases such as "read in full from the ebook". The display layer
        # strips structured fields (URLs, archive paths); it never strips prose.
        for s in resolved:
            hit = process_text_hit(s)
            if hit:
                warnings.append(f"[PROCESS-IN-LABEL] {loc}: a source's text contains "
                                f"research-process wording ({hit!r}), which would print in "
                                f"its footnote. Move it to a note: {s[:80]}…")

        # Classify each resolved source
        for c in classes:
            classification_stats[c] = classification_stats.get(c, 0) + 1

        # Rule 2: count by conflevel
        if conf:
            stats[conf] = stats.get(conf, 0) + 1
        else:
            stats["no-conflevel"] += 1

        # Rule 3: every named person should have at least one source
        # (Skip "unknown" placeholders and research.exempt_refns, e.g. the compiler).
        # A tree-link person, as import marks everyone, is expected to have
        # none yet: they are counted, not listed.
        if conf and conf != "unknown" and refn not in EXEMPT and not resolved:
            stats["no-source"] += 1
            if conf == "tree-link":
                unsourced_links += 1
            else:
                warnings.append(f"[NO-SOURCE] {loc}: confidence={conf} but no source is cited")

        # Rule 4: primary confidence requires primary or authoritative-secondary source
        if conf == "primary" and refn not in EXEMPT:
            has_primary_grade = any(c in ("primary", "authoritative-secondary") for c in classes)
            if not has_primary_grade:
                tier_summary = ", ".join(sorted(set(classes))) if classes else "(no sources)"
                errors.append(
                    f"[CONF-MISMATCH] {loc}: confidence=primary but sources are only "
                    f"[{tier_summary}]. Cite a primary or authoritative source; or, if a source "
                    f"is graded wrongly, give it a _TIER or a pattern in paths.source_tier_patterns "
                    f"(docs/research-standards.md); or set the person's confidence to tree-link."
                )

    # Print report
    print(f"━━━ Validation of {INPUT_GED.name} ━━━")
    print(f"  {len(indis)} individuals total")
    print(f"  Confidence breakdown:")
    for k in ("primary", "tree-link", "memoir", "unknown", "no-conflevel"):
        print(f"    {k}: {stats.get(k, 0)}")
    print(f"  Source citation classification:")
    for k in ("primary", "authoritative-secondary", "compiled-secondary", "family-testimony", "lead", "unclassified"):
        print(f"    {k}: {classification_stats[k]}")
    if unsourced_links:
        print(f"  {unsourced_links} " + ("person linked from another tree (tree-link) cites"
                                       if unsourced_links == 1 else
                                       "people linked from another tree (tree-link) cite")
              + " no source yet.")

    if warnings:
        print(f"\n━━━ {len(warnings)} WARNINGS ━━━")
        for w in warnings:
            print(f"  ⚠ {w}")

    if errors:
        print(f"\n━━━ {len(errors)} ERRORS ━━━")
        for e in errors:
            print(f"  ✗ {e}")
        print("\nValidation failed. Fix the errors above, then run flyleaf book again.")
        sys.exit(1)
    else:
        print(f"\n✓ Validation passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Enrich the source GEDCOM (paths.source_gedcom) → the generated one.

Transforms the minimal NOTE-based source GEDCOM (the file the family edits)
into the project's enriched GEDCOM export with SOUR, REPO, citations and
OBJE records (paths.generated_gedcom; for programs such as Gramps).

What this does:
- Preserves explicit individuals, families, events, citations, and other records
- Converts notes in the optional plain-text format (a note that starts with
  [Source], [Notes] or [Confidence]; see docs/gedcom.md) to source records,
  person-level references, notes and a confidence level
- Reads native SOUR citations at their recorded subject/event/family location

It does not infer events, claim support, or citation quality from prose labels.
See docs/gedcom.md.

Run:
    .venv/bin/python3 scripts/enrich-gedcom.py
"""
import re
import sys
from collections import Counter, OrderedDict
from io import BytesIO
import build_clock
import flyleaf_settings
from pathlib import Path
from urllib.parse import urlsplit
from gedcom_confidence import CONFIDENCE_MARKER, resolve_confidence, simple_note
from source_tiers import record_text

try:
    from gedcom.parser import Parser
    from gedcom.element.individual import IndividualElement
    from gedcom.element.family import FamilyElement
except ImportError:
    sys.exit("Install python-gedcom: .venv/bin/pip install python-gedcom")

HERE = Path(__file__).resolve().parent
ROOT = flyleaf_settings.family_root()
INPUT_GED = flyleaf_settings.path("source_gedcom")
OUTPUT_GED = flyleaf_settings.path("generated_gedcom")


# ---------- Repositories ----------
# The archives a source can link to. A source whose links all point to one of
# these sites gets a REPO record. A family adds its own archives in the
# gedcom.repositories setting, in the same shape.
REPOS = {
    "findagrave": {"name": "Find a Grave", "url": "https://www.findagrave.com/",
                   "address": "online", "domain": "findagrave.com"},
    "wikitree": {"name": "WikiTree", "url": "https://www.wikitree.com/",
                 "address": "online", "domain": "wikitree.com"},
    "archive_org": {"name": "Internet Archive", "url": "https://archive.org/",
                    "address": "online", "domain": "archive.org"},
    "familysearch": {"name": "FamilySearch", "url": "https://www.familysearch.org/",
                     "address": "Salt Lake City, UT, USA", "domain": "familysearch.org"},
    "nara": {"name": "U.S. National Archives", "url": "https://www.archives.gov/",
             "address": "Washington, DC", "domain": "archives.gov"},
}
REPOS.update(flyleaf_settings.get("gedcom.repositories", {}))


def url_to_repo(url):
    """Recognize an explicitly supplied host, never words in a URL path."""
    if not url:
        return None
    try:
        parsed = urlsplit('https://' + url if url.startswith('www.') else url)
        host = (parsed.hostname or '').lower()
    except ValueError:
        return None
    if parsed.scheme not in {'http', 'https'}:
        return None
    for key, repo in REPOS.items():
        domain = repo.get("domain")
        if domain and (host == domain or host.endswith('.' + domain)):
            return key
    return None


def gedcom_lines(text, base_level, tag, max_len=200):
    """Wrap generated text with CONC; preserve paragraph breaks with CONT."""
    text = "" if text is None else str(text).replace("\r\n", "\n").replace("\r", "\n")
    out = []
    for index, paragraph in enumerate(text.split("\n")):
        level, line_tag = (base_level, tag) if index == 0 else (base_level + 1, "CONT")
        # Split inside a word where possible: some readers trim spaces at a
        # CONC boundary (GEDCOM 5.5.1, CONC definition, printed pp. 85–86).
        while len(paragraph) > max_len:
            cut = max_len
            while cut > 0 and (paragraph[cut - 1].isspace() or paragraph[cut].isspace()):
                cut -= 1
            cut = cut or max_len  # all-space / single-letter words: retain the text
            out.append(f"{level} {line_tag} {paragraph[:cut]}")
            paragraph = paragraph[cut:]
            level, line_tag = base_level + 1, "CONC"
        out.append(f"{level} {line_tag}" + (f" {paragraph}" if paragraph else ""))
    return out


def element_lines(element):
    """Preserve a subtree, rewrapping text without flattening its metadata."""
    text_tag = element.get_tag() in {"NOTE", "TEXT", "TITL", "AUTH", "PUBL"}
    structured_continuation = any(
        c.get_tag() in {'CONC', 'CONT'} and c.get_child_elements()
        for c in element.get_child_elements())
    if text_tag and not structured_continuation:
        tag = " ".join(filter(None, (element.get_pointer(), element.get_tag())))
        out = gedcom_lines(element.get_multi_line_value(), element.get_level(), tag, max_len=180)
    else:
        # Unicode separators inside a recorded value are not GEDCOM lines.
        out = [element.to_gedcom_string().rstrip('\r\n')]
    for child in element.get_child_elements():
        if not (text_tag and not structured_continuation and
                child.get_tag() in {"CONC", "CONT"}):
            out.extend(element_lines(child))
    return out


def allocate_xref(prefix, reserved):
    """Allocate a generated ID without changing any source pointer."""
    index = 1
    while f"@{prefix}{index:03d}@" in reserved:
        index += 1
    xref = f"{prefix}{index:03d}"
    reserved.add(f"@{xref}@")
    return xref


ARCHIVED_PATH = re.compile(
    r'\bimages/[^\s"<>]+\.(?:jpg|jpeg|png|pdf|txt|html|svg|webp|tif|tiff)'
    r'(?=$|[\s,;:)\].])', re.IGNORECASE)


def media_paths(element, records):
    """Only declared FILE/OBJE attachments, never paths in old source notes.

    Follow shared multimedia records by ID. A source's historical assessments
    may mention other documents; those are not its own attachments.
    """
    paths, seen = set(), set()

    def walk(node):
        for child in node.get_child_elements():
            if child.get_tag() == "FILE":
                paths.add(child.get_multi_line_value())
            elif child.get_tag() == "OBJE":
                pointer = child.get_value()
                if pointer.startswith("@") and pointer not in seen:
                    seen.add(pointer)
                    target = records.get(pointer)
                    if target is None or target.get_tag() != "OBJE":
                        raise ValueError(f"media points to missing OBJE record {pointer}")
                    walk(target)
                walk(child)

    walk(element)
    return sorted(paths)


def parse_note(text):
    """Pull bio, notes, confidence and a source out of a NOTE written in the
    optional plain-text format (docs/gedcom.md): "[Source] title — URL" is a
    citation, "[Notes] ..." research notes, "[Confidence] primary" a level.
    A tree that cites with SOUR records never needs this format."""
    if not text:
        return None, None, None, None
    if text.startswith("[Source]"):
        archive = {"raw_notes": [text], "paths": sorted(set(ARCHIVED_PATH.findall(text)))}
        rest = text[len("[Source]"):].strip()
        # A [Source] note may say where the family keeps a copy (" — archived
        # <path>", " — image/text archived <path> [+ <path>...]"). That is
        # not citation text: strip it so labels — and the keys stories cite,
        # derived from them — stay the same when a copy is added.
        # A renamed key would drop the footnotes that cite it.
        rest = re.sub(
            r"\s+—\s+(?:(?:whole\s+source|cert\s+image|page\s+images?|images?|text)\s+)?"
            r"(?:RE-CAPTURED\s+\S+\s+)?archived\s+images/\S+"
            r"(?:\s+\+\s+\S+(?:\s+\S+\.(?:jpg|jpeg|png|pdf|txt|html))?)*"
            # a second copy can follow in the same clause ("…archived
            # images/x.jpg; member-shared copy also held images/y.jpg"):
            # consume it too, or the leftover path glues onto the citation text
            # with no separator once the em-dash above is eaten
            r"(?:\s*[;,]?\s*member[- ]shared?\s+cop(?:y|ies)[^—;]*?(?:held|archived)\s+images/\S+)*",
            "", rest)
        # Marks about a link's state ([DEAD ...], [WALLED ...], [CAPTURE-PENDING
        # ...]) are notes to the family, like copy paths: strip them so adding
        # one never changes a key.
        rest = re.sub(r"\s+[—;:]\s+\[(?:DEAD|WALLED|CAPTURE-PENDING)\b[^\]]*\]", "", rest)
        # Only split on " — " if the right-hand side is a URL (http://, https://, www., or recognizable domain)
        if " — " in rest:
            label, maybe_url = rest.rsplit(" — ", 1)
            maybe_url_stripped = maybe_url.strip()
            if re.match(r"^https?://", maybe_url_stripped) or maybe_url_stripped.startswith("www."):
                return None, None, None, {"label": label.strip(), "url": maybe_url_stripped, **archive}
        return None, None, None, {"label": rest, "url": "", **archive}
    bio, notes, conf = text, None, None
    m = CONFIDENCE_MARKER.search(bio)
    if m:
        conf = m.group(1)
        bio = bio[:m.start()]
    m = re.search(r"\s*\[Notes\]\s*", bio)
    if m:
        notes = bio[m.end():].strip()
        bio = bio[:m.start()]
    return bio.strip() or None, notes, conf, None


def child_text(element, tag):
    return next((c.get_multi_line_value() for c in element.get_child_elements()
                 if c.get_tag() == tag), "")


def source_note(element, records):
    """Read a legacy citation with explicit media without changing its label.

    This is distinct from plain-note confidence parsing. Other structured notes
    remain preserved notes; adding an attachment must not turn a source into bio.
    Declared attachments supersede historical filename mentions in the text.
    """
    text = element.get_multi_line_value() or ""
    if not text.startswith("[Source]"):
        return None
    children = element.get_child_elements()
    if any(c.get_tag() not in {"CONC", "CONT", "OBJE"} or
           (c.get_tag() in {"CONC", "CONT"} and c.get_child_elements()) for c in children):
        return None
    source = parse_note(text)[3]
    if any(c.get_tag() == "OBJE" for c in children):
        source["paths"] = media_paths(element, records)
        source["structured_note"] = True
    return source


def note_text(note, records):
    """A NOTE's text. A note that points to a shared NOTE record (1 NOTE @N1@)
    has that record's text."""
    value = (note.get_value() or "").strip()
    shared = records.get(value) if re.fullmatch(r"@[^@]+@", value) else None
    if shared is not None and shared.get_tag() == "NOTE":
        return shared.get_multi_line_value() or ""
    return note.get_multi_line_value() or ""


def native_citation(citation, records, *, fact="general", family=None):
    """Read explicit SOUR placement; source titles never supply the fact/subject.

    _KEY is an optional stable authoring key, at the source or citation level.
    PAGE and citation NOTE belong to this use of the source, not to its title.
    """
    pointer = citation.get_value()
    paths = media_paths(citation, records)
    if pointer.startswith("@"):
        source = records.get(pointer)
        if source is None or source.get_tag() != "SOUR":
            raise ValueError(f"citation points to missing source {pointer}")
        # A source record may lack a title; its short title or author names it.
        title = (child_text(source, "TITL") or child_text(source, "ABBR")
                 or child_text(source, "AUTH") or "Untitled source")
        # Only a citation's own _KEY is fixed. A key from the source record
        # (its _KEY, else its id) is shared by every use of that source.
        own = child_text(citation, "_KEY")
        derived = not own
        key = (own or child_text(source, "_KEY")
               or re.sub(r"[^a-z0-9]+", "-", pointer.strip("@").lower()).strip("-"))
        short = child_text(source, "ABBR") or title
        tiers = [c.get_multi_line_value().strip() for c in source.get_child_elements()
                 if c.get_tag() == "_TIER"]
        if len(tiers) > 1 or (tiers and not tiers[0]):
            raise ValueError(f"source {pointer} must have at most one nonempty _TIER")
        tier = tiers[0] if tiers else ""
        url = child_text(source, "_URL")
        classify = record_text(source)
        paths = sorted(set(paths + media_paths(source, records)))
    else:
        # GEDCOM also permits a source description directly in a citation.
        title = citation.get_multi_line_value()
        key = child_text(citation, "_KEY")
        derived = not key
        if not key:
            from hashlib import sha256
            key = "inline-" + sha256(title.encode()).hexdigest()[:12]
        short, tier, url = title, "", ""
        classify = title
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key):
        raise ValueError(f"invalid citation _KEY {key!r} on {pointer}")
    if tier and tier not in {"primary", "authoritative-secondary", "compiled-secondary",
                             "family-testimony", "lead", "unclassified"}:
        raise ValueError(f"invalid source _TIER {tier!r} on {pointer}")
    quay = child_text(citation, "QUAY")
    if quay not in {"", "0", "1", "2", "3"}:
        raise ValueError(f"invalid citation QUAY {quay!r} on {pointer}")
    page = child_text(citation, "PAGE")
    notes = " ".join(note_text(c, records) for c in citation.get_child_elements()
                     if c.get_tag() == "NOTE")
    label = title + (f" — {page}" if page else "")
    if notes:
        label += f" — {notes}"
    return {"label": label, "source_label": title, "url": url, "key": key,
            "short": short + (f" — {page}" if page else "") + (f" — {notes}" if notes else ""),
            "tier": tier, "classify": classify,
            "native": True, "source_id": pointer, "page": page,
            "quay": quay, "paths": paths,
            "facts": [{"kind": fact, "family": family}],
            # Removed again by collect_individual_data, once keys are distinct.
            "derived_key": derived}


def distinct_keys(sources):
    """Give each different use of a source its own key, for one person.

    A citation without its own _KEY takes its key from its source record:
    the source's _KEY, else its id (@S12@ becomes s12). When one person cites that source twice with different pages
    or notes, each use gets a key of its own from them, such as s12-p-4 and
    s12-p-9. A source cited once, or always the same way, keeps its key.
    Returns the person's sources and a map from (key, label) to each new key.
    """
    uses = OrderedDict()
    for s in sources:
        if s.get("derived_key"):
            uses.setdefault(s["key"], OrderedDict()).setdefault(s["label"], s)
    taken = {s["key"] for s in sources if "key" in s}
    renamed = {}
    for key, labels in uses.items():
        if len(labels) < 2:
            continue
        wanted = {}
        for label, s in labels.items():
            # The label is the source's title, then this use's page and notes.
            detail = label[len(s["source_label"]):]
            wanted[label] = key + "-" + (_slug(detail) or _digest(label))
        counts = Counter(wanted.values())
        for label, new in wanted.items():
            if counts[new] > 1 or new in taken:
                new += "-" + _digest(label)
            renamed[(key, label)] = new
            taken.add(new)
    if not renamed:
        return sources, renamed
    return [dict(s, key=renamed[(s.get("key"), s["label"])])
            if (s.get("key"), s["label"]) in renamed else s for s in sources], renamed


def _slug(text, length=32):
    text = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return text[:length].rstrip("-")


def _digest(text):
    from hashlib import sha256
    return sha256(text.encode()).hexdigest()[:6]


def burial_kind(event):
    """Read authored event semantics; never infer them from a source title.

    A planned burial is an EVEN with TYPE Planned burial, not a BURI assertion
    of completed interment. TYPE Reported burial qualifies a retained BURI.
    """
    kind = child_text(event, "TYPE").strip().casefold()
    if event.get_tag() == "EVEN" and kind == "planned burial":
        return "planned"
    if event.get_tag() == "BURI":
        if kind == "planned burial":
            raise ValueError("Planned burial must use EVEN/TYPE, not BURI")
        value = event.get_value().strip()
        if value not in ("", "Y"):
            raise ValueError("BURI supports only Y or an empty value")
        if not (value == "Y" or child_text(event, "DATE") or child_text(event, "PLAC")):
            return None  # notes/sources alone do not assert that an event occurred
        return "reported" if kind == "reported burial" else "recorded"
    return None


# The events the register prints, by the kind of fact their citations support.
FACT_TAGS = {"BIRT": "birth", "BAPM": "baptism", "CHR": "christening", "DEAT": "death",
             "CREM": "cremation", "MARR": "marriage", "DIV": "divorce"}


def explicit_citations(element, records, *, family=None):
    """Direct event citations support that event; deeper citations are general."""

    def walk(parent, depth=0):
        for child in parent.get_child_elements():
            if child.get_tag() == "SOUR":
                fact = ("burial" if burial_kind(parent) else
                        FACT_TAGS.get(parent.get_tag(), "general")) if depth == 1 else "general"
                yield native_citation(child, records, fact=fact, family=family)
            yield from walk(child, depth + 1)

    yield from walk(element)


def name_suffix(name):
    """Read a recorded suffix without moving it into the given name."""
    if name is None:
        return ""
    explicit = child_text(name, "NSFX").strip()
    parts = (name.get_multi_line_value() or "").split("/")
    return explicit or (parts[2].strip() if len(parts) > 2 else "")


def primary_first(events):
    """A person's births (or deaths), the one the register prints first: the
    first with a date or place, as GEDCOM lists the preferred event first."""
    for i, event in enumerate(events):
        if event["date"] or event["place"]:
            return [event, *events[:i], *events[i + 1:]]
    return events


def pedigree_family(parent_families):
    """The parents the book numbers as ancestors, when a person has more than
    one family (FAMC with PEDI). Birth parents first; then parents with no
    stated kind; otherwise the first parents recorded (adoptive or foster)."""
    for wanted in ("birth", ""):
        for link in parent_families:
            if link["kind"] == wanted:
                return link["family"]
    return parent_families[0]["family"] if parent_families else None


def collect_individual_data(parser):
    """Return list of dicts per individual with parsed fields."""
    all_els = parser.get_element_list()
    records = {e.get_pointer(): e for e in parser.get_root_child_elements() if e.get_pointer()}
    indis = [e for e in all_els if isinstance(e, IndividualElement)]
    fams = {e.get_pointer(): e for e in all_els if isinstance(e, FamilyElement)}

    people = []
    for indi in indis:
        ip = indi.get_pointer()
        given, surname = indi.get_name()
        names = [c for c in indi.get_child_elements() if c.get_tag() == "NAME"]
        suffix = name_suffix(names[0] if names else None)
        alternate_names = []
        for name in names[1:]:
            raw = name.get_multi_line_value() or ""
            parts = raw.split("/")
            alternate = {
                "given": child_text(name, "GIVN") or parts[0].strip(),
                "surname": child_text(name, "SURN") or (parts[1].strip() if len(parts) > 1 else ""),
                "type": child_text(name, "TYPE"),
            }
            alternate_suffix = name_suffix(name)
            if alternate_suffix:
                alternate["suffix"] = alternate_suffix
            alternate_names.append(alternate)
        # Each event keeps its own date, place and citations. The citations
        # stand in for their keys until the keys are distinct.
        def events(tag, fact):
            return [{"date": child_text(event, "DATE"), "place": child_text(event, "PLAC"),
                     "source_keys": [native_citation(c, records, fact=fact)
                                     for c in event.get_child_elements() if c.get_tag() == "SOUR"]}
                    for event in indi.get_child_elements() if event.get_tag() == tag]
        births, deaths = primary_first(events("BIRT", "birth")), primary_first(events("DEAT", "death"))
        baptisms, christenings = events("BAPM", "baptism"), events("CHR", "christening")
        cremations = events("CREM", "cremation")
        burials = [
            {"date": child_text(event, "DATE"), "place": child_text(event, "PLAC"),
             "kind": burial_kind(event),
             "source_keys": [native_citation(c, records, fact="burial")
                             for c in event.get_child_elements() if c.get_tag() == "SOUR"]}
            for event in indi.get_child_elements() if burial_kind(event)
        ]
        sex = indi.get_gender()
        refn = None
        confidence = resolve_confidence(indi)
        bio_parts, note_parts, sources = [], [], []
        parent_families, fams_list = [], []
        for c in indi.get_child_elements():
            t = c.get_tag()
            v = c.get_multi_line_value() or ""
            if t == "REFN":
                # Check if jsonid
                for sub in c.get_child_elements():
                    if sub.get_tag() == "TYPE" and (sub.get_value() or "") == "jsonid":
                        refn = v.strip()
                        break
            elif t == "NOTE":
                src = source_note(c, records)
                if src:
                    sources.append(src)
                    continue
                if not simple_note(c):
                    bio_parts.append(v)  # preserve structured notes as recorded
                    continue
                bio_p, note_p, _, src = parse_note(v)
                if bio_p: bio_parts.append(bio_p)
                if note_p: note_parts.append(note_p)
                if src: sources.append(src)
            elif t == "FAMC":
                kind = next(((sub.get_value() or "").strip().lower()
                             for sub in c.get_child_elements() if sub.get_tag() == "PEDI"), "")
                parent_families.append({"family": v.strip(), "kind": kind})
            elif t == "FAMS":
                fams_list.append(v.strip())

        sources.extend(explicit_citations(indi, records))
        people.append({
            "xref": ip,
            "refn": refn,
            "given": given,
            "surname": surname,
            **({"suffix": suffix} if suffix else {}),
            "alternate_names": alternate_names,
            "sex": sex,
            # The register prints the first birth and death; any others are
            # alternatives, each with its own citations.
            "birth_date": births[0]["date"] if births else "",
            "birth_place": births[0]["place"] if births else "",
            "births": births,
            "baptisms": baptisms,
            "christenings": christenings,
            "burials": burials,
            "cremations": cremations,
            "death_date": deaths[0]["date"] if deaths else "",
            "death_place": deaths[0]["place"] if deaths else "",
            "deaths": deaths,
            "bio": "  ".join(bio_parts) if bio_parts else None,
            "notes": "  ".join(note_parts) if note_parts else None,
            "confidence": confidence["value"],
            "confidence_errors": confidence["errors"],
            "confidence_warnings": confidence["warnings"],
            "sources": sources,
            "famc": pedigree_family(parent_families),
            "parent_families": parent_families,
            "fams": fams_list,
        })

    by_xref = {p["xref"]: p for p in people}
    for pointer, family in fams.items():
        citations = list(explicit_citations(family, records, family=pointer))
        for member in family.get_child_elements():
            if member.get_tag() in {"HUSB", "WIFE"} and member.get_value() in by_xref:
                by_xref[member.get_value()]["sources"].extend(citations)
    for person in people:
        person["sources"], renamed = distinct_keys(person["sources"])
        for event in [*person["births"], *person["baptisms"], *person["christenings"],
                      *person["deaths"], *person["burials"], *person["cremations"]]:
            event["source_keys"] = [renamed.get((c["key"], c["label"]), c["key"])
                                    for c in event["source_keys"]]
        if renamed:
            # A family's divorce citations are named per spouse (booklib).
            person["renamed_keys"] = renamed
    for person in people:
        for source in person["sources"]:
            source.pop("derived_key", None)
    return people, fams


def inventory_sources(people, reserved_xrefs=()):
    """Across all people, return ordered dict of unique sources: label -> {label, urls, ids}."""
    sources_by_label = OrderedDict()
    for p in people:
        for s in p["sources"]:
            if s.get("native") or s.get("structured_note"):
                continue  # existing SOUR records keep their original IDs
            lbl = s["label"]
            if lbl not in sources_by_label:
                sources_by_label[lbl] = {"label": lbl, "urls": set()}
            if s.get("url"):
                sources_by_label[lbl]["urls"].add(s["url"])
    # Existing records keep their IDs; generated sources use free IDs.
    reserved = set(reserved_xrefs)
    for lbl in sources_by_label:
        sources_by_label[lbl]["xref"] = allocate_xref("S", reserved)
        # Only one unambiguous, explicitly supplied provider establishes a
        # generated repository. A title is not repository provenance.
        urls = sources_by_label[lbl]["urls"]
        repos = {url_to_repo(u) for u in urls}
        sources_by_label[lbl]["repo"] = next(iter(repos)) if len(repos) == 1 else None
    return sources_by_label


def build_enriched_gedcom(people, fams, sources_by_label, used_repos, *, source_records):
    """Enrich around preserved source structures."""
    originals = {e.get_pointer(): e for e in source_records if e.get_pointer()}
    reserved = set(originals)
    for source in sources_by_label.values():
        pointer = f"@{source['xref']}@"
        if pointer in reserved:
            raise ValueError(f"generated source ID collides with source record: {pointer}")
        reserved.add(pointer)
    header = next((e for e in source_records if e.get_tag() == "HEAD"), None)
    header_children = header.get_child_elements() if header else []
    submitter_links = [e for e in header_children if e.get_tag() == "SUBM"]
    submitter_id = None if submitter_links else allocate_xref("SUB", reserved)
    out = []
    out.append("0 HEAD")
    out.append(f"1 SOUR {flyleaf_settings.require('gedcom.source_id')}")
    out.append(f"2 NAME {flyleaf_settings.require('gedcom.source_name')}")
    out.append("2 VERS 2.0")
    out.append("1 DEST GRAMPS")
    out.append(f"1 DATE {build_clock.today().strftime('%d %b %Y').upper()}")
    if submitter_links:
        for link in submitter_links:
            out.extend(element_lines(link))
    else:
        out.append(f"1 SUBM @{submitter_id}@")
    out.append(f"1 FILE {OUTPUT_GED.name}")
    out.append("1 GEDC")
    out.append("2 VERS 5.5.1")
    out.append("2 FORM LINEAGE-LINKED")
    out.append("1 CHAR UTF-8")
    for child in header_children:
        if child.get_tag() not in {"SOUR", "DEST", "DATE", "SUBM", "FILE", "GEDC", "CHAR"}:
            out.extend(element_lines(child))
    if submitter_id:
        out.append(f"0 @{submitter_id}@ SUBM")
        out.append(f"1 NAME {flyleaf_settings.require('maintainer.name')}")
    for record in source_records:
        if record.get_tag() == "SUBM":
            out.extend(element_lines(record))

    # Sort people by xref for stable output
    people = sorted(people, key=lambda p: p["xref"])

    # Repositories
    repo_xref = {}
    for rkey in used_repos:
        rxref = allocate_xref("R", reserved)
        repo_xref[rkey] = rxref

    # Pre-assign source xrefs (already done in sources_by_label)
    src_xref_by_label = {lbl: s["xref"] for lbl, s in sources_by_label.items()}

    # Individuals
    for p in people:
        x = p["xref"].strip("@")
        out.append(f"0 @{x}@ INDI")
        children = originals[p["xref"]].get_child_elements()
        explicit = {}
        for child in children:
            explicit.setdefault(child.get_tag(), []).append(child)
            if child.get_tag() != "NOTE":
                out.extend(element_lines(child))

        # An unplaced legacy source is a person-level reference. Its label
        # cannot assert an event, its subject, or a per-citation quality score.
        for source in p["sources"]:
            if source.get("native") or source.get("structured_note"):
                continue  # the original citation is already in its source subtree
            out.append(f"1 SOUR @{src_xref_by_label[source['label']]}@")
            if source.get("url"):
                out.append(f"2 PAGE {source['url']}")

        legacy_confidences = {
            parse_note(n.get_multi_line_value())[2]
            for n in explicit.get('NOTE', []) if simple_note(n)
        } - {None}
        native_confidences = {c.get_value() for c in explicit.get('_CONFLEVEL', [])}
        confidence_conflict = len(legacy_confidences | native_confidences) > 1

        # Convert only plain marker notes. Ordinary/structured notes retain
        # their text, paragraph boundaries, citations, and custom children.
        for note in explicit.get("NOTE", []):
            text = note.get_multi_line_value()
            if confidence_conflict and parse_note(text)[2]:
                # Note order cannot decide which historical assessment is
                # current. Retain each assessment and its original context.
                out.extend(element_lines(note))
                continue
            if not simple_note(note) or not any(marker in text for marker in
                                                ("[Source]", "[Notes]", "[Confidence]")):
                out.extend(element_lines(note))
                continue
            bio, notes, _, _ = parse_note(text)
            for value in (bio, notes):
                if value:
                    out.extend(gedcom_lines(value, 1, "NOTE", max_len=180))
        if len(legacy_confidences) == 1 and not native_confidences:
            out.append(f"1 _CONFLEVEL {next(iter(legacy_confidences))}")

    # Families and referenced records are source structures, not field lists.
    for fam in fams.values():
        out.extend(element_lines(fam))
    for record in source_records:
        if record.get_tag() not in {"HEAD", "TRLR", "INDI", "FAM", "SUBM"}:
            out.extend(element_lines(record))

    # SOURCE records
    for lbl, s in sources_by_label.items():
        out.append(f"0 @{s['xref']}@ SOUR")
        # Shorten only the recorded title; do not substitute a repository.
        out.append(f"1 ABBR {lbl[:60].rstrip()}")
        # TITL — the full label
        out.extend(gedcom_lines(lbl, 1, "TITL", max_len=180))
        urls = sorted(s["urls"])
        # Supplied URLs remain locators.
        if s.get("repo") and s["repo"] in repo_xref:
            out.append(f"1 REPO @{repo_xref[s['repo']]}@")
            for u in urls:
                out.extend(gedcom_lines(u, 2, "CALN", max_len=180))
        elif urls:
            # No repo, just emit URL as a NOTE
            for u in urls:
                out.extend(gedcom_lines(u, 1, "NOTE", max_len=180))

    # REPOSITORY records
    for rkey in used_repos:
        rxref = repo_xref[rkey]
        repo = REPOS[rkey]
        name, www, addr = repo["name"], repo.get("url"), repo.get("address")
        out.append(f"0 @{rxref}@ REPO")
        out.append(f"1 NAME {name}")
        if addr:
            out.append(f"1 ADDR {addr}")
        if www:
            out.append(f"1 WWW {www}")

    out.append("0 TRLR")
    return "\n".join(out) + "\n"


def main():
    parser = Parser()
    # python-gedcom iterates binary LF-delimited lines. Normalize physical
    # CR/LF endings without treating Unicode value characters as delimiters.
    raw = INPUT_GED.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n')
    if raw and not raw.endswith(b'\n'):
        raw += b'\n'
    parser.parse(BytesIO(raw), strict=True)
    people, fams = collect_individual_data(parser)
    source_records = parser.get_root_child_elements()
    sources_by_label = inventory_sources(people, (e.get_pointer() for e in source_records))
    used_repos = []
    for lbl, s in sources_by_label.items():
        r = s.get("repo")
        if r and r not in used_repos:
            used_repos.append(r)

    native = Counter(e.get_tag() for e in source_records)
    print(f"Read {len(people)} individuals, {len(fams)} families, "
          f"{native['SOUR']} sources, {native['REPO']} repositories")
    if sources_by_label:
        # Notes in the optional [Source] format (docs/gedcom.md) become source records.
        print(f"Made {len(sources_by_label)} sources from [Source] notes"
              + (f", in {len(used_repos)} repositories: {', '.join(used_repos)}" if used_repos else ""))

    enriched = build_enriched_gedcom(people, fams, sources_by_label, used_repos,
                                     source_records=source_records)
    # Check the generated syntax before replacing a previously usable export.
    parsed_output = Parser()
    parsed_output.parse(BytesIO(enriched.encode("utf-8")), strict=True)
    counts = Counter(e.get_tag() for e in parsed_output.get_element_list())
    OUTPUT_GED.write_text(enriched, encoding="utf-8")
    print(f"Wrote enriched GEDCOM: {OUTPUT_GED} ({len(enriched.encode('utf-8'))} bytes)")
    # Count actual exported structures, not guesses from narrative text.
    print(f"  - Exported: {counts['MARR']} MARR, {counts['BURI']} BURI, "
          f"{counts['BAPM']} BAPM, {counts['OBJE']} OBJE structures/links")


if __name__ == "__main__":
    main()

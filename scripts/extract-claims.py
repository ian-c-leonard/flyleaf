#!/usr/bin/env python3
"""Index authored citation placement and attachments, not source truth.

Writes book/CLAIMS-MAP.json: each passage of the book's text with the sources
it cites, for checking the text against the records.
Segments stop at citation groups, paragraphs, headings, figures, and notes.
Sentence splitting is only a reading aid. Explicit footnotes and captions have
their own entries; citations never leak into surrounding prose.

With --validate it only checks that the text uses the markup the book
supports (MACROS below and docs/book.md); the book build runs this before
it makes the PDF.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
import booklib

SCHEMA_VERSION = 2
# The Typst calls the book's text may use. Everything else in Typst's markup
# (emphasis, quotes, headings, escapes) is plain text here.
MACROS = ("#src", "#refp", "#fig", "#figure", "#footnote", "#block", "#grid",
          "#pagebreak", "#super[,]")
STRING = r'"(?:\\.|[^"\\])*"'
SRC = re.compile(r'#src\("([a-z0-9-]+(?:::[a-z0-9-]+)?)"\)')

def balanced_end(text, start):
    """End offset after a balanced argument/content block; honor strings."""
    stack, i = [], start
    pairs = {"(": ")", "[": "]", "{": "}"}
    while i < len(text):
        c = text[i]
        if c == '"':
            m = re.match(STRING, text[i:])
            if not m:
                raise ValueError("unterminated string")
            i += m.end()
            continue
        if c == "\\":
            i += 2
            continue
        if c in pairs:
            stack.append(pairs[c])
        elif c in ")]}":
            if not stack or c != stack.pop():
                raise ValueError("unbalanced Typst block")
            if not stack:
                return i + 1
        i += 1
    raise ValueError("unterminated Typst block")

def arguments(text):
    result, start, i = [], 0, 0
    while i < len(text):
        if text[i] == '"':
            m = re.match(STRING, text[i:])
            if not m:
                raise ValueError("unterminated argument string")
            i += m.end()
        elif text[i] in "([{":
            i = balanced_end(text, i)
        elif text[i] == ",":
            result.append(text[start:i].strip())
            start = i = i + 1
        else:
            i += 1
    result.append(text[start:].strip())
    return [s for s in result if s]

def literal(text):
    if not re.fullmatch(STRING, text.strip()):
        raise ValueError("expected a literal string")
    return json.loads(text)

# The values an allowed call's settings may hold. Each is a plain value, such
# as false or 1.36em, so a setting can never run Typst code or read a file.
LENGTH = r"(?:\d+(?:\.\d+)?|\.\d+)(?:in|cm|mm|pt|em|fr|%)|0"
SIDE = r"(?:left|right|top|bottom|x|y|rest)\s*:\s*(?:" + LENGTH + ")"
BOOL = "true or false"
SIZE = "a length such as 1.2em or 2in"
SIDES = "a length, or sides such as (left: 0pt, right: 0pt)"
COLUMNS = "a count such as 2, or lengths such as (1fr, 2fr)"
COLOUR = "one of the template's colours: ink, ember, pine or iron"
VALUES = {
    BOOL: r"true|false",
    SIZE: LENGTH,
    SIDES: rf"{LENGTH}|\(\s*{SIDE}(?:\s*,\s*{SIDE})*\s*,?\s*\)",
    COLUMNS: rf"[1-9]\d*|\(\s*(?:{LENGTH})(?:\s*,\s*(?:{LENGTH}))*\s*,?\s*\)",
    COLOUR: r"ink|ember|pine|iron",
}
# The settings each call may take, and the kind of value each holds. A call
# not listed here takes none: #footnote[...] and #super[, ] take only content.
SETTINGS = {
    "block": {"breakable": BOOL, "sticky": BOOL, "above": SIZE, "below": SIZE,
              "width": SIZE, "height": SIZE, "inset": SIDES},
    "pagebreak": {"weak": BOOL},
    "grid": {"columns": COLUMNS, "gutter": SIZE},
    "image": {"width": SIZE, "height": SIZE},
    "text": {"size": SIZE, "fill": COLOUR},
}

def settings(call, args, text=()):
    """Split a call's arguments into positional ones and named settings.
    Every setting must be on the call's list in SETTINGS, with a plain value.
    The names in `text` hold words (a caption) and are checked by the caller."""
    allowed = SETTINGS.get(call, {})
    label = f"{call}(...)" if call in ("image", "text") else f"#{call}"
    positional, named = [], {}
    for part in arguments(args):
        option = re.fullmatch(r"([A-Za-z][\w-]*)\s*:\s*(.+)", part, re.S)
        if not option:
            positional.append(part)
            continue
        name, value = option[1], option[2].strip()
        if name in named:
            raise ValueError(f"{label} names {name} twice")
        named[name] = value
        if name in text:
            continue
        if name not in allowed:
            listed = ", ".join([*allowed, *text])
            raise ValueError(f"{label} cannot take {name}" + (
                f"; it may take only {listed}" if listed else "; it takes no settings"))
        if not re.fullmatch(VALUES[allowed[name]], value):
            raise ValueError(f"{label}: {name} must be {allowed[name]}, not {value[:40]!r}")
    return positional, named

def grid_cells(args):
    """Offsets of literal content cells; reject expressions in layout options."""
    cells, cursor = [], 0
    for part in arguments(args):
        start = args.index(part, cursor)
        cursor = start + len(part)
        if part.startswith("[") and balanced_end(part, 0) == len(part):
            cells.append((start + 1, cursor - 1))
    positional, named = settings("grid", args)
    if len(positional) != len(cells):
        raise ValueError("grid requires literal content cells and static columns/gutter")
    if "columns" not in named or not cells:
        raise ValueError("grid requires explicit columns and at least one content cell")
    return cells

def figure_details(name, args, root):
    """Static #fig and #figure(image(...), caption: text(...)) authoring."""
    if name == "fig":
        parts, named = settings("fig", args, text=("caption",))
        caption = named.get("caption", "")
        if len(parts) != 1:
            raise ValueError('#fig takes one picture name, such as #fig("photo.jpg", caption: "...")')
        image_name = literal(parts[0])
        path = booklib.figure_path(image_name, root)
        images = booklib.flyleaf_settings.folder_name("images")
        paths = [str(path.relative_to(root))] if path else [f"{images}/{image_name}"]
        return literal(caption) if caption else "", paths, []
    positional, named = settings("figure", args, text=("caption",))
    caption = named.get("caption", "")
    if len(positional) != 1 or not re.fullmatch(r"image\(.*\)", positional[0], re.S):
        raise ValueError("figure body must be a static image(...) call")
    image_args, _ = settings("image", positional[0][len("image("):-1])
    if len(image_args) != 1:
        raise ValueError("image(...) takes one picture path and only width or height")
    image_path = literal(image_args[0])
    if not image_path.startswith("/"):
        raise ValueError("direct figure image path must start at the Typst root with /")
    images = booklib.flyleaf_settings.folder_name("images")
    if not image_path.startswith((f"/{images}/", "/build/figures/")) or ".." in image_path.split("/"):
        raise ValueError(f"a figure's picture must be in {images}/, such as \"/{images}/photo.jpg\"")
    paths = [image_path.lstrip("/")]
    if re.fullmatch(r"text\(.*\)", caption, re.S):
        values, _ = settings("text", caption[5:-1])
        if len(values) != 1:
            raise ValueError("caption text(...) must have one literal content string or block")
        caption = values[0]
    elif caption and not caption.startswith(("[", '"')):
        raise ValueError('a caption is words in quotes, words in [...], or text(...) around them')
    if caption.startswith("[") and balanced_end(caption, 0) == len(caption):
        content = caption[1:-1]
        if any(token in content for token in ('//', '/*', '*/')):
            raise ValueError("caption block comments cannot supply invisible source citations")
        text = SRC.sub("", content)
        # An authored caption may contain literal words plus exact #src calls.
        # Do not silently discard expressions, formatting or another macro.
        if not text.strip() or re.search(r"[#\[\]{}`\\_*$@<>~]", text) or re.search(r"(?:^|\n)\s*(?:=|[-+] )", text):
            raise ValueError("caption block must contain literal text and exact source calls only")
        if args.count(caption) != 1:
            raise ValueError("caption block must have one unambiguous argument location")
        offset = args.index(caption) + 1
        keys = [(m[1], offset + m.start()) for m in SRC.finditer(content)]
        return text, paths, keys
    return literal(caption) if caption else "", paths, []

def split_sentences(text):
    """Approximate reading units; the segment, not this split, owns citations."""
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r'(?<!\b[A-Z])(?<!\bMr)(?<!\bMrs)(?<!\bDr)(?<!\bRev)'
                     r'(?<!\bSt)(?<!\bvol)(?<!\bno)(?<!\bp)(?<!\bb)(?<!\bd)(?<!\bm)'
                     r'(?<=[.!?])\s+(?=[A-Z"“])', text)
    return [p.strip() for p in parts if p.strip()]

class Document:
    def __init__(self, text, file, covers, source_map, tree, root, artifact_cache=None, *, meta=None,
                 hash_files=True):
        self.original, self.file, self.covers = text, file, covers
        self.source_scope = booklib.citation_scope(meta or {}, covers, tree)
        self.source_map, self.tree, self.root = source_map, tree, Path(root)
        self.claims, self.figures, self.issues = [], [], []
        self.artifact_cache = {} if artifact_cache is None else artifact_cache
        self.hash_files = hash_files
        self.segment = 0
        self.position = 0  # where the walk is, for the line of a markup error
        self.text = re.sub(r"(?m)^[ \t]*//[^\n]*", lambda m: " " * len(m[0]), text)
        self.headings = {m.start(): m.end() for m in re.finditer(r"(?m)^=+ [^\n]*", self.text)}

    def location(self, start, end):
        return {"file": self.file, "start": start, "end": end,
                "line": self.original.count("\n", 0, start) + 1,
                "end_line": self.original.count("\n", 0, end) + 1}

    def artifacts(self, paths):
        result = []
        for path in paths:
            if path not in self.artifact_cache:
                target = self.root / path
                rec = {"path": path, "exists": target.is_file()}
                if rec["exists"] and self.hash_files:
                    with target.open("rb") as stream:
                        rec["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
                self.artifact_cache[path] = rec
            result.append(dict(self.artifact_cache[path]))
        return result

    def resolve(self, call, start):
        try:
            match = booklib.resolve_source(self.source_map, self.source_scope, call)
        except ValueError as e:
            match, reason = None, str(e)
        else:
            reason = f"unresolved or out-of-scope citation {call!r}"
        if match is None:
            self.issues.append({**self.location(start, start), "message": reason})
            return {"key": call, "status": "unresolved", "paths": []}
        refn, source = match
        return {"key": call, "refn": refn, "status": "resolved",
                **{k: source.get(k) for k in ("label", "url", "tier", "native",
                                              "source_id", "uses", "raw_notes")},
                "paths": source["paths"], "artifacts": self.artifacts(source["paths"])}

    def emit(self, text, keys, start, end, kind, figure_paths=()):
        text = re.sub(r"\s+", " ", text).strip()
        if not text and not keys:
            return
        if not text and keys:
            self.issues.append({**self.location(start, end), "message": "citation without preceding text"})
        self.segment += 1
        self.claims.append({**self.location(start, end), "segment": self.segment,
                            "kind": kind, "covers": self.covers, "text": text,
                            "raw": self.original[start:end],
                            "sentences": split_sentences(text),
                            "keys": [k for k, _ in keys],
                            "sources": [self.resolve(k, p) for k, p in keys],
                            "figure_artifacts": self.artifacts(figure_paths)})

    def walk(self, start=0, end=None, kind="prose"):
        end = len(self.text) if end is None else end
        pieces, keys, begin, last = [], [], None, start
        def flush():
            nonlocal pieces, keys, begin
            if begin is not None:
                self.emit("".join(pieces), keys, begin, last, kind)
            pieces, keys, begin = [], [], None
        def add(value, first, final):
            nonlocal begin, last
            if value.strip():
                if keys:
                    flush()
                if begin is None:
                    begin = first
            pieces.append(value)
            last = final
        i = start
        while i < end:
            self.position = i
            if i in self.headings:
                flush()
                # \\ prints a backslash, so it does not escape the # after it.
                heading = re.sub(r"\\.", "", self.text[i:self.headings[i]])
                if "#" in heading or "$" in heading:
                    raise ValueError("a heading holds plain text only; "
                                     "to print # or $ in it, write \\# or \\$")
                i = self.headings[i]
                continue
            blank = re.match(r"\n[ \t]*\n", self.text[i:])
            if blank:
                flush()
                i += blank.end()
                continue
            if self.text[i] == "\\" and i + 1 < end:
                add(self.text[i:i+2], i, i+2)
                i += 2
                continue
            if self.text[i] == "`":
                ticks = re.match(r"`+", self.text[i:])[0]
                if len(ticks) >= 3:
                    raise ValueError("``` starts a code block, which the book does not print; "
                                     "to print a backtick, write \\`")
                if len(ticks) == 2:
                    # Typst reads `` as empty raw text, not as an opening.
                    add(ticks, i, i + 2)
                    i += 2
                    continue
                close = self.text.find(ticks, i + len(ticks), end)
                if close < 0:
                    raise ValueError("unterminated raw text")
                final = close + len(ticks)
                add(self.text[i:final], i, final)
                i = final
                continue
            if self.text.startswith("//", i):
                raise ValueError("a comment needs a line of its own: start the line with //")
            if self.text.startswith("/*", i):
                # Typst skips a block comment; this check would read on inside it.
                raise ValueError("/* starts a block comment, which a story may not use; "
                                 "start a comment line with //")
            if self.text[i] == "$":
                # Typst math can call functions that read files, with no #.
                raise ValueError("$ starts Typst math, which the book does not use; "
                                 "to print a dollar sign, write \\$")
            macro = re.match(r"#([A-Za-z][\w-]*)", self.text[i:])
            if not macro and self.text[i] == "#":
                # #{...}, #(...), #"..." and the like run as Typst code.
                raise ValueError("# starts Typst code here; to print it, write \\#")
            if not macro:
                add(self.text[i], i, i+1)
                i += 1
                continue
            name, j = macro[1], i + macro.end()
            args, content = "", None
            if j < end and self.text[j] == "(":
                stop = balanced_end(self.text, j)
                args, j = self.text[j+1:stop-1], stop
            if j < end and self.text[j] == "[":
                stop = balanced_end(self.text, j)
                content, j = (j+1, stop-1), stop
            # Typst reads on past the call: .name, (...) or [...] straight
            # after it are more code, and would run.
            if j < end and (self.text[j] in "([" or re.match(r"\.[^\W\d]", self.text[j:j+2])):
                raise ValueError(f"#{name} must end at its closing bracket; "
                                 "to print what follows it, write \\ before it")
            if name == "src":
                m = SRC.fullmatch(self.text[i:j])
                if not m:
                    raise ValueError('#src takes one source key in quotes, such as #src("birth-record")')
                if begin is None:
                    begin = i
                keys.append((m[1], i))
                last = j
            elif name in {"fig", "figure"}:
                if content:
                    raise ValueError(f"#{name} takes its caption as caption: \"...\", "
                                     "not as [...] after the call")
                flush()
                caption, paths, caption_keys = figure_details(name, args, self.root)
                self.figures.append({**self.location(i, j), "caption": caption,
                                     "artifacts": self.artifacts(paths)})
                self.emit(caption, [(key, i + len(f"#{name}(") + offset)
                                    for key, offset in caption_keys], i, j, "caption", paths)
            elif name == "footnote" and content:
                if settings("footnote", args)[0]:
                    raise ValueError("#footnote takes only its note, as #footnote[...]")
                flush()
                self.walk(*content, kind="note")
            elif name == "block" and content:
                if settings("block", args)[0]:
                    raise ValueError("#block takes its text as #block(...)[...]")
                flush()
                self.walk(*content, kind=kind)
            elif name == "grid":
                if content or not self.text[i:j].startswith("#grid("):
                    raise ValueError("grid cells must be literal arguments inside parentheses")
                cells = grid_cells(args)
                flush()
                offset = i + len("#grid(")
                for first, final in cells:
                    self.walk(offset + first, offset + final, kind=kind)
            elif name == "pagebreak":
                # Static layout only. Do not silently discard authored text
                # or expressions passed as arguments/content to this macro.
                if not re.fullmatch(r"#pagebreak\(\s*(?:weak\s*:\s*(?:true|false)\s*,?\s*)?\)",
                                    self.text[i:j]):
                    raise ValueError("#pagebreak may take only weak: true or weak: false")
                flush()
            elif name == "super" and content and self.text[slice(*content)].strip() == ",":
                if args.strip():
                    raise ValueError("#super takes no settings here; write #super[, ]")
            elif name == "refp":
                if content:
                    raise ValueError('#refp takes only a person\'s id, such as #refp("john-penhallow")')
                ref = literal(args)
                person = self.tree.by_refn.get(ref)
                if person is None:
                    raise ValueError(f"unknown person reference {ref!r}")
                add(booklib.person_name(person), i, j)
            else:
                raise ValueError(f"#{name} is not markup the book supports. The text may use "
                                 + ", ".join(MACROS) + " (see docs/book.md)")
            i = j
        flush()

def prose_inputs(tree, cfg):
    """Configured book prose, using the assembler's section scopes."""
    coverage = booklib._load_module("book-coverage.py", "claims_coverage").gather(tree, cfg)
    if coverage["errors"]:
        raise ValueError("; ".join(coverage["errors"]))
    cfg = coverage["cfg"]  # each chapter's lines written out
    all_refns = list(coverage["ancestors"])
    inputs = [(p, all_refns) for folder in ("front-matter", "back-matter")
              for p in booklib.typ_files(booklib.BOOK_DIR / folder)]
    for chapter in cfg["chapters"]:
        rows = []
        for section in coverage["sections"]:
            ancestor = coverage["ancestors"].get(section["meta"].get("refn"))
            if ancestor and ancestor["line"] in chapter.get("lines", []):
                rows.append((ancestor, section))
        rows.sort(key=lambda r: (-r[0]["generation"], r[0]["ahnentafel"][0]))
        intro = booklib.BOOK_DIR / "chapters" / f"{chapter['id']}-intro.typ"
        if intro.exists():
            inputs.append((intro, list(dict.fromkeys(c for _, s in rows for c in s["covers"]))))
        inputs.extend((s["path"], s["covers"]) for a, s in rows
                      if s["has_prose"] and coverage["states"].get(a["refn"]) != "stub")
    return sorted(inputs)

def build_map(tree, inputs, root=booklib.ROOT, *, hash_files=True):
    root = Path(root)
    source_map = tree.sources_by_person()
    claims, figures, issues, manifest, artifact_cache = [], [], [], {}, {}
    for path, covers in inputs:
        path = Path(path)
        relative = str(path.relative_to(root))
        manifest[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        meta, _ = booklib.parse_front_matter(path)
        doc = Document(path.read_text(), relative, covers, source_map, tree, root, artifact_cache,
                       meta=meta, hash_files=hash_files)
        try:
            doc.walk()
        except ValueError as e:
            doc.issues.append({"file": relative, "line": doc.original.count("\n", 0, doc.position) + 1,
                               "message": str(e)})
        claims.extend(doc.claims)
        figures.extend(doc.figures)
        issues.extend(doc.issues)
    for path in (tree.src_path, booklib.BOOK_YAML,
                 *[Path(__file__).with_name(n) for n in
                   ("extract-claims.py", "booklib.py", "book-coverage.py", "book-assemble.py",
                    "bookbib.py", "enrich-gedcom.py", "gedcom_confidence.py")]):
        # Shared code is named relative to the engine; family files to the root.
        engine = booklib.ENGINE.resolve()
        label = (str(path.resolve().relative_to(engine)) if path.resolve().is_relative_to(engine)
                 else str(path.relative_to(root)) if path.is_relative_to(root) else str(path))
        manifest[label] = hashlib.sha256(path.read_bytes()).hexdigest()
    without = sorted({f"{s['refn']}::{s['key'].split('::')[-1]}" for c in claims for s in c["sources"]
                      if s["status"] == "resolved" and not s["paths"]})
    all_artifacts = ([a for f in figures for a in f["artifacts"]] +
                     [a for c in claims for s in c["sources"] for a in s.get("artifacts", [])])
    missing = sorted({a["path"] for a in all_artifacts if not a["exists"]})
    return {"schema_version": SCHEMA_VERSION,
            "status": "citation placement index; source support requires human review",
            "inputs_sha256": dict(sorted(manifest.items())),
            "stats": {"prose_files": len(inputs), "segments": len(claims),
                      "cited_segments": sum(bool(c["keys"]) for c in claims),
                      "uncited_segments": sum(not c["keys"] for c in claims),
                      "figures": len(figures), "keys_without_artifact": without,
                      "missing_artifacts": missing, "resolution_errors": len(issues)},
            "issues": issues, "claims": claims, "figures": figures}

def render_json(payload):
    return json.dumps(payload, indent=1, ensure_ascii=False) + "\n"

def slice_documents(payload):
    """An authoritative index identifies active slices and the full map."""
    map_hash = hashlib.sha256(render_json(payload).encode("utf-8")).hexdigest()
    grouped = {name: [] for name in payload["inputs_sha256"] if name.endswith(".typ")}
    for claim in payload["claims"]:
        grouped[claim["file"]].append(claim)
    documents = {}
    for name, claims in grouped.items():
        target = str(Path(name).with_suffix(".json"))
        documents[target] = render_json({"schema_version": SCHEMA_VERSION, "file": name,
            "map_sha256": map_hash, "inputs_sha256": payload["inputs_sha256"], "claims": claims})
    documents["index.json"] = render_json({"schema_version": SCHEMA_VERSION,
        "map_sha256": map_hash, "inputs_sha256": payload["inputs_sha256"],
        "active_slices": sorted(documents)})
    return documents

def write_slices(payload, directory):
    """Use a separate namespace; never delete historical review verdicts."""
    for name, text in slice_documents(payload).items():
        target = Path(directory) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=booklib.BOOK_DIR / "CLAIMS-MAP.json")
    parser.add_argument("--check", action="store_true", help="check freshness without writing files")
    parser.add_argument("--validate", action="store_true",
                        help="only check the text's markup and citations; write nothing")
    parser.add_argument("--slices-dir", type=Path, default=booklib.ROOT / "build/claims/current")
    args = parser.parse_args(argv)
    tree = booklib.Tree()
    payload = build_map(tree, prose_inputs(tree, booklib.load_book_yaml()),
                        hash_files=not args.validate)
    if payload["issues"]:
        for issue in payload["issues"]:
            where = f"{issue['file']}, line {issue['line']}" if issue.get("line") else issue["file"]
            print(f"{where}: {issue['message']}", file=sys.stderr)
        return 1
    if args.validate:
        n = payload['stats']['prose_files']
        print(f"Story markup checked: {n} file{'' if n == 1 else 's'} with written text."
              if n else "Story markup checked: no story has written text yet; stubs are skipped.")
        return 0
    rendered = render_json(payload)
    if args.check:
        if not args.out.exists() or args.out.read_text() != rendered:
            print("claim map is stale; run flyleaf book", file=sys.stderr)
            return 1
        for name, expected in slice_documents(payload).items():
            path = args.slices_dir / name
            if not path.exists() or path.read_text() != expected:
                print(f"claim slice {name} is stale; run flyleaf book", file=sys.stderr)
                return 1
    else:
        args.out.write_text(rendered)
        write_slices(payload, args.slices_dir)
    print(f"Citation map written: {payload['stats']['segments']} passages in "
          f"{payload['stats']['prose_files']} files, {payload['stats']['figures']} figures"
          + (f"; {len(payload['stats']['missing_artifacts'])} attached files are missing"
             if payload['stats']['missing_artifacts'] else "") + ".")
    return 0

if __name__ == "__main__":
    sys.exit(main())

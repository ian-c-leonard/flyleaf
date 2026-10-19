"""The family's settings, from flyleaf.json at the root of the family folder.

Every family-specific value the build needs (names, paths, the PDF file name,
the maintainer) comes from here, so the code itself names no family.

Two folders matter:
- ENGINE, the shared Flyleaf code: scripts/, the book templates in book/, and
  the website code in website/.
- The family folder, holding flyleaf.json and the family's content and build
  output. FLYLEAF_FAMILY names it. Otherwise it is the first of these with a
  flyleaf.json: the engine folder itself, the folder above it (Flyleaf kept
  inside a family's repository), then the engine's sample/.
"""
import json
import os
from functools import lru_cache
from pathlib import Path

_HERE = Path(__file__).resolve().parent
ENGINE = _HERE.parent


def family_root():
    """The folder holding flyleaf.json and the family's content: FLYLEAF_FAMILY,
    else the first of the current folder, the folder that holds Flyleaf (a
    family keeping Flyleaf inside its folder) and Flyleaf's sample/ that has
    a flyleaf.json. The flyleaf command and website/flyleaf-settings.mjs use
    the same order."""
    if os.environ.get("FLYLEAF_FAMILY"):
        return Path(os.environ["FLYLEAF_FAMILY"]).resolve()
    for candidate in (Path.cwd(), ENGINE.parent, ENGINE / "sample"):
        if (candidate / "flyleaf.json").is_file():
            return candidate.resolve()
    return ENGINE.resolve()


def _roots():
    """The engine and the family folder, the deeper one first. Either may
    hold the other: Flyleaf inside a family's folder, or the sample family
    inside Flyleaf."""
    return sorted((ENGINE.resolve(), family_root()), key=lambda root: len(root.parts),
                  reverse=True)


def logical(path):
    """A stable name for a file in build records: relative to the engine for
    shared code, relative to the family folder for the family's files."""
    path = Path(path).absolute()
    for root in _roots():
        if path.is_relative_to(root):
            return path.relative_to(root).as_posix()
    return str(path)


def locate(name):
    """The file a stable name from logical() refers to, looked up in the
    same order: the deeper folder first."""
    path = Path(name)
    if path.is_absolute():
        return path
    for root in _roots():
        if (root / path).exists():
            return root / path
    return family_root() / path


@lru_cache(maxsize=None)
def _load(root):
    file = Path(root) / "flyleaf.json"
    if not file.is_file():
        raise SystemExit(f"No flyleaf.json in {root}. Set FLYLEAF_FAMILY to your family folder.")
    return json.loads(file.read_text(encoding="utf-8"))


def settings():
    """The whole settings object (read once per family folder)."""
    return _load(str(family_root()))


def get(dotted, default=None):
    """One setting by dotted name, e.g. get("book.pdf_name")."""
    node = settings()
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node


def require(dotted):
    """One setting that must be present."""
    value = get(dotted)
    if value in (None, ""):
        raise SystemExit(f"flyleaf.json is missing {dotted}")
    return value


# Paths a family may leave out of its "paths" settings, with their defaults.
# The website reads the same default for site_content.
PATH_DEFAULTS = {"site_content": "site"}


def path(name):
    """A family content path from the "paths" settings, as an absolute Path."""
    if name in PATH_DEFAULTS and get(f"paths.{name}") in (None, ""):
        return family_root() / PATH_DEFAULTS[name]
    return family_root() / require(f"paths.{name}")


# Folders a family may rename in its "paths" settings, with their defaults.
FOLDERS = {"book": "book"}
# Photographs and documents live in images/. The tree's file paths and the
# website's addresses start with that name, so it cannot be renamed.
IMAGES = "images"


def folder_name(name):
    """A family folder's name relative to the family folder, such as "book"."""
    if name == "images":
        if get("paths.images") not in (None, IMAGES):
            raise SystemExit('flyleaf.json: paths.images cannot be changed. Keep '
                             'photographs and documents in a folder called "images".')
        return IMAGES
    return Path(get(f"paths.{name}") or FOLDERS[name]).as_posix().strip("/")


def folder(name):
    """A family folder from the "paths" settings, as an absolute Path."""
    return family_root() / folder_name(name)


CONTENT_DEFAULTS = ENGINE / "website" / "content-defaults"


def content_file(name):
    """A site content file: the family's own, else Flyleaf's empty default."""
    own = path("site_content") / name
    default = CONTENT_DEFAULTS / name
    return own if own.exists() or not default.exists() else default

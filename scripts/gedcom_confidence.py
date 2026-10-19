"""Resolve person confidence without changing recorded notes or citations.

Book readers and validation enforce errors. Preservation export may retain an
unresolved record: resolution is not permission to select a historical value.
"""
import re


CONFIDENCE_VALUES = frozenset({"primary", "tree-link", "memoir", "unknown"})
CONFIDENCE_MARKER = re.compile(r"\s*\[Confidence\]\s*(\S+)\s*$")


def simple_note(element):
    """Plain text only; metadata beneath a continuation also stays structured."""
    return all(c.get_tag() in ("CONC", "CONT") and not c.get_child_elements()
               for c in element.get_child_elements())


def legacy_confidence(note):
    """A confidence level in the optional plain-text note format
    ("... [Confidence] primary"; docs/gedcom.md), excluding source labels.
    A tree can instead record it as 1 _CONFLEVEL."""
    if note.get_tag() != "NOTE" or not simple_note(note):
        return None
    text = note.get_multi_line_value() or ""
    if text.startswith("[Source]"):
        return None
    match = CONFIDENCE_MARKER.search(text)
    return match.group(1) if match else None


def resolve_confidence(individual):
    """Return value/errors/warnings; missing and unresolved remain distinct."""
    children = individual.get_child_elements()
    refn = next(((c.get_multi_line_value() or "").strip() for c in children
                 if c.get_tag() == "REFN" and any(
                     s.get_tag() == "TYPE" and s.get_value() == "jsonid"
                     for s in c.get_child_elements())), "?")
    name = " ".join(filter(None, individual.get_name())) or "(unnamed)"
    location = f"{individual.get_pointer()} ({refn}) {name}"
    native = [(c.get_multi_line_value() or "").strip() for c in children
              if c.get_tag() == "_CONFLEVEL"]
    legacy = sorted({value for c in children
                     if (value := legacy_confidence(c)) is not None})
    value, errors, warnings = None, [], []
    if native:
        if len(native) != 1 or native[0] not in CONFIDENCE_VALUES:
            errors.append(f"[CONF-NATIVE] {location}: expected one nonempty _CONFLEVEL "
                          f"from {sorted(CONFIDENCE_VALUES)!r}; found {native!r}")
        else:
            value = native[0]
            if any(old != value for old in legacy):
                warnings.append(f"[CONF-HISTORY] {location}: legacy [Confidence] values "
                                f"{legacy!r} differ from active _CONFLEVEL {value!r}; "
                                "recorded history is retained")
    elif legacy:
        invalid = sorted(set(legacy) - CONFIDENCE_VALUES)
        if invalid:
            errors.append(f"[CONF-LEGACY] {location}: invalid terminal [Confidence] "
                          f"values {invalid!r}; expected {sorted(CONFIDENCE_VALUES)!r}")
        if len(legacy) > 1:
            errors.append(f"[CONF-CONFLICT] {location}: conflicting legacy [Confidence] "
                          f"values {legacy!r}; record a reviewed _CONFLEVEL without "
                          "discarding history")
        if not errors:
            value = legacy[0]
    return {"value": value, "errors": errors, "warnings": warnings}

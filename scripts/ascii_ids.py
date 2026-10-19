"""Plain ASCII ids from names in any alphabet.

People's ids and family-line ids become Typst labels and file names, so they
use only a-z, 0-9 and hyphens. A name keeps its letters: accents are folded
("Müller" becomes muller), Greek and Cyrillic letters are spelled in Latin
letters, and a letter of any other script is written as its code point, so
two different names never share an id. Only the standard library is used:
the flyleaf command loads this too.
"""
import re
import unicodedata

# Letters that Unicode does not split into a base letter and an accent.
_LATIN = {"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ð": "d", "þ": "th", "ł": "l",
          "đ": "d", "ı": "i", "ħ": "h", "ŋ": "ng"}
_GREEK = dict(zip("αβγδεζηθικλμνξοπρσςτυφχψω",
                  ["a", "v", "g", "d", "e", "z", "i", "th", "i", "k", "l", "m", "n", "x", "o",
                   "p", "r", "s", "s", "t", "y", "f", "ch", "ps", "o"]))
_CYRILLIC = dict(zip("абвгдежзийклмнопрстуфхцчшщъыьэюяієґђјљњћџ",
                     ["a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o",
                      "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "",
                      "e", "yu", "ya", "i", "ye", "g", "dj", "j", "lj", "nj", "c", "dz"]))
_LETTERS = {**_LATIN, **_GREEK, **_CYRILLIC}


def ascii_text(text):
    """Lowercase ASCII text for an id: "Ó Súilleabháin" -> "o suilleabhain",
    "Παπαδόπουλος" -> "papadopoulos", "王" -> "u738b"."""
    out = []
    # Greek writes the sound ou with two letters.
    for char in unicodedata.normalize("NFKD", (text or "").lower()).replace("ου", "ou"):
        if char.isascii():
            out.append(char)
        elif unicodedata.combining(char):
            continue
        elif char in _LETTERS:
            out.append(_LETTERS[char])
        elif char.isalnum():
            out.append(f" u{ord(char):x} ")
        else:
            out.append(" ")
    return "".join(out)


def slug(text, max_len=48):
    """An id from a name: lowercase letters, digits and hyphens."""
    plain = re.sub(r"[’'\"“”‘]", "", ascii_text(text))
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")[:max_len].rstrip("-")

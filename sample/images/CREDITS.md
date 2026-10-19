# Image and document credits

The Penhallow family is fictional. Nothing in this folder shows or records a
real member of any family. The photographs are real pictures of unidentified
people and places from the Library of Congress, with no known restrictions on
publication, used only to illustrate the sample. The
documents are facsimiles made with Typst for the sample.

## Photographs

All five came from the Library of Congress Prints and Photographs Division.
Each file is the library's 1024-pixel JPEG service copy, cropped to remove the
scan border, converted to grayscale and saved again as a JPEG with no
metadata (no EXIF, GPS, ICC profile or comments).

| File | What it shows | Source | Rights |
|---|---|---|---|
| `photographs/john-penhallow-portrait.jpg` | Unidentified man, studio portrait. Stands in for John Penhallow. | C.M. Bell Studio Collection, glass negative, between 1873 and about 1916. LC-B5- 820907. https://www.loc.gov/item/2016712605/ | No known restrictions on publication. |
| `photographs/elizabeth-penhallow-portrait.jpg` | Unidentified woman, studio portrait. Stands in for Elizabeth Penhallow. | C.M. Bell Studio Collection, glass negative, between 1873 and about 1916. LC-B5- 800490. https://www.loc.gov/item/2016711727/ | No known restrictions on publication. |
| `photographs/edith-rowe-portrait.jpg` | Unidentified young woman, studio portrait. Stands in for Edith May Rowe. | C.M. Bell Studio Collection, glass negative, between 1873 and about 1916. LC-B5- 800494. https://www.loc.gov/item/2016711731/ | No known restrictions on publication. |
| `photographs/penhallow-family-group.jpg` | Unidentified family of four, studio group. Stands in for William and Edith Penhallow with Lilian and Harold. | C.M. Bell Studio Collection, glass negative, between 1873 and about 1916. LC-B5- 860160. https://www.loc.gov/item/2016712924/ | No known restrictions on publication. |
| `photographs/mineral-point-cornish-miners-house-habs.jpg` | Cornish Miner's House No. 2, Mineral Point, Wisconsin, view from the southeast. Illustrates the kind of house Cornish miners built there; it was not the Penhallows' home. | Historic American Buildings Survey, HABS WI-28-14, photograph 1, by Alexander C. Guth. https://www.loc.gov/item/wi0079/ | Made by the U.S. Government; no known restrictions. |

Suggested credit line: "Unidentified sitter. Library of Congress. Used to
illustrate the sample family." For the house: "Historic American Buildings
Survey, Library of Congress."

## Facsimile documents

Made with Typst 0.14.2 for the sample. Each page says on its face that it is a
facsimile and that the record is fictional. The newspaper, *The Iowa County
Lantern*, is invented. The Typst sources are in `facsimiles/`; rebuild a
document from that folder with, for example:

    typst compile --font-path fonts 1866-penhallow-trembath-marriage.typ \
      ../documents/1866-penhallow-trembath-marriage-certificate.pdf

| File | Source file |
|---|---|
| `documents/1866-penhallow-trembath-marriage-certificate.pdf` and `documents/plates/1866-penhallow-trembath-marriage-plate.jpg` | `facsimiles/1866-penhallow-trembath-marriage.typ` |
| `newspapers/1912-03-07-iowa-county-lantern-penhallow-obituary.pdf` and `newspapers/plates/1912-03-07-iowa-county-lantern-penhallow-obituary-plate.jpg` | `facsimiles/1912-iowa-county-lantern-penhallow-obituary.typ` |
| `letters/1944-04-09-edith-penhallow-to-robert.pdf` and `letters/plates/1944-04-09-edith-penhallow-to-robert-plate.jpg` | `facsimiles/1944-edith-penhallow-letter.typ` |
| `recipes/1995-joan-penhallow-recipe-booklet.pdf` (4 pages, with a text layer) and `recipes/plates/1995-joan-penhallow-recipe-booklet-cover.jpg` | `facsimiles/1995-joan-penhallow-recipe-booklet.typ` |

The plates are PNG renderings from Typst, saved again as JPEG with no
metadata. The recipes are traditional dishes written up for the sample.

## Fonts used by the facsimiles

The font files and their licences are in `facsimiles/fonts/`.

| Font | Designer | Licence |
|---|---|---|
| IM FELL English and IM FELL English SC | Igino Marini | SIL Open Font License 1.1 (`OFL-IM-Fell.txt`) |
| Pinyon Script | Nicole Fally, The Pinyon Project Authors | SIL Open Font License 1.1 (`OFL-Pinyon-Script.txt`) |
| Cedarville Cursive | Kimberly Geswein | SIL Open Font License 1.1 (`OFL-Cedarville-Cursive.txt`) |
| Special Elite | Astigmatic (Brian J. Bonislawsky) | Apache License 2.0 (`LICENSE-Special-Elite-Apache-2.0.txt`) |

All four were downloaded from the Google Fonts repository
(https://github.com/google/fonts).

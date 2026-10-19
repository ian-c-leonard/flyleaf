// Facsimile made for the Flyleaf sample family. "The Iowa County Lantern"
// is an invented newspaper and this notice is fictional.
//
// Build (from sample/images/facsimiles):
//   typst compile --font-path fonts 1912-iowa-county-lantern-penhallow-obituary.typ \
//     ../newspapers/1912-03-07-iowa-county-lantern-penhallow-obituary.pdf

#let paper = rgb("#ece1c4")
#let ink = rgb("#231d16")
#let warn = rgb("#9b2d20")

#set document(
  title: "Facsimile clipping: obituary of John Penhallow, The Iowa County Lantern, 7 March 1912 (fictional)",
  author: "Flyleaf sample family",
)
#set page(width: 2.9in, height: auto, margin: (x: 0.22in, top: 0.2in, bottom: 0.18in), fill: paper)
#set text(font: "IM FELL English", size: 8.4pt, fill: ink, lang: "en", hyphenate: true)
#set par(justify: true, leading: 0.42em, spacing: 0.5em, first-line-indent: 0.9em)

#align(center, text(size: 6.4pt, tracking: 0.04em)[
  THE IOWA COUNTY LANTERN, MINERAL POINT, WIS., THURSDAY, MARCH 7, 1912.
])
#line(length: 100%, stroke: 0.5pt + ink)
#v(1pt)
#align(center)[
  #set block(spacing: 4pt)
  #set par(first-line-indent: 0pt, spacing: 4pt)
  #text(font: "IM FELL English SC", size: 12pt, tracking: 0.03em)[John Penhallow.]
  #line(length: 22%, stroke: 0.4pt + ink)
  #text(size: 7.6pt, style: "italic")[One of the Old Cornish Miners \ Answers the Last Call.]
  #line(length: 22%, stroke: 0.4pt + ink)
]
#v(2pt)

John Penhallow died at his home on Shake Rag street on Sunday morning, March 3, after an illness of several weeks. He was in his sixty-seventh year.

Mr. Penhallow was born in the parish of St. Just, Cornwall, England, and worked as a boy in the tin mines of that district. In October, 1866, he was married at Penzance to Miss Elizabeth Ann Trembath, and in the spring of 1868 they came to America with their infant son, reaching Mineral Point in June of that year. For more than thirty years he worked in the lead and zinc mines about the city, and he was afterward employed at the zinc works until failing health obliged him to give up work.

He was a faithful member of the Methodist church and for many years a class leader. He leaves his wife; a daughter, Miss Mary Jane Penhallow, of Madison; and a son, William H. Penhallow, of Dodgeville. A son, Richard, died in infancy.

The funeral was held from the Methodist church on Wednesday afternoon, and burial was made in the city cemetery.

#v(5pt)
#line(length: 100%, stroke: (paint: warn, thickness: 0.4pt, dash: "dotted"))
#set par(first-line-indent: 0pt, justify: false)
#align(center, text(size: 5.8pt, style: "italic", fill: warn, hyphenate: false)[
  Facsimile made for the Flyleaf sample family. The newspaper and the notice are fictional.
])

// Facsimile made for the Flyleaf sample family. The people and this record
// are fictional. The layout follows the printed columns of an English
// marriage register entry of the 1860s; it is not a copy of any real entry.
//
// Build (from sample/images/facsimiles):
//   typst compile --font-path fonts 1866-penhallow-trembath-marriage.typ \
//     ../documents/1866-penhallow-trembath-marriage-certificate.pdf

#let paper = rgb("#f2ead3")
#let rule = rgb("#8a6a4a")
#let print-ink = rgb("#2b2118")
#let hand-ink = rgb("#3d2a1c")
#let warn = rgb("#9b2d20")

#set document(
  title: "Facsimile marriage entry: John Penhallow and Elizabeth Ann Trembath, 1866 (fictional)",
  author: "Flyleaf sample family",
)
#set page(width: 11in, height: 5.2in, margin: (x: 0.45in, top: 0.4in, bottom: 0.4in), fill: paper)
#set text(font: "IM FELL English", size: 9.5pt, fill: print-ink)

#let hand(body, size: 15pt) = text(font: "Pinyon Script", size: size, fill: hand-ink, body)
#let head(body) = align(center + horizon, text(size: 8pt, style: "italic", body))

#align(center, text(font: "IM FELL English SC", size: 8pt, tracking: 0.12em, fill: warn)[
  Facsimile made for the Flyleaf sample family · fictional record · not a copy of any real register
])
#v(6pt)

#align(center)[
  #text(size: 13pt)[#hand(size: 19pt)[1866.]
  Marriage solemnized at #hand[the Wesleyan Methodist Chapel]
  in the District of #hand[Penzance]
  in the County of #hand[Cornwall]]
]
#v(4pt)

#table(
  columns: (0.45in, 1.05in, 1.9in, 0.5in, 0.85in, 1.05in, 1.25in, 1.55in, 1.25in),
  stroke: 0.6pt + rule,
  inset: (x: 4pt, y: 5pt),
  align: center + horizon,
  head[No.], head[When Married.], head[Name and Surname.], head[Age.],
  head[Condition.], head[Rank or Profession.], head[Residence at the time of Marriage.],
  head[Father's Name and Surname.], head[Rank or Profession of Father.],
  table.cell(rowspan: 2)[#hand[47]],
  table.cell(rowspan: 2)[#hand(size: 13pt)[Ninth \ October \ 1866]],
  [#hand[John Penhallow]], [#hand[21]], [#hand[Bachelor]], [#hand[Tin Miner]],
  [#hand[St Just]], [#hand[Richard Penhallow]], [#hand[Miner]],
  [#hand[Elizabeth Ann Trembath]], [#hand[19]], [#hand[Spinster]], [#hand[—]],
  [#hand[Penzance]], [#hand(size: 13pt)[James Trembath \ (deceased)]], [#hand[Copper Miner]],
)

#v(6pt)
#set par(leading: 0.9em)
Married in the #hand[Wesleyan Methodist Chapel] according to the Rites and Ceremonies of the
#hand[Wesleyan Methodists] after #hand[Certificate] by me,
#h(1fr) #hand[William Hosken], Minister.
#v(4pt)
#grid(
  columns: (1fr, 1fr),
  column-gutter: 0.3in,
  [
    This Marriage \ was solemnized \ between us,
    #h(8pt)
    #box(baseline: 50%)[#stack(spacing: 6pt,
      hand[John Penhallow],
      [#hand[The mark of] #text(size: 13pt, fill: hand-ink)[X] #hand[Elizabeth Ann Trembath]],
    )]
  ],
  [
    in the \ Presence \ of us,
    #h(8pt)
    #box(baseline: 50%)[#stack(spacing: 6pt,
      hand[Richard Penhallow],
      hand[Mary Trembath],
    )]
    #v(6pt)
    #align(right)[#hand[Thomas Pascoe], Registrar.]
  ],
)

#place(bottom + center, dy: 0.1in, text(size: 7pt, style: "italic", fill: warn)[
  Made with Typst for the Flyleaf sample. John Penhallow, Elizabeth Ann Trembath and every other name here are invented.
])

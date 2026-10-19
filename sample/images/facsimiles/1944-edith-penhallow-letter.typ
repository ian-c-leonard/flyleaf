// Facsimile made for the Flyleaf sample family. Edith Penhallow, her son
// Robert and this letter are fictional.
//
// Build (from sample/images/facsimiles):
//   typst compile --font-path fonts 1944-edith-penhallow-letter.typ \
//     ../letters/1944-04-09-edith-penhallow-to-robert.pdf

#let paper = rgb("#f6f1e4")
#let ruled = rgb("#b9c6d6")
#let margin-rule = rgb("#d9a3a3")
#let ink = rgb("#1f2f57")
#let warn = rgb("#9b2d20")
#let line-gap = 0.3in

#set document(
  title: "Facsimile letter from Edith Penhallow to her son Robert, 9 April 1944 (fictional)",
  author: "Flyleaf sample family",
)
#set page(
  width: 5.5in, height: 8.5in, fill: paper,
  margin: (left: 0.75in, right: 0.45in, top: 0.62in, bottom: 0.5in),
  background: {
    for i in range(0, 25) {
      place(top + left, dy: 0.9in + i * line-gap,
        line(length: 100%, stroke: 0.5pt + ruled))
    }
    place(top + left, dx: 0.62in, line(angle: 90deg, length: 100%, stroke: 0.6pt + margin-rule))
  },
  footer: align(center, text(font: "IM FELL English", size: 6.5pt, style: "italic", fill: warn)[
    Facsimile made for the Flyleaf sample family. The letter and the people in it are fictional.
  ]),
)
#set text(font: "Cedarville Cursive", size: 12.2pt, fill: ink)
#set par(leading: line-gap - 12.2pt * 0.72, spacing: line-gap - 12.2pt * 0.72, justify: false)

#align(right)[Dodgeville, Wis. \ Easter Sunday, April 9, 1944]

Dear Robert,

#h(2em)Your letter of the 20th came Friday and we were so glad to have it. Dad read it twice at the supper table. You cannot say where you are, but you say you are near the sea in the old country and that the people talk the way Grandpa John used to. I wonder if you are anywhere near St. Just. Wouldn't he have smiled at that!

#h(2em)We are all well here. The roads are muddy and Dad has started the plowing on the low field. Lilian came home from Madison for Easter and went to church with us this morning. Joan Treloar stopped by on Thursday with a pasty for Dad and asked after you, as she always does. She is a good girl, Robert.

#h(2em)We have the sugar stamps saved for a cake when you come home. Write when you can and keep warm.

#align(right)[With love from us all, \ Mother]

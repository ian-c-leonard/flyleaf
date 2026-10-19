// template.typ: the book shell Flyleaf uses for every family.
// Hand-crafted Typst template: page geometry, typography, running heads,
// Register-style components. Content is produced by scripts/book-assemble.py
// (build/book.typ), which imports everything below. See docs/book.md for the
// editorial rules these components implement.

#let ink = rgb("#1E2124")
#let ember = rgb("#A8481A")
#let pine = rgb("#315049")
#let iron = rgb("#5E625F")
#let rule-c = rgb("#B9B4A5")

// The family's typefaces (book.fonts in flyleaf.json) and page size
// (trim_width and trim_height in book.yaml), written by the build.
#import "fonts.typ": serif, sans
#import "page.typ": page-width, page-height, margins, chart-width, tall-figure-height

// ---------- document shell ----------

// Mark parity gaps so their empty leaves can omit running heads and folios.
// A gap may contain continued footnotes; those pages are substantive.
#let recto-break() = {
  [#metadata(none) <recto-gap-start>]
  pagebreak(weak: true, to: "odd")
  [#metadata(none) <recto-gap-end>]
}

#let recto-filler(pg) = {
  let gaps = query(<recto-gap-start>).zip(query(<recto-gap-end>))
  let between = gaps.any(pair =>
    pair.at(0).location().page() < pg and pg < pair.at(1).location().page())
  // The title page's local page settings end before the outline's recto break.
  let titles = query(<title-end>)
  let chapters = query(heading.where(level: 1))
  let title-verso = (titles.len() > 0 and chapters.len() > 0 and
    titles.last().location().page() < pg and pg < chapters.first().location().page())
  let has-note = query(<fn-check>).any(m =>
    m.value.entry_start <= pg and pg <= m.location().page())
  (between or title-verso) and not has-note
}

#let book(title: "", subtitle: "", author: "", body) = {
  // The edition is dated by day; precise build times remain in its receipt.
  set document(title: title, author: author, date: datetime.today())
  set page(
    width: page-width,
    height: page-height,
    binding: left,
    margin: margins,
    numbering: "i",   // front matter runs roman; Part I restarts arabic (assembler emits the switch)
    number-align: center,
    header: context {
      let pg = here().page()
      // book convention: no running head on a chapter-opener page
      let opens-here = query(heading.where(level: 1)).any(h => h.location().page() == pg)
      let part-here = query(<part-title>).any(m => m.location().page() == pg)
      if counter(page).get().first() > 1 and not opens-here and not part-here and not recto-filler(pg) {
        let chapters = query(selector(heading.where(level: 1)).before(here()))
        set text(font: sans, size: 7.5pt, tracking: 0.12em, fill: iron)
        if calc.even(counter(page).get().first()) {
          upper(title)
          h(1fr)
        } else if chapters.len() > 0 {
          h(1fr)
          upper(chapters.last().body)
        }
      }
    },
    footer: context {
      if here().page-numbering() != none and not recto-filler(here().page()) {
        align(center, counter(page).display())
      }
    },
  )
  set text(font: serif, size: 10.5pt, fill: ink)
  // character-level justification (Typst 0.14+) — nearest equivalent of
  // LaTeX microtype for a justified book column
  set par(justify: true, leading: 0.68em, first-line-indent: 1.15em, spacing: 0.68em,
    justification-limits: (tracking: (min: -0.015em, max: 0.02em)))
  set heading(numbering: none)

  // chapter openers — books start chapters on a recto (odd) page
  show heading.where(level: 1): it => {
    recto-break()
    v(0.9in)
    set par(first-line-indent: 0em)
    set text(font: serif, size: 19pt, weight: 600, hyphenate: false)
    block(below: 2.2em, {
      line(length: 1.1in, stroke: 1.2pt + ember)
      v(0.6em)
      it.body
    })
  }
  // narrative section headings
  show heading.where(level: 2): it => {
    set par(first-line-indent: 0em)
    block(above: 2em, below: 0.9em, sticky: true, {
      set text(font: serif, size: 13pt, weight: 600)
      it.body
    })
  }
  // register entry headings — Register style: number + SMALL CAPS
  show heading.where(level: 3): it => {
    set par(first-line-indent: 0em)
    block(above: 1.6em, below: 0.6em, sticky: true, {
      set text(font: serif, size: 11pt, weight: 700, tracking: 0.02em)
      it.body
    })
  }

  set footnote.entry(separator: line(length: 28%, stroke: 0.5pt + rule-c), indent: 0.6em)
  show footnote.entry: set text(size: 8.2pt)
  // Footnote-dense-book hardening (maintainer guidance, forum.typst.app/t/5953):
  // let entries break across pages and disable widow/orphan cost inside them.
  // Tried: breakable: false (a split footnote is confusing)
  // re-exposed the footnote-before-anchor bug (typst#5314) at a NEW page on
  // every reflow, so it was reverted. Short footnotes are the real fix:
  // source labels carry no process notes, paths or URLs (the validator's
  // PROCESS-IN-LABEL rule), which keeps splits rare.
  show footnote.entry: set text(costs: (widow: 0%, orphan: 0%))
  show footnote.entry: block.with(breakable: true)
  // Queryable breadcrumb for the post-compile anchor check
  // (scripts/check-footnotes.py): use the entry's own location for its START.
  // here() after `it` measured the END of a split note and missed early starts.
  show footnote.entry: it => {
    it
    context [#metadata((
      anchor: it.note.location().page(),
      entry_start: it.location().page(),
      number: counter(footnote).at(it.note.location()).first(),
    )) <fn-check>]
  }
  show figure.where(kind: "family-chart"): it => {
    it
    context [#metadata((
      id: str(it.label),
      number: counter(figure.where(kind: "family-chart")).at(it.location()).first(),
      page: it.location().page(),
    )) <chart-check>]
  }
  show link: set text(fill: ink)  // print-quiet links

  body
}

// ---------- front pages ----------

#let relation-line(body) = {
  v(-0.4em)
  block(text(font: serif, size: 9.5pt, style: "italic", fill: pine, body))
  v(0.35em)
}

#let title-page(strapline: "A Family History", title: "", subtitle: "", author: "", stamp: "") = {
  set page(header: none, numbering: none)
  set par(first-line-indent: 0em)
  v(1.1in)
  align(center, {
    text(font: sans, size: 9pt, tracking: 0.28em, fill: ember, upper(strapline))
    v(0.5in)
    {
      set text(hyphenate: false)
      set par(justify: false)
      text(font: serif, size: 28pt, weight: 600, title)
    }
    v(0.25in)
    text(font: serif, size: 13pt, style: "italic", fill: pine, subtitle)
    v(1fr)
    text(font: sans, size: 9pt, tracking: 0.08em, fill: iron, author)
    v(0.2in)
    text(font: sans, size: 8.5pt, tracking: 0.08em, fill: iron, stamp)
    [#metadata(none) <title-end>]
  })
  pagebreak()
}

#let part-page(label-text, part-title, restart: false) = {
  recto-break()
  if restart { counter(page).update(1) }
  [#metadata(none) <part-title>]
  set par(first-line-indent: 0em)
  v(2.6in)
  align(center, {
    text(font: sans, size: 10pt, tracking: 0.3em, fill: ember, upper(label-text))
    v(0.4in)
    text(font: serif, size: 22pt, weight: 600, part-title)
  })
}

// ---------- register components ----------

// The descent superscript chain, e.g. (Thomas³², Edwin¹⁶, Arthur⁸)
#let descent(pairs) = {
  text(style: "italic", size: 9.5pt, fill: iron, {
    "("
    pairs.enumerate().map(((i, p)) => {
      p.at(0) + super(text(size: 6.5pt, p.at(1)))
    }).join(", ")
    ")"
  })
}

// General references are grouped by person in Sources for the Register.
// Event evidence retains page-bottom footnotes; every source key is queryable.
#let register-sources(items) = {
  set text(size: 9pt)
  set par(first-line-indent: 0em, justify: false, leading: 0.45em)
  for (i, item) in items.enumerate() {
    // Block spacing overrides paragraph spacing. Give the first reference
    // room below the register-page pointer; retain compact gaps thereafter.
    block(above: if i == 0 { 1em } else { 0em }, below: 0.6em, breakable: true,
      inset: (left: 0.8em), {
        for key in item.keys {
          [#metadata((refn: item.refn, key: key)) <register-source>]
        }
        item.body
      })
  }
}

// children list — Register style (Guide, Manual): children's intro + list in
// smaller type; lower-case roman numerals in birth order; a carried-forward
// child also bears their (ahnentafel) number in bold before the roman numeral.
#let children(intro, items) = {
  set par(first-line-indent: 0em)
  set text(size: 9pt)
  let entries = {
    block(sticky: true, text(intro))
    v(0.35em)
    for it in items {
      block(below: 0.3em, inset: (left: 1.4em), breakable: false, it)
    }
  }
  // Keep short families together. For longer lists, let each child's block
  // participate directly in page layout: a breakable outer block can put
  // its nested child's footnotes before that child (Typst #5314).
  if items.len() <= 3 {
    block(above: 0.8em, sticky: false, breakable: false, entries)
  } else {
    v(0.8em)
    entries
  }
}

#let child-fwd(num, rn, body) = {
  text(weight: 700, num) + h(0.6em) + (if rn != "" { rn + ". " } else { "" }) + body
}
#let child-plain(rn, body) = {
  h(1.3em) + (if rn != "" { rn + ". " } else { "" }) + body
}

// stale-draft margin note for Part I sections
#let draft-note(msg) = {
  set par(first-line-indent: 0em)
  block(inset: (left: 1em), stroke: (left: 1.5pt + ember),
    text(style: "italic", size: 9pt, fill: iron, msg))
}

// figures
// Print charts have fixed physical dimensions: never fit them to the tall-plate
// cap, which would reduce their measured 9pt lettering. They count separately
// from source images and retain linkable captions across panels.
#let book-chart(path, caption-text) = {
  figure(
    [#image(path, width: chart-width) <chart-image>],
    kind: "family-chart",
    supplement: [Chart],
    caption: text(size: 8.6pt, fill: iron, caption-text),
  )
}

// Figure components are deliberately STATIC — no context/measure/layout()
// sizing, no placement: auto floats. Every dynamic construct tried
// (remaining-space caps, measure-based choices, floats) fed back
// into layout and re-exposed the footnote-anchor bug (typst#5314) at a new
// page on each reflow. The tall/wide decision is made in PYTHON at assembly
// time (book-assemble _is_tall) and emitted as two distinct calls.
// The tall-figure cap (5.5in on a 9in page) always leaves ~1.9in for the
// caption and some text.

#let book-fig(path, caption-text) = {
  figure(
    image(path, width: 100%),
    caption: text(size: 8.6pt, fill: iron, caption-text),
  )
}

#let book-fig-tall(path, caption-text) = {
  figure(
    image(path, width: 100%, height: tall-figure-height, fit: "contain"),
    caption: text(size: 8.6pt, fill: iron, caption-text),
  )
}



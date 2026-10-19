// Native reading presentation of the checked assembled book.
// Authored text, register helpers and figures remain in the print pipeline.
// scripts/website_native_book.py validates and packages this compiler output.
#import "template.typ": *

// Preserve the ordinary relation-line output while identifying its generated
// display role for opening extraction. The packager removes this marker.
#let relation-line(body) = {
  v(-0.4em)
  show block: it => html.elem("div", attrs: ("data-book-display": "relationship"), it.body)
  block(text(font: serif, size: 9.5pt, style: "italic", fill: pine, body))
  v(0.35em)
}

#let book(title: "", subtitle: "", author: "", body) = {
  set document(title: title, author: author)
  // HTML's generated endnote number can make an opening quote look like an
  // inch mark. Emit the actual quote character, keeping its meaning explicit.
  show smartquote: it => text(if it.double { "\"" } else { "'" })
  show pagebreak: none
  show v: it => html.elem("span", " ")
  show h: it => html.elem("span", " ")
  show line: none
  show align: it => it.body
  show block: it => html.elem("div", it.body)
  show columns: it => it.body
  show grid: it => html.elem("div", it.children.join())
  // Each cell is its own block, so the words of two cells never run together.
  show grid.cell: it => html.elem("div", it.body)
  show metadata: it => {
    let tag = if it.has("label") { it.label } else { none }
    if tag == <bibliography-use> {
      assert.eq(it.value.keys().sorted(), ("key", "person"))
      html.elem("span", attrs: ("data-book-person": it.value.person,
        "data-book-key": it.value.key), [])
    } else if tag == <register-source> {
      assert.eq(it.value.keys().sorted(), ("key", "refn"))
      html.elem("span", attrs: ("data-register-person": it.value.refn,
        "data-register-key": it.value.key), [])
    } else if tag == <bibliography-entry> {
      html.elem("span", attrs: ("data-bibliography-entry": it.value), [])
    } else if it.value == none {
      html.elem("span", [])
    } else {
      panic("Unsupported book metadata in HTML export")
    }
  }
  // Keep the original destination; the exporter uses its actual heading or
  // caption as link text instead of a physical page number.
  show ref.where(form: "page"): it => html.elem("span",
    attrs: ("data-book-page-ref": str(it.target)), link(it.target)[View section])
  body
}

#let title-page(strapline: "A Family History", title: "", subtitle: "", author: "", stamp: "") = [
  #html.elem("p", upper(strapline))
  #html.elem("h1", title)
  #html.elem("p", subtitle)
  #html.elem("p", author)
  #html.elem("p", stamp)
]

#let part-page(label-text, part-title, restart: false) = [
  #html.elem("h2", [#label-text — #part-title])
]

// Physical parity markers have no content or spacing in continuous reading.
#let recto-break() = none

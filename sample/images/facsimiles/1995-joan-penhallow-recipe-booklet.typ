// Facsimile made for the Flyleaf sample family. Joan Penhallow and the cooks
// she credits are fictional; the recipes are traditional dishes written up
// for the sample. Four pages with a text layer.
//
// Build (from sample/images/facsimiles):
//   typst compile --font-path fonts 1995-joan-penhallow-recipe-booklet.typ \
//     ../recipes/1995-joan-penhallow-recipe-booklet.pdf

#let paper = rgb("#faf7ee")
#let ink = rgb("#24221f")
#let warn = rgb("#9b2d20")

#set document(
  title: "Joan's Kitchen: Penhallow family recipes, typed Christmas 1995 (fictional facsimile)",
  author: "Flyleaf sample family",
  keywords: ("recipes", "Cornish pasty", "saffron buns", "heavy cake", "lefse", "kuchen"),
)
#set page(
  width: 5.5in, height: 8.5in, fill: paper,
  margin: (x: 0.6in, top: 0.6in, bottom: 0.75in),
  footer: context {
    set text(font: "IM FELL English", size: 6.5pt, style: "italic", fill: warn)
    align(center)[
      #text(font: "Special Elite", size: 9pt, style: "normal", fill: ink)[– #counter(page).display() –]
      \ Facsimile made for the Flyleaf sample family. The booklet and its cooks are fictional; the recipes are traditional.
    ]
  },
)
#set text(font: "Special Elite", size: 10.4pt, fill: ink)
#set par(leading: 0.78em, spacing: 1.1em, justify: false)

#let title(body) = block(below: 0.9em, text(size: 12.5pt, upper(body)))
#let note(body) = block(above: 0.8em, inset: (left: 1.2em), text(size: 9pt)[#body])
#let items(..rows) = block(inset: (left: 1.2em), below: 0.8em, stack(spacing: 0.72em, ..rows.pos()))

// Page 1: cover and contents
#v(0.7in)
#align(center)[
  #text(size: 20pt)[JOAN'S KITCHEN]
  #v(0.25em)
  #text(size: 11pt)[Penhallow Family Recipes]
  #v(1.2em)
  typed by Joan Penhallow \
  Madison, Christmas 1995
  #v(1.4em)
  For David and Karin, for Carol, \
  and for the grandchildren to come.
]
#v(0.6in)
#text(size: 11pt)[CONTENTS]
#v(0.3em)
#let entry(name, page) = grid(columns: (1fr, auto), name + box(width: 1fr, repeat[.]), [ #page])
#stack(spacing: 0.7em,
  entry[Cornish Pasties (Edith's way)][2],
  entry[Saffron Buns][3],
  entry[Heavy Cake][3],
  entry[Ruth Solberg's Lefse][4],
  entry[Anna Kessler's Apple Kuchen][4],
)

#pagebreak()

// Page 2
#title[Cornish Pasties (Edith's way)]
As Mother Penhallow made them on the farm at Dodgeville. Makes 6.

PASTRY
#items[3 cups flour, 1 teaspoon salt][1 cup lard (or half lard, half butter)][about 1/2 cup ice water]

FILLING
#items[1 lb beef skirt or round steak, cut small -- never ground][3 medium potatoes, sliced thin][1 small onion, chopped][1 cup rutabaga, sliced thin (the old people called it turnip)][salt and plenty of pepper][butter]

Rub the lard into the flour and salt until it looks like meal. Add the water a little at a time and press into a ball. Chill one hour. Divide into 6 and roll each piece to a round the size of a dinner plate.

On one half of each round lay potato, rutabaga, onion and beef, seasoning each layer. Put a dot of butter on top. Fold over, crimp the edge tight, and cut a small slit in the top.

Bake at 400 F for 15 minutes, then at 350 F for about 40 minutes more, until golden.

#note[Edith always said never grind the meat and never put in carrots. Bob liked ketchup on his, which she pretended not to see. -- J.]

#pagebreak()

// Page 3
#title[Saffron Buns]
#items[1/2 teaspoon saffron threads, soaked overnight in 1/4 cup hot water][1 package dry yeast in 1 cup warm milk][4 cups flour, 1/2 cup sugar, 1 teaspoon salt][1/2 cup butter and lard together][1 cup currants, 1/4 cup candied peel]

Rub the fat into the flour, sugar and salt. Add the yeast milk and the saffron with its water, and knead to a soft yellow dough. Work in the fruit. Let rise until double, about 2 hours. Shape into 18 buns, rise again, and bake at 375 F about 20 minutes.

#v(0.8em)
#title[Heavy Cake]
#items[2 cups flour, 1/2 teaspoon salt, 1/4 cup sugar][1/2 cup butter][1 cup currants][milk to mix]

Rub the butter into the dry things, add the currants and enough milk for a stiff dough. Pat out 1/2 inch thick on a greased sheet. Score the top in a criss-cross, like a fishing net, and sprinkle with sugar. Bake at 375 F for 25 to 30 minutes. Cut in squares while warm.

#note[Mother made this every Saturday in Mineral Point. She said the fishermen's wives at home baked it when the boats came in. -- J.]

#pagebreak()

// Page 4
#title[Ruth Solberg's Lefse]
#items[4 cups riced potatoes, cold][1/2 cup butter, 1/4 cup cream][1 tablespoon sugar, 1 teaspoon salt][about 1 1/2 cups flour]

Mix the warm potatoes with the butter, cream, sugar and salt and chill overnight. Work in the flour. Roll small balls paper thin on a floured cloth. Bake on a hot dry griddle, turning once, until brown spots appear. Stack under a towel.

#note[Ruth showed me how at Thanksgiving. Mine are not as round as hers. -- J.]

#v(0.6em)
#title[Anna Kessler's Apple Kuchen]
#items[1 1/2 cups flour, 1/4 cup sugar][1 1/2 teaspoons baking powder, 1/2 teaspoon salt][1/4 cup butter, 1 egg, 1/2 cup milk][4 tart apples, sliced][cinnamon sugar; 1 egg beaten with 1/2 cup cream]

Rub the butter into the dry things, then stir in the egg and milk. Press into a buttered pan. Cover with rows of apple and sprinkle well with cinnamon sugar. Bake at 375 F for 20 minutes, pour the egg and cream over, and bake 15 to 20 minutes more.

#note[From Ruth, who had it from her mother. -- J.]

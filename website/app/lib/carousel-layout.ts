/** Sizes for Home's carousels. A shape is a picture's width over its height,
 * so a frame can fit the picture it holds, and a carousel can keep one
 * height while its pictures change. */

/** A picture of this shape at its largest inside the box. A picture whose
 * shape is not known yet fills the box. */
export function fitPhoto(
  shape: number | undefined,
  width: number,
  height: number,
) {
  width = Math.max(0, width);
  height = Math.max(0, height);
  if (!shape || !Number.isFinite(shape) || shape <= 0) return { width, height };
  const fitted = Math.min(width, height * shape);
  return {
    width: Math.round(fitted),
    height: Math.min(height, Math.round(fitted / shape)),
  };
}

/** The height the tallest picture of a set needs at this width. A picture
 * whose shape is not known may need all of it. */
export function tallestPhoto(
  shapes: readonly (number | undefined)[],
  width: number,
  height: number,
) {
  return shapes.reduce<number>(
    (tallest, shape) =>
      Math.max(tallest, fitPhoto(shape, width, height).height),
    0,
  );
}

/** Where each item sits in a carousel that shows `visible` items from
 * `index`: slots 0 to visible - 1 are on show. Slot -1 holds the item that
 * has just gone and slot `visible` the one that comes next, out of sight,
 * so either can slide in or out. Items keep their order in the list. */
export function carouselSlots(count: number, index: number, visible: number) {
  if (count <= visible)
    return Array.from({ length: count }, (_, item) => ({ item, slot: item }));
  const slots: { item: number; slot: number }[] = [];
  for (let item = 0; item < count; item++) {
    const offset = (((item - index) % count) + count) % count;
    if (offset <= visible) slots.push({ item, slot: offset });
    else if (offset === count - 1) slots.push({ item, slot: -1 });
  }
  return slots;
}

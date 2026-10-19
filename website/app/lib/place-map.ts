export type MapPoint<T> = { x: number; y: number; item: T };
export type MapGroup<T> = { x: number; y: number; items: T[] };

/** Group overlapping screen markers, without changing geographic identities. */
export function groupMapPoints<T>(
  points: MapPoint<T>[],
  distance = 52,
): MapGroup<T>[] {
  const parents = points.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) index = parents[index];
    return index;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (
        Math.abs(points[i].x - points[j].x) < distance &&
        Math.abs(points[i].y - points[j].y) < distance
      )
        parents[root(j)] = root(i);
    }
  }
  const groups = new Map<number, MapPoint<T>[]>();
  for (let index = 0; index < points.length; index++) {
    const key = root(index);
    const members = groups.get(key) || [];
    members.push(points[index]);
    groups.set(key, members);
  }
  const result = [...groups.values()].map((members) => ({
    x: members.reduce((sum, point) => sum + point.x, 0) / members.length,
    y: members.reduce((sum, point) => sum + point.y, 0) / members.length,
    items: members.map((point) => point.item),
  }));
  // Moving each connected group to its center can bring two new markers close
  // together. Merge those too, so the displayed targets remain separated.
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i],
        b = result[j];
      if (Math.abs(a.x - b.x) >= distance || Math.abs(a.y - b.y) >= distance)
        continue;
      const count = a.items.length + b.items.length;
      result[i] = {
        x: (a.x * a.items.length + b.x * b.items.length) / count,
        y: (a.y * a.items.length + b.y * b.items.length) / count,
        items: [...a.items, ...b.items],
      };
      result.splice(j, 1);
      i = -1;
      break;
    }
  }
  return result;
}

// Where dragged pages land, apart from the column that shows them.

/** Where a dragged page lands: its index among the pages once it has been taken out. */
export function dropIndex(order: string[], moving: string[], before: number): number {
  const set = new Set(moving);
  let at = 0;
  for (let i = 0; i < Math.min(before, order.length); i++) if (!set.has(order[i])) at++;
  return at;
}

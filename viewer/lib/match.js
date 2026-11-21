// Finds the part in another build that matches a part, so the two builds can
// be compared part by part. The builds name parts differently
// ("L batten 6 fabric pocket" vs "Batten pocket L 6"), so the match uses, in
// order: the same name, the same manufacturer part number, then shared words.
const SIDE = { l: 'L', left: 'L', r: 'R', right: 'R' };
const STOP = new Set(['the', 'of', 'and', 'a', 'to', 'in', 'on', 'with']);

function words(name) {
  const out = { side: null, tokens: new Set() };
  for (const raw of name.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim().split(' ')) {
    if (!raw || STOP.has(raw)) continue;
    if (SIDE[raw]) { out.side = SIDE[raw]; continue; }
    if (/^-?\d*\.\d+$/.test(raw)) continue;           // offsets like "0.012" in Astra names
    out.tokens.add(raw.replace(/s$/, ''));
  }
  return out;
}

function score(a, b) {
  if (a.name.toLowerCase() === b.name.toLowerCase()) return 1;
  const wa = a.words || (a.words = words(a.name));
  const wb = b.words || (b.words = words(b.name));
  if (wa.side && wb.side && wa.side !== wb.side) return 0;
  if (a.info.part_no && a.info.part_no === b.info.part_no) return 0.9 + (wa.side === wb.side ? 0.05 : 0);
  let shared = 0;
  for (const t of wa.tokens) if (wb.tokens.has(t)) shared++;
  if (!shared) return 0;
  const jaccard = shared / (wa.tokens.size + wb.tokens.size - shared);
  return jaccard * 0.85 + (wa.side === wb.side ? 0.05 : 0) + (a.group === b.group ? 0.05 : 0);
}

const memo = new WeakMap();

/** Candidates in `record` for `part`, best first: [{ part, score }]. */
export function candidates(part, record, limit = 12) {
  let byPart = memo.get(record);
  if (!byPart) memo.set(record, (byPart = new Map()));
  if (!byPart.has(part)) {
    const list = [];
    for (const other of record.parts.values()) {
      const s = score(part, other);
      if (s > 0.2) list.push({ part: other, score: s });
    }
    list.sort((x, y) => y.score - x.score);
    byPart.set(part, list);
  }
  return byPart.get(part).slice(0, limit);
}

/** The best match, or null when nothing is close enough. */
export function bestMatch(part, record) {
  const [first] = candidates(part, record, 1);
  return first && first.score >= 0.34 ? first.part : null;
}

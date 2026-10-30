// Joining two devices' changes: when this device and another both changed the data since the copy they last shared
// (the base), each change is kept rather than one device's data replacing the other's. Worked out per collection, then
// per item (by id) and per setting:
//   - what only one side changed takes that side's version (an item added, edited or deleted on one device);
//   - what both changed, differently, keeps this device's version (the one in front of the person now).
// A collection that is not a list of items with ids (a week of the Planner, the journal's texts by id, a row of
// numbers) is joined by its keys, one level down, by the same rule; anything else whole.

type Json = any;

const isObj = (v: Json) => v != null && typeof v === 'object' && !Array.isArray(v);
const keyed = (v: Json) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && (typeof x.id === 'string' || typeof x.id === 'number'));

/** Deep equality for JSON values (key order ignored). */
export function same(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !same(a[k], b[k])) return false;
    return true;
  }
  return false;
}

const MISSING = Symbol('missing');
type Val = Json | typeof MISSING;

/** One value, three ways: the side that changed it wins; both changed, this device's. */
function pick(base: Val, mine: Val, theirs: Val): Val {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  return mine;
}

/** A list of items with ids: joined item by item, in this device's order, with the other's new items after. */
function mergeList(base: Json[], mine: Json[], theirs: Json[]): Json[] {
  const b = new Map(base.map((x) => [String(x.id), x]));
  const m = new Map(mine.map((x) => [String(x.id), x]));
  const t = new Map(theirs.map((x) => [String(x.id), x]));
  const out: Json[] = [];
  const seen = new Set<string>();
  const one = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const v = pick(b.has(id) ? b.get(id) : MISSING, m.has(id) ? m.get(id) : MISSING, t.has(id) ? t.get(id) : MISSING);
    if (v !== MISSING) out.push(v);
  };
  // this device's order first, then items new on the other device in its order (each placed after its neighbour there)
  for (const x of mine) one(String(x.id));
  theirs.forEach((x, i) => {
    const id = String(x.id);
    if (seen.has(id)) return;
    const before = out.length;
    one(id);
    if (out.length === before) return;
    // put it after the item that comes before it on the other device, when that one is here
    const prev = i > 0 ? String(theirs[i - 1].id) : null;
    const at = prev == null ? 0 : out.findIndex((y) => String(y.id) === prev) + 1;
    if (at > 0 || prev == null) {
      const [item] = out.splice(out.length - 1, 1);
      out.splice(at, 0, item);
    }
  });
  return out;
}

/** An object joined by its keys, one level down. */
function mergeKeys(base: Json, mine: Json, theirs: Json, deep: boolean): Json {
  const out: Json = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    const bv: Val = isObj(base) && k in base ? base[k] : MISSING;
    const mv: Val = k in mine ? mine[k] : MISSING;
    const tv: Val = k in theirs ? theirs[k] : MISSING;
    let v: Val;
    if (deep && mv !== MISSING && tv !== MISSING && !same(mv, tv)) v = mergeValue(bv === MISSING ? undefined : bv, mv, tv, false);
    else v = pick(bv, mv, tv);
    if (v !== MISSING) out[k] = v;
  }
  return out;
}

function mergeValue(base: Json, mine: Json, theirs: Json, deep: boolean): Json {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  if (Array.isArray(mine) && Array.isArray(theirs) && (keyed(mine) || keyed(theirs)) && (mine.length === 0 || keyed(mine)) && (theirs.length === 0 || keyed(theirs))) {
    return mergeList(Array.isArray(base) && (base.length === 0 || keyed(base)) ? base : [], mine, theirs);
  }
  if (isObj(mine) && isObj(theirs)) return mergeKeys(isObj(base) ? base : {}, mine, theirs, deep);
  return mine;
}

/**
 * The data with both devices' changes: `base` is the copy both last had, `mine` this device's now, `theirs` the
 * cloud's now (snapshots as the cloud keeps them). Keys that start with "_" (the export's own marks) come from theirs.
 */
export function mergeSnapshots(base: Json, mine: Json, theirs: Json): Json {
  const out: Json = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    if (k.startsWith('_')) { if (k in theirs) out[k] = theirs[k]; continue; }
    const bv = isObj(base) ? base[k] : undefined;
    if (!(k in mine)) { out[k] = theirs[k]; continue; }
    if (!(k in theirs)) { out[k] = mine[k]; continue; }
    out[k] = mergeValue(bv, mine[k], theirs[k], true);
  }
  return out;
}

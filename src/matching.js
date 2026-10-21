// JS mirror of FN_COMPUTE_MATCH_SCORE. The database function in
// sql/02_programmability.sql is the authoritative scorer; this copy exists so
// the app can show "possible matches for your report" right after a student
// submits, without writing MATCHES rows (that is SP_REFRESH_MATCHES' job).
const { q } = require('./db');

const W = {
  category: 20,
  name: 20,
  color: 15,
  location: 20,
  date: 10,
};

function norm(s) {
  return (s || '').trim().toLowerCase();
}

/**
 * Score one lost vs found report pair. Returns 0..100, adjustable later.
 */
async function scorePair(lostId, foundId) {
  // Two simple queries keeps it readable.
  const lost = (
    await q(
      `SELECT li.category, li.item_name, li.color, li.brand,
              l.location_id, l.lost_date
       FROM lost_reports l JOIN items li ON li.item_id = l.item_id
       WHERE l.lost_id = ?`,
      [lostId]
    )
  )[0];
  const found = (
    await q(
      `SELECT fi.category, fi.item_name, fi.color, fi.brand,
              f.location_id, f.found_date
       FROM found_reports f JOIN items fi ON fi.item_id = f.item_id
       WHERE f.found_id = ?`,
      [foundId]
    )
  )[0];
  if (!lost || !found) return 0;

  let score = 0;
  if (norm(lost.category) !== norm(found.category)) return 0;
  score += W.category;

  // item name similarity (mirrors SQL rules)
  const ln = norm(lost.item_name);
  const fn2 = norm(found.item_name);
  if (ln === fn2) score += W.name;
  else if (ln.includes(fn2) || fn2.includes(ln)) score += W.name - 5;
  else {
    const fw = fn2.split(/\s+/).filter(Boolean);
    const hits = fw.filter((w) => ln.includes(w)).length;
    score += Math.min(2 * hits, 2) * 10;
  }

  if (lost.color && found.color && norm(lost.color) === norm(found.color)) score += W.color;
  if (lost.brand && found.brand && norm(lost.brand) === norm(found.brand)) score += 15;
  if (lost.location_id === found.location_id) score += W.location;

  const dayDiff = Math.abs(
    Math.round(
      (new Date(lost.lost_date) - new Date(found.found_date)) / 86400000
    )
  );
  if (dayDiff <= 1) score += W.date;
  else if (dayDiff === 2) score += 7;
  else if (dayDiff === 3) score += 5;
  else if (dayDiff <= 7) score += 3;

  return Math.min(score, 100);
}

/** Preview: top matches for one lost report (no rows written). */
async function previewForLost(lostId, threshold) {
  // same 30-day proximity window as SP_REFRESH_MATCHES
  const lostDate = (
    await q('SELECT lost_date FROM lost_reports WHERE lost_id = ?', [lostId])
  )[0].lost_date;
  const founds = await q(
    `SELECT f.found_id FROM found_reports f
     WHERE f.status = 'UNCLAIMED'
       AND ABS(DATEDIFF(f.found_date, ?)) <= 30`,
    [lostDate]
  );
  return await collect([lostId], founds.map((r) => r.found_id), threshold);
}

/** Preview: top matches for one found report (no rows written). */
async function previewForFound(foundId, threshold) {
  const losts = await q(
    `SELECT l.lost_id FROM lost_reports l WHERE l.status = 'OPEN'`
  );
  return await collect(losts.map((r) => r.lost_id), [foundId], threshold);
}

async function collect(lostIds, foundIds, threshold) {
  const out = [];
  const cap = 500;
  let n = 0;
  for (const l of lostIds) {
    for (const f of foundIds) {
      if (n++ >= cap) break;
      const s = await scorePair(l, f);
      if (s >= threshold) out.push({ lost_id: l, found_id: f, score: s });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

module.exports = { scorePair, previewForLost, previewForFound };

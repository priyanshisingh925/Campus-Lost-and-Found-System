-- ============================================================
-- Campus Lost & Found — Demonstration Queries
-- Run AFTER 01_schema.sql and 04_seed.sql.
-- Each numbered query maps to a requirement in the project spec.
-- ============================================================

USE campus_lost_found;

-- 1. Show all lost items (join: users, items, locations)
SELECT lr.lost_id, u.name AS reported_by, i.item_name, i.category,
       loc.location_name, lr.lost_date, lr.lost_time, lr.status
FROM lost_reports lr
JOIN users     u   ON u.user_id   = lr.user_id
JOIN items     i   ON i.item_id   = lr.item_id
JOIN locations loc ON loc.location_id = lr.location_id
ORDER BY lr.lost_date DESC;

-- 2. Show all found items
SELECT fr.found_id, u.name AS found_by, i.item_name, i.category,
       loc.location_name, fr.found_date, fr.source, fr.status
FROM found_reports fr
JOIN users     u   ON u.user_id   = fr.user_id
JOIN items     i   ON i.item_id   = fr.item_id
JOIN locations loc ON loc.location_id = fr.location_id
ORDER BY fr.found_date DESC;

-- 3. Show unclaimed found items
SELECT fr.found_id, i.item_name, loc.location_name, fr.found_date, fr.source
FROM found_reports fr
JOIN items     i   ON i.item_id   = fr.item_id
JOIN locations loc ON loc.location_id = fr.location_id
WHERE fr.status = 'UNCLAIMED'
ORDER BY fr.found_date DESC;

-- 4. Items found at a particular location (parameterised: Library)
SELECT fr.found_id, i.item_name, fr.found_date, fr.source
FROM found_reports fr
JOIN items     i   ON i.item_id   = fr.item_id
JOIN locations loc ON loc.location_id = fr.location_id
WHERE loc.location_name = 'Library';

-- 5. Recent lost reports (last 7 days)
SELECT lr.lost_id, i.item_name, lr.lost_date, lr.status
FROM lost_reports lr
JOIN items i ON i.item_id = lr.item_id
WHERE lr.lost_date >= CURDATE() - INTERVAL 7 DAY
ORDER BY lr.lost_date DESC;

-- 6. Find possible lost/found matches (recomputed live, no stored rows)
SELECT * FROM (
  SELECT l.lost_id, f.found_id,
         FN_COMPUTE_MATCH_SCORE(l.lost_id, f.found_id) AS score
  FROM lost_reports l
  JOIN found_reports f
    ON f.status = 'UNCLAIMED'
   AND ABS(DATEDIFF(l.lost_date, f.found_date)) <= 30
  WHERE l.status = 'OPEN'
) pairs
WHERE pairs.score >= 50
ORDER BY pairs.score DESC;

-- 7. All unresolved (PENDING) matches — uses the view
SELECT match_id, lost_item, found_item, match_score, match_status
FROM possible_matches_view
WHERE match_status = 'PENDING'
ORDER BY match_score DESC;

-- 8. Show all resolved items — uses the view
SELECT match_id, lost_item, found_item, owner_name, finder_name,
       match_score, resolved_at
FROM resolved_items_view
ORDER BY resolved_at DESC;

-- 9. Count lost reports by category
SELECT i.category, COUNT(*) AS lost_count
FROM lost_reports lr JOIN items i ON i.item_id = lr.item_id
GROUP BY i.category
ORDER BY lost_count DESC;

-- 10. Count found reports by location
SELECT loc.location_name, COUNT(*) AS found_count
FROM found_reports fr JOIN locations loc ON loc.location_id = fr.location_id
GROUP BY loc.location_id
ORDER BY found_count DESC;

-- 11. Most common lost-item category (aggregate + subquery)
SELECT category, lost_count
FROM (
  SELECT i.category AS category, COUNT(*) AS lost_count
  FROM lost_reports lr JOIN items i ON i.item_id = lr.item_id
  GROUP BY i.category
) t
WHERE lost_count = (SELECT MAX(c) FROM
  (SELECT COUNT(*) AS c FROM lost_reports lr JOIN items i ON i.item_id = lr.item_id
   GROUP BY i.category) x);

-- 12. All possible matches above a score threshold (e.g. 80)
SELECT lost_item, found_item, match_score
FROM possible_matches_view
WHERE match_score >= 80 AND match_status = 'PENDING'
ORDER BY match_score DESC;

-- 13. Aggregate demo: min / max / avg match score of resolved matches
SELECT COUNT(*)   AS resolved_matches,
       MIN(match_score) AS min_score,
       MAX(match_score) AS max_score,
       AVG(match_score) AS avg_score
FROM matches
WHERE status = 'RESOLVED';

-- 14. LEFT JOIN demo: locations that have never had a found report
SELECT loc.location_name, COUNT(fr.found_id) AS found_reports
FROM locations loc
LEFT JOIN found_reports fr ON fr.location_id = loc.location_id
GROUP BY loc.location_id
HAVING found_reports = 0;

-- 15. Regenerate possible matches (DML via stored procedure)
CALL SP_REFRESH_MATCHES();

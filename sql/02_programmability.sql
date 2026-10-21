-- ============================================================
-- Campus Lost & Found — Programmability (MySQL 8.x)
-- Function: FN_COMPUTE_MATCH_SCORE
-- Procedure: SP_REFRESH_MATCHES
-- Trigger:   TRG_MATCH_AFTER_UPDATE
--
-- Run AFTER 01_schema.sql.
-- ============================================================

USE campus_lost_found;

DELIMITER $$

-- ------------------------------------------------------------
-- FN_COMPUTE_MATCH_SCORE(lost_id, found_id) -> 0..100
--
-- Score breakdown (mirrors the project spec):
--   same category        +20
--   similar item name    +20  (exact -> 20, one contains the other -> 15,
--                              >=2 common significant words -> 10)
--   same color           +15
--   same brand           +15
--   same location        +20  (different location -> 0)
--   nearby dates         +10  (0-1 days -> 10, 2 days -> 7, 3 -> 5, 4-7 -> 3)
--
-- A pair only qualifies as a possible match when category is equal
-- (otherwise the score is forced to 0).
-- ============================================================
DROP FUNCTION IF EXISTS FN_COMPUTE_MATCH_SCORE;
CREATE FUNCTION FN_COMPUTE_MATCH_SCORE(p_lost_id INT, p_found_id INT)
RETURNS DECIMAL(5,2)
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE v_score      DECIMAL(5,2) DEFAULT 0;
  DECLARE v_name       DECIMAL(5,2) DEFAULT 0;
  DECLARE v_date       DECIMAL(5,2) DEFAULT 0;
  DECLARE v_daydiff    INT DEFAULT 999;
  DECLARE v_lost_name  VARCHAR(150);
  DECLARE v_found_name VARCHAR(150);

  SELECT i.item_name INTO v_lost_name
  FROM lost_reports l JOIN items i ON i.item_id = l.item_id
  WHERE l.lost_id = p_lost_id;

  SELECT i.item_name INTO v_found_name
  FROM found_reports f JOIN items i ON i.item_id = f.item_id
  WHERE f.found_id = p_found_id;

  SELECT ABS(DATEDIFF(l.lost_date, f.found_date)) INTO v_daydiff
  FROM lost_reports l, found_reports f
  WHERE l.lost_id = p_lost_id AND f.found_id = p_found_id;

  -- category (hard requirement)
  SELECT CASE WHEN li.category = fi.category THEN 20 ELSE 0 END
    INTO v_score
  FROM lost_reports l
  JOIN items li ON li.item_id = l.item_id
  JOIN found_reports f ON f.found_id = p_found_id
  JOIN items fi ON fi.item_id = f.item_id
  WHERE l.lost_id = p_lost_id;

  IF v_score = 0 THEN
    RETURN 0;   -- different categories can never match
  END IF;

  -- item name similarity
  SET v_lost_name  = LOWER(TRIM(COALESCE(v_lost_name,  '')));
  SET v_found_name = LOWER(TRIM(COALESCE(v_found_name, '')));
  IF v_lost_name = v_found_name THEN
    SET v_name = 20;
  ELSEIF v_lost_name LIKE CONCAT('%', v_found_name, '%')
      OR v_found_name LIKE CONCAT('%', v_lost_name, '%') THEN
    SET v_name = 15;
  ELSE
    SET v_name = 10 * (
      (v_lost_name LIKE CONCAT('%', SUBSTRING_INDEX(v_found_name, ' ', 1), '%'))
      + (v_lost_name LIKE CONCAT('%', SUBSTRING_INDEX(v_found_name, ' ', -1), '%'))
    );
    IF v_name >= 20 THEN SET v_name = 20; END IF;
  END IF;
  SET v_score = v_score + v_name;

  -- color (NULL never scores)
  SET v_score = v_score + (
    SELECT CASE WHEN li.color IS NOT NULL AND fi.color IS NOT NULL
                 AND LOWER(TRIM(li.color)) = LOWER(TRIM(fi.color))
                THEN 15 ELSE 0 END
    FROM lost_reports l
    JOIN items li ON li.item_id = l.item_id
    JOIN found_reports f ON f.found_id = p_found_id
    JOIN items fi ON fi.item_id = f.item_id
    WHERE l.lost_id = p_lost_id
  );

  -- brand (NULL never scores)
  SET v_score = v_score + (
    SELECT CASE WHEN li.brand IS NOT NULL AND fi.brand IS NOT NULL
                 AND LOWER(TRIM(li.brand)) = LOWER(TRIM(fi.brand))
                THEN 15 ELSE 0 END
    FROM lost_reports l
    JOIN items li ON li.item_id = l.item_id
    JOIN found_reports f ON f.found_id = p_found_id
    JOIN items fi ON fi.item_id = f.item_id
    WHERE l.lost_id = p_lost_id
  );

  -- location
  SET v_score = v_score + (
    SELECT CASE WHEN l.location_id = f.location_id THEN 20 ELSE 0 END
    FROM lost_reports l, found_reports f
    WHERE l.lost_id = p_lost_id AND f.found_id = p_found_id
  );

  -- date proximity
  IF v_daydiff <= 1 THEN SET v_date = 10;
  ELSEIF v_daydiff = 2 THEN SET v_date = 7;
  ELSEIF v_daydiff = 3 THEN SET v_date = 5;
  ELSEIF v_daydiff <= 7 THEN SET v_date = 3;
  ELSE SET v_date = 0;
  END IF;
  SET v_score = v_score + v_date;

  RETURN LEAST(v_score, 100);
END$$

-- ------------------------------------------------------------
-- SP_REFRESH_MATCHES() : regenerate PENDING matches above threshold.
-- Safe to call any time; call after every new report.
-- ============================================================
DROP PROCEDURE IF EXISTS SP_REFRESH_MATCHES;
CREATE PROCEDURE SP_REFRESH_MATCHES()
BEGIN
  DECLARE v_threshold DECIMAL(5,2);
  SELECT CAST(env_value AS DECIMAL(5,2)) INTO v_threshold
  FROM app_settings WHERE env_key = 'MATCH_THRESHOLD';

  -- 1) insert new pairs scoring >= threshold
  INSERT INTO matches (lost_id, found_id, match_score, status)
  SELECT t.lost_id, t.found_id, t.score, 'PENDING'
  FROM (
    SELECT l.lost_id, f.found_id,
           FN_COMPUTE_MATCH_SCORE(l.lost_id, f.found_id) AS score
    FROM lost_reports l
    JOIN found_reports f
      ON f.status = 'UNCLAIMED'
     AND ABS(DATEDIFF(l.lost_date, f.found_date)) <= 30
    WHERE l.status = 'OPEN'
      AND NOT EXISTS (
        SELECT 1 FROM matches m
        WHERE m.lost_id = l.lost_id AND m.found_id = f.found_id
      )
  ) t
  WHERE t.score >= v_threshold
  ON DUPLICATE KEY UPDATE match_score = VALUES(match_score);

  -- 2) refresh scores of pairs that are still PENDING
  UPDATE matches m
  JOIN lost_reports  l ON l.lost_id  = m.lost_id
  JOIN found_reports f ON f.found_id = m.found_id
  SET m.match_score = FN_COMPUTE_MATCH_SCORE(m.lost_id, m.found_id)
  WHERE m.status = 'PENDING'
    AND l.status = 'OPEN'
    AND f.status = 'UNCLAIMED';

  -- 3) hide stale pairs (report closed / score fell below threshold)
  UPDATE matches m
  LEFT JOIN lost_reports  l ON l.lost_id  = m.lost_id
  LEFT JOIN found_reports f ON f.found_id = m.found_id
  SET m.status = 'REJECTED'
  WHERE m.status = 'PENDING'
    AND ( l.status IS NULL OR l.status <> 'OPEN'
       OR f.status IS NULL OR f.status <> 'UNCLAIMED'
       OR FN_COMPUTE_MATCH_SCORE(m.lost_id, m.found_id) < v_threshold );
END$$

-- ------------------------------------------------------------
-- TRG_MATCH_AFTER_UPDATE
-- When a match becomes RESOLVED, also resolve both reports.
-- (Rejected matches leave the reports untouched.)
--
-- Note: a trigger may not update the table that fired it
-- (MySQL error 1442), so the stale-PENDING cleanup for those
-- same reports is done by SP_REFRESH_MATCHES(), which the app
-- calls immediately after resolving.
-- ============================================================
DROP TRIGGER IF EXISTS TRG_MATCH_AFTER_UPDATE;
CREATE TRIGGER TRG_MATCH_AFTER_UPDATE
AFTER UPDATE ON matches
FOR EACH ROW
BEGIN
  IF NEW.status = 'RESOLVED' AND OLD.status <> 'RESOLVED' THEN
    UPDATE lost_reports  SET status = 'RESOLVED' WHERE lost_id  = NEW.lost_id;
    UPDATE found_reports SET status = 'RESOLVED' WHERE found_id = NEW.found_id;
  END IF;
END$$

DELIMITER ;

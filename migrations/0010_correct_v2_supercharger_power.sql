-- Correct legacy Supercharger records that incorrectly label V2 hardware as 250 kW.
-- Only V2 configurations are capped; V3/V4 and mixed sites retain their own speeds.
UPDATE superchargers
SET charger_configs = (
  SELECT json_group_array(json(
    CASE
      WHEN upper(trim(COALESCE(json_extract(j.value, '$.version'), ''))) = 'V2'
           AND CAST(COALESCE(json_extract(j.value, '$.speedKw'), 0) AS REAL) > 150
      THEN json_set(j.value, '$.speedKw', 150)
      ELSE j.value
    END
  ))
  FROM json_each(superchargers.charger_configs) AS j
)
WHERE json_valid(charger_configs)
  AND json_type(charger_configs) = 'array'
  AND EXISTS (
    SELECT 1 FROM json_each(superchargers.charger_configs) AS j
    WHERE upper(trim(COALESCE(json_extract(j.value, '$.version'), ''))) = 'V2'
      AND CAST(COALESCE(json_extract(j.value, '$.speedKw'), 0) AS REAL) > 150
  );

-- Keep the site-level maximum consistent when every declared charger version is V2.
UPDATE superchargers
SET max_speed_kw = 150
WHERE max_speed_kw > 150
  AND (
    (
      json_valid(versions) AND json_type(versions) = 'array'
      AND json_array_length(versions) > 0
      AND NOT EXISTS (
        SELECT 1 FROM json_each(superchargers.versions) AS v
        WHERE upper(trim(CAST(v.value AS TEXT))) <> 'V2'
      )
    )
    OR
    (
      json_valid(charger_configs) AND json_type(charger_configs) = 'array'
      AND json_array_length(charger_configs) > 0
      AND NOT EXISTS (
        SELECT 1 FROM json_each(superchargers.charger_configs) AS c
        WHERE upper(trim(COALESCE(json_extract(c.value, '$.version'), ''))) <> 'V2'
      )
    )
    OR
    (
      lower(COALESCE(stall_types, '')) LIKE '%v2%'
      AND lower(COALESCE(stall_types, '')) NOT LIKE '%v3%'
      AND lower(COALESCE(stall_types, '')) NOT LIKE '%v4%'
    )
  );

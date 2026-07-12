\set ON_ERROR_STOP on
\timing on

CREATE TEMP TABLE dm_annotations_bench (
    id bigint PRIMARY KEY,
    project_id integer NOT NULL,
    task_id integer NOT NULL,
    updated_at timestamptz NOT NULL,
    is_active boolean NOT NULL,
    was_cancelled boolean NOT NULL,
    class_name text NOT NULL,
    source text NOT NULL,
    tool_unit_id text NOT NULL,
    annotation_type text NOT NULL,
    track_id text
);

INSERT INTO dm_annotations_bench
SELECT
    value,
    1 + value % 10,
    1 + value % 100000,
    timestamptz '2026-01-01 00:00:00+00' + value * interval '1 second',
    value % 20 <> 0,
    value % 50 = 0,
    'class_' || value % 20,
    (ARRAY['manual', 'prediction_based', 'ai_tracker', 'interpolated'])[1 + value % 4],
    (ARRAY['bbox', 'region', 'cuboid'])[1 + value % 3],
    (ARRAY['bbox', 'polygon', 'box_3d'])[1 + value % 3],
    CASE WHEN value % 3 = 0 THEN 'trk_' || value % 25000 ELSE NULL END
FROM generate_series(1, 1000000) AS value;

ANALYZE dm_annotations_bench;

\echo 'BEFORE: object first page'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, class_name, source, updated_at
FROM dm_annotations_bench
WHERE project_id = 1
  AND is_active = true
  AND was_cancelled = false
ORDER BY updated_at DESC, id
LIMIT 100;

\echo 'BEFORE: object class/source aggregate'
EXPLAIN (ANALYZE, BUFFERS)
SELECT source, count(*)
FROM dm_annotations_bench
WHERE project_id = 1
  AND is_active = true
  AND was_cancelled = false
  AND class_name = 'class_10'
GROUP BY source;

\echo 'BEFORE: scene track first page'
EXPLAIN (ANALYZE, BUFFERS)
SELECT track_id, min(task_id), count(*)
FROM dm_annotations_bench
WHERE project_id = 1
  AND is_active = true
  AND was_cancelled = false
  AND track_id IS NOT NULL
GROUP BY track_id
ORDER BY track_id
LIMIT 100;

CREATE INDEX dm_bench_project_updated_active
    ON dm_annotations_bench (project_id, updated_at, id)
    WHERE is_active = true AND was_cancelled = false;
CREATE INDEX dm_bench_project_class_active
    ON dm_annotations_bench (project_id, class_name, id)
    WHERE is_active = true AND was_cancelled = false;
CREATE INDEX dm_bench_project_source_active
    ON dm_annotations_bench (project_id, source, id)
    WHERE is_active = true AND was_cancelled = false;
CREATE INDEX dm_bench_project_tool_type_active
    ON dm_annotations_bench (project_id, tool_unit_id, annotation_type, id)
    WHERE is_active = true AND was_cancelled = false;
CREATE INDEX dm_bench_project_track_active
    ON dm_annotations_bench (project_id, track_id, task_id)
    WHERE is_active = true AND was_cancelled = false AND track_id IS NOT NULL;

ANALYZE dm_annotations_bench;

\echo 'AFTER: object first page'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, class_name, source, updated_at
FROM dm_annotations_bench
WHERE project_id = 1
  AND is_active = true
  AND was_cancelled = false
ORDER BY updated_at DESC, id
LIMIT 100;

\echo 'AFTER: object class/source aggregate'
EXPLAIN (ANALYZE, BUFFERS)
SELECT source, count(*)
FROM dm_annotations_bench
WHERE project_id = 1
  AND is_active = true
  AND was_cancelled = false
  AND class_name = 'class_10'
GROUP BY source;

\echo 'AFTER: scene track first page'
EXPLAIN (ANALYZE, BUFFERS)
SELECT track_id, min(task_id), count(*)
FROM dm_annotations_bench
WHERE project_id = 1
  AND is_active = true
  AND was_cancelled = false
  AND track_id IS NOT NULL
GROUP BY track_id
ORDER BY track_id
LIMIT 100;

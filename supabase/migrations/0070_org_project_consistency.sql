-- Enforce organization_id matches project_id on dual-column tables.

CREATE OR REPLACE FUNCTION public.project_org_id(p_project_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT organization_id FROM public.projects WHERE id = p_project_id;
$$;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'keyword_corpus',
    'rank_schedules',
    'traffic_panel_observations',
    'execution_tasks',
    'ops_queue'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t
        AND column_name = 'organization_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t
        AND column_name = 'project_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
        t,
        t || '_org_project_consistency'
      );
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (
          organization_id IS NULL
          OR project_id IS NULL
          OR organization_id = public.project_org_id(project_id)
        )',
        t,
        t || '_org_project_consistency'
      );
    END IF;
  END LOOP;
END $$;

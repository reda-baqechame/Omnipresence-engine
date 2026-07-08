-- 0073_reports_bucket_private.sql wrote a policy assuming storage object
-- paths look like {orgId}/{projectId}/{file}, but report-builder.ts has
-- always written (and still writes) paths as reports/{projectId}/{file} —
-- i.e. storage.foldername(name) = ARRAY['reports', projectId], not
-- ARRAY[orgId, projectId]. The policy's org/project match therefore never
-- matched any real object. In practice this was masked because the only
-- reader (the report PDF download route) uses the service-role client,
-- which bypasses RLS entirely — but the policy should still describe the
-- access it actually grants, for any future authenticated-client read path.

DROP POLICY IF EXISTS reports_org_read ON storage.objects;

CREATE POLICY reports_org_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid()
        AND (storage.foldername(name))[2] = p.id::text
    )
  );

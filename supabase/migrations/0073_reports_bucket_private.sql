-- Make reports bucket private; access via signed URLs / service role only.

UPDATE storage.buckets SET public = false WHERE id = 'reports';

DROP POLICY IF EXISTS reports_public_read ON storage.objects;

-- Authenticated users may read report objects for projects in their org (path: orgId/projectId/...).
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
        AND (storage.foldername(name))[1] = p.organization_id::text
        AND (storage.foldername(name))[2] = p.id::text
    )
  );

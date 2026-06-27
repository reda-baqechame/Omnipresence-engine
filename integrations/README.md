# OmniPresence Engine — BI & Export Integrations (Phase 16)

All connectors read the API-key-authenticated endpoint:

```
GET /api/v1/export?projectId=<uuid>&type=<dataset>&format=json|csv
Header: x-api-key: omp_...
```

Datasets: `ranks`, `keywords`, `visibility`, `findings`, `mentions`, `tasks`,
`content_gaps`, `local`, `backlinks`, `coverage`, `snippets`, `ledger`.

## Looker Studio community connector (`looker-studio/`)

A free Looker Studio connector. Deploy with [clasp](https://github.com/google/clasp):

```bash
cd integrations/looker-studio
clasp create --type standalone --title "OmniPresence Connector"
clasp push
```

Then in Apps Script: **Deploy → Test deployments → Community Connector**. In
Looker Studio it asks for Base URL, API key, Project ID, and dataset.

## Scheduled Google Sheets export (`google-sheets/`)

`ScheduledExport.gs` pulls datasets into sheet tabs on a daily trigger. Paste
into **Extensions → Apps Script**, set Script Properties (`BASE_URL`, `API_KEY`,
`PROJECT_ID`), and run `setup()` once.

## Metabase embed (self-hosted, optional)

Metabase (AGPL/Enterprise) can connect directly to the same Supabase Postgres
(read replica recommended). For embedding a Metabase dashboard in an agency
white-label view, enable **Admin → Embedding** and use a signed embed URL:

```
https://<metabase-host>/embed/dashboard/<signed-jwt>#bordered=false&titled=false
```

Sign the JWT server-side with your `METABASE_SECRET_KEY` and render it in an
iframe inside the dashboard. No app code change required; documented here so the
data path (Supabase → Metabase) is explicit and keyless.

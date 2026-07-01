# Traffic panel embed (Layer 2)

Opt-in pixel for honest `panel_observed` traffic intelligence.

## Script tag

```html
<script
  src="https://YOUR_APP/api/traffic-panel/pixel.js?projectId=PROJECT_UUID&domain=example.com"
  async
  defer
></script>
```

Set `NEXT_PUBLIC_APP_URL` on Vercel to your production URL.

## WordPress plugin

1. Zip `plugins/presenceos-traffic-pixel/` or copy to `wp-content/plugins/`
2. Activate **PresenceOS Traffic Pixel**
3. Settings → PresenceOS Pixel: enter Project ID + App URL

## Server ingest (bulk)

`POST /api/traffic-panel/ingest` with header `x-traffic-panel-secret: TRAFFIC_PANEL_INGEST_SECRET`

## Privacy

- Session-scoped (one beacon per session)
- No PII in the pixel payload
- Domain must match the project domain

# Billing — Stripe staging E2E

PresenceOS billing is wired but **disabled in production** while `FREE_ACCESS_MODE=true` (default). Use this runbook to validate Stripe in staging before flipping paid access.

## Prerequisites

- Stripe **test mode** keys in staging env:
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...` (from Stripe CLI or dashboard endpoint)
  - Price IDs for plans (`STRIPE_PRICE_SOLO` $29, `STRIPE_PRICE_GROWTH` $79, `STRIPE_PRICE_AGENCY` $199 — all monthly subscriptions)
- Supabase staging project with migrations applied (organizations `api_credit_limit`, `api_credits_used`, Stripe customer columns).
- App deployed to staging with `FREE_ACCESS_MODE=false` **only on the staging stack** (keep production `true` until commercialization gate passes).

## 1. Webhook delivery

```bash
stripe listen --forward-to https://<staging-host>/api/webhooks/stripe
```

Create a test checkout from **Settings → Billing** and confirm events:

| Event | Expected DB effect |
|-------|-------------------|
| `checkout.session.completed` | Org `subscription_plan`, `stripe_customer_id`, `api_credit_limit` updated |
| `customer.subscription.updated` | Plan tier synced |
| `customer.subscription.deleted` | Revert to `free` plan limits |

## 2. Checkout happy path

1. Sign in as org owner on staging.
2. Open `/app/settings/billing`.
3. Click **Subscribe — Growth** (or Solo / Agency).
4. Complete Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
5. Return URL should land back in the app; org row should show non-free plan and matching `api_credit_limit`.

## 3. Portal

1. From billing page, click **Manage subscription**.
2. Stripe Customer Portal opens.
3. Cancel subscription in portal; webhook should downgrade org to `free` limits.

## 4. API credit enforcement

With `FREE_ACCESS_MODE=false`:

1. Set org `api_credits_used` near `api_credit_limit` in Supabase.
2. Trigger a credit-consuming route (e.g. content generate, full scan).
3. Expect `402` or route-specific degradation when `assertApiCredits` / `trackApiUsage` blocks over-limit usage.

Run unit gate:

```bash
node --import ./tests/_lib/register-loader.mjs --test src/lib/metering/__tests__/api-usage.test.ts
```

## 5. Rollback

- Set `FREE_ACCESS_MODE=true` on staging to restore unlimited access without code deploy.
- Refund/cancel test subscriptions in Stripe dashboard.

## Production flip

Do **not** enable paid mode in production until `npm run commercialization:gate` passes. Then follow [COMMERCIALIZATION_FLIP.md](./COMMERCIALIZATION_FLIP.md).

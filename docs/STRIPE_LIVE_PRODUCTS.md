# Stripe Live Products — webfetch

Create live-mode products to replace the 5 test-mode price IDs in
`cloud/workers/wrangler.toml:90-94`. Follow every section in order.

---

## 1. Pre-flight — Dashboard Settings Checklist

Complete these before creating any products. Each item links to the relevant
Stripe dashboard page.

| # | Setting | Where | Required value |
|---|---------|-------|----------------|
| 1 | Switch to **Live mode** | Top-right toggle (Dashboard home) | Live mode ON |
| 2 | Default currency | Settings → Business → Customer emails | USD |
| 3 | Statement descriptor | Settings → Business → Public details | `WEBFETCH` (max 22 chars) |
| 4 | Receipt emails | Settings → Business → Customer emails | "Send email receipts" ON |
| 5 | Stripe Tax | Settings → Tax → Overview | Enable if you want automatic VAT collection (EU/UK). Optional at launch — add later per plan/Section E. |
| 6 | Email domain | Settings → Business → Public details | `getwebfetch.com` |
| 7 | Support email | Settings → Business → Public details | `support@getwebfetch.com` |
| 8 | Live-mode Stripe keys | Developers → API keys | Copy **Secret key** (`sk_live_…`) — this becomes `STRIPE_SECRET_KEY` |

Screenshot checklist: open each page, confirm the value, proceed.

---

## 2. Billing Meter — Must Create First

The metered overage prices attach to a Billing Meter. Create the meter
**before** the prices, because you'll need the meter ID when creating overage
prices.

### Steps (Stripe Dashboard → Billing → Meters → + Create meter)

| Field | Value |
|-------|-------|
| Display name | `webfetch request` |
| Event name | `webfetch_request` |
| Value settings — event payload key | `value` |
| Aggregation | `Sum` |
| Customer mapping — event payload key | `stripe_customer_id` |

Click **Create meter**. Copy the resulting meter ID (looks like
`mtr_live_XXXXXXXXXXXXXXXX`). You will select this meter when creating the
overage prices below.

> **Why this shape:** `billing.ts` posts meter events via
> `POST /v1/billing/meter_events` with `payload[value]` as the unit count
> and `payload[stripe_customer_id]` for customer mapping. See
> `cloud/workers/src/billing.ts:430-435`.

---

## 3. Product / Price Creation

Create products at **Catalog → Products → + Add product**.

---

### Product: webfetch Pro

| Field | Value |
|-------|-------|
| Name | `webfetch Pro` |
| Description | `10,000 fetches/mo, pooled provider keys, 100 rpm per key, all endpoints` |
| Image | Upload `cloud/landing/public/og-image.png` |
| Statement descriptor | `WEBFETCH PRO` |
| Tax code | `txcd_10000000` (Software as a Service) |

#### Prices

| Label | Type | Billing | Amount | Currency | Tax behavior | Metered? |
|-------|------|---------|--------|----------|-------------|---------|
| Pro monthly | Recurring | Monthly | $19.00 | USD | Exclusive | No |
| Pro overage | Recurring | Monthly | $0.015 per unit | USD | Exclusive | Yes — attach meter `webfetch_request` |

**Creating Pro monthly:**
1. Click **Add a price**.
2. Pricing model: **Standard pricing**.
3. Price: `19.00`, Currency: `USD`, Billing period: `Monthly`.
4. Tax behavior: `Exclusive` (tax added on top).
5. Save. Copy the `price_live_…` ID → this is `STRIPE_PRICE_PRO`.

**Creating Pro overage:**
1. Click **Add another price**.
2. Pricing model: **Usage-based**.
3. Meter: select `webfetch_request` (created above).
4. Price per unit: `0.015`, Currency: `USD`.
5. Tax behavior: `Exclusive`.
6. Save. Copy the `price_live_…` ID → this is `STRIPE_PRICE_OVERAGE_PRO`.

---

### Product: webfetch Team

| Field | Value |
|-------|-------|
| Name | `webfetch Team` |
| Description | `50,000 fetches/mo, 5 seats included, pooled provider keys, 300 rpm per key` |
| Image | Upload `cloud/landing/public/og-image.png` |
| Statement descriptor | `WEBFETCH TEAM` |
| Tax code | `txcd_10000000` |

#### Prices

| Label | Type | Billing | Amount | Currency | Tax behavior | Metered? |
|-------|------|---------|--------|----------|-------------|---------|
| Team monthly | Recurring | Monthly | $79.00 | USD | Exclusive | No |
| Team seat | Recurring | Monthly | $12.00 per unit | USD | Exclusive | No |
| Team overage | Recurring | Monthly | $0.010 per unit | USD | Exclusive | Yes — attach meter `webfetch_request` |

**Creating Team monthly:**
1. Click **Add a price** → Standard pricing → $79.00, Monthly, USD, Exclusive.
2. Save. Copy ID → `STRIPE_PRICE_TEAM`.

**Creating Team seat:**
1. Click **Add another price** → Standard pricing → $12.00, Monthly, USD, Exclusive.
2. Save. Copy ID → `STRIPE_PRICE_TEAM_SEAT`.

> The checkout code at `billing.ts:76-78` adds `seats - 5` units of this price
> when `seats > 5`.

**Creating Team overage:**
1. Click **Add another price** → Usage-based → meter `webfetch_request` →
   $0.010 per unit, USD, Exclusive.
2. Save. Copy ID → `STRIPE_PRICE_OVERAGE_TEAM`.

---

## 4. Webhook Endpoint

Register after the Worker is deployed.

**Stripe Dashboard → Developers → Webhooks → + Add endpoint**

| Field | Value |
|-------|-------|
| Endpoint URL | `https://api.getwebfetch.com/stripe/webhook` |
| API version | `2024-06-20` |
| Events to listen for | See table below |

Events:

| Event |
|-------|
| `checkout.session.completed` |
| `customer.subscription.created` |
| `customer.subscription.updated` |
| `customer.subscription.deleted` |
| `invoice.payment_failed` |

After saving, click **Reveal signing secret**. Copy the `whsec_…` value →
this becomes `STRIPE_WEBHOOK_SECRET` (set via `wrangler secret put STRIPE_WEBHOOK_SECRET`).

> **Note:** The Worker handles webhooks at `/stripe/webhook` (registered in
> `billingRouter` in `billing.ts:132`). The deployment plan references
> `/v1/webhooks/stripe` — use `/stripe/webhook` instead, which is what the
> code actually mounts.

---

## 5. Customer Portal Configuration

> **STATUS (as of 2026-05-01):** the value currently in `cloud/workers/wrangler.toml`
> (`STRIPE_PORTAL_CONFIG_ID = "bpc_1TMdoLIsCo7Z3L3vBZQtxTKN"`) is the
> **test-mode** config. Live customers cannot open the portal until you
> recreate it in live mode and update the binding.

The test-mode portal config is `bpc_1TMdoLIsCo7Z3L3vBZQtxTKN`. Recreate an
equivalent config in live mode.

**Stripe Dashboard → Settings → Billing → Customer portal** (toggle to **Live**
mode in the upper-left **before** configuring)

Enable the following features to match test-mode config:

| Feature | Setting |
|---------|---------|
| Payment method update | On |
| Invoice history | On |
| Subscription cancellation | On — at period end, capture reason |
| Plan switching | On — allow customers to switch between Pro and Team |
| Subscription pause | Off (not supported in our billing model) |
| Customer information update | On — allow email update |
| Billing address collection | Optional |

Return URL: `https://app.getwebfetch.com/billing`

After saving, copy the portal configuration ID (`bpc_live_…`) →
this becomes `STRIPE_PORTAL_CONFIG_ID`.

---

## 6. Mapping to wrangler.toml

After creating all 5 prices and the portal config, update
`cloud/workers/wrangler.toml` lines 90–99.

```toml
# before (test mode)
STRIPE_PRICE_PRO          = "price_1TMd9qIsCo7Z3L3vRPcU5ADf"
STRIPE_PRICE_TEAM         = "price_1TMd9rIsCo7Z3L3vlDoD5aEq"
STRIPE_PRICE_TEAM_SEAT    = "price_1TMd9rIsCo7Z3L3vTas2tbYY"
STRIPE_PRICE_OVERAGE_PRO  = "price_1TMdALIsCo7Z3L3vESz7Acen"
STRIPE_PRICE_OVERAGE_TEAM = "price_1TMdALIsCo7Z3L3vZcYck87Y"
STRIPE_PORTAL_CONFIG_ID   = "bpc_1TMdoLIsCo7Z3L3vBZQtxTKN"

# after (live mode) — PASTE YOUR LIVE IDS HERE
STRIPE_PRICE_PRO          = "price_XXXXXXXXXXXXXXXXXXXXXXXX"
STRIPE_PRICE_TEAM         = "price_XXXXXXXXXXXXXXXXXXXXXXXX"
STRIPE_PRICE_TEAM_SEAT    = "price_XXXXXXXXXXXXXXXXXXXXXXXX"
STRIPE_PRICE_OVERAGE_PRO  = "price_XXXXXXXXXXXXXXXXXXXXXXXX"
STRIPE_PRICE_OVERAGE_TEAM = "price_XXXXXXXXXXXXXXXXXXXXXXXX"
STRIPE_PORTAL_CONFIG_ID   = "bpc_XXXXXXXXXXXXXXXXXXXXXXXX"
```

Then redeploy:

```bash
cd cloud/workers
wrangler secret put STRIPE_SECRET_KEY   # paste sk_live_… key
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler deploy
```

---

## 7. Verification

### Pre-cutover local test (before DNS goes live)

```bash
# Forward live webhook events to your local worker during testing.
stripe listen \
  --forward-to http://localhost:8787/stripe/webhook \
  --events checkout.session.completed,customer.subscription.created,\
customer.subscription.updated,customer.subscription.deleted,\
invoice.payment_failed
```

Keep this running in a terminal, then run the steps below in another.

### Live-mode end-to-end smoke test

1. Sign up at `https://app.getwebfetch.com` with a real inbox.
2. Confirm verification email arrives (SendGrid domain auth required first —
   see `docs/SSO_SETUP.md`).
3. Go to `/billing` → click **Upgrade to Pro**.
4. Complete Stripe Checkout with test card `4242 4242 4242 4242`, any future
   expiry, any CVC. Use **your live Stripe key** — this charges the card for
   real. For smoke testing only, use a real card you own and immediately cancel.
5. Return to `/billing` — `plan` should flip to `pro` within 10 seconds
   (webhook latency). If it doesn't, check `wrangler tail` and the Stripe
   Dashboard → Events tab for webhook delivery status.
6. Create a new API key in the dashboard.
7. Run a pooled search:
   ```bash
   curl -H "Authorization: Bearer wf_YOUR_PRO_KEY" \
     "https://api.getwebfetch.com/v1/search?q=nature&providers=unsplash,pexels,pixabay,flickr" \
     | jq '.providerReports'
   ```
   Every listed provider should return `count > 0` with no `401` or
   `403` errors.
8. Check `/v1/usage` — the request counter should have incremented.
9. In Stripe Dashboard → Billing → Meters → `webfetch_request` → View events —
   confirm a meter event was recorded for the request.

### Trigger a webhook manually

```bash
# Simulate a subscription update (replace ws_xxx with a real workspace_id):
stripe trigger customer.subscription.updated \
  --override subscription:metadata.workspace_id=ws_xxx

# Test duplicate delivery (idempotency):
stripe events resend evt_XXXXXXXX
# Expect: second delivery returns 200 but is a no-op (dedup via webhook_events table).
```

### Test payment failure flow

```bash
stripe trigger invoice.payment_failed
```

Check that the dashboard `/billing` page shows the `past_due` banner (B2
fix from the launch-hardening plan).

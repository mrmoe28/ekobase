# EkoBase migration gaps for ops.lock28.com (field-ops project)

**Status:** living document. Reflects what's missing on EkoBase vs what `ops.lock28.com` actually uses. Generated from grep of `eko-solar-ops-master/` + `supabase-clone/` + Coolify API as of 2026-05-20.

Field-ops project ID: `75ce0d13-5acd-4740-88b5-cb6bea58c4ad`
Schema: `proj_75ce0d135acd4740`

Legend: ✅ done · 🔧 in progress · ❌ missing · ❓ verify once backend is healthy

---

## 1. Database schema gaps

### `profiles` table — 12 columns added 2026-05-20

| Column | Type | Status |
|---|---|---|
| `square_access_token` | text | ✅ added |
| `square_refresh_token` | text | ✅ added |
| `square_merchant_id` | text | ✅ added |
| `square_location_id` | text | ✅ added |
| `square_connected_at` | timestamptz | ✅ added |
| `company_name` | text | ✅ added |
| `company_email` | text | ✅ added |
| `company_phone` | text | ✅ added |
| `logo_path` | text | ✅ added |
| `google_calendar_id` | text | ✅ added |
| `google_refresh_token` | text | ✅ added |
| `onboarding_completed` | boolean | ✅ added |

### Tables referenced by ops.lock28.com — 35 distinct

All 35 must exist in `proj_75ce0d135acd4740` with the columns the running app expects. The eko-solar-ops `supabase/migrations/` folder only contains 32 migration files that mostly do ALTER TABLE, not CREATE TABLE — meaning the base schema was added via the cloud Supabase dashboard UI, not as code. **The canonical schema doesn't live in the repo.** That's the root cause of every "missing column" surprise so far.

Tables: `api_keys`, `certificates`, `chat_rate_limits`, `client_requests`, `client_users`, `companies`, `courses`, `document_templates`, `equipment`, `equipment_orders`, `equipment_scrape_runs`, `form_fields`, `form_submission_files`, `form_submissions`, `forms`, `invoice_line_items`, `invoices`, `job_documents`, `job_images`, `job_reports`, `job_template_assignments`, `jobs`, `messages`, `modules`, `notifications`, `order_items`, `payment_attempts`, `payments`, `permit_offices`, `profiles`, `quiz_attempts`, `quiz_questions`, `quote_line_items`, `quotes`, `service_deposits`, `sessions`, `signatures`, `sms_settings`, `solar_designs`, `solar_estimates`, `step_progress`, `steps`, `subscription_events`, `subscriptions`, `vendors`, `web_push_subscriptions`.

❓ **All 45 tables in `proj_75ce0d135acd4740` exist by name, but per-column completeness is unverified beyond `profiles`.** Will probably bite us again on `invoices.square_deposit_payment_url`, `quotes.square_payment_url`, etc.

**Action needed:** dump the canonical schema from the original cloud Supabase project (still exists at supabase.com under Voxly org), apply diff to EkoBase. Without this we'll keep stubbing columns one feature at a time.

---

## 2. Storage buckets

Buckets the app uses (8):

| Bucket | Used for | Status |
|---|---|---|
| `company-logos` | onboarding company logo | ❓ |
| `document-templates` | reusable docs | ❓ |
| `equipment-images` | equipment catalog | ❓ |
| `job-documents` | job paperwork | ❓ |
| `job-images` | job photos | ❓ |
| `quote-attachments` | quote files | ❓ |
| `quote-signatures` | e-sign images | ❓ |
| `signatures` | signature pad output | ❓ |

Per `/admin/v1/stats`: total buckets = **1**. So most/all are missing. Need to create.

---

## 3. Edge functions

26 functions in `eko-solar-ops-master/supabase/functions/`. 18 of them are actually called by the running React app. Only **2 deployed** to EkoBase right now (`hello` demo + `square-oauth`).

### Node-style (5) — can deploy on the existing `functions-runner` with minor work

| Function | Status | Notes |
|---|---|---|
| `square-oauth` | ✅ deployed | needs schema-error checks; previous bug logged tokens as null silently |
| `send-email` | ❌ | core to invoicing, quote notifications, password reset, client invites |
| `create-payment-link` | ❌ | Square payment-link creation |
| `send-push` | ❌ | web push notifications |
| `square-payment-webhook` | ❌ | webhook receiver for Square payment status |

### Deno-style (21) — need a Deno runtime (Phase 2)

`cancel-subscription`, `chat-completions`, `client-request-notify`, `contract-send`, `create-calendar-event`, `create-subscription`, `delete-calendar-event`, `detect-calendar`, `form-chat`, `form-submission-notify`, `geocode`, `invite-client`, `invoice-opened`, `invoice-pdf`, `invoice-sms`, `mcp`, `permit-office-lookup`, `quote-deposit`, `quote-notify`, `quote-reminders`, `receipt-pdf`, `scrape-equipment`, `sync-square-payments`, `upload-to-drive` — all ❌

### Functions referenced by client but missing from source

Found in client grep but no source dir: `contract-send`, `geocode`, `quote-deposit`, `quote-notify`. These calls will 404 even when the runtime is up. ❓ verify whether they were renamed or actually missing.

---

## 4. Auth gaps

| Method | App uses it | EkoBase supports |
|---|---|---|
| `signInWithPassword` (email/password) | ✅ | ✅ |
| `signUp` (email/password) | ✅ | ✅ |
| `signInWithOAuth({provider: 'google'})` | ✅ | ❌ **gateway has no `/auth/v1/authorize` route** |
| Google session refresh via `provider_refresh_token` | ✅ | ❌ same |
| `resetPasswordForEmail` | ✅ | ✅ (gateway implements `/auth/v1/recover` + `/reset`) |

**Action:** Either disable Google sign-in in the React app (low cost, lose feature) or add Google OAuth to the EkoBase gateway (real work — provider registration, token exchange, callback route, profile linkage).

The onboarding wizard's "Detect calendar" step depends on Google OAuth being completed (it reads `provider_refresh_token`). Without Google auth, calendar auto-detect is broken regardless of `detect-calendar` function being deployed.

---

## 5. Env vars on `supabase-clone-app`

### ✅ Currently set
`POSTGRES_PASSWORD`, `JWT_SECRET`, `GATEWAY_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `SQUARE_ENVIRONMENT`, `SQUARE_APP_ID`, `SQUARE_APP_SECRET`

### ❌ Needed by other Node-style functions (Phase 1.5)

| Var | For function(s) |
|---|---|
| `SUPABASE_ANON_KEY` | create-payment-link |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `FROM_EMAIL` | send-email (or SENDGRID_API_KEY as alt) |
| `SENDGRID_API_KEY` | send-email fallback |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT` | send-push |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | square-payment-webhook |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`), `OWNER_NOTIFY_PHONE` | square-payment-webhook (SMS branch) |

### ❌ Needed for Deno-style functions (Phase 2)

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` (AI features) · `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_MAPS_API_KEY` (Google integrations) · `SERPER_API_KEY` (web search) · `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_PLAN_VARIATION_ID` (Square outside OAuth) · `ALLOWED_ORIGINS`, `PORTAL_URL`, `PUBLIC_SITE_URL` (CORS/links)

### ⚠️ Security finding

`JWT_SECRET` on Coolify is the literal default dev fallback `local-dev-jwt-secret-change-me-at-least-32-chars`. Anyone who knows that string can mint admin tokens for the entire EkoBase instance. **Rotate before anything moves to production traffic.**

---

## 6. Infrastructure reliability

### Today's outage root cause (2026-05-20)

After the OAuth retry, the supabase-clone-app stack went degraded: `postgres`, `gateway`, `functions-runner`, `realtime`, `storage` containers were missing entirely; only `admin-service` and `postgrest` existed and were crash-looping with `password authentication failed for user "postgres"`. Coolify reported app status `running:unknown` despite the actual state. 

Hypothesis: the back-to-back redeploys earlier (git-push-triggered + my manual trigger) overlapped, and Coolify's compose teardown removed the postgres container before the new compose-up brought it back. The dependent services then crash-looped against a missing host.

**Recovery:** triggered a fresh `force=true` deploy (in progress now).

**Prevention:**
- Don't trigger manual deploys when an auto-deploy from git push is already queued.
- Coolify v4 has a "minimum interval between deployments" setting — worth enabling.
- The `admin-service` `initSchema` step retries indefinitely with no backoff — it should fail fast or have a circuit breaker so containers don't pin CPU on auth failures.

---

## 7. Recommended order of operations

1. **Get the canonical schema dumped** from the dead Voxly/cloud-Supabase project. Apply diff. (Unblocks every future "missing column" surprise.)
2. **Create the 8 storage buckets** via admin API + apply matching grants.
3. **Disable Google OAuth in the ops.lock28.com React app** OR implement it in the gateway. Pick one; the half-state breaks onboarding step 2.
4. **Phase 1.5:** ship the 4 remaining Node-style functions (`send-email`, `create-payment-link`, `send-push`, `square-payment-webhook`) with their env vars. Add `.error` checks to all 5.
5. **Phase 2:** stand up the Deno runtime sidecar; deploy the 21 Deno functions with their env vars.
6. **Rotate `JWT_SECRET`** to a real random value before any other production move.

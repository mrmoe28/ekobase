# Public Edge

Canonical public entrypoints for Ekobase production:

- `https://supabase.ekodevops.com` -> gateway/API
- `https://supabase-admin.ekodevops.com` -> admin UI

Do not switch the admin UI back to `admin.supabase.ekodevops.com`.
That nested hostname has previously failed TLS/routing at the Cloudflare edge.

## Invariants

- The first decision is **which machine you are on**.
- `/home/mrmoe28` is a workstation, not the Proxmox/Coolify proxy host.
- Do **not** run the shared production tunnel restore on the workstation unless you have first verified that this machine actually serves `localhost:443` and `localhost:8000`.
- The Cloudflare tunnel is `proxmox-coolify`.
- The production tunnel id is `4459baed-9bb8-4c23-877e-6ebab77aacef`.
- `docker-compose.coolify.yml` must route the admin UI on
  `supabase-admin.ekodevops.com`.
- `cloudflared` ingress must include:
  - `supabase.ekodevops.com` -> `https://localhost:443`
  - `supabase-admin.ekodevops.com` -> `https://localhost:443`
- The real app host is CT 105, now named `ekobase`, at `192.168.50.105`.
- If `supabase-admin.ekodevops.com` fails with `502` while `supabase.ekodevops.com` is healthy, the first suspect is CT 105 `admin-ui`, not Cloudflare.

## Admin UI runtime

The admin UI deployment on CT 105 must use the Next.js standalone server path.

- `apps/admin-ui/next.config.ts` should set:
  - `output: 'standalone'`
- The admin UI image should start with:
  - `node .next/standalone/apps/admin-ui/server.js`

Do not switch this deployment target back to `next start` unless the CT 105 runtime behavior has been re-verified.
On 2026-06-08, `next start` on `node:22-alpine` crash-looped with a Tokio
`failed to create UnixStream` permission error in CT 105.

## Checks

Run these before or after infra changes:

```bash
./scripts/check-public-edge.sh
./scripts/check-edge-config.sh
```

To install a recurring systemd timer on the host:

```bash
sudo ./scripts/install-public-edge-monitor.sh
systemctl list-timers ekobase-public-edge-check.timer
```

If the tunnel host breaks because `/etc/cloudflared` was deleted or drifted,
recover it with:

```bash
sudo ./scripts/restore-cloudflared.sh
```

The recovery script reads the Cloudflare token from a local env file instead of
storing credentials in this repo.

## Guardrail

Before using `restore-cloudflared.sh`, verify that you are on the actual proxy host:

```bash
lsof -iTCP:443 -sTCP:LISTEN
curl -sk --resolve supabase.ekodevops.com:443:127.0.0.1 https://supabase.ekodevops.com/auth/v1/user
curl -sk --resolve panel.lock28.com:443:127.0.0.1 https://panel.lock28.com/
```

If `127.0.0.1:443` is not serving the proxy locally, stop. Do not attach that
machine to `proxmox-coolify`. Use a dedicated workstation tunnel instead.

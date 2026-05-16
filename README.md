# Supabase Clone

A small self-hosted Supabase-compatible slice for local development:

- `/rest/v1/*` proxies to PostgREST backed by PostgreSQL RLS.
- `/functions/v1/*` proxies to a Node functions runner.
- e2e tests use `@supabase/supabase-js` against the local gateway.

## Quick Start

```bash
pnpm install
pnpm test:e2e:local
```

The local API base URL is:

```text
http://localhost:54321
```

This is intentionally not a full Supabase replacement yet. The first milestone is proving client compatibility for RLS-protected PostgREST queries and function invocation.

## Codex Sandbox Note

Inside the Codex sandbox, Node processes may be blocked from opening local TCP
connections and fail with `connect EPERM 127.0.0.1:<port>`. The app is still
reachable; `curl` and unsandboxed shell commands can connect normally.

For Codex-run verification, use:

```bash
bash -ic 'cd /home/mrmoe28/Project\ X/Supabase\ Clone && pnpm test:e2e:local'
```

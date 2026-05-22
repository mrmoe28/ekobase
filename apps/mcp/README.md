# `@local/mcp` — EkoBase MCP server

A Model Context Protocol server that exposes the EkoBase (self-hosted Supabase
clone) admin API as tools for Claude Code and other MCP clients. Talks to the
admin API at `${EKOBASE_URL}/admin/v1/*` over HTTPS using a pre-minted
service-role JWT.

## Tools (v1)

| Tool | Purpose |
| --- | --- |
| `list_projects` | List all projects |
| `get_project` | Get one project by id |
| `create_project` | Create a project (auto-provisions a schema) |
| `get_project_keys` | Fetch anon + service_role JWTs for a project |
| `list_tables` | List tables and columns; optional schema filter |
| `execute_sql` | Run arbitrary SQL — unrestricted |
| `list_users` | List `auth.users` |
| `list_edge_functions` | List a project's edge functions |
| `deploy_edge_function` | Create a new deployment for a function |
| `list_secrets` | List function secrets (digests only) |

## Install

From the monorepo root:

```bash
pnpm install
```

That's all — no build step. The server is run directly via Node's TypeScript
stripping (`node --experimental-strip-types`), matching the rest of this repo.

## Mint a service-role JWT

The MCP authenticates with a static JWT in the `EKOBASE_ADMIN_TOKEN` env var.
Mint one against the **live** `JWT_SECRET` from the LXC (not the dev fallback):

```bash
JWT_SECRET="<live secret from LXC>" \
  node --experimental-strip-types -e '
    import("./packages/jwt/src/index.ts").then(async ({ signProjectJwt }) => {
      const tok = await signProjectJwt({
        sub: "00000000-0000-0000-0000-000000000000",
        role: "service_role",
        secret: process.env.JWT_SECRET,
        expiresInSeconds: 60 * 60 * 24 * 365 * 100,
      });
      console.log(tok);
    });
  '
```

Stash the printed token in a password manager. Treat it as a root credential
for the entire EkoBase instance.

## Wire into Claude Code

Add an entry to `~/.claude.json` (or a per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "ekobase": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/home/mrmoe28/Project X/Ekobase/apps/mcp/src/index.ts"
      ],
      "env": {
        "EKOBASE_URL": "https://supabase.ekodevops.com",
        "EKOBASE_ADMIN_TOKEN": "<paste-the-jwt-here>"
      }
    }
  }
}
```

Restart Claude Code, then `/mcp` should show `ekobase` connected.

## Smoke tests

In a Claude Code session with the MCP loaded:

- `list_projects` — should return your live project list
- `list_tables` with `{ "schema": "admin" }` — should list `projects`,
  `tenants`, `edge_functions`, etc.
- `execute_sql` with `{ "sql": "SELECT now()" }` — single row
- `list_users` — auth users
- `get_project_keys` with a known `project_id` — `{ anon_key, service_role_key }`

## Security caveat

The EkoBase admin service currently accepts **any valid authenticated JWT** —
see `services/admin/src/index.ts:108`. There is no distinct "admin" role check.
That means the static service-role JWT you put in `EKOBASE_ADMIN_TOKEN` is
effectively a god-mode credential for the whole instance.

Mitigation, in rough order: keep it out of source control, scope it to one
operator workstation, plan to add an admin-only auth gate to `services/admin`
and re-issue a narrower token afterward.

## What's intentionally not included in v1

- `get_logs` — no endpoint exists in EkoBase yet
- `apply_migration` — use `execute_sql`
- `generate_typescript_types` — would require client-side codegen on top of
  `list_tables`; deferred
- storage / realtime / tenant tools — out of v1 scope
- a hosted HTTP/SSE variant — stdio-only for now

create table if not exists admin.edge_functions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin.projects(id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'draft'
    check (status in ('draft', 'deployed', 'failed', 'disabled')),
  entrypoint text not null default 'index.ts',
  verify_jwt boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists admin.edge_function_deployments (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null references admin.edge_functions(id) on delete cascade,
  version integer not null,
  source text,
  status text not null default 'created'
    check (status in ('created', 'deployed', 'failed')),
  created_at timestamptz not null default now(),
  unique (function_id, version)
);

create schema if not exists admin;

create table if not exists admin.tenants (
  id uuid primary key,
  name text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant usage on schema admin to service_role;
grant select, insert, update, delete on admin.tenants to service_role;
create schema if not exists storage;

create table if not exists storage.buckets (
  id uuid primary key,
  name text not null unique,
  public boolean not null default false,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.files (
  id uuid primary key,
  bucket_id uuid not null references storage.buckets(id) on delete cascade,
  name text not null,
  path text not null,
  size bigint not null,
  content_type text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket_id, name)
);

grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.buckets to authenticated;
grant select, insert, update, delete on storage.files to authenticated;
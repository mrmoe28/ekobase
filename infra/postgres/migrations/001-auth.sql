create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text not null unique,
  encrypted_password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

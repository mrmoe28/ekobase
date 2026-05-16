create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator noinherit login password 'authenticator';

grant anon, authenticated, service_role to authenticator;

create schema auth;

create table auth.users (
  id uuid primary key,
  email text not null unique,
  encrypted_password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null,
  inserted_at timestamptz not null default now()
);

alter table public.todos enable row level security;

create policy "Users can read their todos"
  on public.todos
  for select
  to authenticated
  using (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub')::uuid);

create policy "Users can insert their todos"
  on public.todos
  for insert
  to authenticated
  with check (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub')::uuid);

grant usage on schema public to anon, authenticated;
grant select, insert on public.todos to authenticated;
grant usage, select on sequence public.todos_id_seq to authenticated;

insert into public.todos (user_id, title)
values
  ('00000000-0000-0000-0000-000000000001', 'Only my row'),
  ('00000000-0000-0000-0000-000000000002', 'Someone else row');

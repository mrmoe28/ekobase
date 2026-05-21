-- Idempotent production init — safe to run on a fresh or existing database.

-- Roles
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authenticator';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT anon, authenticated, service_role TO authenticator;

-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS admin;
CREATE SCHEMA IF NOT EXISTS storage;

-- auth.users
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  encrypted_password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- auth.refresh_tokens
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- auth.password_reset_tokens
CREATE TABLE IF NOT EXISTS auth.password_reset_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);

-- storage.buckets
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  private_user_scoped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS private_user_scoped boolean NOT NULL DEFAULT false;

-- storage.files
CREATE TABLE IF NOT EXISTS storage.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name text NOT NULL,
  path text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  content_type text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);

-- admin.projects
CREATE TABLE IF NOT EXISTS admin.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  region text NOT NULL DEFAULT 'us-east-1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- admin.project_members
CREATE TABLE IF NOT EXISTS admin.project_members (
  project_id uuid NOT NULL REFERENCES admin.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- admin.edge_functions
CREATE TABLE IF NOT EXISTS admin.edge_functions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES admin.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'deployed', 'failed', 'disabled')),
  entrypoint text NOT NULL DEFAULT 'index.ts',
  verify_jwt boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);

-- admin.edge_function_deployments
CREATE TABLE IF NOT EXISTS admin.edge_function_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_id uuid NOT NULL REFERENCES admin.edge_functions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  source text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'deployed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (function_id, version)
);

-- public.todos (example data)
CREATE TABLE IF NOT EXISTS public.todos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read their todos" ON public.todos
    FOR SELECT TO authenticated
    USING (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their todos" ON public.todos
    FOR INSERT TO authenticated
    WITH CHECK (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grants for PostgREST
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON public.todos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.todos_id_seq TO authenticated;

GRANT USAGE ON SCHEMA auth TO authenticator;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO authenticator;
GRANT USAGE ON SCHEMA storage TO authenticator;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticator;

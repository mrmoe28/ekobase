-- Project-scope storage.buckets and storage.files.
--
-- Pre-existing state varies by environment:
--   * `infra/postgres/init-prod.sql` does not include `project_id`.
--   * Migration 003-admin.sql adds it nullable.
-- This migration is idempotent: it adds the column if missing, fails fast if
-- any bucket cannot be assigned to a project (per user choice: block, don't
-- guess), then enforces NOT NULL and switches the unique constraint from
-- (name) to (project_id, name).

begin;

alter table storage.buckets
  add column if not exists project_id uuid references admin.projects(id) on delete cascade;

alter table storage.files
  add column if not exists project_id uuid references admin.projects(id) on delete cascade;

-- Pre-flight: list orphan buckets (owner has no project_members row).
-- Buckets that already have a project_id assigned are skipped.
do $$
declare
  orphans text;
begin
  select string_agg(format('  - %s (owner=%s)', b.name, b.owner_id), E'\n')
    into orphans
  from storage.buckets b
  where b.project_id is null
    and not exists (
      select 1 from admin.project_members pm where pm.user_id = b.owner_id
    );

  if orphans is not null then
    raise exception E'Cannot migrate: % bucket(s) have no project to assign to:\n%\n\nResolve by either (a) adding the owner to a project via admin.project_members, or (b) deleting the bucket. Then re-run.',
      (select count(*) from storage.buckets b
         where b.project_id is null
           and not exists (
             select 1 from admin.project_members pm where pm.user_id = b.owner_id
           )),
      orphans;
  end if;
end$$;

-- Backfill: for each bucket missing project_id, pick the owner's earliest
-- project membership. Ties broken by project_id for determinism.
update storage.buckets b
set project_id = (
  select pm.project_id
  from admin.project_members pm
  where pm.user_id = b.owner_id
  order by pm.created_at asc, pm.project_id asc
  limit 1
)
where b.project_id is null;

-- Files inherit project_id from their bucket.
update storage.files f
set project_id = b.project_id
from storage.buckets b
where f.bucket_id = b.id
  and f.project_id is null;

alter table storage.buckets alter column project_id set not null;
alter table storage.files alter column project_id set not null;

-- Switch uniqueness: bucket names are unique within a project, not globally.
do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'storage.buckets'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(name)%'
      and pg_get_constraintdef(oid) not ilike '%project_id%'
  loop
    execute format('alter table storage.buckets drop constraint %I', rec.conname);
  end loop;
end$$;

-- Drop the implicit UNIQUE index too if it was created by a `text NOT NULL UNIQUE`
-- column definition (init-prod.sql shape).
do $$
declare
  idxname text;
begin
  select indexname into idxname
  from pg_indexes
  where schemaname = 'storage'
    and tablename = 'buckets'
    and indexdef ilike '%UNIQUE%(name)%'
    and indexdef not ilike '%project_id%';
  if idxname is not null then
    execute format('drop index storage.%I', idxname);
  end if;
end$$;

create unique index if not exists buckets_project_name_uniq
  on storage.buckets (project_id, name);

create index if not exists buckets_project_id_idx
  on storage.buckets (project_id);

create index if not exists files_project_id_idx
  on storage.files (project_id);

commit;

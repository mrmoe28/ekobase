alter table storage.buckets
  add column if not exists private_user_scoped boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · reset
--
-- ⚠ DESTRUCTIVE. Deletes every table, view, function and row in the `public`
-- schema of this project (and maeosan's `private` schema), plus all access
-- policies on storage objects and realtime messages.
--
-- Kept: auth users (they get fresh profiles), storage buckets and uploaded files.
--
-- Use it when the project already holds another schema, then run schema.sql.
-- Supabase → SQL Editor → New query → paste → Run.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  -- Policies left behind by earlier schemas could still grant access to files
  -- or realtime topics, so they go too. schema.sql recreates maeosan's own.
  for r in
    select policyname, schemaname, tablename
    from pg_policies
    where (schemaname = 'storage' and tablename = 'objects')
       or (schemaname = 'realtime' and tablename = 'messages')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('maeosan-housekeeping');
exception
  when others then null;
end;
$$;

-- Cascades to triggers on auth.users and policies that used these functions.
drop schema if exists private cascade;
drop schema if exists public cascade;

create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

comment on schema public is 'standard public schema';

notify pgrst, 'reload schema';

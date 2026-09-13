-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 05 · storage
--   avatars      public read, object path  <user_id>/<file>
--   attachments  private, object path       <conversation_id>/<user_id>/<file>
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('attachments', 'attachments', false, 25 * 1024 * 1024, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_attachment(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversation text := split_part(coalesce(p_object_name, ''), '/', 1);
begin
  if v_conversation !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_conversation_participant(v_conversation::uuid);
end;
$$;

-- Avatars ────────────────────────────────────────────────────────────────────

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Attachments ────────────────────────────────────────────────────────────────

drop policy if exists attachments_select_participants on storage.objects;
create policy attachments_select_participants
  on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.can_access_attachment(name));

drop policy if exists attachments_insert_participants on storage.objects;
create policy attachments_insert_participants
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.can_access_attachment(name)
  );

drop policy if exists attachments_delete_uploader on storage.objects;
create policy attachments_delete_uploader
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[2] = (select auth.uid())::text);

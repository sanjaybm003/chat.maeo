-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 04 · realtime
--
-- Topics (all private, authorised by RLS on realtime.messages):
--   user:<uuid>          personal feed. Messages, reactions, read receipts and
--                        conversation changes are fanned out here by the
--                        database, so a client needs exactly one subscription
--                        to keep every chat in the sidebar live.
--   workspace:<uuid>     presence (who is online) and membership/profile hints.
--   conversation:<uuid>  ephemeral typing indicators sent by clients.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.realtime_notify_users(p_user_ids uuid[], p_event text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_user_ids is null then
    return;
  end if;
  foreach v_user in array p_user_ids loop
    perform realtime.send(p_payload, p_event, 'user:' || v_user::text, true);
  end loop;
end;
$$;

create or replace function public.realtime_notify_workspace(p_workspace_id uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'workspace:' || p_workspace_id::text, true);
end;
$$;

revoke execute on function public.realtime_notify_users(uuid[], text, jsonb) from public, anon, authenticated;
revoke execute on function public.realtime_notify_workspace(uuid, text, jsonb) from public, anon, authenticated;

-- Messages ───────────────────────────────────────────────────────────────────

create or replace function public.realtime_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
  v_payload jsonb;
begin
  if tg_op = 'UPDATE'
    and new.body is not distinct from old.body
    and new.deleted_at is not distinct from old.deleted_at
  then
    return null;
  end if;

  select array_agg(cp.user_id) into v_users
    from public.conversation_participants cp
   where cp.conversation_id = new.conversation_id;

  v_payload := to_jsonb(new);

  if new.reply_to_id is not null then
    v_payload := v_payload || jsonb_build_object('reply_to', (
      select jsonb_build_object(
        'id', q.id,
        'sender_id', q.sender_id,
        'body', left(q.body, 200),
        'attachment_count', jsonb_array_length(q.attachments),
        'deleted_at', q.deleted_at
      )
      from public.messages q
      where q.id = new.reply_to_id
    ));
  end if;

  perform public.realtime_notify_users(
    v_users,
    case tg_op when 'INSERT' then 'message.created' else 'message.updated' end,
    v_payload
  );
  return null;
end;
$$;

create trigger messages_realtime
  after insert or update on public.messages
  for each row execute function public.realtime_on_message();

-- Reactions ──────────────────────────────────────────────────────────────────

create or replace function public.realtime_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.message_reactions%rowtype;
  v_users uuid[];
begin
  -- A reaction removed because its message went away is not news. (AFTER
  -- triggers of cascades run at the outer statement level, so pg_trigger_depth
  -- can not tell them apart; the parent row can.)
  if tg_op = 'DELETE' and not exists (select 1 from public.messages m where m.id = old.message_id) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select array_agg(cp.user_id) into v_users
    from public.conversation_participants cp
   where cp.conversation_id = v_row.conversation_id;

  perform public.realtime_notify_users(
    v_users,
    case tg_op when 'INSERT' then 'reaction.added' else 'reaction.removed' end,
    jsonb_build_object(
      'message_id', v_row.message_id,
      'conversation_id', v_row.conversation_id,
      'user_id', v_row.user_id,
      'emoji', v_row.emoji
    )
  );
  return null;
end;
$$;

create trigger message_reactions_realtime
  after insert or delete on public.message_reactions
  for each row execute function public.realtime_on_reaction();

-- Participants ───────────────────────────────────────────────────────────────
-- Statement level so creating a 20 person group sends 20 events, not 400.

create or replace function public.realtime_on_participants_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select n.conversation_id, array_agg(cp.user_id) as users
    from (select distinct conversation_id from added_rows) n
    join public.conversation_participants cp on cp.conversation_id = n.conversation_id
    group by n.conversation_id
  loop
    perform public.realtime_notify_users(
      r.users, 'conversation.changed', jsonb_build_object('conversation_id', r.conversation_id)
    );
  end loop;
  return null;
end;
$$;

create trigger conversation_participants_realtime_added
  after insert on public.conversation_participants
  referencing new table as added_rows
  for each statement execute function public.realtime_on_participants_added();

create or replace function public.realtime_on_participants_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_remaining uuid[];
begin
  -- Conversations deleted outright are announced through workspace.removed.
  for r in
    select rr.conversation_id, array_agg(rr.user_id) as users
    from removed_rows rr
    where exists (select 1 from public.conversations c where c.id = rr.conversation_id)
    group by rr.conversation_id
  loop
    perform public.realtime_notify_users(
      r.users, 'conversation.removed', jsonb_build_object('conversation_id', r.conversation_id)
    );

    select array_agg(cp.user_id) into v_remaining
      from public.conversation_participants cp
     where cp.conversation_id = r.conversation_id;

    perform public.realtime_notify_users(
      v_remaining, 'conversation.changed', jsonb_build_object('conversation_id', r.conversation_id)
    );
  end loop;
  return null;
end;
$$;

create trigger conversation_participants_realtime_removed
  after delete on public.conversation_participants
  referencing old table as removed_rows
  for each statement execute function public.realtime_on_participants_removed();

create or replace function public.realtime_on_participant_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
begin
  if new.last_read_at is distinct from old.last_read_at then
    select array_agg(cp.user_id) into v_users
      from public.conversation_participants cp
     where cp.conversation_id = new.conversation_id;

    perform public.realtime_notify_users(
      v_users,
      'participant.read',
      jsonb_build_object(
        'conversation_id', new.conversation_id,
        'user_id', new.user_id,
        'last_read_at', new.last_read_at
      )
    );
  end if;

  if new.muted is distinct from old.muted then
    perform public.realtime_notify_users(
      array[new.user_id],
      'conversation.changed',
      jsonb_build_object('conversation_id', new.conversation_id)
    );
  end if;

  return null;
end;
$$;

create trigger conversation_participants_realtime_updated
  after update on public.conversation_participants
  for each row execute function public.realtime_on_participant_updated();

create or replace function public.realtime_on_conversation_renamed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
begin
  select array_agg(cp.user_id) into v_users
    from public.conversation_participants cp
   where cp.conversation_id = new.id;

  perform public.realtime_notify_users(
    v_users, 'conversation.changed', jsonb_build_object('conversation_id', new.id)
  );
  return null;
end;
$$;

create trigger conversations_realtime_renamed
  after update of name on public.conversations
  for each row
  when (old.name is distinct from new.name)
  execute function public.realtime_on_conversation_renamed();

-- Workspace membership, profiles and settings ───────────────────────────────
-- Workspace topic payloads are hints only: clients refetch through RLS rather
-- than trusting them, because members may also publish on that topic.

create or replace function public.realtime_on_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.realtime_notify_workspace(
      old.workspace_id, 'member.removed', jsonb_build_object('user_id', old.user_id)
    );
    perform public.realtime_notify_users(
      array[old.user_id], 'workspace.removed', jsonb_build_object('workspace_id', old.workspace_id)
    );
    return null;
  end if;

  perform public.realtime_notify_workspace(
    new.workspace_id, 'member.changed', jsonb_build_object('user_id', new.user_id)
  );
  return null;
end;
$$;

create trigger workspace_members_realtime
  after insert or update or delete on public.workspace_members
  for each row execute function public.realtime_on_member_changed();

create or replace function public.realtime_on_profile_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  for v_workspace in
    select m.workspace_id from public.workspace_members m where m.user_id = new.id
  loop
    perform public.realtime_notify_workspace(
      v_workspace, 'member.changed', jsonb_build_object('user_id', new.id)
    );
  end loop;
  return null;
end;
$$;

create trigger profiles_realtime
  after update on public.profiles
  for each row
  when (
    old.full_name is distinct from new.full_name
    or old.display_name is distinct from new.display_name
    or old.title is distinct from new.title
    or old.status_text is distinct from new.status_text
    or old.avatar_path is distinct from new.avatar_path
    or old.color is distinct from new.color
  )
  execute function public.realtime_on_profile_updated();

create or replace function public.realtime_on_workspace_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.realtime_notify_workspace(
    new.id, 'workspace.updated', jsonb_build_object('workspace_id', new.id)
  );
  return null;
end;
$$;

create trigger workspaces_realtime
  after update on public.workspaces
  for each row execute function public.realtime_on_workspace_updated();

-- Channel authorisation ──────────────────────────────────────────────────────

create or replace function public.can_access_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text := split_part(coalesce(p_topic, ''), ':', 1);
  v_id text := substr(coalesce(p_topic, ''), length(split_part(coalesce(p_topic, ''), ':', 1)) + 2);
begin
  if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  return case v_scope
    when 'user' then v_id::uuid = (select auth.uid())
    when 'workspace' then public.is_workspace_member(v_id::uuid)
    when 'conversation' then public.is_conversation_participant(v_id::uuid)
    else false
  end;
end;
$$;

drop policy if exists maeosan_realtime_receive on realtime.messages;
create policy maeosan_realtime_receive
  on realtime.messages for select to authenticated
  using (public.can_access_realtime_topic((select realtime.topic())));

-- Clients may publish typing and presence only; personal feeds are written by
-- the database alone, so they cannot be spoofed.
drop policy if exists maeosan_realtime_publish on realtime.messages;
create policy maeosan_realtime_publish
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and split_part((select realtime.topic()), ':', 1) in ('workspace', 'conversation')
    and public.can_access_realtime_topic((select realtime.topic()))
  );

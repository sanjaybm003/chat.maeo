-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 02 · integrity triggers and RPC API
-- Every write that touches more than one row goes through a function here, so
-- it is atomic and authorised in exactly one place.
-- ─────────────────────────────────────────────────────────────────────────────

-- Access helpers ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can call them without recursing into RLS.

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = (select auth.uid())
  );
$$;

create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

create or replace function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- Auth → profile sync ────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_palette text[] := array['tomato', 'saffron', 'grass', 'lagoon', 'cobalt', 'iris', 'bubblegum', 'clay'];
  v_name text := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  )), '');
begin
  insert into public.profiles (id, email, full_name, color)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    left(v_name, 80),
    v_palette[1 + floor(random() * array_length(v_palette, 1))::int]
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = lower(coalesce(new.email, ''))
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Accounts created before this schema was installed get a profile as well.
insert into public.profiles (id, email)
select u.id, lower(coalesce(u.email, ''))
from auth.users u
on conflict (id) do nothing;

-- Message integrity ──────────────────────────────────────────────────────────
-- Clients may only write body/attachments/reply target on insert and body or a
-- soft delete on update. Everything else is pinned here.

create or replace function public.messages_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attachment jsonb;
  v_prefix text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    new.body := btrim(new.body, E' \t\r\n');

    if new.reply_to_id is not null and not exists (
      select 1 from public.messages r
      where r.id = new.reply_to_id and r.conversation_id = new.conversation_id
    ) then
      raise exception 'You can only reply to messages in the same conversation.' using errcode = '22023';
    end if;

    if new.kind = 'text' then
      v_prefix := new.conversation_id::text || '/' || new.sender_id::text || '/';
      for v_attachment in select value from jsonb_array_elements(new.attachments) loop
        if jsonb_typeof(v_attachment) <> 'object'
          or left(coalesce(v_attachment ->> 'path', ''), length(v_prefix)) <> v_prefix
          or coalesce(v_attachment ->> 'name', '') = ''
        then
          raise exception 'One of the attachments is invalid.' using errcode = '22023';
        end if;
      end loop;
    end if;

    return new;
  end if;

  -- Only foreign keys (ON DELETE SET NULL for a deleted account or message)
  -- change these columns; clients hold no privilege on them.
  if new.sender_id is distinct from old.sender_id or new.reply_to_id is distinct from old.reply_to_id then
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception 'This message was deleted.' using errcode = '22023';
  end if;

  new.id := old.id;
  new.conversation_id := old.conversation_id;
  new.sender_id := old.sender_id;
  new.kind := old.kind;
  new.meta := old.meta;
  new.reply_to_id := old.reply_to_id;
  new.created_at := old.created_at;

  if new.deleted_at is not null then
    new.deleted_at := now();
    new.body := '';
    new.attachments := '[]'::jsonb;
    new.edited_at := old.edited_at;
    return new;
  end if;

  new.attachments := old.attachments;
  if new.body is distinct from old.body then
    new.body := btrim(new.body, E' \t\r\n');
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  return new;
end;
$$;

create trigger messages_before_write
  before insert or update on public.messages
  for each row execute function public.messages_before_write();

create or replace function public.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations c
     set last_message_at = new.created_at
   where c.id = new.conversation_id
     and (c.last_message_at is null or c.last_message_at < new.created_at);
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.message_reactions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.conversation_id
    into new.conversation_id
    from public.messages m
   where m.id = new.message_id
     and m.kind = 'text'
     and m.deleted_at is null;

  if new.conversation_id is null then
    raise exception 'That message no longer exists.' using errcode = '22023';
  end if;

  new.created_at := now();
  return new;
end;
$$;

create trigger message_reactions_before_insert
  before insert on public.message_reactions
  for each row execute function public.message_reactions_before_insert();

-- Internal: system messages (group created, people added, renamed …) ─────────

create or replace function public.post_system_message(
  p_conversation_id uuid,
  p_actor uuid,
  p_event text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (
    p_conversation_id,
    p_actor,
    'system',
    '',
    jsonb_build_object('event', p_event) || coalesce(p_meta, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.post_system_message(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Workspaces ─────────────────────────────────────────────────────────────────

create or replace function public.is_workspace_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_slug, '') ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and not exists (select 1 from public.workspaces w where w.slug = p_slug);
$$;

create or replace function public.create_workspace(
  p_name text,
  p_slug text,
  p_team_size text default null,
  p_use_case text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_id uuid;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if (
    select count(*) from public.workspaces w
    where w.created_by = v_uid and w.created_at > now() - interval '1 day'
  ) >= 5 then
    raise exception 'You have created a lot of workspaces today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  begin
    insert into public.workspaces (name, slug, team_size, use_case, created_by)
    values (btrim(p_name), v_slug, p_team_size, nullif(btrim(coalesce(p_use_case, '')), ''), v_uid)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'That workspace URL is already taken.' using errcode = '23505';
  end;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_slug;
end;
$$;

create or replace function public.my_workspaces()
returns table (
  id uuid,
  name text,
  slug text,
  role public.workspace_role,
  joined_at timestamptz,
  member_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id,
    w.name,
    w.slug,
    m.role,
    m.joined_at,
    (select count(*)::int from public.workspace_members x where x.workspace_id = w.id)
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
  order by m.joined_at;
$$;

create or replace function public.list_workspace_members(
  p_workspace_id uuid,
  p_user_id uuid default null
)
returns table (
  user_id uuid,
  role public.workspace_role,
  joined_at timestamptz,
  email text,
  full_name text,
  display_name text,
  title text,
  status_text text,
  avatar_path text,
  color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.user_id,
    m.role,
    m.joined_at,
    p.email,
    p.full_name,
    p.display_name,
    p.title,
    p.status_text,
    p.avatar_path,
    p.color
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id
    and (p_user_id is null or m.user_id = p_user_id)
    and (select public.is_workspace_member(p_workspace_id))
  order by lower(coalesce(p.display_name, p.full_name, p.email));
$$;

create or replace function public.update_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_actor public.workspace_role;
  v_target public.workspace_role;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Choose admin or member.' using errcode = '22023';
  end if;

  select m.role into v_actor from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = v_uid;
  select m.role into v_target from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_user_id;

  if v_actor is null or v_actor = 'member' then
    raise exception 'Only admins can change roles.' using errcode = '42501';
  end if;
  if v_target is null then
    raise exception 'That person is not in this workspace.' using errcode = '22023';
  end if;
  if v_target = 'owner' then
    raise exception 'The owner''s role can''t be changed. Transfer ownership instead.' using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'You can''t change your own role.' using errcode = '22023';
  end if;

  update public.workspace_members m
     set role = p_role
   where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$$;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_actor public.workspace_role;
  v_target public.workspace_role;
  v_conversation uuid;
begin
  select m.role into v_actor from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = v_uid;
  select m.role into v_target from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_user_id;

  if v_actor is null or v_target is null then
    raise exception 'That person is not in this workspace.' using errcode = '22023';
  end if;
  if v_target = 'owner' then
    raise exception 'The owner can''t leave or be removed. Transfer ownership first.' using errcode = '22023';
  end if;
  if p_user_id <> v_uid then
    if v_actor = 'member' then
      raise exception 'Only admins can remove people.' using errcode = '42501';
    end if;
    if v_actor = 'admin' and v_target = 'admin' then
      raise exception 'Only the owner can remove an admin.' using errcode = '42501';
    end if;
  end if;

  for v_conversation in
    select cp.conversation_id
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    where cp.user_id = p_user_id
      and c.workspace_id = p_workspace_id
      and c.kind = 'group'
  loop
    delete from public.conversation_participants cp
     where cp.conversation_id = v_conversation and cp.user_id = p_user_id;
    perform public.post_system_message(v_conversation, p_user_id, 'member_left');
  end loop;

  delete from public.conversation_participants cp
   using public.conversations c
   where c.id = cp.conversation_id
     and c.workspace_id = p_workspace_id
     and cp.user_id = p_user_id;

  delete from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$$;

create or replace function public.transfer_workspace_ownership(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'You already own this workspace.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'That person is not in this workspace.' using errcode = '22023';
  end if;

  update public.workspace_members m set role = 'admin'
   where m.workspace_id = p_workspace_id and m.user_id = v_uid;
  update public.workspace_members m set role = 'owner'
   where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid, p_confirm_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_slug text;
begin
  select w.slug into v_slug
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where w.id = p_workspace_id and m.user_id = v_uid and m.role = 'owner';

  if v_slug is null then
    raise exception 'Only the owner can delete this workspace.' using errcode = '42501';
  end if;
  if v_slug <> coalesce(p_confirm_slug, '') then
    raise exception 'Type the workspace URL exactly to confirm.' using errcode = '22023';
  end if;

  delete from public.workspaces w where w.id = p_workspace_id;
end;
$$;

-- Removes workspaces the caller owns alone and refuses when others depend on
-- them. The auth user itself is deleted by the server with the service role.
create or replace function public.prepare_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_blocking text;
begin
  select string_agg(w.name, ', ')
    into v_blocking
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
   where m.user_id = v_uid
     and m.role = 'owner'
     and exists (
       select 1 from public.workspace_members o
       where o.workspace_id = m.workspace_id and o.user_id <> v_uid
     );

  if v_blocking is not null then
    raise exception 'Transfer ownership of % before deleting your account.', v_blocking using errcode = '22023';
  end if;

  delete from public.workspaces w
   where w.id in (
     select m.workspace_id from public.workspace_members m
     where m.user_id = v_uid and m.role = 'owner'
   );
end;
$$;

-- Invitations ────────────────────────────────────────────────────────────────

create or replace function public.invite_workspace_members(
  p_workspace_id uuid,
  p_emails text[],
  p_role public.workspace_role default 'member'
)
returns table (invited_email text, invite_token text, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_membership record;
  v_role public.workspace_role;
  v_members_can_invite boolean;
  v_email text;
  v_count integer := coalesce(array_length(p_emails, 1), 0);
  v_recent integer;
begin
  select m.role, w.members_can_invite
    into v_membership
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
   where m.workspace_id = p_workspace_id and m.user_id = v_uid;

  if not found then
    raise exception 'Workspace not found.' using errcode = '42501';
  end if;
  v_role := v_membership.role;
  v_members_can_invite := v_membership.members_can_invite;
  if v_role = 'member' and not v_members_can_invite then
    raise exception 'Only admins can invite people to this workspace.' using errcode = '42501';
  end if;
  if p_role = 'owner' or (p_role = 'admin' and v_role = 'member') then
    raise exception 'You can''t invite people with that role.' using errcode = '42501';
  end if;
  if v_count = 0 then
    return;
  end if;
  if v_count > 25 then
    raise exception 'You can invite up to 25 people at a time.' using errcode = '22023';
  end if;

  select count(*) into v_recent
    from public.invitations i
   where i.workspace_id = p_workspace_id and i.created_at > now() - interval '1 hour';
  if v_recent + v_count > 100 then
    raise exception 'That''s a lot of invitations in an hour. Try again a little later.' using errcode = 'P0001';
  end if;

  for v_email in
    select distinct lower(btrim(e)) from unnest(p_emails) as e where btrim(coalesce(e, '')) <> ''
  loop
    invited_email := v_email;
    invite_token := null;

    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      outcome := 'invalid';
      return next;
      continue;
    end if;

    if exists (
      select 1 from public.workspace_members m
      join public.profiles p on p.id = m.user_id
      where m.workspace_id = p_workspace_id and p.email = v_email
    ) then
      outcome := 'already_member';
      return next;
      continue;
    end if;

    update public.invitations i
       set expires_at = now() + interval '14 days',
           role = p_role,
           invited_by = v_uid
     where i.workspace_id = p_workspace_id
       and i.email = v_email
       and i.status = 'pending'
    returning i.token into invite_token;

    if found then
      outcome := 'resent';
      return next;
      continue;
    end if;

    insert into public.invitations as i (workspace_id, email, role, invited_by)
    values (p_workspace_id, v_email, p_role, v_uid)
    returning i.token into invite_token;

    outcome := 'invited';
    return next;
  end loop;
end;
$$;

create or replace function public.get_invitation(p_token text)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  email text,
  role public.workspace_role,
  status text,
  expires_at timestamptz,
  inviter_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id,
    w.name,
    w.slug,
    i.email,
    i.role,
    case
      when i.status = 'pending' and i.expires_at < now() then 'expired'
      else i.status::text
    end,
    i.expires_at,
    coalesce(p.display_name, p.full_name, 'A teammate')
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = p_token;
$$;

create or replace function public.my_pending_invitations()
returns table (
  token text,
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  role public.workspace_role,
  inviter_name text,
  member_count integer,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.token,
    w.id,
    w.name,
    w.slug,
    i.role,
    coalesce(p.display_name, p.full_name, 'A teammate'),
    (select count(*)::int from public.workspace_members x where x.workspace_id = w.id),
    i.created_at,
    i.expires_at
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email = (select lower(u.email) from auth.users u where u.id = (select auth.uid()))
    and not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = i.workspace_id and m.user_id = (select auth.uid())
    )
  order by i.created_at desc;
$$;

create or replace function public.accept_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_email text;
  v_confirmed timestamptz;
  v_invite public.invitations%rowtype;
  v_slug text;
begin
  select lower(u.email), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u
   where u.id = v_uid;

  select * into v_invite
    from public.invitations i
   where i.token = p_token
   for update;

  if not found then
    raise exception 'This invitation link is not valid.' using errcode = '22023';
  end if;

  select w.slug into v_slug from public.workspaces w where w.id = v_invite.workspace_id;

  if v_invite.status = 'accepted' then
    if v_invite.accepted_by = v_uid then
      return v_slug;
    end if;
    raise exception 'This invitation has already been used.' using errcode = '22023';
  end if;
  if v_invite.status = 'revoked' then
    raise exception 'This invitation was cancelled.' using errcode = '22023';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = '22023';
  end if;
  if v_invite.email <> v_email then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;
  if v_confirmed is null then
    raise exception 'Confirm your email address before joining.' using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_uid, v_invite.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.invitations i
     set status = 'accepted', accepted_by = v_uid, accepted_at = now()
   where i.id = v_invite.id;

  return v_slug;
end;
$$;

create or replace function public.decline_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.invitations i
     set status = 'revoked'
   where i.token = p_token
     and i.status = 'pending'
     and i.email = (select lower(u.email) from auth.users u where u.id = v_uid);
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.invitations i
     set status = 'revoked'
   where i.id = p_invitation_id
     and i.status = 'pending'
     and (i.invited_by = v_uid or public.is_workspace_admin(i.workspace_id));

  if not found then
    raise exception 'Invitation not found.' using errcode = '22023';
  end if;
end;
$$;

-- Conversations ──────────────────────────────────────────────────────────────

create or replace function public.list_conversations(
  p_workspace_id uuid,
  p_conversation_id uuid default null
)
returns table (
  id uuid,
  kind public.conversation_kind,
  name text,
  created_by uuid,
  created_at timestamptz,
  last_message_at timestamptz,
  muted boolean,
  last_read_at timestamptz,
  unread_count integer,
  participants jsonb,
  last_message jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.created_by,
    c.created_at,
    c.last_message_at,
    me.muted,
    me.last_read_at,
    unread.total::int,
    roster.participants,
    latest.message
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  cross join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', cp.user_id,
          'joined_at', cp.joined_at,
          'last_read_at', cp.last_read_at
        )
        order by cp.joined_at
      ),
      '[]'::jsonb
    ) as participants
    from public.conversation_participants cp
    where cp.conversation_id = c.id
  ) roster
  left join lateral (
    select jsonb_build_object(
      'id', m.id,
      'sender_id', m.sender_id,
      'kind', m.kind,
      'body', left(m.body, 180),
      'meta', m.meta,
      'attachment_count', jsonb_array_length(m.attachments),
      'deleted_at', m.deleted_at,
      'created_at', m.created_at
    ) as message
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  cross join lateral (
    select count(*) as total
    from (
      select 1
      from public.messages m
      where m.conversation_id = c.id
        and m.created_at > me.last_read_at
        and m.kind = 'text'
        and m.deleted_at is null
        and m.sender_id is distinct from me.user_id
      limit 100
    ) capped
  ) unread
  where me.user_id = (select auth.uid())
    and c.workspace_id = p_workspace_id
    and (
      (p_conversation_id is not null and c.id = p_conversation_id)
      or (p_conversation_id is null and (c.last_message_at is not null or c.created_by = me.user_id))
    )
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

create or replace function public.create_direct_conversation(p_workspace_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_key text;
  v_id uuid;
begin
  if p_user_id = v_uid then
    raise exception 'Pick someone other than yourself.' using errcode = '22023';
  end if;
  if not public.is_workspace_member(p_workspace_id) or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'That person is not in this workspace.' using errcode = '22023';
  end if;

  v_key := p_workspace_id::text || ':' || least(v_uid, p_user_id)::text || ':' || greatest(v_uid, p_user_id)::text;

  insert into public.conversations (workspace_id, kind, direct_key, created_by)
  values (p_workspace_id, 'direct', v_key, v_uid)
  on conflict (direct_key) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.conversations c where c.direct_key = v_key;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_id, v_uid), (v_id, p_user_id)
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$$;

create or replace function public.create_group_conversation(
  p_workspace_id uuid,
  p_member_ids uuid[],
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_members uuid[];
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace not found.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}')
    into v_members
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x
   where x <> v_uid;

  if coalesce(array_length(v_members, 1), 0) = 0 then
    raise exception 'Pick at least one person.' using errcode = '22023';
  end if;
  if array_length(v_members, 1) > 99 then
    raise exception 'Group chats can have up to 100 people.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_members) as x
    where not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = x
    )
  ) then
    raise exception 'Some of those people are not in this workspace.' using errcode = '22023';
  end if;

  insert into public.conversations (workspace_id, kind, name, created_by)
  values (p_workspace_id, 'group', v_name, v_uid)
  returning id into v_id;

  insert into public.conversation_participants (conversation_id, user_id)
  select v_id, x from unnest(array_append(v_members, v_uid)) as x;

  perform public.post_system_message(v_id, v_uid, 'group_created', jsonb_build_object('name', v_name));
  return v_id;
end;
$$;

create or replace function public.add_conversation_participants(p_conversation_id uuid, p_user_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_conversation public.conversations%rowtype;
  v_existing uuid[];
  v_new uuid[];
begin
  select * into v_conversation from public.conversations c where c.id = p_conversation_id;
  if not found or not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;

  select coalesce(array_agg(cp.user_id), '{}')
    into v_existing
    from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id;

  select coalesce(array_agg(distinct x), '{}')
    into v_new
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) as x
   where not (x = any (v_existing));

  if coalesce(array_length(v_new, 1), 0) = 0 then
    return p_conversation_id;
  end if;

  if exists (
    select 1 from unnest(v_new) as x
    where not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = v_conversation.workspace_id and m.user_id = x
    )
  ) then
    raise exception 'Some of those people are not in this workspace.' using errcode = '22023';
  end if;

  -- A 1:1 stays private: adding people starts a fresh group instead.
  if v_conversation.kind = 'direct' then
    return public.create_group_conversation(v_conversation.workspace_id, v_existing || v_new, null);
  end if;

  if array_length(v_existing, 1) + array_length(v_new, 1) > 100 then
    raise exception 'Group chats can have up to 100 people.' using errcode = '22023';
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  select p_conversation_id, x from unnest(v_new) as x;

  perform public.post_system_message(
    p_conversation_id, v_uid, 'members_added', jsonb_build_object('user_ids', to_jsonb(v_new))
  );
  return p_conversation_id;
end;
$$;

create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  if not exists (
    select 1 from public.conversations c
    join public.conversation_participants cp on cp.conversation_id = c.id
    where c.id = p_conversation_id and c.kind = 'group' and cp.user_id = v_uid
  ) then
    raise exception 'You can only leave group chats you are part of.' using errcode = '22023';
  end if;

  delete from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id and cp.user_id = v_uid;

  perform public.post_system_message(p_conversation_id, v_uid, 'member_left');
end;
$$;

create or replace function public.rename_conversation(p_conversation_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'Keep the name under 80 characters.' using errcode = '22023';
  end if;

  update public.conversations c
     set name = v_name
   where c.id = p_conversation_id
     and c.kind = 'group'
     and public.is_conversation_participant(p_conversation_id)
     and c.name is distinct from v_name;

  if found then
    perform public.post_system_message(p_conversation_id, v_uid, 'renamed', jsonb_build_object('name', v_name));
  end if;
end;
$$;

create or replace function public.mark_conversation_read(
  p_conversation_id uuid,
  p_read_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_at timestamptz := least(coalesce(p_read_at, now()), now());
  v_result timestamptz;
begin
  update public.conversation_participants cp
     set last_read_at = v_at
   where cp.conversation_id = p_conversation_id
     and cp.user_id = v_uid
     and cp.last_read_at < v_at
  returning cp.last_read_at into v_result;

  return v_result;
end;
$$;

create or replace function public.set_conversation_muted(p_conversation_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.conversation_participants cp
     set muted = coalesce(p_muted, false)
   where cp.conversation_id = p_conversation_id and cp.user_id = v_uid;
end;
$$;

-- Messages ───────────────────────────────────────────────────────────────────

create or replace function public.get_messages(
  p_conversation_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  kind public.message_kind,
  body text,
  attachments jsonb,
  meta jsonb,
  reply_to_id uuid,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz,
  reactions jsonb,
  reply_to jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.conversation_id,
    m.sender_id,
    m.kind,
    m.body,
    m.attachments,
    m.meta,
    m.reply_to_id,
    m.edited_at,
    m.deleted_at,
    m.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'user_id', r.user_id) order by r.created_at)
      from public.message_reactions r
      where r.message_id = m.id
    ), '[]'::jsonb),
    (
      select jsonb_build_object(
        'id', q.id,
        'sender_id', q.sender_id,
        'body', left(q.body, 200),
        'attachment_count', jsonb_array_length(q.attachments),
        'deleted_at', q.deleted_at
      )
      from public.messages q
      where q.id = m.reply_to_id
    )
  from public.messages m
  where m.conversation_id = p_conversation_id
    and (select public.is_conversation_participant(p_conversation_id))
    and (
      p_before_created_at is null
      or (m.created_at, m.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.search_messages(
  p_workspace_id uuid,
  p_query text,
  p_limit integer default 20
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at
  from public.messages m
  join public.conversation_participants me
    on me.conversation_id = m.conversation_id
   and me.user_id = (select auth.uid())
  join public.conversations c
    on c.id = m.conversation_id
   and c.workspace_id = p_workspace_id
  where char_length(btrim(coalesce(p_query, ''))) >= 2
    and m.kind = 'text'
    and m.deleted_at is null
    and m.body ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

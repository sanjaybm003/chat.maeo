-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 06 · platform upgrade
--
--   • private schema for internal state, never exposed through the Data API
--   • token-bucket rate limiting for messages, reactions and new groups
--   • message versions + an ordered change feed for gap-free realtime catch-up
--   • ranked full-text message search: prefix matching, trigram similarity and
--     recency decay
--   • presence "last seen", web push subscriptions and push dispatch (pg_net)
--   • admin audit log, nightly housekeeping (pg_cron), health check, indexes
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- App configuration ──────────────────────────────────────────────────────────
-- Operator-managed settings read by database code (for example the push
-- dispatch URL and secret). Edit with SQL; see README → Web push.

create table if not exists private.app_config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

-- Shared JSON builders ───────────────────────────────────────────────────────

create or replace function private.reactions_json(p_message_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('emoji', r.emoji, 'user_id', r.user_id) order by r.created_at),
    '[]'::jsonb
  )
  from public.message_reactions r
  where r.message_id = p_message_id;
$$;

create or replace function private.reply_preview_json(p_message_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id,
    'sender_id', q.sender_id,
    'body', left(q.body, 200),
    'attachment_count', jsonb_array_length(q.attachments),
    'deleted_at', q.deleted_at
  )
  from public.messages q
  where q.id = p_message_id;
$$;

-- Rate limiting: token bucket ────────────────────────────────────────────────
-- Each (user, bucket) holds up to `capacity` tokens refilled continuously at
-- `refill_per_second`. Bursts are allowed, sustained floods are not. On refusal
-- the error carries `retry_after=<seconds>` in its hint so clients back off
-- precisely instead of guessing.

create table if not exists private.rate_limits (
  user_id      uuid not null,
  bucket       text not null,
  tokens       double precision not null,
  refilled_at  timestamptz not null,
  primary key (user_id, bucket)
);

create or replace function private.consume_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_capacity integer,
  p_refill_per_second double precision,
  p_cost integer default 1
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_tokens double precision;
  v_refilled timestamptz;
  v_retry_after integer;
begin
  if p_user_id is null then
    return;
  end if;

  insert into private.rate_limits (user_id, bucket, tokens, refilled_at)
  values (p_user_id, p_bucket, p_capacity, v_now)
  on conflict (user_id, bucket) do nothing;

  select r.tokens, r.refilled_at
    into v_tokens, v_refilled
    from private.rate_limits r
   where r.user_id = p_user_id and r.bucket = p_bucket
   for update;

  v_tokens := least(
    p_capacity::double precision,
    v_tokens + greatest(0, extract(epoch from (v_now - v_refilled))) * p_refill_per_second
  );

  if v_tokens < p_cost then
    v_retry_after := greatest(1, ceil((p_cost - v_tokens) / p_refill_per_second))::integer;
    raise exception 'You''re sending a lot at once. Try again in a few seconds.'
      using errcode = 'P0429', hint = 'retry_after=' || v_retry_after;
  end if;

  update private.rate_limits r
     set tokens = v_tokens - p_cost,
         refilled_at = v_now
   where r.user_id = p_user_id and r.bucket = p_bucket;
end;
$$;

revoke execute on function private.consume_rate_limit(uuid, text, integer, double precision, integer) from public, anon, authenticated;

-- Messages: versions, change feed, search vector ─────────────────────────────

alter table public.messages
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists search_vector tsvector
    generated always as (to_tsvector('simple'::regconfig, coalesce(body, ''))) stored;

create index if not exists messages_search_vector_idx on public.messages using gin (search_vector);
create index if not exists messages_changes_idx on public.messages (conversation_id, updated_at, id);
create index if not exists messages_unread_idx
  on public.messages (conversation_id, created_at)
  where kind = 'text' and deleted_at is null;

-- Security definer so it can consult private.* (rate limits). It still pins
-- every column a client must not control.
create or replace function public.messages_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment jsonb;
  v_prefix text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;
    new.version := 1;
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
      perform private.consume_rate_limit(new.sender_id, 'message', 30, 1.0);

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
  new.version := old.version + 1;
  new.updated_at := now();

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

  perform private.consume_rate_limit(new.user_id, 'reaction', 40, 2.0);
  new.created_at := now();
  return new;
end;
$$;

-- A reaction change bumps the message version so the change feed carries it.
create or replace function public.message_reactions_touch_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
begin
  if tg_op = 'DELETE' then
    -- When the message itself is gone (a cascade) the update below matches nothing.
    v_message_id := old.message_id;
  else
    v_message_id := new.message_id;
  end if;

  update public.messages m
     set updated_at = now()
   where m.id = v_message_id and m.deleted_at is null;
  return null;
end;
$$;

drop trigger if exists message_reactions_touch_message on public.message_reactions;
create trigger message_reactions_touch_message
  after insert or delete on public.message_reactions
  for each row execute function public.message_reactions_touch_message();

-- Realtime payloads never need the search vector.
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

  v_payload := to_jsonb(new) - 'search_vector';
  if new.reply_to_id is not null then
    v_payload := v_payload || jsonb_build_object('reply_to', private.reply_preview_json(new.reply_to_id));
  end if;

  perform public.realtime_notify_users(
    v_users,
    case tg_op when 'INSERT' then 'message.created' else 'message.updated' end,
    v_payload
  );
  return null;
end;
$$;

drop function if exists public.get_messages(uuid, timestamptz, uuid, integer);

create function public.get_messages(
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
  updated_at timestamptz,
  version integer,
  reactions jsonb,
  reply_to jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.attachments, m.meta, m.reply_to_id,
    m.edited_at, m.deleted_at, m.created_at, m.updated_at, m.version,
    private.reactions_json(m.id),
    case when m.reply_to_id is null then null else private.reply_preview_json(m.reply_to_id) end
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

-- Everything that changed in a conversation after a cursor, oldest change
-- first. Clients page with (updated_at, id) until a short page comes back.
create or replace function public.get_message_changes(
  p_conversation_id uuid,
  p_since timestamptz,
  p_since_id uuid default null,
  p_limit integer default 200
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
  updated_at timestamptz,
  version integer,
  reactions jsonb,
  reply_to jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.attachments, m.meta, m.reply_to_id,
    m.edited_at, m.deleted_at, m.created_at, m.updated_at, m.version,
    private.reactions_json(m.id),
    case when m.reply_to_id is null then null else private.reply_preview_json(m.reply_to_id) end
  from public.messages m
  where m.conversation_id = p_conversation_id
    and (select public.is_conversation_participant(p_conversation_id))
    and (m.updated_at, m.id) > (p_since, coalesce(p_since_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by m.updated_at, m.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

-- Ranked search ──────────────────────────────────────────────────────────────
-- score = (2 · cover density rank of prefix terms + trigram similarity
--          + substring bonus) · (0.35 + 0.65 · e^(−age_days / 45))
-- so the best textual match wins, but recent conversations float up.

drop function if exists public.search_messages(uuid, text, integer);

create function public.search_messages(
  p_workspace_id uuid,
  p_query text,
  p_limit integer default 20
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_tsquery tsquery;
  v_like text;
begin
  if char_length(v_query) < 2 then
    return;
  end if;

  select to_tsquery('simple'::regconfig, string_agg(quote_literal(word) || ':*', ' & '))
    into v_tsquery
    from regexp_split_to_table(lower(v_query), '[^[:alnum:]]+') as word
   where word <> '';

  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.created_at,
    (
      (
        case when v_tsquery is not null and m.search_vector @@ v_tsquery
          then ts_rank_cd(m.search_vector, v_tsquery, 32) * 2
          else 0
        end
        + extensions.similarity(m.body, v_query)
        + case when m.body ilike v_like then 0.25 else 0 end
      )
      * (0.35 + 0.65 * exp(-extract(epoch from (now() - m.created_at)) / (86400.0 * 45)))
    )::real
  from public.messages m
  join public.conversation_participants me
    on me.conversation_id = m.conversation_id
   and me.user_id = (select auth.uid())
  join public.conversations c
    on c.id = m.conversation_id
   and c.workspace_id = p_workspace_id
  where m.kind = 'text'
    and m.deleted_at is null
    and ((v_tsquery is not null and m.search_vector @@ v_tsquery) or m.body ilike v_like)
  order by 6 desc, 5 desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- Groups: creation is rate limited ───────────────────────────────────────────

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

  perform private.consume_rate_limit(v_uid, 'group', 10, 0.05);

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

-- Presence: last seen ────────────────────────────────────────────────────────

alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Called by clients as a heartbeat; writes at most once every 45 seconds.
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles p
     set last_seen_at = now()
   where p.id = (select auth.uid())
     and (p.last_seen_at is null or p.last_seen_at < now() - interval '45 seconds');
$$;

drop function if exists public.list_workspace_members(uuid, uuid);

create function public.list_workspace_members(
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
  color text,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.user_id, m.role, m.joined_at, p.email, p.full_name, p.display_name, p.title,
    p.status_text, p.avatar_path, p.color, p.last_seen_at
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id
    and (p_user_id is null or m.user_id = p_user_id)
    and (select public.is_workspace_member(p_workspace_id))
  order by lower(coalesce(p.display_name, p.full_name, p.email));
$$;

-- Web push ───────────────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1024),
  p256dh        text not null check (char_length(p256dh) <= 256),
  auth          text not null check (char_length(auth) <= 128),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 300),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, last_used_at desc);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon;
revoke insert, update, delete, truncate, references, trigger on public.push_subscriptions from authenticated;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  if coalesce(p_endpoint, '') !~ '^https://' then
    raise exception 'That push subscription is not valid.' using errcode = '22023';
  end if;

  -- An endpoint belongs to one browser profile; whoever signs in there owns it.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_used_at = now();

  -- Keep each person's ten most recently used devices.
  delete from public.push_subscriptions s
   where s.user_id = v_uid
     and s.id not in (
       select s2.id from public.push_subscriptions s2
       where s2.user_id = v_uid
       order by s2.last_used_at desc
       limit 10
     );
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
   where s.endpoint = p_endpoint and s.user_id = (select auth.uid());
$$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception
  when others then
    raise notice 'pg_net is unavailable (%); web push dispatch stays off.', sqlerrm;
end;
$$;

-- After a text message commits, ask the app to fan out push notifications.
-- pg_net queues the request and sends it asynchronously, so sending a message
-- never waits on the network and a rolled-back insert sends nothing.
create or replace function private.dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.kind <> 'text' then
    return null;
  end if;

  select c.value into v_url from private.app_config c where c.key = 'push_dispatch_url';
  select c.value into v_secret from private.app_config c where c.key = 'push_dispatch_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception
    when others then
      raise warning 'maeosan push dispatch skipped: %', sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists messages_push_dispatch on public.messages;
create trigger messages_push_dispatch
  after insert on public.messages
  for each row execute function private.dispatch_push();

-- Audit log ──────────────────────────────────────────────────────────────────

create table if not exists public.audit_events (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null check (char_length(action) <= 60),
  target_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_events_workspace_idx on public.audit_events (workspace_id, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_select_admins on public.audit_events;
create policy audit_events_select_admins
  on public.audit_events for select to authenticated
  using (public.is_workspace_admin(workspace_id));

revoke all on public.audit_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.audit_events from authenticated;

create or replace function private.record_audit(
  p_workspace_id uuid,
  p_action text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_events (workspace_id, actor_id, action, target_id, metadata)
  values (p_workspace_id, (select auth.uid()), p_action, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function private.audit_workspace_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_audit(new.workspace_id, 'member.joined', new.user_id, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.record_audit(
        new.workspace_id, 'member.role_changed', new.user_id,
        jsonb_build_object('from', old.role, 'to', new.role)
      );
    end if;
  -- Deleting the workspace itself cascades here; there is nothing left to log to.
  elsif exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform private.record_audit(old.workspace_id, 'member.removed', old.user_id, jsonb_build_object('role', old.role));
  end if;
  return null;
end;
$$;

drop trigger if exists workspace_members_audit on public.workspace_members;
create trigger workspace_members_audit
  after insert or update or delete on public.workspace_members
  for each row execute function private.audit_workspace_members();

create or replace function private.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_audit(new.workspace_id, 'invitation.created', new.id, jsonb_build_object('email', new.email, 'role', new.role));
  elsif new.status is distinct from old.status then
    perform private.record_audit(new.workspace_id, 'invitation.' || new.status::text, new.id, jsonb_build_object('email', new.email));
  end if;
  return null;
end;
$$;

drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit
  after insert or update on public.invitations
  for each row execute function private.audit_invitations();

create or replace function private.audit_workspaces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.name is distinct from old.name then
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_array(old.name, new.name));
  end if;
  if new.team_size is distinct from old.team_size then
    v_changes := v_changes || jsonb_build_object('team_size', jsonb_build_array(old.team_size, new.team_size));
  end if;
  if new.use_case is distinct from old.use_case then
    v_changes := v_changes || jsonb_build_object('use_case', jsonb_build_array(old.use_case, new.use_case));
  end if;
  if new.members_can_invite is distinct from old.members_can_invite then
    v_changes := v_changes || jsonb_build_object('members_can_invite', jsonb_build_array(old.members_can_invite, new.members_can_invite));
  end if;

  if v_changes <> '{}'::jsonb then
    perform private.record_audit(new.id, 'workspace.updated', new.id, v_changes);
  end if;
  return null;
end;
$$;

drop trigger if exists workspaces_audit on public.workspaces;
create trigger workspaces_audit
  after update on public.workspaces
  for each row execute function private.audit_workspaces();

-- Housekeeping ───────────────────────────────────────────────────────────────

create or replace function private.run_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limits integer;
  v_invitations integer;
  v_push integer;
  v_audit integer;
begin
  delete from private.rate_limits r where r.refilled_at < now() - interval '1 day';
  get diagnostics v_rate_limits = row_count;

  delete from public.invitations i
   where (i.status = 'revoked' and i.created_at < now() - interval '90 days')
      or (i.status = 'pending' and i.expires_at < now() - interval '90 days');
  get diagnostics v_invitations = row_count;

  delete from public.push_subscriptions s where s.last_used_at < now() - interval '120 days';
  get diagnostics v_push = row_count;

  delete from public.audit_events a where a.created_at < now() - interval '400 days';
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'rate_limits', v_rate_limits,
    'invitations', v_invitations,
    'push_subscriptions', v_push,
    'audit_events', v_audit
  );
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('maeosan-housekeeping', '17 3 * * *', 'select private.run_housekeeping()');
exception
  when others then
    raise notice 'pg_cron is unavailable (%); run private.run_housekeeping() on your own schedule.', sqlerrm;
end;
$$;

-- Health check ───────────────────────────────────────────────────────────────

create or replace function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'time', now(), 'schema', 6);
$$;

grant execute on function public.health_check() to anon, authenticated;

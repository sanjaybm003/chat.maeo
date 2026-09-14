-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 10 · Webhooks: other apps post into chats and hear about tasks
--
--   • chat_webhooks   a secret link an admin makes for one chat. CI, monitoring,
--                     forms or Zapier post messages with it, and agents in the
--                     chat read them like any other message
--   • task_webhooks   addresses an admin adds to hear when tasks are created,
--                     assigned, finished or changed: signed JSON, or a ready
--                     message for Slack, Google Chat or Discord
-- ─────────────────────────────────────────────────────────────────────────────

-- Incoming ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_webhooks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  -- Only a hash of the link's secret is kept; the link itself is shown once.
  token_hash       text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz
);

create index if not exists chat_webhooks_workspace_idx on public.chat_webhooks (workspace_id, created_at desc);
create index if not exists chat_webhooks_conversation_idx on public.chat_webhooks (conversation_id);

alter table public.chat_webhooks enable row level security;

drop policy if exists chat_webhooks_select_admins on public.chat_webhooks;
create policy chat_webhooks_select_admins
  on public.chat_webhooks for select to authenticated
  using (public.is_workspace_admin(workspace_id));

revoke all on public.chat_webhooks from anon, authenticated;
grant select (id, workspace_id, conversation_id, name, created_by, created_at, last_used_at)
  on public.chat_webhooks to authenticated;

-- An admin in the chat makes the link; the secret comes back once and is never stored.
create or replace function public.create_chat_webhook(p_conversation_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_workspace uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_token text;
  v_row public.chat_webhooks%rowtype;
begin
  select c.workspace_id into v_workspace
    from public.conversations c
   where c.id = p_conversation_id;
  if v_workspace is null or not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Chat not found.' using errcode = '42501';
  end if;
  if not public.is_workspace_admin(v_workspace) then
    raise exception 'Only workspace admins can connect apps.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Give the webhook a name of up to 60 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_webhooks w where w.workspace_id = v_workspace) >= 50 then
    raise exception 'A workspace can have up to 50 incoming webhooks. Delete one you no longer use.' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.chat_webhooks (workspace_id, conversation_id, name, token_hash, created_by)
  values (v_workspace, p_conversation_id, v_name, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid)
  returning * into v_row;

  return (to_jsonb(v_row) - 'token_hash') || jsonb_build_object('token', v_token);
end;
$$;

create or replace function public.delete_chat_webhook(p_webhook_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  perform public.require_user();
  select w.workspace_id into v_workspace from public.chat_webhooks w where w.id = p_webhook_id;
  if v_workspace is null then
    return false;
  end if;
  if not public.is_workspace_admin(v_workspace) then
    raise exception 'Only workspace admins can remove apps.' using errcode = '42501';
  end if;
  delete from public.chat_webhooks w where w.id = p_webhook_id;
  return true;
end;
$$;

-- Server only: the link's id and secret must both match. The message has no
-- person as its sender; it carries the app's name, and never wakes an agent.
create or replace function public.post_webhook_message(
  p_webhook_id uuid,
  p_token text,
  p_body text,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hook public.chat_webhooks%rowtype;
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_name text := nullif(btrim(left(coalesce(p_name, ''), 60)), '');
  v_id uuid;
begin
  select * into v_hook from public.chat_webhooks w where w.id = p_webhook_id;
  if not found or v_hook.token_hash <> encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') then
    raise exception 'That webhook doesn''t exist.' using errcode = 'P0002';
  end if;
  if v_body = '' then
    raise exception 'Send some text to post.' using errcode = '22023';
  end if;

  -- A burst of 20, then a message every two seconds, per webhook.
  perform private.consume_rate_limit(v_hook.id, 'webhook', 20, 0.5);

  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (
    v_hook.conversation_id,
    null,
    'text',
    left(v_body, 4000),
    jsonb_build_object('source', 'webhook', 'webhook_id', v_hook.id, 'name', coalesce(v_name, v_hook.name))
  )
  returning id into v_id;

  update public.chat_webhooks w set last_used_at = now() where w.id = v_hook.id;
  return v_id;
end;
$$;

-- Outgoing ───────────────────────────────────────────────────────────────────

create table if not exists public.task_webhooks (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  url                text not null check (char_length(url) between 12 and 2000 and url ~ '^https://[^\s/?#]+'),
  format             text not null default 'json' check (format in ('json', 'slack', 'discord')),
  events             text[] not null
                     check (cardinality(events) between 1 and 4
                            and events <@ array['task.created', 'task.assigned', 'task.completed', 'task.updated']::text[]),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  last_delivered_at  timestamptz,
  last_status        integer
);

create index if not exists task_webhooks_workspace_idx on public.task_webhooks (workspace_id);

-- Signing secrets live where no client can read them.
create table if not exists private.task_webhook_secrets (
  webhook_id  uuid primary key references public.task_webhooks (id) on delete cascade,
  secret      text not null
);

alter table public.task_webhooks enable row level security;

drop policy if exists task_webhooks_select_admins on public.task_webhooks;
create policy task_webhooks_select_admins
  on public.task_webhooks for select to authenticated
  using (public.is_workspace_admin(workspace_id));

revoke all on public.task_webhooks from anon;
revoke insert, update, delete, truncate, references, trigger on public.task_webhooks from authenticated;
grant select on public.task_webhooks to authenticated;

create or replace function public.create_task_webhook(
  p_workspace_id uuid,
  p_name text,
  p_url text,
  p_format text,
  p_events text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_url text := btrim(coalesce(p_url, ''));
  v_events text[] := array(select distinct e from unnest(coalesce(p_events, '{}'::text[])) as e order by e);
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_row public.task_webhooks%rowtype;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only workspace admins can connect apps.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'Give the webhook a name of up to 60 characters.' using errcode = '22023';
  end if;
  if char_length(v_url) not between 12 and 2000 or v_url !~ '^https://[^\s/?#]+' then
    raise exception 'Use a full https:// address.' using errcode = '22023';
  end if;
  if coalesce(p_format, '') not in ('json', 'slack', 'discord') then
    raise exception 'Choose JSON, Slack or Discord.' using errcode = '22023';
  end if;
  if cardinality(v_events) = 0
    or not (v_events <@ array['task.created', 'task.assigned', 'task.completed', 'task.updated']::text[])
  then
    raise exception 'Choose at least one task event.' using errcode = '22023';
  end if;
  if (select count(*) from public.task_webhooks w where w.workspace_id = p_workspace_id) >= 20 then
    raise exception 'A workspace can have up to 20 task webhooks. Delete one you no longer use.' using errcode = '22023';
  end if;

  insert into public.task_webhooks (workspace_id, name, url, format, events, created_by)
  values (p_workspace_id, v_name, v_url, p_format, v_events, v_uid)
  returning * into v_row;
  insert into private.task_webhook_secrets (webhook_id, secret) values (v_row.id, v_secret);

  return to_jsonb(v_row) || jsonb_build_object('secret', v_secret);
end;
$$;

create or replace function public.delete_task_webhook(p_webhook_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  perform public.require_user();
  select w.workspace_id into v_workspace from public.task_webhooks w where w.id = p_webhook_id;
  if v_workspace is null then
    return false;
  end if;
  if not public.is_workspace_admin(v_workspace) then
    raise exception 'Only workspace admins can remove apps.' using errcode = '42501';
  end if;
  delete from public.task_webhooks w where w.id = p_webhook_id;
  return true;
end;
$$;

-- Server only: where a task event goes, with each address's signing secret.
-- With a webhook id, just that one, whatever it listens for (a test send).
create or replace function public.task_webhook_targets(p_workspace_id uuid, p_event text, p_webhook_id uuid default null)
returns table (id uuid, name text, url text, format text, secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.url, w.format, s.secret
    from public.task_webhooks w
    join private.task_webhook_secrets s on s.webhook_id = w.id
   where w.workspace_id = p_workspace_id
     and (case when p_webhook_id is null then p_event = any (w.events) else w.id = p_webhook_id end);
$$;

create or replace function public.record_task_webhook_delivery(p_webhook_id uuid, p_status integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.task_webhooks w
     set last_delivered_at = now(),
         last_status = p_status
   where w.id = p_webhook_id;
$$;

-- Privileges ─────────────────────────────────────────────────────────────────

revoke execute on function public.create_chat_webhook(uuid, text) from public, anon;
revoke execute on function public.delete_chat_webhook(uuid) from public, anon;
revoke execute on function public.create_task_webhook(uuid, text, text, text, text[]) from public, anon;
revoke execute on function public.delete_task_webhook(uuid) from public, anon;
grant execute on function public.create_chat_webhook(uuid, text) to authenticated;
grant execute on function public.delete_chat_webhook(uuid) to authenticated;
grant execute on function public.create_task_webhook(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.delete_task_webhook(uuid) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.post_webhook_message(uuid, text, text, text)',
    'public.task_webhook_targets(uuid, text, uuid)',
    'public.record_task_webhook_delivery(uuid, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
    begin
      execute format('grant execute on function %s to service_role', v_fn);
    exception
      when undefined_object then null;
    end;
  end loop;
end;
$$;

create or replace function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'time', now(), 'schema', 10);
$$;

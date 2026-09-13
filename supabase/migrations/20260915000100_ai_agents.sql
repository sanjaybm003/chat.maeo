-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 07 · AI agents and credits
--
--   • ai_agents       teammates made of instructions, a model and tools
--   • agent replies are ordinary messages with agent_id + meta.run, so unread
--     counts, search, previews and realtime fan-out keep working unchanged
--   • agent rooms     a private conversation between one person and one agent
--   • ai_runs         every model run with its token usage and credits
--   • credits         one account per workspace with hold → settle accounting:
--                     each model call holds its worst-case cost first, then
--                     settles to actual usage, so concurrent runs can never
--                     spend more than the balance
-- ─────────────────────────────────────────────────────────────────────────────

-- Agents ─────────────────────────────────────────────────────────────────────

create table if not exists public.ai_agents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  created_by    uuid references public.profiles (id) on delete set null,
  name          text not null check (char_length(btrim(name)) between 2 and 40),
  handle        text not null check (handle ~ '^[a-z][a-z0-9-]{1,22}[a-z0-9]$'),
  tagline       text not null default '' check (char_length(tagline) <= 120),
  instructions  text not null check (char_length(btrim(instructions)) between 20 and 8000),
  model         text not null check (model ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  tools         text[] not null default '{}' check (tools <@ array['history', 'search', 'directory', 'web']::text[]),
  starters      text[] not null default '{}' check (cardinality(starters) <= 4),
  color         text not null default 'iris'
                check (color in ('tomato', 'saffron', 'grass', 'lagoon', 'cobalt', 'iris', 'bubblegum', 'clay')),
  glyph         text not null default 'orbit' check (glyph in ('orbit', 'prism', 'wave', 'spark', 'grid', 'bloom')),
  visibility    text not null default 'workspace' check (visibility in ('workspace', 'private')),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists ai_agents_handle_unique
  on public.ai_agents (workspace_id, handle) where archived_at is null;
create index if not exists ai_agents_workspace_idx
  on public.ai_agents (workspace_id, created_at desc);

drop trigger if exists ai_agents_touch_updated_at on public.ai_agents;
create trigger ai_agents_touch_updated_at
  before update on public.ai_agents
  for each row execute function public.touch_updated_at();

-- Messages written by agents ─────────────────────────────────────────────────

alter table public.messages
  add column if not exists agent_id uuid references public.ai_agents (id) on delete set null;

create index if not exists messages_agent_idx on public.messages (agent_id) where agent_id is not null;

-- Agent replies may run longer than people's messages, and an unfinished reply
-- is legitimately empty. Only server-created rows carry meta.run: clients hold
-- no privilege on meta.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_body_length;
alter table public.messages add constraint messages_body_length check (
  char_length(body) <= 4000 or (meta ? 'run' and char_length(body) <= 16000)
);

alter table public.messages drop constraint if exists messages_has_content;
alter table public.messages add constraint messages_has_content check (
  deleted_at is not null
  or kind = 'system'
  or meta ? 'run'
  or char_length(btrim(body)) > 0
  or jsonb_array_length(attachments) > 0
);

-- Agent rooms ────────────────────────────────────────────────────────────────

alter table public.conversations
  add column if not exists agent_id uuid references public.ai_agents (id) on delete cascade,
  add column if not exists agent_key text unique;

alter table public.conversations drop constraint if exists conversations_agent_room;
alter table public.conversations add constraint conversations_agent_room check (
  (agent_id is null) = (agent_key is null) and (agent_id is null or kind = 'group')
);

-- Runs ───────────────────────────────────────────────────────────────────────

create table if not exists public.ai_runs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  kind                text not null check (kind in ('reply', 'architect')),
  agent_id            uuid references public.ai_agents (id) on delete set null,
  conversation_id     uuid references public.conversations (id) on delete cascade,
  trigger_message_id  uuid references public.messages (id) on delete set null,
  reply_message_id    uuid references public.messages (id) on delete set null,
  triggered_by        uuid references public.profiles (id) on delete set null,
  model               text not null,
  status              text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  cancel_requested    boolean not null default false,
  steps               jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  tool_calls          integer not null default 0,
  credits_reserved    bigint not null default 0 check (credits_reserved >= 0),
  credits_charged     bigint not null default 0 check (credits_charged >= 0),
  error               text check (error is null or char_length(error) <= 500),
  created_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create unique index if not exists ai_runs_one_reply_per_trigger
  on public.ai_runs (trigger_message_id, agent_id) where trigger_message_id is not null;
create index if not exists ai_runs_workspace_created_idx on public.ai_runs (workspace_id, created_at desc);
create index if not exists ai_runs_running_idx on public.ai_runs (created_at) where status = 'running';

-- Credits ────────────────────────────────────────────────────────────────────

create table if not exists public.ai_credit_accounts (
  workspace_id      uuid primary key references public.workspaces (id) on delete cascade,
  balance           bigint not null default 0 check (balance >= 0),
  reserved          bigint not null default 0 check (reserved >= 0),
  lifetime_granted  bigint not null default 0,
  lifetime_used     bigint not null default 0,
  updated_at        timestamptz not null default now()
);

create table if not exists public.ai_credit_ledger (
  id             bigint generated always as identity primary key,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  delta          bigint not null,
  balance_after  bigint not null,
  kind           text not null check (kind in ('grant', 'charge', 'refund', 'adjustment')),
  run_id         uuid,
  actor_id       uuid references public.profiles (id) on delete set null,
  note           text check (note is null or char_length(note) <= 200),
  created_at     timestamptz not null default now()
);

create index if not exists ai_credit_ledger_workspace_idx on public.ai_credit_ledger (workspace_id, created_at desc);

-- Every workspace starts with 10,000 credits.
create or replace function private.grant_workspace_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_credit_accounts (workspace_id, balance, lifetime_granted)
  values (new.id, 10000, 10000)
  on conflict (workspace_id) do nothing;

  if found then
    insert into public.ai_credit_ledger (workspace_id, delta, balance_after, kind, note)
    values (new.id, 10000, 10000, 'grant', 'Starting credits');
  end if;
  return null;
end;
$$;

drop trigger if exists workspaces_grant_credits on public.workspaces;
create trigger workspaces_grant_credits
  after insert on public.workspaces
  for each row execute function private.grant_workspace_credits();

with created as (
  insert into public.ai_credit_accounts (workspace_id, balance, lifetime_granted)
  select w.id, 10000, 10000 from public.workspaces w
  on conflict (workspace_id) do nothing
  returning workspace_id
)
insert into public.ai_credit_ledger (workspace_id, delta, balance_after, kind, note)
select created.workspace_id, 10000, 10000, 'grant', 'Starting credits' from created;

-- Row level security ─────────────────────────────────────────────────────────

alter table public.ai_agents          enable row level security;
alter table public.ai_runs            enable row level security;
alter table public.ai_credit_accounts enable row level security;
alter table public.ai_credit_ledger   enable row level security;

drop policy if exists ai_agents_select_visible on public.ai_agents;
create policy ai_agents_select_visible
  on public.ai_agents for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (visibility = 'workspace' or created_by = (select auth.uid()))
  );

drop policy if exists ai_agents_insert_own on public.ai_agents;
create policy ai_agents_insert_own
  on public.ai_agents for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_workspace_member(workspace_id));

drop policy if exists ai_agents_update_owner_or_admin on public.ai_agents;
create policy ai_agents_update_owner_or_admin
  on public.ai_agents for update to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_workspace_member(workspace_id)
    and (created_by = (select auth.uid()) or public.is_workspace_admin(workspace_id))
  );

drop policy if exists ai_runs_select_members on public.ai_runs;
create policy ai_runs_select_members
  on public.ai_runs for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists ai_credit_accounts_select_members on public.ai_credit_accounts;
create policy ai_credit_accounts_select_members
  on public.ai_credit_accounts for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists ai_credit_ledger_select_members on public.ai_credit_ledger;
create policy ai_credit_ledger_select_members
  on public.ai_credit_ledger for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.ai_agents, public.ai_runs, public.ai_credit_accounts, public.ai_credit_ledger from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.ai_agents, public.ai_runs, public.ai_credit_accounts, public.ai_credit_ledger
  from authenticated;
grant select on public.ai_agents, public.ai_runs, public.ai_credit_accounts, public.ai_credit_ledger to authenticated;

grant insert (workspace_id, created_by, name, handle, tagline, instructions, model, tools, starters, color, glyph, visibility)
  on public.ai_agents to authenticated;
grant update (name, handle, tagline, instructions, model, tools, starters, color, glyph, visibility, archived_at)
  on public.ai_agents to authenticated;

-- Message integrity, now agent-aware ─────────────────────────────────────────

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

    if new.kind = 'text' and new.sender_id is not null then
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

  -- Only foreign keys (ON DELETE SET NULL for a deleted account, agent or
  -- message) change these columns; clients hold no privilege on them.
  if new.sender_id is distinct from old.sender_id
    or new.reply_to_id is distinct from old.reply_to_id
    or new.agent_id is distinct from old.agent_id
  then
    return new;
  end if;

  -- Agent replies are written by the server while a run streams and finishes.
  if old.meta ? 'run' then
    new.id := old.id;
    new.conversation_id := old.conversation_id;
    new.sender_id := old.sender_id;
    new.agent_id := old.agent_id;
    new.kind := old.kind;
    new.reply_to_id := old.reply_to_id;
    new.created_at := old.created_at;
    new.edited_at := null;
    new.version := old.version + 1;
    new.updated_at := now();
    if not (new.meta ? 'run') then
      new.meta := new.meta || jsonb_build_object('run', old.meta -> 'run');
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
      new.body := '';
      new.attachments := '[]'::jsonb;
    end if;
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception 'This message was deleted.' using errcode = '22023';
  end if;

  new.id := old.id;
  new.conversation_id := old.conversation_id;
  new.sender_id := old.sender_id;
  new.agent_id := old.agent_id;
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

-- Status changes on agent replies are news too.
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
    and new.meta is not distinct from old.meta
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

-- An empty "thinking" placeholder is not worth a push notification.
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
  if new.kind <> 'text' or new.agent_id is not null or new.meta ? 'run' then
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

create or replace function private.reply_preview_json(p_message_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id,
    'sender_id', q.sender_id,
    'agent_id', q.agent_id,
    'body', left(q.body, 200),
    'attachment_count', jsonb_array_length(q.attachments),
    'deleted_at', q.deleted_at
  )
  from public.messages q
  where q.id = p_message_id;
$$;

-- Reads that now carry agent_id ──────────────────────────────────────────────

drop function if exists public.list_conversations(uuid, uuid);

create function public.list_conversations(
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
  last_message jsonb,
  agent_id uuid
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
    latest.message,
    c.agent_id
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  cross join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('user_id', cp.user_id, 'joined_at', cp.joined_at, 'last_read_at', cp.last_read_at)
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
      'agent_id', m.agent_id,
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
  agent_id uuid,
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
    m.id, m.conversation_id, m.sender_id, m.agent_id, m.kind, m.body, m.attachments, m.meta, m.reply_to_id,
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

drop function if exists public.get_message_changes(uuid, timestamptz, uuid, integer);

create function public.get_message_changes(
  p_conversation_id uuid,
  p_since timestamptz,
  p_since_id uuid default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  agent_id uuid,
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
    m.id, m.conversation_id, m.sender_id, m.agent_id, m.kind, m.body, m.attachments, m.meta, m.reply_to_id,
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
  rank real,
  agent_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select s.id, s.conversation_id, s.sender_id, s.body, s.created_at, s.rank, s.agent_id
  from private.ranked_message_search((select auth.uid()), p_workspace_id, p_query, p_limit) s;
end;
$$;

-- Shared by people's search and agents' search tool: the ranking lives in one place.
create or replace function private.ranked_message_search(
  p_user_id uuid,
  p_workspace_id uuid,
  p_query text,
  p_limit integer
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  rank real,
  agent_id uuid
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
  if p_user_id is null or char_length(v_query) < 2 then
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
    )::real,
    m.agent_id
  from public.messages m
  join public.conversation_participants me
    on me.conversation_id = m.conversation_id
   and me.user_id = p_user_id
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

revoke execute on function private.ranked_message_search(uuid, uuid, text, integer) from public, anon, authenticated;

-- Agent rooms ────────────────────────────────────────────────────────────────

create or replace function public.create_agent_conversation(p_agent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_agent public.ai_agents%rowtype;
  v_key text;
  v_id uuid;
begin
  select * into v_agent from public.ai_agents a where a.id = p_agent_id and a.archived_at is null;
  if not found
    or not public.is_workspace_member(v_agent.workspace_id)
    or (v_agent.visibility = 'private' and v_agent.created_by is distinct from v_uid)
  then
    raise exception 'Agent not found.' using errcode = '42501';
  end if;

  v_key := v_agent.id::text || ':' || v_uid::text;

  insert into public.conversations (workspace_id, kind, created_by, agent_id, agent_key)
  values (v_agent.workspace_id, 'group', v_uid, v_agent.id, v_key)
  on conflict (agent_key) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.conversations c where c.agent_key = v_key;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_id, v_uid)
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end;
$$;

create or replace function public.cancel_ai_run(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.ai_runs r
     set cancel_requested = true
   where r.id = p_run_id
     and r.status = 'running'
     and (r.triggered_by = v_uid or public.is_workspace_admin(r.workspace_id));
  return found;
end;
$$;

create or replace function public.ai_usage_summary(
  p_workspace_id uuid,
  p_days integer default 30,
  p_time_zone text default 'UTC'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
  v_since timestamptz;
  v_result jsonb;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace not found.' using errcode = '42501';
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_zone) then
    v_zone := 'UTC';
  end if;

  v_since := (date_trunc('day', now() at time zone v_zone) - make_interval(days => v_days - 1)) at time zone v_zone;

  select jsonb_build_object(
    'time_zone', v_zone,
    'since', v_since,
    'account', (
      select jsonb_build_object(
        'balance', a.balance,
        'reserved', a.reserved,
        'lifetime_granted', a.lifetime_granted,
        'lifetime_used', a.lifetime_used
      )
      from public.ai_credit_accounts a where a.workspace_id = p_workspace_id
    ),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'credits', d.credits, 'runs', d.runs) order by d.day)
      from (
        select (r.created_at at time zone v_zone)::date as day, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        where r.workspace_id = p_workspace_id and r.created_at >= v_since
        group by 1
      ) d
    ), '[]'::jsonb),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('agent_id', g.agent_id, 'credits', g.credits, 'runs', g.runs) order by g.credits desc)
      from (
        select r.agent_id, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        where r.workspace_id = p_workspace_id and r.created_at >= v_since
        group by r.agent_id
      ) g
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('model', g.model, 'credits', g.credits, 'runs', g.runs) order by g.credits desc)
      from (
        select r.model, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        where r.workspace_id = p_workspace_id and r.created_at >= v_since
        group by r.model
      ) g
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', g.user_id, 'credits', g.credits, 'runs', g.runs) order by g.credits desc)
      from (
        select r.triggered_by as user_id, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        where r.workspace_id = p_workspace_id and r.created_at >= v_since
        group by r.triggered_by
      ) g
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Server-only run lifecycle ──────────────────────────────────────────────────
-- Called with the service role by the app's AI routes, never by browsers.

create or replace function public.ai_start_reply_run(
  p_user_id uuid,
  p_trigger_message_id uuid,
  p_agent_id uuid,
  p_model text,
  p_quote boolean default false
)
returns table (
  o_run_id uuid,
  o_reply_message_id uuid,
  o_conversation_id uuid,
  o_workspace_id uuid,
  o_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message record;
  v_workspace_id uuid;
  v_agent public.ai_agents%rowtype;
  v_existing record;
  v_balance bigint;
  v_run_id uuid := gen_random_uuid();
  v_reply_id uuid;
begin
  select m.id, m.conversation_id, m.sender_id, m.kind, m.deleted_at, m.created_at
    into v_message
    from public.messages m
   where m.id = p_trigger_message_id;

  if not found
    or v_message.sender_id is distinct from p_user_id
    or v_message.kind <> 'text'
    or v_message.deleted_at is not null
  then
    raise exception 'That message can''t start an agent reply.' using errcode = '22023';
  end if;
  if v_message.created_at < now() - interval '15 minutes' then
    raise exception 'That message is too old for an agent to reply to.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_message.conversation_id and cp.user_id = p_user_id
  ) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;

  select c.workspace_id into v_workspace_id from public.conversations c where c.id = v_message.conversation_id;

  select * into v_agent
    from public.ai_agents a
   where a.id = p_agent_id and a.workspace_id = v_workspace_id and a.archived_at is null;
  if not found or (v_agent.visibility = 'private' and v_agent.created_by is distinct from p_user_id) then
    raise exception 'Agent not found.' using errcode = '42501';
  end if;

  select r.id, r.reply_message_id into v_existing
    from public.ai_runs r
   where r.trigger_message_id = p_trigger_message_id and r.agent_id = p_agent_id;
  if found then
    o_run_id := v_existing.id;
    o_reply_message_id := v_existing.reply_message_id;
    o_conversation_id := v_message.conversation_id;
    o_workspace_id := v_workspace_id;
    o_created := false;
    return next;
    return;
  end if;

  perform private.consume_rate_limit(p_user_id, 'agent_run', 20, 0.2);

  select a.balance into v_balance from public.ai_credit_accounts a where a.workspace_id = v_workspace_id;
  if coalesce(v_balance, 0) < 1 then
    raise exception 'This workspace is out of AI credits.' using errcode = 'P0402';
  end if;

  insert into public.messages (conversation_id, sender_id, agent_id, body, meta, reply_to_id)
  values (
    v_message.conversation_id,
    null,
    p_agent_id,
    '',
    jsonb_build_object('run', v_run_id, 'status', 'thinking', 'model', p_model, 'by', p_user_id),
    case when p_quote then p_trigger_message_id end
  )
  returning id into v_reply_id;

  insert into public.ai_runs (
    id, workspace_id, kind, agent_id, conversation_id, trigger_message_id, reply_message_id, triggered_by, model
  )
  values (
    v_run_id, v_workspace_id, 'reply', p_agent_id, v_message.conversation_id, p_trigger_message_id, v_reply_id, p_user_id, p_model
  );

  o_run_id := v_run_id;
  o_reply_message_id := v_reply_id;
  o_conversation_id := v_message.conversation_id;
  o_workspace_id := v_workspace_id;
  o_created := true;
  return next;
end;
$$;

create or replace function public.ai_start_architect_run(
  p_user_id uuid,
  p_workspace_id uuid,
  p_model text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_run_id uuid;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'Workspace not found.' using errcode = '42501';
  end if;

  perform private.consume_rate_limit(p_user_id, 'agent_architect', 10, 0.05);

  select a.balance into v_balance from public.ai_credit_accounts a where a.workspace_id = p_workspace_id;
  if coalesce(v_balance, 0) < 1 then
    raise exception 'This workspace is out of AI credits.' using errcode = 'P0402';
  end if;

  insert into public.ai_runs (workspace_id, kind, triggered_by, model)
  values (p_workspace_id, 'architect', p_user_id, p_model)
  returning id into v_run_id;

  return v_run_id;
end;
$$;

-- Holds up to p_amount credits for the next model call. When the balance can't
-- cover the whole estimate but still covers p_minimum, holds what's there.
-- Returns the credits held; 0 means the run can't afford another call.
create or replace function public.ai_reserve_credits(
  p_run_id uuid,
  p_amount bigint,
  p_minimum bigint default 1
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_balance bigint;
  v_hold bigint;
begin
  if coalesce(p_amount, 0) <= 0 then
    return 0;
  end if;

  select r.workspace_id into v_workspace_id
    from public.ai_runs r
   where r.id = p_run_id and r.status = 'running'
   for update;
  if v_workspace_id is null then
    return 0;
  end if;

  select a.balance into v_balance
    from public.ai_credit_accounts a
   where a.workspace_id = v_workspace_id
   for update;

  v_hold := least(p_amount, coalesce(v_balance, 0));
  if v_hold < greatest(coalesce(p_minimum, 1), 1) then
    return 0;
  end if;

  update public.ai_credit_accounts a
     set balance = a.balance - v_hold,
         reserved = a.reserved + v_hold,
         updated_at = now()
   where a.workspace_id = v_workspace_id;

  update public.ai_runs r
     set credits_reserved = r.credits_reserved + v_hold
   where r.id = p_run_id;

  return v_hold;
end;
$$;

-- Converts the run's current hold into the real charge: refunds the unused
-- part, or takes a bounded top-up from the balance when usage ran over.
create or replace function public.ai_settle_credits(
  p_run_id uuid,
  p_credits bigint,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_tool_calls integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ai_runs%rowtype;
  v_account public.ai_credit_accounts%rowtype;
  v_held bigint;
  v_charge bigint := greatest(coalesce(p_credits, 0), 0);
begin
  select * into v_run from public.ai_runs r where r.id = p_run_id for update;
  if not found then
    return 0;
  end if;

  select * into v_account from public.ai_credit_accounts a where a.workspace_id = v_run.workspace_id for update;
  if not found then
    return 0;
  end if;

  v_held := least(v_run.credits_reserved, v_account.reserved);
  if v_charge > v_held then
    v_charge := v_held + least(v_charge - v_held, v_account.balance);
  end if;

  update public.ai_credit_accounts a
     set reserved = a.reserved - v_held,
         balance = a.balance + v_held - v_charge,
         lifetime_used = a.lifetime_used + v_charge,
         updated_at = now()
   where a.workspace_id = v_run.workspace_id
  returning a.* into v_account;

  update public.ai_runs r
     set credits_reserved = greatest(r.credits_reserved - v_held, 0),
         credits_charged = r.credits_charged + v_charge,
         input_tokens = r.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
         output_tokens = r.output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
         tool_calls = r.tool_calls + greatest(coalesce(p_tool_calls, 0), 0)
   where r.id = p_run_id;

  if v_charge > 0 then
    insert into public.ai_credit_ledger (workspace_id, delta, balance_after, kind, run_id, actor_id)
    values (v_run.workspace_id, -v_charge, v_account.balance, 'charge', p_run_id, v_run.triggered_by);
  end if;

  perform public.realtime_notify_workspace(
    v_run.workspace_id, 'credits.changed', jsonb_build_object('balance', v_account.balance)
  );

  return v_charge;
end;
$$;

-- Ends a run exactly once: releases any unsettled hold, records the outcome,
-- and writes the final text onto the agent's reply.
create or replace function public.ai_finish_run(
  p_run_id uuid,
  p_status text,
  p_body text default null,
  p_steps jsonb default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ai_runs%rowtype;
begin
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'Unknown run status %.', p_status using errcode = '22023';
  end if;

  select * into v_run from public.ai_runs r where r.id = p_run_id for update;
  if not found or v_run.status <> 'running' then
    return false;
  end if;

  if v_run.credits_reserved > 0 then
    update public.ai_credit_accounts a
       set balance = a.balance + least(v_run.credits_reserved, a.reserved),
           reserved = a.reserved - least(v_run.credits_reserved, a.reserved),
           updated_at = now()
     where a.workspace_id = v_run.workspace_id;
  end if;

  update public.ai_runs r
     set status = p_status,
         error = left(p_error, 500),
         steps = coalesce(p_steps, r.steps),
         credits_reserved = 0,
         finished_at = now()
   where r.id = p_run_id;

  if v_run.reply_message_id is not null then
    update public.messages m
       set body = case when p_body is null then m.body else left(p_body, 16000) end,
           meta = m.meta || jsonb_build_object(
             'status', case p_status when 'succeeded' then 'done' else p_status end,
             'steps', coalesce(p_steps, v_run.steps),
             'credits', v_run.credits_charged,
             'error', left(p_error, 500)
           )
     where m.id = v_run.reply_message_id
       and m.deleted_at is null;
  end if;

  return true;
end;
$$;

-- Runs whose server died mid-flight: fail them and give their holds back.
create or replace function public.ai_fail_stale_runs(p_workspace_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select s.id
    from public.ai_runs s
    where s.status = 'running'
      and s.created_at < now() - interval '6 minutes'
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
    for update skip locked
  loop
    if public.ai_finish_run(r.id, 'failed', null, null, 'This reply stopped before it finished.') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Live text for everyone viewing the conversation while a reply streams.
create or replace function public.ai_broadcast(p_conversation_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, 'agent.stream', 'conversation:' || p_conversation_id::text, true);
end;
$$;

-- The agents' search tool: ranked like people's search and run as the person
-- who asked, but it only returns messages that everyone in the conversation
-- being answered can already read. A reply is seen by that whole audience, so
-- an agent can never carry a private message into a room where someone else
-- would see it, not even when a message in that room tells it to.
drop function if exists public.ai_search_messages_for(uuid, uuid, text, integer);

create or replace function public.ai_search_messages_for(
  p_user_id uuid,
  p_workspace_id uuid,
  p_audience_conversation_id uuid,
  p_query text,
  p_limit integer default 10
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  rank real,
  agent_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversation_participants asker
    where asker.conversation_id = p_audience_conversation_id and asker.user_id = p_user_id
  ) then
    return;
  end if;

  return query
  select s.id, s.conversation_id, s.sender_id, s.body, s.created_at, s.rank, s.agent_id
  from private.ranked_message_search(p_user_id, p_workspace_id, p_query, 50) s
  where not exists (
    select 1
    from public.conversation_participants audience
    where audience.conversation_id = p_audience_conversation_id
      and not exists (
        select 1 from public.conversation_participants reader
        where reader.conversation_id = s.conversation_id
          and reader.user_id = audience.user_id
      )
  )
  order by s.rank desc, s.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.ai_start_reply_run(uuid, uuid, uuid, text, boolean)',
    'public.ai_start_architect_run(uuid, uuid, text)',
    'public.ai_reserve_credits(uuid, bigint, bigint)',
    'public.ai_settle_credits(uuid, bigint, integer, integer, integer)',
    'public.ai_finish_run(uuid, text, text, jsonb, text)',
    'public.ai_fail_stale_runs(uuid)',
    'public.ai_broadcast(uuid, jsonb)',
    'public.ai_search_messages_for(uuid, uuid, uuid, text, integer)'
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

-- Hints for everyone in the workspace ────────────────────────────────────────

create or replace function private.realtime_on_agent_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.realtime_notify_workspace(
    new.workspace_id, 'agent.changed', jsonb_build_object('agent_id', new.id)
  );
  return null;
end;
$$;

drop trigger if exists ai_agents_realtime on public.ai_agents;
create trigger ai_agents_realtime
  after insert or update on public.ai_agents
  for each row execute function private.realtime_on_agent_changed();

do $$
begin
  perform cron.schedule('maeosan-ai-stale-runs', '*/5 * * * *', 'select public.ai_fail_stale_runs()');
exception
  when others then
    raise notice 'pg_cron is unavailable (%); stale AI runs are cleaned up when the next run starts.', sqlerrm;
end;
$$;

create or replace function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'time', now(), 'schema', 7);
$$;

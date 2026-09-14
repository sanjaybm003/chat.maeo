-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 08 · Credits per person, agents in any chat, sharper agents
--
--   • ai_wallets           credits belong to each account and follow the person
--                          across workspaces: 10,000 at signup, spent only by
--                          whoever asks an agent
--   • conversation_agents  agents join chats alongside the team
--   • agents gain a specialty, team knowledge, a reply style and an automatic
--     model mode; every run records how its model was chosen
-- ─────────────────────────────────────────────────────────────────────────────

-- Wallets ────────────────────────────────────────────────────────────────────

create table if not exists public.ai_wallets (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  balance           bigint not null default 0 check (balance >= 0),
  reserved          bigint not null default 0 check (reserved >= 0),
  lifetime_granted  bigint not null default 0,
  lifetime_used     bigint not null default 0,
  updated_at        timestamptz not null default now()
);

create table if not exists public.ai_wallet_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  delta          bigint not null,
  balance_after  bigint not null,
  kind           text not null check (kind in ('grant', 'charge', 'refund', 'adjustment')),
  run_id         uuid,
  workspace_id   uuid references public.workspaces (id) on delete set null,
  note           text check (note is null or char_length(note) <= 200),
  created_at     timestamptz not null default now()
);

create index if not exists ai_wallet_ledger_user_idx on public.ai_wallet_ledger (user_id, created_at desc);

-- Every account starts with 10,000 credits.
create or replace function private.grant_starting_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_wallets (user_id, balance, lifetime_granted)
  values (new.id, 10000, 10000)
  on conflict (user_id) do nothing;

  if found then
    insert into public.ai_wallet_ledger (user_id, delta, balance_after, kind, note)
    values (new.id, 10000, 10000, 'grant', 'Starting credits');
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_grant_credits on public.profiles;
create trigger profiles_grant_credits
  after insert on public.profiles
  for each row execute function private.grant_starting_credits();

with created as (
  insert into public.ai_wallets (user_id, balance, lifetime_granted)
  select p.id, 10000, 10000 from public.profiles p
  on conflict (user_id) do nothing
  returning user_id
)
insert into public.ai_wallet_ledger (user_id, delta, balance_after, kind, note)
select created.user_id, 10000, 10000, 'grant', 'Starting credits' from created;

alter table public.ai_wallets       enable row level security;
alter table public.ai_wallet_ledger enable row level security;

drop policy if exists ai_wallets_select_own on public.ai_wallets;
create policy ai_wallets_select_own
  on public.ai_wallets for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_wallet_ledger_select_own on public.ai_wallet_ledger;
create policy ai_wallet_ledger_select_own
  on public.ai_wallet_ledger for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.ai_wallets, public.ai_wallet_ledger from anon;
revoke insert, update, delete, truncate, references, trigger on public.ai_wallets, public.ai_wallet_ledger from authenticated;
grant select on public.ai_wallets, public.ai_wallet_ledger to authenticated;

-- Workspace credit accounts are retired in favour of wallets.
drop trigger if exists workspaces_grant_credits on public.workspaces;
drop function if exists private.grant_workspace_credits();
drop function if exists public.ai_usage_summary(uuid, integer, text);
drop table if exists public.ai_credit_ledger;
drop table if exists public.ai_credit_accounts;

-- Sharper agents ─────────────────────────────────────────────────────────────

alter table public.ai_agents
  add column if not exists specialty text not null default 'assistant',
  add column if not exists response_style text not null default 'balanced',
  add column if not exists knowledge text not null default '',
  -- Agents made before automatic routing keep the model their maker picked.
  add column if not exists model_mode text not null default 'fixed';

alter table public.ai_agents alter column model_mode set default 'auto';

alter table public.ai_agents drop constraint if exists ai_agents_specialty_check;
alter table public.ai_agents add constraint ai_agents_specialty_check
  check (specialty in ('assistant', 'research', 'writing', 'analysis', 'planning', 'support', 'engineering'));

alter table public.ai_agents drop constraint if exists ai_agents_response_style_check;
alter table public.ai_agents add constraint ai_agents_response_style_check
  check (response_style in ('concise', 'balanced', 'detailed'));

alter table public.ai_agents drop constraint if exists ai_agents_model_mode_check;
alter table public.ai_agents add constraint ai_agents_model_mode_check
  check (model_mode in ('auto', 'fixed'));

alter table public.ai_agents drop constraint if exists ai_agents_knowledge_length;
alter table public.ai_agents add constraint ai_agents_knowledge_length
  check (char_length(knowledge) <= 8000);

grant insert (specialty, response_style, knowledge, model_mode) on public.ai_agents to authenticated;
grant update (specialty, response_style, knowledge, model_mode) on public.ai_agents to authenticated;

-- Runs: private to the person who asked, with the routing decision kept ─────

alter table public.ai_runs add column if not exists route jsonb not null default '{}'::jsonb;
alter table public.ai_runs drop constraint if exists ai_runs_route_object;
alter table public.ai_runs add constraint ai_runs_route_object check (jsonb_typeof(route) = 'object');

create index if not exists ai_runs_triggered_by_idx on public.ai_runs (triggered_by, created_at desc);

drop policy if exists ai_runs_select_members on public.ai_runs;
drop policy if exists ai_runs_select_own on public.ai_runs;
create policy ai_runs_select_own
  on public.ai_runs for select to authenticated
  using (triggered_by = (select auth.uid()));

-- Agents in chats ────────────────────────────────────────────────────────────

create table if not exists public.conversation_agents (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  agent_id         uuid not null references public.ai_agents (id) on delete cascade,
  added_by         uuid references public.profiles (id) on delete set null,
  added_at         timestamptz not null default now(),
  primary key (conversation_id, agent_id)
);

create index if not exists conversation_agents_agent_idx on public.conversation_agents (agent_id);

alter table public.conversation_agents enable row level security;

drop policy if exists conversation_agents_select_participants on public.conversation_agents;
create policy conversation_agents_select_participants
  on public.conversation_agents for select to authenticated
  using (public.is_conversation_participant(conversation_id));

revoke all on public.conversation_agents from anon;
revoke insert, update, delete, truncate, references, trigger on public.conversation_agents from authenticated;
grant select on public.conversation_agents to authenticated;

create or replace function private.notify_conversation_changed(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
begin
  select array_agg(cp.user_id) into v_users
    from public.conversation_participants cp
   where cp.conversation_id = p_conversation_id;
  perform public.realtime_notify_users(
    v_users, 'conversation.changed', jsonb_build_object('conversation_id', p_conversation_id)
  );
end;
$$;

-- Any participant can bring a shared agent into the chat. Private agents stay
-- with their maker, and an agent's own room already has its agent.
create or replace function public.add_agent_to_conversation(p_conversation_id uuid, p_agent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_conversation public.conversations%rowtype;
  v_agent public.ai_agents%rowtype;
begin
  select * into v_conversation from public.conversations c where c.id = p_conversation_id;
  if not found or not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  if v_conversation.agent_id is not null then
    raise exception 'This is already a private chat with an agent.' using errcode = '22023';
  end if;

  select * into v_agent
    from public.ai_agents a
   where a.id = p_agent_id and a.workspace_id = v_conversation.workspace_id and a.archived_at is null;
  if not found or (v_agent.visibility = 'private' and v_agent.created_by is distinct from v_uid) then
    raise exception 'Agent not found.' using errcode = '42501';
  end if;
  if v_agent.visibility = 'private' then
    raise exception 'Only agents shared with the workspace can join chats.' using errcode = '22023';
  end if;

  insert into public.conversation_agents (conversation_id, agent_id, added_by)
  values (p_conversation_id, p_agent_id, v_uid)
  on conflict (conversation_id, agent_id) do nothing;
  if not found then
    return false;
  end if;

  perform public.post_system_message(
    p_conversation_id, v_uid, 'agent_added', jsonb_build_object('agent_id', v_agent.id, 'name', v_agent.name)
  );
  perform private.notify_conversation_changed(p_conversation_id);
  return true;
end;
$$;

create or replace function public.remove_agent_from_conversation(p_conversation_id uuid, p_agent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_name text;
begin
  if not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;

  delete from public.conversation_agents ca
   where ca.conversation_id = p_conversation_id and ca.agent_id = p_agent_id;
  if not found then
    return false;
  end if;

  select a.name into v_name from public.ai_agents a where a.id = p_agent_id;
  perform public.post_system_message(
    p_conversation_id, v_uid, 'agent_removed', jsonb_build_object('agent_id', p_agent_id, 'name', v_name)
  );
  perform private.notify_conversation_changed(p_conversation_id);
  return true;
end;
$$;

-- An agent that goes private or is archived quietly leaves every shared chat.
create or replace function private.remove_agent_from_shared_chats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversations uuid[];
  v_conversation uuid;
begin
  if new.visibility <> 'private' and new.archived_at is null then
    return null;
  end if;

  with removed as (
    delete from public.conversation_agents ca where ca.agent_id = new.id returning ca.conversation_id
  )
  select array_agg(removed.conversation_id) into v_conversations from removed;

  if v_conversations is not null then
    foreach v_conversation in array v_conversations loop
      perform private.notify_conversation_changed(v_conversation);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists ai_agents_leave_shared_chats on public.ai_agents;
create trigger ai_agents_leave_shared_chats
  after update of visibility, archived_at on public.ai_agents
  for each row execute function private.remove_agent_from_shared_chats();

-- The chat list now says which agents are in each chat.
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
  agent_id uuid,
  agent_ids uuid[]
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
    c.agent_id,
    coalesce(
      (select array_agg(ca.agent_id order by ca.added_at) from public.conversation_agents ca where ca.conversation_id = c.id),
      '{}'::uuid[]
    )
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

-- Run lifecycle, billed to the asker's wallet ────────────────────────────────

drop function if exists public.ai_start_reply_run(uuid, uuid, uuid, text, boolean);

create or replace function public.ai_start_reply_run(
  p_user_id uuid,
  p_trigger_message_id uuid,
  p_agent_id uuid,
  p_model text,
  p_quote boolean default false,
  p_route jsonb default '{}'::jsonb
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
  v_route jsonb := case when jsonb_typeof(p_route) = 'object' then p_route else '{}'::jsonb end;
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

  select w.balance into v_balance from public.ai_wallets w where w.user_id = p_user_id;
  if coalesce(v_balance, 0) < 1 then
    raise exception 'You''re out of AI credits.' using errcode = 'P0402';
  end if;

  insert into public.messages (conversation_id, sender_id, agent_id, body, meta, reply_to_id)
  values (
    v_message.conversation_id,
    null,
    p_agent_id,
    '',
    jsonb_build_object('run', v_run_id, 'status', 'thinking', 'model', p_model, 'by', p_user_id, 'route', v_route),
    case when p_quote then p_trigger_message_id end
  )
  returning id into v_reply_id;

  insert into public.ai_runs (
    id, workspace_id, kind, agent_id, conversation_id, trigger_message_id, reply_message_id, triggered_by, model, route
  )
  values (
    v_run_id, v_workspace_id, 'reply', p_agent_id, v_message.conversation_id, p_trigger_message_id, v_reply_id, p_user_id, p_model, v_route
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

  select w.balance into v_balance from public.ai_wallets w where w.user_id = p_user_id;
  if coalesce(v_balance, 0) < 1 then
    raise exception 'You''re out of AI credits.' using errcode = 'P0402';
  end if;

  insert into public.ai_runs (workspace_id, kind, triggered_by, model)
  values (p_workspace_id, 'architect', p_user_id, p_model)
  returning id into v_run_id;

  return v_run_id;
end;
$$;

-- Holds up to p_amount credits from the asker's wallet for the next model
-- call; when the wallet can't cover it but still covers p_minimum, holds what
-- is there. Returns the credits held; 0 means no further call is affordable.
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
  v_user uuid;
  v_balance bigint;
  v_hold bigint;
begin
  if coalesce(p_amount, 0) <= 0 then
    return 0;
  end if;

  select r.triggered_by into v_user
    from public.ai_runs r
   where r.id = p_run_id and r.status = 'running'
   for update;
  if v_user is null then
    return 0;
  end if;

  select w.balance into v_balance
    from public.ai_wallets w
   where w.user_id = v_user
   for update;

  v_hold := least(p_amount, coalesce(v_balance, 0));
  if v_hold < greatest(coalesce(p_minimum, 1), 1) then
    return 0;
  end if;

  update public.ai_wallets w
     set balance = w.balance - v_hold,
         reserved = w.reserved + v_hold,
         updated_at = now()
   where w.user_id = v_user;

  update public.ai_runs r
     set credits_reserved = r.credits_reserved + v_hold
   where r.id = p_run_id;

  return v_hold;
end;
$$;

-- Turns the run's hold into the real charge: refunds the unused part, or takes
-- a bounded top-up from the wallet when usage ran over the estimate.
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
  v_wallet public.ai_wallets%rowtype;
  v_held bigint;
  v_charge bigint := greatest(coalesce(p_credits, 0), 0);
begin
  select * into v_run from public.ai_runs r where r.id = p_run_id for update;
  if not found or v_run.triggered_by is null then
    return 0;
  end if;

  select * into v_wallet from public.ai_wallets w where w.user_id = v_run.triggered_by for update;
  if not found then
    return 0;
  end if;

  v_held := least(v_run.credits_reserved, v_wallet.reserved);
  if v_charge > v_held then
    v_charge := v_held + least(v_charge - v_held, v_wallet.balance);
  end if;

  update public.ai_wallets w
     set reserved = w.reserved - v_held,
         balance = w.balance + v_held - v_charge,
         lifetime_used = w.lifetime_used + v_charge,
         updated_at = now()
   where w.user_id = v_run.triggered_by
  returning w.* into v_wallet;

  update public.ai_runs r
     set credits_reserved = greatest(r.credits_reserved - v_held, 0),
         credits_charged = r.credits_charged + v_charge,
         input_tokens = r.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
         output_tokens = r.output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
         tool_calls = r.tool_calls + greatest(coalesce(p_tool_calls, 0), 0)
   where r.id = p_run_id;

  if v_charge > 0 then
    insert into public.ai_wallet_ledger (user_id, delta, balance_after, kind, run_id, workspace_id)
    values (v_run.triggered_by, -v_charge, v_wallet.balance, 'charge', p_run_id, v_run.workspace_id);
  end if;

  perform public.realtime_notify_users(
    array[v_run.triggered_by], 'credits.changed', jsonb_build_object('balance', v_wallet.balance)
  );

  return v_charge;
end;
$$;

-- Ends a run exactly once: returns any unsettled hold to the wallet, records
-- the outcome, and writes the final text onto the agent's reply.
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
  v_balance bigint;
begin
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'Unknown run status %.', p_status using errcode = '22023';
  end if;

  select * into v_run from public.ai_runs r where r.id = p_run_id for update;
  if not found or v_run.status <> 'running' then
    return false;
  end if;

  if v_run.credits_reserved > 0 and v_run.triggered_by is not null then
    update public.ai_wallets w
       set balance = w.balance + least(v_run.credits_reserved, w.reserved),
           reserved = w.reserved - least(v_run.credits_reserved, w.reserved),
           updated_at = now()
     where w.user_id = v_run.triggered_by
    returning w.balance into v_balance;

    if v_balance is not null then
      perform public.realtime_notify_users(
        array[v_run.triggered_by], 'credits.changed', jsonb_build_object('balance', v_balance)
      );
    end if;
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

-- Usage for the signed-in person across every workspace.
create or replace function public.ai_my_usage(
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
  v_uid uuid := public.require_user();
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'UTC');
  v_since timestamptz;
  v_result jsonb;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_zone) then
    v_zone := 'UTC';
  end if;

  v_since := (date_trunc('day', now() at time zone v_zone) - make_interval(days => v_days - 1)) at time zone v_zone;

  select jsonb_build_object(
    'time_zone', v_zone,
    'since', v_since,
    'account', (
      select jsonb_build_object(
        'balance', w.balance,
        'reserved', w.reserved,
        'lifetime_granted', w.lifetime_granted,
        'lifetime_used', w.lifetime_used
      )
      from public.ai_wallets w where w.user_id = v_uid
    ),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'credits', d.credits, 'runs', d.runs) order by d.day)
      from (
        select (r.created_at at time zone v_zone)::date as day, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        where r.triggered_by = v_uid and r.created_at >= v_since
        group by 1
      ) d
    ), '[]'::jsonb),
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('agent_id', g.agent_id, 'name', g.agent_name, 'credits', g.credits, 'runs', g.runs) order by g.credits desc)
      from (
        select r.agent_id, max(a.name) as agent_name, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        left join public.ai_agents a on a.id = r.agent_id
        where r.triggered_by = v_uid and r.created_at >= v_since
        group by r.agent_id
      ) g
    ), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object('model', g.model, 'credits', g.credits, 'runs', g.runs) order by g.credits desc)
      from (
        select r.model, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        where r.triggered_by = v_uid and r.created_at >= v_since
        group by r.model
      ) g
    ), '[]'::jsonb),
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object('workspace_id', g.workspace_id, 'name', g.workspace_name, 'credits', g.credits, 'runs', g.runs) order by g.credits desc)
      from (
        select r.workspace_id, max(ws.name) as workspace_name, sum(r.credits_charged)::bigint as credits, count(*)::int as runs
        from public.ai_runs r
        join public.workspaces ws on ws.id = r.workspace_id
        where r.triggered_by = v_uid and r.created_at >= v_since
        group by r.workspace_id
      ) g
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.ai_start_reply_run(uuid, uuid, uuid, text, boolean, jsonb)',
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

revoke execute on function private.notify_conversation_changed(uuid) from public, anon, authenticated;

create or replace function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'time', now(), 'schema', 8);
$$;

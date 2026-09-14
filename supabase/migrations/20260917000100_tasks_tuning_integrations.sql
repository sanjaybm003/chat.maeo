-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 09 · Tasks, finer-tuned agents and connected apps
--
--   • tasks                   numbered per workspace (T-1, T-2…), done by a person
--                             or an agent, made on the tasks page, with one key, or
--                             straight from chat, where they're announced
--   • agents gain rules, worked examples, a creativity setting and an optional
--     double-check of every reply, plus tools for tasks and GitHub
--   • workspace_integrations  apps an admin connected to the workspace, GitHub first
-- ─────────────────────────────────────────────────────────────────────────────

-- Tasks ──────────────────────────────────────────────────────────────────────

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  number            integer not null check (number > 0),
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  description       text not null default '' check (char_length(description) <= 8000),
  status            text not null default 'todo'
                    check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority          text not null default 'none'
                    check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  assignee_id       uuid references public.profiles (id) on delete set null,
  agent_id          uuid references public.ai_agents (id) on delete set null,
  due_on            date,
  conversation_id   uuid references public.conversations (id) on delete set null,
  message_id        uuid references public.messages (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null,
  created_by_agent  uuid references public.ai_agents (id) on delete set null,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  constraint tasks_one_assignee check (assignee_id is null or agent_id is null),
  constraint tasks_number_unique unique (workspace_id, number)
);

create index if not exists tasks_workspace_status_idx on public.tasks (workspace_id, status, updated_at desc);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;
create index if not exists tasks_agent_idx on public.tasks (agent_id) where agent_id is not null;
create index if not exists tasks_conversation_idx on public.tasks (conversation_id) where conversation_id is not null;

alter table public.tasks enable row level security;

-- Tasks are team work: everyone in the workspace sees them. Changes go through
-- the functions below so every rule is enforced in one place.
drop policy if exists tasks_select_members on public.tasks;
create policy tasks_select_members
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.tasks from anon;
revoke insert, update, delete, truncate, references, trigger on public.tasks from authenticated;
grant select on public.tasks to authenticated;

create table if not exists private.task_counters (
  workspace_id  uuid primary key references public.workspaces (id) on delete cascade,
  last_number   integer not null default 0
);

create or replace function private.uuid_or_null(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::uuid;
exception
  when invalid_text_representation then
    raise exception 'That isn''t a valid id.' using errcode = '22023';
end;
$$;

-- Every task change goes through here, whether a person makes it or an agent
-- makes it for the person who asked: membership, assignees and the chat link
-- are checked, numbers are handed out, the workspace hears about it live, and
-- the chat a task came from sees it created and finished.
create or replace function private.save_task(
  p_actor uuid,
  p_agent_id uuid,
  p_task_id uuid,
  p_workspace_id uuid,
  p_fields jsonb
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_creating boolean := p_task_id is null;
  v_old public.tasks%rowtype;
  v_task public.tasks%rowtype;
  v_workspace uuid;
  v_id uuid;
begin
  if p_actor is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_fields) <> 'object' then
    raise exception 'Task changes must be an object.' using errcode = '22023';
  end if;

  if v_creating then
    v_workspace := p_workspace_id;
  else
    select * into v_old from public.tasks t where t.id = p_task_id for update;
    if not found then
      raise exception 'Task not found.' using errcode = '42501';
    end if;
    v_workspace := v_old.workspace_id;
    v_task := v_old;
  end if;

  if v_workspace is null or not exists (
    select 1 from public.workspace_members wm where wm.workspace_id = v_workspace and wm.user_id = p_actor
  ) then
    raise exception 'Task not found.' using errcode = '42501';
  end if;

  if p_agent_id is not null and not exists (
    select 1
      from public.ai_agents a
     where a.id = p_agent_id
       and a.workspace_id = v_workspace
       and a.archived_at is null
       and (a.visibility = 'workspace' or a.created_by = p_actor)
  ) then
    raise exception 'Agent not found.' using errcode = '42501';
  end if;

  if v_creating then
    perform private.consume_rate_limit(p_actor, 'task', 40, 0.5);
    v_task.workspace_id := v_workspace;
    v_task.description := '';
    v_task.status := 'todo';
    v_task.priority := 'none';
    v_task.created_by := p_actor;
    v_task.created_by_agent := p_agent_id;
  end if;

  if v_creating or v_fields ? 'title' then
    v_task.title := btrim(coalesce(v_fields ->> 'title', ''), E' \t\r\n');
    if v_task.title = '' then
      raise exception 'Give the task a title.' using errcode = '22023';
    elsif char_length(v_task.title) > 200 then
      raise exception 'Keep the title under 200 characters.' using errcode = '22023';
    end if;
  end if;

  if v_fields ? 'description' then
    v_task.description := coalesce(v_fields ->> 'description', '');
    if char_length(v_task.description) > 8000 then
      raise exception 'Keep the description under 8,000 characters.' using errcode = '22023';
    end if;
  end if;

  if v_fields ? 'status' then
    v_task.status := coalesce(v_fields ->> 'status', '');
    if v_task.status not in ('todo', 'in_progress', 'blocked', 'done', 'cancelled') then
      raise exception 'Unknown task status.' using errcode = '22023';
    end if;
  end if;

  if v_fields ? 'priority' then
    v_task.priority := coalesce(v_fields ->> 'priority', '');
    if v_task.priority not in ('none', 'low', 'medium', 'high', 'urgent') then
      raise exception 'Unknown task priority.' using errcode = '22023';
    end if;
  end if;

  if v_fields ? 'due_on' then
    begin
      v_task.due_on := nullif(btrim(coalesce(v_fields ->> 'due_on', '')), '')::date;
    exception
      when others then
        raise exception 'That due date isn''t a valid date.' using errcode = '22023';
    end;
  end if;

  if v_fields ? 'assignee_id' then
    v_id := private.uuid_or_null(v_fields ->> 'assignee_id');
    if v_id is not null and not exists (
      select 1 from public.workspace_members wm where wm.workspace_id = v_workspace and wm.user_id = v_id
    ) then
      raise exception 'That person isn''t in this workspace.' using errcode = '22023';
    end if;
    v_task.assignee_id := v_id;
    if v_id is not null then
      v_task.agent_id := null;
    end if;
  end if;

  if v_fields ? 'agent_id' then
    v_id := private.uuid_or_null(v_fields ->> 'agent_id');
    if v_id is not null and not exists (
      select 1
        from public.ai_agents a
       where a.id = v_id
         and a.workspace_id = v_workspace
         and a.archived_at is null
         and (a.visibility = 'workspace' or a.created_by = p_actor)
    ) then
      raise exception 'That agent isn''t available.' using errcode = '22023';
    end if;
    v_task.agent_id := v_id;
    if v_id is not null then
      v_task.assignee_id := null;
    end if;
  end if;

  -- The chat and message a task came from are set once, when it's made.
  if v_creating and nullif(v_fields ->> 'conversation_id', '') is not null then
    v_task.conversation_id := private.uuid_or_null(v_fields ->> 'conversation_id');
    if not exists (
      select 1
        from public.conversations c
        join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = p_actor
       where c.id = v_task.conversation_id and c.workspace_id = v_workspace
    ) then
      raise exception 'Conversation not found.' using errcode = '42501';
    end if;

    if nullif(v_fields ->> 'message_id', '') is not null then
      v_task.message_id := private.uuid_or_null(v_fields ->> 'message_id');
      if not exists (
        select 1 from public.messages m
         where m.id = v_task.message_id and m.conversation_id = v_task.conversation_id and m.deleted_at is null
      ) then
        raise exception 'Message not found.' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_task.status = 'done' then
    v_task.completed_at := case when v_creating or v_old.status <> 'done' then now() else v_old.completed_at end;
  else
    v_task.completed_at := null;
  end if;

  if v_creating then
    insert into private.task_counters as tc (workspace_id, last_number)
    values (v_workspace, 1)
    on conflict (workspace_id) do update set last_number = tc.last_number + 1
    returning tc.last_number into v_task.number;

    insert into public.tasks (
      workspace_id, number, title, description, status, priority, assignee_id, agent_id, due_on,
      conversation_id, message_id, created_by, created_by_agent, completed_at
    )
    values (
      v_task.workspace_id, v_task.number, v_task.title, v_task.description, v_task.status, v_task.priority,
      v_task.assignee_id, v_task.agent_id, v_task.due_on, v_task.conversation_id, v_task.message_id,
      v_task.created_by, v_task.created_by_agent, v_task.completed_at
    )
    returning * into v_task;
  else
    if (v_task.title, v_task.description, v_task.status, v_task.priority, v_task.assignee_id, v_task.agent_id, v_task.due_on)
       is not distinct from
       (v_old.title, v_old.description, v_old.status, v_old.priority, v_old.assignee_id, v_old.agent_id, v_old.due_on)
    then
      return v_old;
    end if;

    update public.tasks t
       set title = v_task.title,
           description = v_task.description,
           status = v_task.status,
           priority = v_task.priority,
           assignee_id = v_task.assignee_id,
           agent_id = v_task.agent_id,
           due_on = v_task.due_on,
           completed_at = v_task.completed_at,
           version = t.version + 1,
           updated_at = now()
     where t.id = v_task.id
    returning * into v_task;
  end if;

  perform public.realtime_notify_workspace(v_workspace, 'task.changed', jsonb_build_object('task_id', v_task.id));

  if v_task.assignee_id is not null
    and v_task.assignee_id <> p_actor
    and (v_creating or v_old.assignee_id is distinct from v_task.assignee_id)
  then
    perform public.realtime_notify_users(
      array[v_task.assignee_id], 'task.assigned', jsonb_build_object('task_id', v_task.id, 'by', p_actor)
    );
  end if;

  -- The chat it came from sees it made, and sees it finished by anyone in that chat.
  if v_task.conversation_id is not null
    and (
      v_creating
      or (
        v_task.status = 'done' and v_old.status <> 'done'
        and exists (
          select 1 from public.conversation_participants cp
           where cp.conversation_id = v_task.conversation_id and cp.user_id = p_actor
        )
      )
    )
  then
    perform public.post_system_message(
      v_task.conversation_id,
      p_actor,
      case when v_creating then 'task_created' else 'task_completed' end,
      jsonb_build_object('task_id', v_task.id, 'number', v_task.number, 'name', v_task.title)
        || case when p_agent_id is null then '{}'::jsonb else jsonb_build_object('agent_id', p_agent_id) end
    );
  end if;

  return v_task;
end;
$$;

create or replace function public.create_task(p_workspace_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return to_jsonb(private.save_task(public.require_user(), null, null, p_workspace_id, p_fields));
end;
$$;

create or replace function public.update_task(p_task_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_task_id is null then
    raise exception 'Task not found.' using errcode = '42501';
  end if;
  return to_jsonb(private.save_task(public.require_user(), null, p_task_id, null, p_fields));
end;
$$;

create or replace function public.delete_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks t where t.id = p_task_id for update;
  if not found or not public.is_workspace_member(v_task.workspace_id) then
    return false;
  end if;
  if v_task.created_by is distinct from v_uid and not public.is_workspace_admin(v_task.workspace_id) then
    raise exception 'Only the person who created this task, or an admin, can delete it.' using errcode = '42501';
  end if;

  delete from public.tasks t where t.id = p_task_id;
  perform public.realtime_notify_workspace(v_task.workspace_id, 'task.removed', jsonb_build_object('task_id', v_task.id));
  return true;
end;
$$;

-- Server only: an agent creating or changing a task for the person who asked it.
create or replace function public.ai_save_task(
  p_user_id uuid,
  p_agent_id uuid,
  p_task_id uuid,
  p_workspace_id uuid,
  p_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_agent_id is null then
    raise exception 'Agent not found.' using errcode = '42501';
  end if;
  return to_jsonb(private.save_task(p_user_id, p_agent_id, p_task_id, p_workspace_id, p_fields));
end;
$$;

-- Finer-tuned agents ─────────────────────────────────────────────────────────

alter table public.ai_agents
  add column if not exists rules text not null default '',
  add column if not exists examples jsonb not null default '[]'::jsonb,
  add column if not exists creativity text not null default 'balanced',
  add column if not exists double_check boolean not null default false;

alter table public.ai_agents drop constraint if exists ai_agents_rules_length;
alter table public.ai_agents add constraint ai_agents_rules_length check (char_length(rules) <= 4000);

alter table public.ai_agents drop constraint if exists ai_agents_examples_shape;
alter table public.ai_agents add constraint ai_agents_examples_shape
  check (jsonb_typeof(examples) = 'array' and jsonb_array_length(examples) <= 6 and octet_length(examples::text) <= 24000);

alter table public.ai_agents drop constraint if exists ai_agents_creativity_check;
alter table public.ai_agents add constraint ai_agents_creativity_check
  check (creativity in ('precise', 'balanced', 'creative'));

alter table public.ai_agents drop constraint if exists ai_agents_tools_check;
alter table public.ai_agents add constraint ai_agents_tools_check
  check (tools <@ array['history', 'search', 'directory', 'web', 'tasks', 'github']::text[]);

grant insert (rules, examples, creativity, double_check) on public.ai_agents to authenticated;
grant update (rules, examples, creativity, double_check) on public.ai_agents to authenticated;

-- Connected apps ─────────────────────────────────────────────────────────────

create table if not exists public.workspace_integrations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  provider       text not null check (provider in ('github')),
  -- For GitHub, the app installation's id. Access tokens are minted on demand
  -- from the app's private key and never stored.
  external_id    text not null check (char_length(external_id) between 1 and 100),
  account_login  text not null default '' check (char_length(account_login) <= 100),
  account_type   text not null default '' check (char_length(account_type) <= 40),
  settings       jsonb not null default '{}'::jsonb
                 check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 4000),
  connected_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint workspace_integrations_one_per_provider unique (workspace_id, provider)
);

alter table public.workspace_integrations enable row level security;

drop policy if exists workspace_integrations_select_members on public.workspace_integrations;
create policy workspace_integrations_select_members
  on public.workspace_integrations for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.workspace_integrations from anon;
revoke insert, update, delete, truncate, references, trigger on public.workspace_integrations from authenticated;
grant select on public.workspace_integrations to authenticated;

-- Server only, after the provider confirmed the person may use that installation.
create or replace function public.connect_workspace_integration(
  p_user_id uuid,
  p_workspace_id uuid,
  p_provider text,
  p_external_id text,
  p_account_login text,
  p_account_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workspace_integrations%rowtype;
begin
  if not exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Only workspace admins can connect apps.' using errcode = '42501';
  end if;

  insert into public.workspace_integrations as wi (workspace_id, provider, external_id, account_login, account_type, connected_by)
  values (p_workspace_id, p_provider, p_external_id, coalesce(p_account_login, ''), coalesce(p_account_type, ''), p_user_id)
  on conflict (workspace_id, provider) do update
    set external_id = excluded.external_id,
        account_login = excluded.account_login,
        account_type = excluded.account_type,
        connected_by = excluded.connected_by,
        settings = case when wi.external_id = excluded.external_id then wi.settings else '{}'::jsonb end,
        updated_at = now()
  returning * into v_row;

  perform public.realtime_notify_workspace(p_workspace_id, 'integrations.changed', jsonb_build_object('workspace_id', p_workspace_id));
  return to_jsonb(v_row);
end;
$$;

create or replace function public.disconnect_workspace_integration(p_workspace_id uuid, p_provider text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_user();
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only workspace admins can disconnect apps.' using errcode = '42501';
  end if;

  delete from public.workspace_integrations wi where wi.workspace_id = p_workspace_id and wi.provider = p_provider;
  if not found then
    return false;
  end if;

  perform public.realtime_notify_workspace(p_workspace_id, 'integrations.changed', jsonb_build_object('workspace_id', p_workspace_id));
  return true;
end;
$$;

-- The repository agents use when nobody names one.
create or replace function public.set_integration_default_repo(p_workspace_id uuid, p_provider text, p_repo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repo text := nullif(btrim(coalesce(p_repo, '')), '');
begin
  perform public.require_user();
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only workspace admins can change connected apps.' using errcode = '42501';
  end if;
  if v_repo is not null and v_repo !~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$' then
    raise exception 'Use the owner/name form, like acme/website.' using errcode = '22023';
  end if;

  update public.workspace_integrations wi
     set settings = case
                      when v_repo is null then wi.settings - 'default_repo'
                      else jsonb_set(wi.settings, '{default_repo}', to_jsonb(v_repo))
                    end,
         updated_at = now()
   where wi.workspace_id = p_workspace_id and wi.provider = p_provider;
  if not found then
    return false;
  end if;

  perform public.realtime_notify_workspace(p_workspace_id, 'integrations.changed', jsonb_build_object('workspace_id', p_workspace_id));
  return true;
end;
$$;

-- Privileges ─────────────────────────────────────────────────────────────────

revoke execute on function private.uuid_or_null(text) from public, anon, authenticated;
revoke execute on function private.save_task(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.create_task(uuid, jsonb) from public, anon;
revoke execute on function public.update_task(uuid, jsonb) from public, anon;
revoke execute on function public.delete_task(uuid) from public, anon;
revoke execute on function public.disconnect_workspace_integration(uuid, text) from public, anon;
revoke execute on function public.set_integration_default_repo(uuid, text, text) from public, anon;
grant execute on function public.create_task(uuid, jsonb) to authenticated;
grant execute on function public.update_task(uuid, jsonb) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
grant execute on function public.disconnect_workspace_integration(uuid, text) to authenticated;
grant execute on function public.set_integration_default_repo(uuid, text, text) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.ai_save_task(uuid, uuid, uuid, uuid, jsonb)',
    'public.connect_workspace_integration(uuid, uuid, text, text, text, text)'
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
  select jsonb_build_object('ok', true, 'time', now(), 'schema', 9);
$$;

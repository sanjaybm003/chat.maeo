-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 11 · Agent access: who sees an agent, who uses it, who edits it
--
--   • visibility   private (only its maker) · people (its maker and people they
--                  pick) · workspace (everyone in the workspace)
--   • usage        owner (its maker and editors) · people (people picked to use
--                  it) · viewers (anyone who can see it)
--   • ai_agent_members   the people an agent is shared with: viewer, user or editor
--   • an agent working in a chat is visible to everyone in that chat, so its
--     replies always show who wrote them; only people allowed to use it wake it
--   • web search is on for every agent that didn't have it yet
-- ─────────────────────────────────────────────────────────────────────────────

-- Sharing settings ───────────────────────────────────────────────────────────

alter table public.ai_agents drop constraint if exists ai_agents_visibility_check;
alter table public.ai_agents add constraint ai_agents_visibility_check
  check (visibility in ('private', 'people', 'workspace'));

alter table public.ai_agents add column if not exists usage text not null default 'viewers';
alter table public.ai_agents drop constraint if exists ai_agents_usage_check;
alter table public.ai_agents add constraint ai_agents_usage_check check (usage in ('owner', 'people', 'viewers'));

grant insert (usage) on public.ai_agents to authenticated;
grant update (usage) on public.ai_agents to authenticated;

create table if not exists public.ai_agent_members (
  agent_id  uuid not null references public.ai_agents (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'user' check (role in ('viewer', 'user', 'editor')),
  added_by  uuid references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (agent_id, user_id)
);

create index if not exists ai_agent_members_user_idx on public.ai_agent_members (user_id);

-- Access ─────────────────────────────────────────────────────────────────────

-- 'none', 'view', 'use' or 'edit', for one person and one agent.
create or replace function private.agent_access_for(p_agent_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent record;
  v_workspace_role text;
  v_role text;
begin
  if p_agent_id is null or p_user_id is null then
    return 'none';
  end if;

  select a.workspace_id, a.created_by, a.visibility, a.usage into v_agent
    from public.ai_agents a
   where a.id = p_agent_id;
  if not found then
    return 'none';
  end if;

  select wm.role into v_workspace_role
    from public.workspace_members wm
   where wm.workspace_id = v_agent.workspace_id and wm.user_id = p_user_id;
  if v_workspace_role is null then
    return 'none';
  end if;

  if v_agent.created_by = p_user_id then
    return 'edit';
  end if;
  if v_agent.visibility = 'private' then
    return 'none';
  end if;

  select m.role into v_role
    from public.ai_agent_members m
   where m.agent_id = p_agent_id and m.user_id = p_user_id;

  if v_agent.visibility = 'workspace' or v_role is not null then
    if v_role = 'editor' or v_workspace_role in ('owner', 'admin') then
      return 'edit';
    end if;
    if v_agent.usage = 'viewers' or (v_agent.usage = 'people' and v_role = 'user') then
      return 'use';
    end if;
    return 'view';
  end if;

  -- Working in a chat, or in someone's room with it, makes an agent visible there.
  if exists (
    select 1
      from public.conversation_agents ca
      join public.conversation_participants cp on cp.conversation_id = ca.conversation_id
     where ca.agent_id = p_agent_id and cp.user_id = p_user_id
  ) or exists (
    select 1
      from public.conversations c
      join public.conversation_participants cp on cp.conversation_id = c.id
     where c.agent_id = p_agent_id and cp.user_id = p_user_id
  ) then
    return 'view';
  end if;
  return 'none';
end;
$$;

-- An agent in this workspace, not archived, that the person may talk to or give work to.
create or replace function private.agent_usable(p_agent_id uuid, p_user_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_agents a
     where a.id = p_agent_id and a.workspace_id = p_workspace_id and a.archived_at is null
  ) and private.agent_access_for(p_agent_id, p_user_id) in ('use', 'edit');
$$;

-- The signed-in person's access, for the app and for row level security.
create or replace function public.agent_access(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.agent_access_for(p_agent_id, auth.uid());
$$;

-- Row level security reads a new row's own columns, so this only covers what
-- they can't: sharing with people, and working in a chat or room with them.
create or replace function public.agent_shared_with_me(p_agent_id uuid, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_visibility <> 'private' and (
    exists (select 1 from public.ai_agent_members m where m.agent_id = p_agent_id and m.user_id = auth.uid())
    or exists (
      select 1
        from public.conversation_agents ca
        join public.conversation_participants cp on cp.conversation_id = ca.conversation_id
       where ca.agent_id = p_agent_id and cp.user_id = auth.uid()
    )
    or exists (
      select 1
        from public.conversations c
        join public.conversation_participants cp on cp.conversation_id = c.id
       where c.agent_id = p_agent_id and cp.user_id = auth.uid()
    )
  );
$$;

drop policy if exists ai_agents_select_visible on public.ai_agents;
create policy ai_agents_select_visible
  on public.ai_agents for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      created_by = (select auth.uid())
      or visibility = 'workspace'
      or public.agent_shared_with_me(id, visibility)
    )
  );

drop policy if exists ai_agents_update_owner_or_admin on public.ai_agents;
drop policy if exists ai_agents_update_editors on public.ai_agents;
create policy ai_agents_update_editors
  on public.ai_agents for update to authenticated
  using (public.agent_access(id) = 'edit')
  with check (public.is_workspace_member(workspace_id));

alter table public.ai_agent_members enable row level security;

drop policy if exists ai_agent_members_select_visible on public.ai_agent_members;
create policy ai_agent_members_select_visible
  on public.ai_agent_members for select to authenticated
  using (public.agent_access(agent_id) <> 'none');

revoke all on public.ai_agent_members from anon;
revoke insert, update, delete, truncate, references, trigger on public.ai_agent_members from authenticated;
grant select on public.ai_agent_members to authenticated;

-- Editors change how an agent works; only its maker or an admin changes who has it.
create or replace function private.guard_agent_sharing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.visibility, new.usage) is distinct from (old.visibility, old.usage)
    and auth.uid() is not null
    and auth.uid() is distinct from old.created_by
    and not public.is_workspace_admin(old.workspace_id)
  then
    raise exception 'Only the person who made this agent, or an admin, can change who sees and uses it.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_agents_guard_sharing on public.ai_agents;
create trigger ai_agents_guard_sharing
  before update of visibility, usage on public.ai_agents
  for each row execute function private.guard_agent_sharing();

-- The maker or an admin sets everyone an agent is shared with, in one go.
create or replace function public.set_agent_members(p_agent_id uuid, p_members jsonb)
returns setof public.ai_agent_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_agent public.ai_agents%rowtype;
  v_members jsonb := coalesce(p_members, '[]'::jsonb);
  v_item jsonb;
  v_user uuid;
begin
  select * into v_agent from public.ai_agents a where a.id = p_agent_id and a.archived_at is null;
  if not found
    or not (v_agent.created_by = v_uid or public.is_workspace_admin(v_agent.workspace_id))
    or private.agent_access_for(p_agent_id, v_uid) <> 'edit'
  then
    raise exception 'Only the person who made this agent, or an admin, can share it.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) > 100 then
    raise exception 'Share an agent with up to 100 people at a time.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_members) loop
    v_user := private.uuid_or_null(v_item ->> 'user_id');
    if v_user is null or coalesce(v_item ->> 'role', '') not in ('viewer', 'user', 'editor') then
      raise exception 'Choose whether each person can see, use or edit the agent.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.workspace_members wm where wm.workspace_id = v_agent.workspace_id and wm.user_id = v_user
    ) then
      raise exception 'You can only share an agent with people in this workspace.' using errcode = '22023';
    end if;
  end loop;

  delete from public.ai_agent_members m
   where m.agent_id = p_agent_id
     and m.user_id not in (select (value ->> 'user_id')::uuid from jsonb_array_elements(v_members));

  insert into public.ai_agent_members as m (agent_id, user_id, role, added_by)
  select distinct on (picked.user_id) p_agent_id, picked.user_id, picked.role, v_uid
    from (
      select (value ->> 'user_id')::uuid as user_id, value ->> 'role' as role
        from jsonb_array_elements(v_members)
    ) picked
   where picked.user_id is distinct from v_agent.created_by
  on conflict (agent_id, user_id) do update set role = excluded.role;

  -- Everyone in the workspace refreshes the agent, so it appears or disappears for the right people.
  update public.ai_agents a set updated_at = now() where a.id = p_agent_id;

  return query select * from public.ai_agent_members m where m.agent_id = p_agent_id order by m.added_at;
end;
$$;

-- Talking to agents ──────────────────────────────────────────────────────────

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
  if not found or not private.agent_usable(p_agent_id, v_uid, v_agent.workspace_id) then
    raise exception 'You can''t use this agent. Ask the person who made it for access.' using errcode = '42501';
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

-- Anyone who may use a shared agent can bring it into a chat they're in.
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
  if not found or not private.agent_usable(p_agent_id, v_uid, v_conversation.workspace_id) then
    raise exception 'Agent not found.' using errcode = '42501';
  end if;
  if v_agent.visibility = 'private' then
    raise exception 'Only shared agents can join chats.' using errcode = '22023';
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
  if not found or not private.agent_usable(p_agent_id, p_user_id, v_workspace_id) then
    raise exception 'You can''t use this agent. Ask the person who made it for access.' using errcode = '42501';
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

-- Tasks: giving work to an agent, or an agent acting, needs the right to use it.
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

  if p_agent_id is not null and not private.agent_usable(p_agent_id, p_actor, v_workspace) then
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
    if v_id is not null and not private.agent_usable(v_id, p_actor, v_workspace) then
      raise exception 'That agent isn''t available to you.' using errcode = '22023';
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

-- Web search for every agent ─────────────────────────────────────────────────

update public.ai_agents a
   set tools = a.tools || array['web']::text[]
 where a.archived_at is null
   and not ('web' = any (a.tools));

-- Privileges ─────────────────────────────────────────────────────────────────

revoke execute on function private.agent_access_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.agent_usable(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.save_task(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.agent_access(uuid) from public, anon;
revoke execute on function public.agent_shared_with_me(uuid, text) from public, anon;
revoke execute on function public.set_agent_members(uuid, jsonb) from public, anon;
grant execute on function public.agent_access(uuid) to authenticated;
grant execute on function public.agent_shared_with_me(uuid, text) to authenticated;
grant execute on function public.set_agent_members(uuid, jsonb) to authenticated;

do $$
begin
  revoke execute on function public.ai_start_reply_run(uuid, uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
  begin
    grant execute on function public.ai_start_reply_run(uuid, uuid, uuid, text, boolean, jsonb) to service_role;
  exception
    when undefined_object then null;
  end;
end;
$$;

create or replace function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'time', now(), 'schema', 11);
$$;

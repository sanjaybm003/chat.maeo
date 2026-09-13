-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 03 · row level security and privileges
-- Default deny. Clients read what they belong to and write a handful of
-- columns; everything else goes through the RPCs in 02.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles                  enable row level security;
alter table public.workspaces                enable row level security;
alter table public.workspace_members         enable row level security;
alter table public.invitations               enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;
alter table public.message_reactions         enable row level security;

-- Profiles ───────────────────────────────────────────────────────────────────

create policy profiles_select_self_and_teammates
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Workspaces ─────────────────────────────────────────────────────────────────

create policy workspaces_select_members
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_update_admins
  on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy workspace_members_select_members
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Invitations: visible to whoever sent them and to admins ────────────────────

create policy invitations_select_inviter_and_admins
  on public.invitations for select to authenticated
  using (invited_by = (select auth.uid()) or public.is_workspace_admin(workspace_id));

-- Conversations ──────────────────────────────────────────────────────────────

create policy conversations_select_participants
  on public.conversations for select to authenticated
  using (public.is_conversation_participant(id));

create policy conversation_participants_select_participants
  on public.conversation_participants for select to authenticated
  using (public.is_conversation_participant(conversation_id));

-- Messages ───────────────────────────────────────────────────────────────────

create policy messages_select_participants
  on public.messages for select to authenticated
  using (public.is_conversation_participant(conversation_id));

create policy messages_insert_own
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and kind = 'text'
    and public.is_conversation_participant(conversation_id)
  );

create policy messages_update_own
  on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) and kind = 'text')
  with check (sender_id = (select auth.uid()) and kind = 'text');

create policy message_reactions_select_participants
  on public.message_reactions for select to authenticated
  using (public.is_conversation_participant(conversation_id));

create policy message_reactions_insert_own
  on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_conversation_participant(conversation_id));

create policy message_reactions_delete_own
  on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Privileges ─────────────────────────────────────────────────────────────────
-- Column-level grants mean a client can never forge sender ids, timestamps,
-- roles or system messages even if a policy were loosened by mistake.

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

grant update (full_name, display_name, title, status_text, avatar_path, color, onboarded_at)
  on public.profiles to authenticated;

grant update (name, team_size, use_case, members_can_invite)
  on public.workspaces to authenticated;

grant insert (id, conversation_id, sender_id, body, attachments, reply_to_id)
  on public.messages to authenticated;
grant update (body, deleted_at)
  on public.messages to authenticated;

grant insert (message_id, user_id, emoji)
  on public.message_reactions to authenticated;
grant delete
  on public.message_reactions to authenticated;

-- The invite landing page reads an invitation before the visitor has signed in.
grant execute on function public.get_invitation(text) to anon;

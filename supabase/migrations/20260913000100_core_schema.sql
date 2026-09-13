-- ─────────────────────────────────────────────────────────────────────────────
-- maeosan · 01 · core schema
-- Profiles, workspaces, membership, invitations, conversations and messages.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Enums ──────────────────────────────────────────────────────────────────────

create type public.workspace_role as enum ('owner', 'admin', 'member');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
create type public.conversation_kind as enum ('direct', 'group');
create type public.message_kind as enum ('text', 'system');

-- Shared trigger: keep updated_at honest ─────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Profiles ───────────────────────────────────────────────────────────────────
-- One row per auth user. Created by trigger, never inserted by clients.

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null default '',
  full_name     text check (full_name is null or char_length(full_name) between 1 and 80),
  display_name  text check (display_name is null or char_length(display_name) between 1 and 40),
  title         text check (title is null or char_length(title) <= 80),
  status_text   text check (status_text is null or char_length(status_text) <= 100),
  avatar_path   text check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text),
  color         text not null default 'cobalt'
                check (color in ('tomato', 'saffron', 'grass', 'lagoon', 'cobalt', 'iris', 'bubblegum', 'clay')),
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (email);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Workspaces ─────────────────────────────────────────────────────────────────

create table public.workspaces (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 2 and 60),
  slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  team_size           text check (team_size is null or team_size in ('solo', '2-10', '11-50', '51-200', '200+')),
  use_case            text check (use_case is null or char_length(use_case) <= 40),
  members_can_invite  boolean not null default true,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index workspaces_created_by_idx on public.workspaces (created_by, created_at desc);

create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function public.touch_updated_at();

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          public.workspace_role not null default 'member',
  joined_at     timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

-- Invitations ────────────────────────────────────────────────────────────────

create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          public.workspace_role not null default 'member' check (role <> 'owner'),
  token         text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  status        public.invitation_status not null default 'pending',
  invited_by    uuid references public.profiles (id) on delete set null,
  accepted_by   uuid references public.profiles (id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

create unique index invitations_one_pending_per_email
  on public.invitations (workspace_id, email) where status = 'pending';
create index invitations_pending_email_idx
  on public.invitations (email) where status = 'pending';
create index invitations_workspace_created_idx
  on public.invitations (workspace_id, created_at desc);

-- Conversations ──────────────────────────────────────────────────────────────
-- No channels, no threads: a conversation is either a 1:1 or a small group.

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  kind             public.conversation_kind not null,
  name             text check (name is null or char_length(btrim(name)) between 1 and 80),
  direct_key       text unique,
  created_by       uuid references public.profiles (id) on delete set null,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint conversations_direct_key_matches_kind check ((kind = 'direct') = (direct_key is not null)),
  constraint conversations_direct_has_no_name check (kind = 'group' or name is null)
);

create index conversations_workspace_activity_idx
  on public.conversations (workspace_id, last_message_at desc nulls last);

create trigger conversations_touch_updated_at
  before update on public.conversations
  for each row execute function public.touch_updated_at();

create table public.conversation_participants (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz not null default now(),
  muted            boolean not null default false,
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_idx on public.conversation_participants (user_id);

-- Messages ───────────────────────────────────────────────────────────────────
-- ids are generated by the client so optimistic sends reconcile exactly.

create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null,
  kind             public.message_kind not null default 'text',
  body             text not null default '' check (char_length(body) <= 4000),
  attachments      jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  meta             jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  reply_to_id      uuid references public.messages (id) on delete set null,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint messages_has_content check (
    deleted_at is not null
    or kind = 'system'
    or char_length(btrim(body)) > 0
    or jsonb_array_length(attachments) > 0
  )
);

create index messages_conversation_timeline_idx
  on public.messages (conversation_id, created_at desc, id desc);
create index messages_body_search_idx
  on public.messages using gin (body extensions.gin_trgm_ops);

create table public.message_reactions (
  message_id       uuid not null references public.messages (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  emoji            text not null check (char_length(emoji) between 1 and 16),
  created_at       timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index message_reactions_conversation_idx on public.message_reactions (conversation_id);

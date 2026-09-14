# maeosan

Team chat for startups and small companies. No channels, no threads: your whole team is a list of contacts, and every conversation is either a 1:1 or a small group.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 and Supabase (Postgres, Auth, Realtime, Storage).

---

## What's in the box

**Accounts**
- Email and password sign-up with email confirmation and a live password-strength meter
- Passwordless sign-in links, "Continue with Google" (optional), forgot and reset password
- Sign out everywhere, change password, delete account
- Session refresh in `src/proxy.ts`, identity always verified server-side

**Setup**
- Three-step onboarding: your profile and personal color, then your workspace (with live URL availability), then invite your people
- Invitations by email, with a Resend template or Supabase Auth as delivery, and a copyable link when email can't be sent
- Pending invitations appear in the app for people who already have an account

**Chat**
- Contacts: everyone in the workspace, online presence, one tap to message
- Direct messages and group chats; adding people to a 1:1 starts a new group so the 1:1 stays private
- Realtime over WebSockets: messages, edits, deletes, reactions, read receipts, typing indicators and presence
- Optimistic sending with retry, unread badges and a "New" divider, "Seen" receipts, scroll-anchored history paging
- Replies, edits (↑ edits your last message), deletes, emoji reactions, file and image attachments (paste, drag and drop)
- ⌘K / Ctrl K palette to jump to people and chats and search message history
- Mute per conversation, sound and desktop notifications, unread count in the tab title

**Tasks**
- Press T anywhere, type `/task Send the invoice @sam friday !high` in a chat, or turn any message into a task
- Numbered per workspace (T-12), with status, priority, due dates, and a teammate or an agent doing the work
- Task cards in chat stay live: tick them off or edit them right there, or on their own page

**AI agents**
- Describe an agent in plain words, add it to any chat, or talk to it one-to-one; replies use each person's AI credits
- Automatic model routing, web search with sources, and tools to read the conversation, search the workspace and manage tasks
- Tuning per agent: rules it must keep, example replies to learn from, creativity, and an optional double-check of every answer
- GitHub: agents read code and open pull requests for the team to review

**Design**
- Warm paper and ink with eight flat person colors. Your color tints your avatar, bubbles and reactions
- Bricolage Grotesque, Instrument Sans and IBM Plex Mono
- Light by default, dark as an option, or match the system. Five chat backdrop patterns
- No gradients; a hand-drawn icon set used sparingly
- Responsive: on phones the chat list is home and chats open full screen

---

## Architecture

```
Browser ── Next.js (proxy.ts refreshes the session)
   │          ├─ Server Components load the first paint (workspace bootstrap)
   │          └─ Server Actions for auth, onboarding, invitations, account deletion
   │
   └─ supabase-js ── PostgREST (RLS)  ── Postgres
                 └─ Realtime (private WebSocket channels)
                      user:<id>          personal feed, fanned out by Postgres triggers
                      workspace:<id>     presence + membership changes
                      conversation:<id>  typing indicators (peer to peer)
```

- **Row Level Security everywhere.** Clients can only read what they belong to. Writes that touch more than one row (create a group, accept an invite, change a role) go through `security definer` functions that authorize and run atomically. Column-level grants stop clients from forging sender ids, timestamps or roles.
- **One subscription per user.** Database triggers call `realtime.send()` for every participant, so a client listens on a single private channel for all of its conversations. Channel access is enforced by RLS policies on `realtime.messages`.
- **Resilient by default.** On reconnect, after the tab has been hidden, or when the network returns, the client refetches conversations and the open thread to fill any gap.

```
src/
  app/                  routes only: thin pages and layouts
  components/ui         design-system primitives (button, dialog, menu, avatar…)
  components/brand      logo, workspace glyph, generative mosaic art
  features/
    auth/               sign in, sign up, links, reset password
    onboarding/         profile → workspace → invite
    invitations/        invite actions, email delivery and template
    workspace/          store, realtime sync, API, shell, sidebar, dialogs
    chat/               conversation screen, messages, composer, attachments
    contacts/           people directory and member management
    settings/           profile, preferences, workspace, account
  lib/                  env, Supabase clients, mappers, routes, dates, utils
  server/               request-scoped session helpers
  types/                database and domain types
supabase/
  migrations/           schema, functions, RLS, realtime, storage
  templates/            branded auth emails
```

---

## Setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com), create a project, then copy these values from **Project Settings → API**:

- Project URL
- Publishable key (or legacy anon key)
- Secret key (or legacy service_role key)

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`. `SUPABASE_SERVICE_ROLE_KEY` stays on the server. It is used only to send invitations and delete accounts.

### 3. Apply the database

Pick one:

**Supabase CLI**

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**SQL editor.** Open **SQL Editor → New query** (not the Table Editor), paste all of `supabase/schema.sql`, and run it. It's the migrations bundled in order; regenerate it with `npm run db:bundle`.

**Project already has other tables?** The script runs as one transaction, so a clash such as `relation "profiles" already exists` rolls everything back. Run `supabase/reset.sql` first. ⚠ It deletes everything in the `public` schema plus storage and realtime access policies; auth users, buckets and files are kept. Then run `schema.sql`.

**Check it worked:** open `/api/health` in the running app. `"database": { "ok": true }` means the schema is live.

### 4. Configure Auth

In **Authentication → URL Configuration**:

- **Site URL:** your app's origin, e.g. `http://localhost:3000`
- **Redirect URLs:** add `http://localhost:3000/**` and your production origin with `/**`

In **Authentication → Providers → Email**, keep **Confirm email** on. Invitations are matched to confirmed addresses.

**Recommended:** in **Authentication → Emails**, replace the templates with the ones in `supabase/templates/`:

| Template | File |
| --- | --- |
| Confirm signup | `confirmation.html` |
| Invite user | `invite.html` |
| Magic link | `magic-link.html` |
| Reset password | `recovery.html` |

These links verify with a token hash, so they work even when opened in a different browser or on another device.

**Production email.** Supabase's built-in mailer is heavily rate-limited. Configure custom SMTP in **Authentication → Emails → SMTP settings**. You can also set `RESEND_API_KEY` to send invitations with maeosan's own template.

**Invitations.** Invite emails need a sender. Either set `RESEND_API_KEY`, with `EMAIL_FROM` on a domain you verified in Resend, or set `SUPABASE_SERVICE_ROLE_KEY` to send through Supabase Auth. Supabase's built-in mailer only delivers to members of your Supabase organization, so add custom SMTP (Authentication → Emails → SMTP) before inviting anyone else. Without email, the app gives you a link to copy. A `localhost` link only opens on your own computer; to invite someone on another device, deploy maeosan and set `NEXT_PUBLIC_SITE_URL` and the Supabase Site URL to the public address.

**Google (optional).** Enable the Google provider, add the Supabase callback URL to your Google OAuth client, then set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true`.

### 5. Lock down Realtime

In **Project Settings → Realtime**, turn off **Allow public access**. maeosan only uses private channels, and this makes the database authorization mandatory.

### 6. Connect GitHub (optional)

Agents can read code and open pull requests once a workspace connects GitHub. Register one GitHub App for your deployment at **github.com/settings/apps/new**:

- **Callback URL:** `https://your-domain/api/integrations/github/callback`, and tick **Request user authorization (OAuth) during installation**
- **Webhook:** off
- **Repository permissions:** Contents *Read and write*, Pull requests *Read and write*, Metadata *Read-only*
- **Where can this app be installed:** *Any account*, so teams can install it on their own organizations

Generate a client secret and a private key, then set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` (from `github.com/apps/<slug>`), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY` (the whole `.pem`). Workspace admins connect from **Settings → Connected apps**. Agents only push to their own branches and open pull requests; nothing is merged without a person.

### 7. Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, create an account, and follow setup. To see realtime, invite a second address and open it in another browser.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run verify` | Typecheck, lint, tests and build |
| `npm run db:bundle` | Regenerate `supabase/schema.sql` from the migrations |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run db:types` | Regenerate `src/types/database.ts` from the linked project |

## Deploying

Any Node host that runs Next.js works; Vercel is the simplest.

1. In **Vercel → Project → Settings → Environment Variables**, add the variables from `.env.example`. Vercel never reads your local `.env.local`.
2. `NEXT_PUBLIC_SITE_URL` is optional on Vercel. When it's unset, the production domain is used automatically. If you set it, use the exact `https://` address.
3. `NEXT_PUBLIC_…` values are baked in at build time, so **redeploy** after changing any of them.
4. In Supabase **Authentication → URL Configuration**, set **Site URL** to the production address and add `https://your-domain/**` to **Redirect URLs**.
5. Open `/api/health`. `siteUrl` should be your real address and `database.ok` should be `true`.

**Email without a domain of your own.** Resend needs a domain you own. Without one, use Gmail in Supabase: **Authentication → Emails → SMTP Settings**, with host `smtp.gmail.com`, port `465`, your Gmail address as the username and a Google **App Password** as the password. Then set `SUPABASE_SERVICE_ROLE_KEY` in Vercel and leave `RESEND_API_KEY` empty. Invitations, confirmations and password resets all go out through Gmail.

## Security notes

- Every table has RLS enabled; the default is deny.
- Clients can update only specific columns (`profiles`: name, title, status, avatar, color; `messages`: body and soft delete).
- Attachments live in a private bucket under `<conversation>/<uploader>/…`, readable only by participants through short-lived signed URLs.
- Auth redirects accept only same-origin relative paths; error messages on the sign-in page come from fixed codes, never from the URL.
- Security headers (HSTS, frame denial, no sniffing, referrer policy, permissions policy) are set in `next.config.ts`.

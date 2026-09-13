import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Mosaic } from "@/components/brand/mosaic";
import { WorkspaceGlyph } from "@/components/brand/workspace-glyph";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { InviteAcceptButton } from "@/features/invitations/components/invite-accept-button";
import { formatShortDate } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthUser, getMyWorkspaces } from "@/server/session";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data }, user] = await Promise.all([
    /^[a-f0-9]{48}$/.test(token) ? supabase.rpc("get_invitation", { p_token: token }) : Promise.resolve({ data: null }),
    getAuthUser(),
  ]);
  const invitation = data?.[0] ?? null;
  const invitePath = routes.invite(token);

  if (invitation && user) {
    const workspaces = await getMyWorkspaces();
    if (workspaces.some((workspace) => workspace.id === invitation.workspace_id)) {
      redirect(routes.workspace(invitation.workspace_slug));
    }
  }

  const signedInAs = user?.email?.toLowerCase() ?? null;
  const emailMatches = invitation && signedInAs === invitation.email;

  return (
    <div className="flex min-h-dvh flex-col items-center px-5 py-6">
      <header className="flex w-full max-w-[520px] items-center justify-between">
        <Link href="/" aria-label="maeosan home">
          <Logo />
        </Link>
      </header>

      <main className="flex w-full flex-1 items-center justify-center py-10">
        <div className="w-full max-w-[520px] animate-rise overflow-hidden rounded-[32px] border border-line bg-surface">
          <div className="h-28 overflow-hidden border-b border-line">
            <Mosaic cols={8} rows={2} seed={token.length ? token.charCodeAt(0) * 7 + token.charCodeAt(1) : 5} className="size-full" />
          </div>

          <div className="p-7 sm:p-9">
            {!invitation ? (
              <InviteMessage title="This invitation doesn’t exist." body="The link may be mistyped, or the invitation was replaced by a newer one.">
                <Button asChild>
                  <Link href={routes.home}>Go to maeosan</Link>
                </Button>
              </InviteMessage>
            ) : invitation.status !== "pending" ? (
              <InviteMessage
                title={
                  invitation.status === "expired"
                    ? "This invitation has expired."
                    : invitation.status === "accepted"
                      ? "This invitation was already used."
                      : "This invitation was cancelled."
                }
                body={`Ask someone at ${invitation.workspace_name} to send you a new one.`}
              >
                <Button asChild variant="secondary">
                  <Link href={routes.home}>Go to maeosan</Link>
                </Button>
              </InviteMessage>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <WorkspaceGlyph name={invitation.workspace_name} seed={invitation.workspace_slug} size="lg" />
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">You’re invited</p>
                </div>
                <h1 className="mt-6 font-display text-[38px] font-semibold leading-[1.02] tracking-[-0.035em]">
                  Join {invitation.workspace_name}
                </h1>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-3">
                  {invitation.inviter_name} invited <span className="text-ink">{invitation.email}</span> to chat with the team.
                  Valid until {formatShortDate(invitation.expires_at)}.
                </p>

                <div className="mt-8">
                  {!user ? (
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="lg">
                        <Link href={`${routes.signup}?next=${encodeURIComponent(invitePath)}`}>Create account & join</Link>
                      </Button>
                      <Button asChild size="lg" variant="ghost">
                        <Link href={`${routes.login}?next=${encodeURIComponent(invitePath)}`}>I have an account</Link>
                      </Button>
                    </div>
                  ) : emailMatches ? (
                    <InviteAcceptButton token={token} />
                  ) : (
                    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-2 p-4">
                      <p className="text-sm text-ink-2">
                        You’re signed in as <span className="font-medium text-ink">{signedInAs}</span>, but this invitation is for{" "}
                        <span className="font-medium text-ink">{invitation.email}</span>.
                      </p>
                      <form action={signOut}>
                        <Button type="submit" variant="secondary">
                          Sign out and switch account
                        </Button>
                      </form>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function InviteMessage({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-[32px] font-semibold leading-[1.05] tracking-[-0.03em]">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{body}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import { loadWorkspaceBootstrap } from "@/features/workspace/server/bootstrap";
import { WorkspaceStoreProvider } from "@/features/workspace/store/workspace-provider";
import { routes } from "@/lib/routes";
import { requireAuthUser } from "@/server/session";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return { title: { default: slug, template: `%s · maeosan` } };
}

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Params }) {
  const { slug } = await params;
  const user = await requireAuthUser(routes.workspace(slug));
  const bootstrap = await loadWorkspaceBootstrap(user.id, slug);

  return (
    <WorkspaceStoreProvider key={bootstrap.workspace.id} bootstrap={bootstrap}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceStoreProvider>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";

import { acceptInvitation } from "../actions";

export function InviteAcceptButton({ token }: { token: string }) {
  const router = useRouter();
  const action = useServerAction(acceptInvitation);
  const [redirecting, setRedirecting] = useState(false);

  async function accept() {
    const result = await action.run(token);
    if (result.ok) {
      setRedirecting(true);
      router.replace(result.data.redirectTo);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={action.error} />
      <Button size="lg" onClick={accept} loading={action.pending || redirecting} className="self-start">
        Accept & open workspace
      </Button>
    </div>
  );
}

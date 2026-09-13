"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { IconCheck } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { ChoiceChips } from "@/components/ui/segmented";
import { useServerAction } from "@/hooks/use-server-action";
import { TEAM_SIZES, USE_CASES } from "@/lib/constants";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn, slugify } from "@/lib/utils";

import { createWorkspace } from "../actions";
import { SLUG_PATTERN } from "../schemas";

type TeamSize = (typeof TEAM_SIZES)[number]["value"];
type UseCase = (typeof USE_CASES)[number]["value"];
type SlugStatus = "idle" | "invalid" | "checking" | "available" | "taken";

function useSlugStatus(slug: string): SlugStatus {
  const [checked, setChecked] = useState<{ slug: string; available: boolean } | null>(null);
  const valid = SLUG_PATTERN.test(slug);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await getSupabaseBrowserClient().rpc("is_workspace_slug_available", { p_slug: slug });
      if (!cancelled && !error) setChecked({ slug, available: Boolean(data) });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, valid]);

  if (!slug) return "idle";
  if (!valid) return "invalid";
  if (checked?.slug !== slug) return "checking";
  return checked.available ? "available" : "taken";
}

const STATUS_TEXT: Record<SlugStatus, string> = {
  idle: "Lowercase letters, numbers and dashes.",
  invalid: "Use 3–40 lowercase letters, numbers or dashes.",
  checking: "Checking…",
  available: "Available",
  taken: "Taken. Try another.",
};

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [teamSize, setTeamSize] = useState<TeamSize | null>(null);
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const action = useServerAction(createWorkspace);

  const effectiveSlug = slugEdited ? slug : slugify(name);
  const status = useSlugStatus(effectiveSlug);
  const slugError = action.fieldErrors.slug ?? (status === "taken" || (slugEdited && status === "invalid") ? STATUS_TEXT[status] : null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({ name, slug: effectiveSlug, teamSize, useCase });
    if (result.ok) {
      setRedirecting(true);
      router.push(result.data.redirectTo);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormError message={action.error} />

      <Field label="Workspace name" htmlFor="workspaceName" error={action.fieldErrors.name}>
        <Input
          id="workspaceName"
          autoComplete="organization"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(action.fieldErrors.name)}
          placeholder="Your company or team"
          className="h-12 text-[17px]"
        />
      </Field>

      <Field
        label="Workspace URL"
        htmlFor="workspaceSlug"
        error={slugError}
        hint={
          <span
            className={cn(
              "inline-flex items-center gap-1",
              status === "available" && "text-success",
              status === "checking" && "text-ink-4",
            )}
          >
            {status === "available" ? <IconCheck size={14} strokeWidth={2} /> : null}
            {STATUS_TEXT[status]}
          </span>
        }
      >
        <div
          className={cn(
            "flex h-11 items-center overflow-hidden rounded-xl border border-line-2 bg-surface transition-[border-color,box-shadow] focus-within:border-ink focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_8%,transparent)]",
            slugError && "border-danger",
          )}
        >
          <span className="flex h-full items-center border-r border-line bg-paper-2 px-3 font-mono text-[13px] text-ink-3">
            /w/
          </span>
          <input
            id="workspaceSlug"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40));
            }}
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={Boolean(slugError)}
            className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
            placeholder="your-team"
          />
        </div>
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[13px] font-medium text-ink-2">How many people work with you?</legend>
        <ChoiceChips label="Team size" value={teamSize} onChange={setTeamSize} options={TEAM_SIZES} />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[13px] font-medium text-ink-2">What does your team do?</legend>
        <ChoiceChips label="Team type" value={useCase} onChange={setUseCase} options={USE_CASES} />
      </fieldset>

      <div className="pt-2">
        <Button
          type="submit"
          size="lg"
          loading={action.pending || redirecting}
          disabled={status === "taken" || status === "invalid" || name.trim().length < 2}
        >
          Create workspace
        </Button>
      </div>
    </form>
  );
}

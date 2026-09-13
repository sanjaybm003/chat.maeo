"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ChoiceChips } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { removeMember } from "@/features/workspace/api/members";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { TEAM_SIZES, USE_CASES } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { pluralize } from "@/lib/utils";

import { deleteWorkspace, updateWorkspaceSettings } from "../api";
import { SettingRow, SettingsSection } from "./settings-chrome";

const ROLE_COPY = {
  owner: "You own this workspace. You can manage everything, including deleting it.",
  admin: "You're an admin. You can manage settings, invitations and members.",
  member: "You're a member. Admins manage the settings below.",
} as const;

export function WorkspaceSettings() {
  const store = useWorkspaceStore();
  const router = useRouter();
  const workspace = useWorkspace((state) => state.workspace);
  const myRole = useWorkspace((state) => state.myRole);
  const me = useWorkspace((state) => state.me);
  const memberCount = useWorkspace((state) => Object.keys(state.members).length);
  const isAdmin = myRole !== "member";

  const [name, setName] = useState(workspace.name);
  const [teamSize, setTeamSize] = useState(workspace.teamSize);
  const [useCase, setUseCase] = useState(workspace.useCase);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState("");

  const dirty = name.trim() !== workspace.name || teamSize !== workspace.teamSize || useCase !== workspace.useCase;

  async function save() {
    if (name.trim().length < 2) return void toast.error("Workspace names need at least 2 characters.");
    setSaving(true);
    try {
      store.getState().setWorkspace(
        await updateWorkspaceSettings(workspace.id, { name: name.trim(), team_size: teamSize, use_case: useCase }),
      );
      toast.success("Workspace updated.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save workspace settings."));
    } finally {
      setSaving(false);
    }
  }

  async function setMembersCanInvite(value: boolean) {
    const previous = workspace;
    store.getState().setWorkspace({ ...workspace, membersCanInvite: value });
    try {
      await updateWorkspaceSettings(workspace.id, { members_can_invite: value });
    } catch (error) {
      store.getState().setWorkspace(previous);
      toast.error(getErrorMessage(error));
    }
  }

  async function leave() {
    try {
      await removeMember(workspace.id, me.id);
      toast.success(`You left ${workspace.name}.`);
      router.replace(routes.home);
      router.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't leave the workspace."));
    }
  }

  async function destroy() {
    try {
      await deleteWorkspace(workspace.id, deleteSlug.trim());
      toast.success(`${workspace.name} was deleted.`);
      router.replace(routes.home);
      router.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't delete the workspace."));
      throw error;
    }
  }

  return (
    <>
      <SettingsSection title="General" description={ROLE_COPY[myRole]}>
        <fieldset disabled={!isAdmin} className="flex flex-col gap-6 disabled:opacity-70">
          <Field label="Workspace name" htmlFor="workspace-name">
            <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          </Field>
          <Field label="Workspace URL" htmlFor="workspace-url" hint="URLs can't be changed, so links people saved keep working.">
            <Input id="workspace-url" value={`/w/${workspace.slug}`} readOnly className="font-mono text-[14px] text-ink-3" />
          </Field>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-medium text-ink-2">Team size</p>
            <ChoiceChips label="Team size" value={teamSize as (typeof TEAM_SIZES)[number]["value"] | null} onChange={setTeamSize} options={TEAM_SIZES} />
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-medium text-ink-2">What the team does</p>
            <ChoiceChips label="Team type" value={useCase as (typeof USE_CASES)[number]["value"] | null} onChange={setUseCase} options={USE_CASES} />
          </div>
          {isAdmin ? (
            <div>
              <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          ) : null}
        </fieldset>
      </SettingsSection>

      <SettingsSection title="Invitations" description={`${pluralize(memberCount, "person", "people")} in ${workspace.name}.`}>
        <SettingRow
          title="Everyone can invite"
          description="Let members invite people, not just admins. Only admins can invite other admins."
          control={
            <Switch
              checked={workspace.membersCanInvite}
              onCheckedChange={(checked) => void setMembersCanInvite(checked)}
              disabled={!isAdmin}
            />
          }
        />
      </SettingsSection>

      {myRole !== "owner" ? (
        <SettingsSection title="Leave workspace" description="You'll lose access to its chats. An admin can invite you back.">
          <Button variant="danger-ghost" className="-ml-4" onClick={() => setConfirmLeave(true)}>
            Leave {workspace.name}
          </Button>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="Delete workspace"
          tone="danger"
          description="Permanently removes every chat, message and file for everyone. There is no undo."
        >
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete {workspace.name}
          </Button>
        </SettingsSection>
      )}

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={`Leave ${workspace.name}?`}
        description="You'll be removed from all of its group chats."
        confirmLabel="Leave workspace"
        onConfirm={leave}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) setDeleteSlug("");
        }}
        title={`Delete ${workspace.name}?`}
        description={
          <>
            Type <span className="font-mono text-ink">{workspace.slug}</span> to confirm.
          </>
        }
        confirmLabel="Delete forever"
        confirmDisabled={deleteSlug.trim() !== workspace.slug}
        onConfirm={destroy}
      >
        <Input value={deleteSlug} onChange={(event) => setDeleteSlug(event.target.value)} className="font-mono" autoFocus aria-label="Workspace URL" />
      </ConfirmDialog>
    </>
  );
}

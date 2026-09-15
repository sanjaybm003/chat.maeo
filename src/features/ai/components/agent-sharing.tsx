"use client";

import { useMemo } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconClose, IconLock } from "@/components/ui/icons";
import { inputStyles } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { cn, firstNameOf, joinNames, nameOf } from "@/lib/utils";
import { AGENT_MEMBER_ROLES, type AgentMember, type AgentMemberRole, type AgentUsage, type AgentVisibility } from "@/types/domain";

import { MEMBER_ROLE_LABELS } from "../access";

export interface SharingValue {
  visibility: AgentVisibility;
  usage: AgentUsage;
  members: AgentMember[];
}

interface AgentSharingProps {
  value: SharingValue;
  onChange: (next: SharingValue) => void;
  /** The agent's maker, who always has it and never appears in the list. */
  makerId: string | null;
  /** Only its maker or an admin changes who has an agent. */
  editable: boolean;
}

/** In plain words, what the choices mean for the people in this workspace. */
function outcome(value: SharingValue, names: Record<string, string>) {
  if (value.visibility === "private") return "Only you can see and use it.";
  const withRole = (roles: AgentMemberRole[]) =>
    value.members.filter((member) => roles.includes(member.role)).map((member) => names[member.userId] ?? "someone");
  const editors = withRole(["editor"]);
  const users = withRole(["user", "editor"]);
  const seers = value.visibility === "workspace" ? "Everyone here can see it" : `${joinNames(withRole(["viewer", "user", "editor"]), 3) || "Nobody else"} can see it`;
  const use =
    value.usage === "viewers"
      ? value.visibility === "workspace"
        ? "and use it"
        : "and use it"
      : value.usage === "people"
        ? `; ${users.length > 0 ? joinNames(users, 3) : "nobody else"} can use it`
        : `; only you${editors.length > 0 ? ` and ${joinNames(editors, 2)}` : ""} can use it`;
  const edit = editors.length > 0 ? ` ${joinNames(editors, 2)} can also change how it works.` : "";
  return `${seers} ${use}.`.replace(" ;", ";").replace(/\s+\./, ".") + edit;
}

export function AgentSharing({ value, onChange, makerId, editable }: AgentSharingProps) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);

  const names = useMemo(
    () => Object.fromEntries(Object.values(members).map((member) => [member.id, member.id === meId ? "you" : firstNameOf(member)])),
    [members, meId],
  );
  const addable = useMemo(
    () =>
      Object.values(members)
        .filter((member) => member.id !== makerId && !value.members.some((shared) => shared.userId === member.id))
        .sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [members, makerId, value.members],
  );
  const showPeople = value.visibility !== "private" && (value.visibility === "people" || value.usage === "people" || value.members.length > 0);

  const patch = (next: Partial<SharingValue>) => onChange({ ...value, ...next });
  const setRole = (userId: string, role: AgentMemberRole) =>
    patch({ members: value.members.map((member) => (member.userId === userId ? { ...member, role } : member)) });
  const add = (userId: string) => {
    if (!userId) return;
    // Someone picked to use it is picked to see it too.
    patch({ members: [...value.members, { userId, role: value.usage === "owner" ? "viewer" : "user" }] });
  };

  return (
    <fieldset disabled={!editable} className="flex flex-col gap-5">
      {!editable ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <IconLock size={14} className="shrink-0" />
          Only the person who made this agent, or an admin, can change who has it.
        </p>
      ) : null}

      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-2">Who can see it</p>
        <Segmented<AgentVisibility>
          label="Who can see it"
          value={value.visibility}
          onChange={(visibility) => patch({ visibility, usage: visibility === "private" ? "owner" : value.usage === "owner" && value.visibility === "private" ? "viewers" : value.usage })}
          options={[
            { value: "private", label: "Only me" },
            { value: "people", label: "People I choose" },
            { value: "workspace", label: "Everyone here" },
          ]}
        />
      </div>

      {value.visibility !== "private" ? (
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">Who can use it</p>
          <Segmented<AgentUsage>
            label="Who can use it"
            value={value.usage}
            onChange={(usage) => patch({ usage })}
            options={[
              { value: "owner", label: "Only me" },
              { value: "people", label: "People I choose" },
              { value: "viewers", label: "Everyone who sees it" },
            ]}
          />
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
            Using it means talking to it, @mentioning it, adding it to chats and giving it tasks. People who can only see it still see its replies.
          </p>
        </div>
      ) : null}

      {showPeople ? (
        <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-medium text-ink">People</p>
            <select
              value=""
              onChange={(event) => add(event.target.value)}
              aria-label="Share with someone"
              disabled={addable.length === 0}
              className={cn(inputStyles, "h-8 w-auto max-w-[220px] py-0 text-[13px]")}
            >
              <option value="">{addable.length === 0 ? "Everyone is added" : "Add a person…"}</option>
              {addable.map((member) => (
                <option key={member.id} value={member.id}>
                  {nameOf(member)}
                </option>
              ))}
            </select>
          </div>
          {value.members.length === 0 ? (
            <p className="px-4 py-3.5 text-[13px] text-ink-3">Nobody yet. Add the people who should have this agent.</p>
          ) : (
            <ul>
              {value.members.map((shared) => {
                const member = members[shared.userId];
                return (
                  <li key={shared.userId} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                    <Avatar person={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">{nameOf(member)}</span>
                      <span className="block truncate text-[12px] text-ink-3">{MEMBER_ROLE_LABELS[shared.role].summary}</span>
                    </span>
                    <select
                      value={shared.role}
                      onChange={(event) => setRole(shared.userId, event.target.value as AgentMemberRole)}
                      aria-label={`What ${nameOf(member)} can do`}
                      className={cn(inputStyles, "h-8 w-auto py-0 text-[13px]")}
                    >
                      {AGENT_MEMBER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {MEMBER_ROLE_LABELS[role].label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => patch({ members: value.members.filter((member) => member.userId !== shared.userId) })}
                      aria-label={`Stop sharing with ${nameOf(member)}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-50"
                    >
                      <IconClose size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <p className="rounded-2xl bg-paper-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2" aria-live="polite">
        {outcome(value, names)}
      </p>
    </fieldset>
  );
}

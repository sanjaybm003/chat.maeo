"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { routes } from "@/lib/routes";
import { nameOf } from "@/lib/utils";
import type { Conversation } from "@/types/domain";

import { AGENT_TOOLS } from "../agent-spec";
import { findModel } from "../models";
import { AgentAvatar, AgentGlyphMark, AgentTag } from "./agent-avatar";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 text-sm last:border-b-0">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-ink-2">{children}</dd>
    </div>
  );
}

export function AgentDetails({ conversation }: { conversation: Conversation }) {
  const agent = useWorkspace((state) => (conversation.agentId ? state.agents[conversation.agentId] : undefined));
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const myRole = useWorkspace((state) => state.myRole);
  const slug = useWorkspace((state) => state.workspace.slug);
  const aiModels = useWorkspace((state) => state.aiModels);

  if (!agent) {
    return <p className="p-5 text-sm text-ink-3">This agent was removed. The conversation stays with you.</p>;
  }

  const model = findModel(agent.model);
  const canEdit = !agent.archivedAt && (agent.createdBy === meId || myRole !== "member");
  const tools = AGENT_TOOLS.filter((tool) => agent.tools.includes(tool.id));

  return (
    <div style={personColorStyle(agent.color)}>
      <div className="relative h-24 overflow-hidden bg-person" aria-hidden="true">
        <AgentGlyphMark glyph={agent.glyph} className="absolute -right-6 -top-10 size-44 text-person-on opacity-20" />
      </div>
      <div className="-mt-12 px-5">
        <AgentAvatar agent={agent} size="2xl" className="ring-4 ring-surface" />
        <h2 className="mt-3 flex items-center gap-2 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em]">
          {agent.name}
          <AgentTag />
        </h2>
        <p className="font-mono text-[12px] text-ink-3">@{agent.handle}</p>
        {agent.tagline ? <p className="mt-2 text-sm leading-relaxed text-ink-2">{agent.tagline}</p> : null}
      </div>

      <dl className="mt-6 flex flex-col border-y border-line">
        <Row label="Model">
          {model?.label ?? agent.model}
          {!aiModels.includes(agent.model) ? <span className="ml-1.5 text-danger">not connected</span> : null}
        </Row>
        <Row label="Tools">{tools.length ? tools.map((tool) => tool.label).join(", ") : "None"}</Row>
        <Row label="Made by">{agent.createdBy === meId ? "You" : nameOf(agent.createdBy ? members[agent.createdBy] : null)}</Row>
        <Row label="Available to">{agent.visibility === "private" ? "Only its maker" : "Everyone here"}</Row>
      </dl>

      <div className="px-5 pt-5">
        <SectionLabel>Instructions</SectionLabel>
        <p className="mt-2 line-clamp-[12] whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{agent.instructions}</p>
      </div>

      {canEdit ? (
        <div className="p-5">
          <Button asChild variant="secondary" className="w-full">
            <Link href={routes.agent(slug, agent.id)}>Edit agent</Link>
          </Button>
        </div>
      ) : (
        <div className="h-5" />
      )}
    </div>
  );
}

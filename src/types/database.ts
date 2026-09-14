/**
 * Supabase schema types for maeosan.
 *
 * Mirrors supabase/migrations. Regenerate after changing the schema:
 *   npm run db:types
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type NoArgs = Record<PropertyKey, never>;

export type WorkspaceRole = "owner" | "admin" | "member";
export type InvitationStatus = "pending" | "accepted" | "revoked";
export type ConversationKind = "direct" | "group";
export type MessageKind = "text" | "system";
export type AiRunStatus = "running" | "succeeded" | "failed" | "cancelled";

type MessageRowWithExtras = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  agent_id: string | null;
  kind: MessageKind;
  body: string;
  attachments: Json;
  meta: Json;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  reactions: Json;
  reply_to: Json | null;
};

type SearchRow = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
  rank: number;
  agent_id: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          display_name: string | null;
          title: string | null;
          status_text: string | null;
          avatar_path: string | null;
          color: string;
          onboarded_at: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string;
          full_name?: string | null;
          display_name?: string | null;
          title?: string | null;
          status_text?: string | null;
          avatar_path?: string | null;
          color?: string;
          onboarded_at?: string | null;
        };
        Update: {
          full_name?: string | null;
          display_name?: string | null;
          title?: string | null;
          status_text?: string | null;
          avatar_path?: string | null;
          color?: string;
          onboarded_at?: string | null;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          team_size: string | null;
          use_case: string | null;
          members_can_invite: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          team_size?: string | null;
          use_case?: string | null;
          members_can_invite?: boolean;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          team_size?: string | null;
          use_case?: string | null;
          members_can_invite?: boolean;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          joined_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
        };
        Update: {
          role?: WorkspaceRole;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: WorkspaceRole;
          token: string;
          status: InvitationStatus;
          invited_by: string | null;
          accepted_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: WorkspaceRole;
          invited_by?: string | null;
        };
        Update: {
          status?: InvitationStatus;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          workspace_id: string;
          kind: ConversationKind;
          name: string | null;
          direct_key: string | null;
          agent_id: string | null;
          agent_key: string | null;
          created_by: string | null;
          last_message_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          kind: ConversationKind;
          name?: string | null;
          direct_key?: string | null;
          created_by?: string | null;
        };
        Update: {
          name?: string | null;
        };
        Relationships: [];
      };
      conversation_participants: {
        Row: {
          conversation_id: string;
          user_id: string;
          joined_at: string;
          last_read_at: string;
          muted: boolean;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
        };
        Update: {
          muted?: boolean;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          agent_id: string | null;
          kind: MessageKind;
          body: string;
          attachments: Json;
          meta: Json;
          reply_to_id: string | null;
          edited_at: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          version: number;
          search_vector: unknown;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body?: string;
          attachments?: Json;
          reply_to_id?: string | null;
        };
        Update: {
          body?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      message_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          conversation_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          emoji: string;
        };
        Update: never;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: number;
          workspace_id: string;
          actor_id: string | null;
          action: string;
          target_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_agents: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          name: string;
          handle: string;
          tagline: string;
          instructions: string;
          model: string;
          tools: string[];
          starters: string[];
          color: string;
          glyph: string;
          specialty: string;
          response_style: string;
          knowledge: string;
          model_mode: string;
          visibility: "workspace" | "private";
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          created_by: string;
          name: string;
          handle: string;
          tagline?: string;
          instructions: string;
          model: string;
          tools?: string[];
          starters?: string[];
          color?: string;
          glyph?: string;
          specialty?: string;
          response_style?: string;
          knowledge?: string;
          model_mode?: string;
          visibility?: "workspace" | "private";
        };
        Update: {
          name?: string;
          handle?: string;
          tagline?: string;
          instructions?: string;
          model?: string;
          tools?: string[];
          starters?: string[];
          color?: string;
          glyph?: string;
          specialty?: string;
          response_style?: string;
          knowledge?: string;
          model_mode?: string;
          visibility?: "workspace" | "private";
          archived_at?: string | null;
        };
        Relationships: [];
      };
      ai_runs: {
        Row: {
          id: string;
          workspace_id: string;
          kind: "reply" | "architect";
          agent_id: string | null;
          conversation_id: string | null;
          trigger_message_id: string | null;
          reply_message_id: string | null;
          triggered_by: string | null;
          model: string;
          status: AiRunStatus;
          cancel_requested: boolean;
          steps: Json;
          input_tokens: number;
          output_tokens: number;
          tool_calls: number;
          credits_reserved: number;
          credits_charged: number;
          error: string | null;
          route: Json;
          created_at: string;
          finished_at: string | null;
        };
        Insert: never;
        /** Server only (service role): the provider's reason for a failed run. */
        Update: { error?: string | null };
        Relationships: [];
      };
      ai_wallets: {
        Row: {
          user_id: string;
          balance: number;
          reserved: number;
          lifetime_granted: number;
          lifetime_used: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_wallet_ledger: {
        Row: {
          id: number;
          user_id: string;
          delta: number;
          balance_after: number;
          kind: "grant" | "charge" | "refund" | "adjustment";
          run_id: string | null;
          workspace_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      conversation_agents: {
        Row: {
          conversation_id: string;
          agent_id: string;
          added_by: string | null;
          added_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_workspace_slug_available: {
        Args: { p_slug: string };
        Returns: boolean;
      };
      create_workspace: {
        Args: {
          p_name: string;
          p_slug: string;
          p_team_size?: string | null;
          p_use_case?: string | null;
        };
        Returns: string;
      };
      my_workspaces: {
        Args: NoArgs;
        Returns: {
          id: string;
          name: string;
          slug: string;
          role: WorkspaceRole;
          joined_at: string;
          member_count: number;
        }[];
      };
      list_workspace_members: {
        Args: { p_workspace_id: string; p_user_id?: string | null };
        Returns: {
          user_id: string;
          role: WorkspaceRole;
          joined_at: string;
          email: string;
          full_name: string | null;
          display_name: string | null;
          title: string | null;
          status_text: string | null;
          avatar_path: string | null;
          color: string;
          last_seen_at: string | null;
        }[];
      };
      update_member_role: {
        Args: { p_workspace_id: string; p_user_id: string; p_role: WorkspaceRole };
        Returns: undefined;
      };
      remove_workspace_member: {
        Args: { p_workspace_id: string; p_user_id: string };
        Returns: undefined;
      };
      transfer_workspace_ownership: {
        Args: { p_workspace_id: string; p_user_id: string };
        Returns: undefined;
      };
      delete_workspace: {
        Args: { p_workspace_id: string; p_confirm_slug: string };
        Returns: undefined;
      };
      prepare_account_deletion: {
        Args: NoArgs;
        Returns: undefined;
      };
      invite_workspace_members: {
        Args: { p_workspace_id: string; p_emails: string[]; p_role?: WorkspaceRole };
        Returns: {
          invited_email: string;
          invite_token: string | null;
          outcome: "invited" | "resent" | "already_member" | "invalid";
        }[];
      };
      get_invitation: {
        Args: { p_token: string };
        Returns: {
          workspace_id: string;
          workspace_name: string;
          workspace_slug: string;
          email: string;
          role: WorkspaceRole;
          status: "pending" | "accepted" | "revoked" | "expired";
          expires_at: string;
          inviter_name: string;
        }[];
      };
      my_pending_invitations: {
        Args: NoArgs;
        Returns: {
          token: string;
          workspace_id: string;
          workspace_name: string;
          workspace_slug: string;
          role: WorkspaceRole;
          inviter_name: string;
          member_count: number;
          created_at: string;
          expires_at: string;
        }[];
      };
      accept_invitation: {
        Args: { p_token: string };
        Returns: string;
      };
      decline_invitation: {
        Args: { p_token: string };
        Returns: undefined;
      };
      revoke_invitation: {
        Args: { p_invitation_id: string };
        Returns: undefined;
      };
      list_conversations: {
        Args: { p_workspace_id: string; p_conversation_id?: string | null };
        Returns: {
          id: string;
          kind: ConversationKind;
          name: string | null;
          created_by: string | null;
          created_at: string;
          last_message_at: string | null;
          muted: boolean;
          last_read_at: string;
          unread_count: number;
          participants: Json;
          last_message: Json | null;
          agent_id: string | null;
          agent_ids: string[] | null;
        }[];
      };
      create_direct_conversation: {
        Args: { p_workspace_id: string; p_user_id: string };
        Returns: string;
      };
      create_group_conversation: {
        Args: { p_workspace_id: string; p_member_ids: string[]; p_name?: string | null };
        Returns: string;
      };
      add_conversation_participants: {
        Args: { p_conversation_id: string; p_user_ids: string[] };
        Returns: string;
      };
      leave_conversation: {
        Args: { p_conversation_id: string };
        Returns: undefined;
      };
      rename_conversation: {
        Args: { p_conversation_id: string; p_name: string | null };
        Returns: undefined;
      };
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_read_at?: string | null };
        Returns: string | null;
      };
      set_conversation_muted: {
        Args: { p_conversation_id: string; p_muted: boolean };
        Returns: undefined;
      };
      get_messages: {
        Args: {
          p_conversation_id: string;
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number;
        };
        Returns: MessageRowWithExtras[];
      };
      get_message_changes: {
        Args: {
          p_conversation_id: string;
          p_since: string;
          p_since_id?: string | null;
          p_limit?: number;
        };
        Returns: MessageRowWithExtras[];
      };
      search_messages: {
        Args: { p_workspace_id: string; p_query: string; p_limit?: number };
        Returns: SearchRow[];
      };
      touch_presence: {
        Args: NoArgs;
        Returns: undefined;
      };
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null };
        Returns: undefined;
      };
      delete_push_subscription: {
        Args: { p_endpoint: string };
        Returns: undefined;
      };
      health_check: {
        Args: NoArgs;
        Returns: Json;
      };
      create_agent_conversation: {
        Args: { p_agent_id: string };
        Returns: string;
      };
      cancel_ai_run: {
        Args: { p_run_id: string };
        Returns: boolean;
      };
      ai_my_usage: {
        Args: { p_days?: number; p_time_zone?: string };
        Returns: Json;
      };
      add_agent_to_conversation: {
        Args: { p_conversation_id: string; p_agent_id: string };
        Returns: boolean;
      };
      remove_agent_from_conversation: {
        Args: { p_conversation_id: string; p_agent_id: string };
        Returns: boolean;
      };
      ai_start_reply_run: {
        Args: {
          p_user_id: string;
          p_trigger_message_id: string;
          p_agent_id: string;
          p_model: string;
          p_quote?: boolean;
          p_route?: Json;
        };
        Returns: {
          o_run_id: string;
          o_reply_message_id: string;
          o_conversation_id: string;
          o_workspace_id: string;
          o_created: boolean;
        }[];
      };
      ai_start_architect_run: {
        Args: { p_user_id: string; p_workspace_id: string; p_model: string };
        Returns: string;
      };
      ai_reserve_credits: {
        Args: { p_run_id: string; p_amount: number; p_minimum?: number };
        Returns: number;
      };
      ai_settle_credits: {
        Args: {
          p_run_id: string;
          p_credits: number;
          p_input_tokens?: number;
          p_output_tokens?: number;
          p_tool_calls?: number;
        };
        Returns: number;
      };
      ai_finish_run: {
        Args: {
          p_run_id: string;
          p_status: "succeeded" | "failed" | "cancelled";
          p_body?: string | null;
          p_steps?: Json | null;
          p_error?: string | null;
        };
        Returns: boolean;
      };
      ai_fail_stale_runs: {
        Args: { p_workspace_id?: string | null };
        Returns: number;
      };
      ai_broadcast: {
        Args: { p_conversation_id: string; p_payload: Json };
        Returns: undefined;
      };
      ai_search_messages_for: {
        Args: {
          p_user_id: string;
          p_workspace_id: string;
          p_audience_conversation_id: string;
          p_query: string;
          p_limit?: number;
        };
        Returns: SearchRow[];
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      invitation_status: InvitationStatus;
      conversation_kind: ConversationKind;
      message_kind: MessageKind;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type RpcReturn<T extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][T]["Returns"];

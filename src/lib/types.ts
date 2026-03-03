export interface ExtractedTask {
  id: number;
  name: string;
  description: string;
  assignee: TeamMember | null;
  assigneeConfidence: "high" | "low";
  dueDate: string; // YYYY-MM-DD
  priority: "urgent" | "high" | "normal" | "low";
  duplicateOf?: {
    taskId: string;
    taskName: string;
    taskUrl: string;
  };
}

export interface TeamMember {
  name: string;
  clickupId: string;
  role: string;
}

export interface MeetingSummary {
  keyDecisions: string[];
  updates: string[];
  taskCount: number;
}

export interface ExtractionResult {
  summary: MeetingSummary;
  tasks: ExtractedTask[];
  clientMentioned?: string;
}

export interface PendingApproval {
  channelId: string;
  threadTs: string;
  botMessageTs: string;
  tasks: ExtractedTask[];
  submittedBy: string;
  submittedAt: number; // unix timestamp
  nudgedAt?: number;
}

// Slack interaction payload types
export interface SlackInteractionPayload {
  type: string;
  trigger_id: string;
  user: { id: string; name: string };
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string };
  actions?: Array<{
    action_id: string;
    value?: string;
    block_id?: string;
  }>;
  view?: {
    callback_id: string;
    private_metadata: string;
    state: {
      values: Record<string, Record<string, {
        value?: string;
        selected_option?: { value: string; text?: { type: string; text: string } };
      }>>;
    };
  };
}

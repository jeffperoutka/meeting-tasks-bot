import crypto from "crypto";
import type { ExtractedTask, ExtractionResult, PendingApproval } from "./types";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

// ─── Signature Verification ───────────────────────────────────────────────────

export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest("hex");
  const computedSignature = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(signature)
  );
}

// ─── Slack API Helpers ────────────────────────────────────────────────────────

async function slackApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Slack API error (${method}):`, data.error, data);
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}

// ─── Modal: Paste Transcript ──────────────────────────────────────────────────

export async function openTranscriptModal(triggerId: string) {
  return slackApi("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "transcript_submit",
      title: { type: "plain_text", text: "Paste Meeting Transcript" },
      submit: { type: "plain_text", text: "Extract Tasks" },
      blocks: [
        {
          type: "input",
          block_id: "client_block",
          optional: true,
          label: { type: "plain_text", text: "Client / Meeting Name (optional)" },
          element: {
            type: "plain_text_input",
            action_id: "client_name",
            placeholder: {
              type: "plain_text",
              text: "e.g., Elk All-Hands, Enter Health Check-in",
            },
          },
        },
        {
          type: "input",
          block_id: "transcript_block",
          label: { type: "plain_text", text: "Fathom Transcript" },
          element: {
            type: "plain_text_input",
            action_id: "transcript_text",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Paste your Fathom transcript here...",
            },
          },
        },
      ],
    },
  });
}

// ─── Modal: Edit Tasks ────────────────────────────────────────────────────────

export async function openEditModal(
  triggerId: string,
  tasks: ExtractedTask[],
  metadata: string
) {
  const blocks = tasks.map((task, i) => [
    {
      type: "header",
      text: { type: "plain_text", text: `Task ${i + 1}` },
    },
    {
      type: "input",
      block_id: `task_${i}_name`,
      label: { type: "plain_text", text: "Task Name" },
      element: {
        type: "plain_text_input",
        action_id: "value",
        initial_value: task.name,
      },
    },
    {
      type: "input",
      block_id: `task_${i}_assignee`,
      label: { type: "plain_text", text: "Assignee" },
      element: {
        type: "static_select",
        action_id: "value",
        initial_option: task.assignee
          ? {
              text: { type: "plain_text", text: task.assignee.name },
              value: task.assignee.clickupId,
            }
          : {
              text: { type: "plain_text", text: "Unassigned" },
              value: "unassigned",
            },
        options: [
          ...TEAM_MEMBERS.map((m) => ({
            text: { type: "plain_text", text: `${m.name} (${m.role})` },
            value: m.clickupId,
          })),
          {
            text: { type: "plain_text", text: "Unassigned" },
            value: "unassigned",
          },
        ],
      },
    },
    {
      type: "input",
      block_id: `task_${i}_priority`,
      label: { type: "plain_text", text: "Priority" },
      element: {
        type: "static_select",
        action_id: "value",
        initial_option: {
          text: { type: "plain_text", text: task.priority },
          value: task.priority,
        },
        options: ["urgent", "high", "normal", "low"].map((p) => ({
          text: { type: "plain_text", text: p },
          value: p,
        })),
      },
    },
  ]);

  return slackApi("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "edit_tasks_submit",
      private_metadata: metadata,
      title: { type: "plain_text", text: "Edit Tasks" },
      submit: { type: "plain_text", text: "Approve & Create" },
      blocks: blocks.flat(),
    },
  });
}

// ─── Post Task List with Buttons ──────────────────────────────────────────────

export async function postTaskListForApproval(
  channelId: string,
  result: ExtractionResult,
  submittedBy: string
): Promise<{ messageTs: string }> {
  const { summary, tasks } = result;

  // Build summary section
  let summaryText = "*Meeting Summary*\n";
  if (summary.keyDecisions.length > 0) {
    summaryText += `_Key decisions:_ ${summary.keyDecisions.join("; ")}\n`;
  }
  if (summary.updates.length > 0) {
    summaryText += `_Updates:_ ${summary.updates.join("; ")}\n`;
  }

  // Build task list
  let taskListText = `\n*${tasks.length} Action Items Extracted — Awaiting Approval*\n\n`;

  for (const task of tasks) {
    const assigneeLabel = task.assignee
      ? task.assigneeConfidence === "low"
        ? `⚠️ ${task.assignee.name} _(auto-assigned — needs triage)_`
        : task.assignee.name
      : "⚠️ _Unassigned — needs triage_";

    const dupeWarning = task.duplicateOf
      ? `\n   ⚠️ _Similar task exists:_ <${task.duplicateOf.taskUrl}|${task.duplicateOf.taskName}>`
      : "";

    taskListText += `*${task.id}. ${task.name}*\n`;
    taskListText += `   Assignee: ${assigneeLabel}\n`;
    taskListText += `   Due: ${task.dueDate}\n`;
    taskListText += `   Priority: ${task.priority}\n`;
    taskListText += `   > ${task.description}${dupeWarning}\n\n`;
  }

  // Post as a new message (not in a thread — this IS the parent)
  const data = await slackApi("chat.postMessage", {
    channel: channelId,
    text: `${tasks.length} tasks extracted from meeting transcript`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: summaryText },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: taskListText },
      },
      { type: "divider" },
      {
        type: "actions",
        block_id: "approval_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ Approve All" },
            style: "primary",
            action_id: "approve_all",
            value: JSON.stringify({ submittedBy }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "✏️ Edit Tasks" },
            action_id: "edit_tasks",
            value: JSON.stringify({ submittedBy }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "❌ Reject" },
            style: "danger",
            action_id: "reject_tasks",
            value: JSON.stringify({ submittedBy }),
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Submitted by <@${submittedBy}> • Tasks will be created in *Quick To-do's* in ClickUp`,
          },
        ],
      },
    ],
  });

  return { messageTs: data.ts };
}

// ─── Post Confirmation ────────────────────────────────────────────────────────

export async function postConfirmation(
  channelId: string,
  messageTs: string,
  createdTasks: Array<{ name: string; assignee: string; url: string }>
) {
  let text = `*✅ All ${createdTasks.length} tasks created in ClickUp*\n\n`;
  for (const task of createdTasks) {
    text += `• <${task.url}|${task.name}> — ${task.assignee}\n`;
  }

  // Reply in thread to the approval message
  await slackApi("chat.postMessage", {
    channel: channelId,
    thread_ts: messageTs,
    text,
  });

  // Update the original message to remove buttons
  await slackApi("chat.update", {
    channel: channelId,
    ts: messageTs,
    text: `✅ ${createdTasks.length} tasks approved and created in ClickUp`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*✅ ${createdTasks.length} tasks approved and created in ClickUp*\nAll tasks are in the Quick To-do's list.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: createdTasks
            .map((t) => `• <${t.url}|${t.name}> — ${t.assignee}`)
            .join("\n"),
        },
      },
    ],
  });
}

// ─── Nudge Hannah ─────────────────────────────────────────────────────────────

export async function nudgeInThread(channelId: string, messageTs: string) {
  const hannahSlackId = process.env.HANNAH_SLACK_ID;
  const mention = hannahSlackId ? `<@${hannahSlackId}>` : "Hannah";

  await slackApi("chat.postMessage", {
    channel: channelId,
    thread_ts: messageTs,
    text: `👋 ${mention} — this task list has been waiting for approval for 4+ hours. Can you review when you get a chance?`,
  });
}

// ─── Read Thread Replies ──────────────────────────────────────────────────────

export async function getThreadReplies(channelId: string, threadTs: string) {
  return slackApi("conversations.replies", {
    channel: channelId,
    ts: threadTs,
    limit: 50,
  });
}

// ─── Get Channel History ──────────────────────────────────────────────────────

export async function getRecentMessages(channelId: string, limit = 10) {
  return slackApi("conversations.history", {
    channel: channelId,
    limit,
  });
}

// ─── Team Members Reference ───────────────────────────────────────────────────

export const TEAM_MEMBERS = [
  {
    name: "Sasha Kertamus",
    clickupId: "107598606",
    role: "SEO / QA / Deliverables",
    keywords: [
      "seo", "qa", "quality", "keyword", "audit", "content review",
      "deliverable", "standards", "research", "gap analysis",
    ],
  },
  {
    name: "Hannah Pinkerton",
    clickupId: "107556476",
    role: "PM / Client Success",
    keywords: [
      "client", "onboarding", "deck", "project", "coordinate", "vendor",
      "follow up", "schedule", "meeting", "status", "update",
    ],
  },
  {
    name: "Jeff Peroutka",
    clickupId: "300808837",
    role: "Operations",
    keywords: [
      "operations", "strategy", "vendor management", "system", "tool",
      "pricing", "process", "decision",
    ],
  },
  {
    name: "Aidan",
    clickupId: "107556471",
    role: "Sales",
    keywords: [
      "sales", "proposal", "lead", "prospect", "pricing", "close",
      "pipeline", "acquisition", "deal",
    ],
  },
];

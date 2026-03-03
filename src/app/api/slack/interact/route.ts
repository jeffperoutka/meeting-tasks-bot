import { NextRequest, NextResponse } from "next/server";
import {
  verifySlackSignature,
  postTaskListForApproval,
  postConfirmation,
  openEditModal,
  TEAM_MEMBERS,
} from "@/lib/slack";
import { extractTasksFromTranscript } from "@/lib/claude";
import { createAllTasks, getRecentTasks } from "@/lib/clickup";
import type { SlackInteractionPayload, ExtractedTask } from "@/lib/types";

// In-memory store for pending task lists (keyed by bot message ts)
// In production, you'd use Vercel KV or a database
const pendingTasks = new Map<string, ExtractedTask[]>();

export async function POST(req: NextRequest) {
  const body = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (!verifySlackSignature(body, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Slack sends interaction payloads as form-encoded with a "payload" field
  const params = new URLSearchParams(body);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "No payload" }, { status: 400 });
  }

  const payload: SlackInteractionPayload = JSON.parse(payloadStr);

  // Handle different interaction types
  if (payload.type === "view_submission") {
    return handleViewSubmission(payload);
  }

  if (payload.type === "block_actions") {
    return handleBlockAction(payload);
  }

  return new NextResponse("", { status: 200 });
}

// ─── Handle Modal Submissions ─────────────────────────────────────────────────

async function handleViewSubmission(payload: SlackInteractionPayload) {
  const callbackId = payload.view?.callback_id;

  if (callbackId === "transcript_submit") {
    // User submitted a transcript via the /transcribe modal
    const values = payload.view!.state.values;
    const transcript = values.transcript_block.transcript_text.value || "";
    const clientName = values.client_block?.client_name?.value || undefined;
    const submittedBy = payload.user.id;

    // Acknowledge modal immediately (close it)
    // Then process async
    processTranscript(transcript, clientName, submittedBy).catch((err: unknown) =>
      console.error("Transcript processing failed:", err)
    );

    return NextResponse.json({
      response_action: "clear",
    });
  }

  if (callbackId === "edit_tasks_submit") {
    // User submitted edited tasks
    const metadata = JSON.parse(payload.view!.private_metadata);
    const values = payload.view!.state.values;

    // Reconstruct tasks from the edit modal
    const editedTasks: ExtractedTask[] = [];
    let i = 0;
    while (values[`task_${i}_name`]) {
      const name = values[`task_${i}_name`].value.value || "";
      const assigneeId = values[`task_${i}_assignee`].value.selected_option?.value;
      const priority = values[`task_${i}_priority`].value.selected_option?.value as ExtractedTask["priority"];

      const member = TEAM_MEMBERS.find((m) => m.clickupId === assigneeId);

      editedTasks.push({
        id: i + 1,
        name,
        description: metadata.descriptions?.[i] || "",
        assignee: member || null,
        assigneeConfidence: "high",
        dueDate: metadata.dueDates?.[i] || getFriday(),
        priority: priority || "normal",
      });
      i++;
    }

    // Create all tasks in ClickUp
    createAndConfirm(
      editedTasks,
      metadata.channelId,
      metadata.messageTs
    ).catch((err) => console.error("Task creation failed:", err));

    return NextResponse.json({ response_action: "clear" });
  }

  return new NextResponse("", { status: 200 });
}

// ─── Handle Button Clicks ─────────────────────────────────────────────────────

async function handleBlockAction(payload: SlackInteractionPayload) {
  const action = payload.actions?.[0];
  if (!action) return new NextResponse("", { status: 200 });

  const channelId = payload.channel?.id || process.env.SLACK_CHANNEL_ID!;
  const messageTs = payload.message?.ts || "";

  if (action.action_id === "approve_all") {
    // Get the stored tasks
    const tasks = pendingTasks.get(messageTs);
    if (tasks) {
      createAndConfirm(tasks, channelId, messageTs).catch((err) =>
        console.error("Approve + create failed:", err)
      );
    }
    return new NextResponse("", { status: 200 });
  }

  if (action.action_id === "edit_tasks") {
    const tasks = pendingTasks.get(messageTs);
    if (tasks && payload.trigger_id) {
      const metadata = JSON.stringify({
        channelId,
        messageTs,
        descriptions: tasks.map((t) => t.description),
        dueDates: tasks.map((t) => t.dueDate),
      });

      openEditModal(payload.trigger_id, tasks, metadata).catch((err) =>
        console.error("Failed to open edit modal:", err)
      );
    }
    return new NextResponse("", { status: 200 });
  }

  if (action.action_id === "reject_tasks") {
    pendingTasks.delete(messageTs);

    // Update the message to show rejection
    await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        ts: messageTs,
        text: "❌ Task list rejected.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `❌ *Task list rejected* by <@${payload.user.id}>. No tasks were created.`,
            },
          },
        ],
      }),
    });

    return new NextResponse("", { status: 200 });
  }

  return new NextResponse("", { status: 200 });
}

// ─── Process Transcript (async) ───────────────────────────────────────────────

async function processTranscript(
  transcript: string,
  clientName: string | undefined,
  submittedBy: string
) {
  const channelId = process.env.SLACK_CHANNEL_ID!;

  // Get existing tasks for dedup check
  let existingTasks: Array<{ id: string; name: string; url: string }> = [];
  try {
    existingTasks = await getRecentTasks(50);
  } catch {
    existingTasks = [];
  }

  // Extract tasks using Claude
  const result = await extractTasksFromTranscript(
    transcript,
    clientName,
    existingTasks
  );

  // Post the task list to Slack with approval buttons
  const { messageTs } = await postTaskListForApproval(
    channelId,
    result,
    submittedBy
  );

  // Store tasks for when approval comes
  pendingTasks.set(messageTs, result.tasks);

  // Auto-cleanup after 7 days
  setTimeout(
    () => pendingTasks.delete(messageTs),
    7 * 24 * 60 * 60 * 1000
  );
}

// ─── Create Tasks & Post Confirmation ─────────────────────────────────────────

async function createAndConfirm(
  tasks: ExtractedTask[],
  channelId: string,
  messageTs: string
) {
  const created = await createAllTasks(tasks);
  await postConfirmation(channelId, messageTs, created);
  pendingTasks.delete(messageTs);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFriday(): string {
  const today = new Date();
  const friday = new Date(today);
  friday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
  return friday.toISOString().split("T")[0];
}

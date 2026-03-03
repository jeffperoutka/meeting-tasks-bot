import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult, ExtractedTask, TeamMember } from "./types";
import { TEAM_MEMBERS } from "./slack";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ─── Task Extraction ──────────────────────────────────────────────────────────

export async function extractTasksFromTranscript(
  transcript: string,
  clientName?: string,
  existingTasks?: Array<{ id: string; name: string; url: string }>
): Promise<ExtractionResult> {
  const existingTasksContext = existingTasks?.length
    ? `\n\nEXISTING TASKS IN CLICKUP (check for duplicates):\n${existingTasks
        .map((t) => `- [${t.id}] ${t.name} (${t.url})`)
        .join("\n")}`
    : "";

  const today = new Date();
  const friday = new Date(today);
  friday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
  const fridayStr = friday.toISOString().split("T")[0];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are an expert at extracting action items from meeting transcripts. Analyze this Fathom meeting transcript and extract every actionable task.

## Team Members & Roles (use these for assignment):
${TEAM_MEMBERS.map(
  (m) => `- ${m.name} (ClickUp ID: ${m.clickupId}) — ${m.role}. Assign when task involves: ${m.keywords.join(", ")}`
).join("\n")}

## Rules:
1. Extract EVERY commitment, assignment, request, or follow-up action
2. Do NOT extract general discussion, opinions, or completed items being reported on
3. Task names: clear, action-oriented, start with a verb, under 80 characters
4. Descriptions: 2-3 sentences with meeting context — what was discussed, requirements, who's involved
5. Assignee: Match based on who was mentioned as responsible or role alignment. If unclear, set assignee to null and confidence to "low"
6. Due dates: Default to end of this week (${fridayStr}) unless the transcript specifies otherwise. Use explicit deadlines when mentioned ("by Wednesday", "before March 10th", "ASAP" = tomorrow)
7. Priority: urgent (hard deadline <48h or client upset), high (time-sensitive, affects delivery), normal (standard follow-up), low (nice-to-have)
8. If a client name is mentioned in the task context, include it in the task name
${existingTasksContext ? `9. Check each extracted task against the existing ClickUp tasks listed below. If a task is very similar to an existing one, include the duplicateOf field.` : ""}
${existingTasksContext}

## Meeting Context:
${clientName ? `Client/Meeting: ${clientName}` : "No client specified"}
Today's date: ${today.toISOString().split("T")[0]}
End of week: ${fridayStr}

## Transcript:
${transcript}

## Required Output Format (JSON):
{
  "summary": {
    "keyDecisions": ["Decision 1", "Decision 2"],
    "updates": ["Update 1", "Update 2"],
    "taskCount": 5
  },
  "tasks": [
    {
      "id": 1,
      "name": "Action-oriented task name",
      "description": "2-3 sentence context from the meeting.",
      "assignee": { "name": "Person Name", "clickupId": "123", "role": "Their Role" },
      "assigneeConfidence": "high",
      "dueDate": "YYYY-MM-DD",
      "priority": "normal",
      "duplicateOf": null
    }
  ],
  "clientMentioned": "Client Name or null"
}

Return ONLY valid JSON. No markdown, no explanation.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse the JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude did not return valid JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]) as ExtractionResult;

  // Validate and normalize
  parsed.tasks = parsed.tasks.map((task, i) => ({
    ...task,
    id: i + 1,
    assignee: task.assignee
      ? TEAM_MEMBERS.find((m) => m.clickupId === task.assignee?.clickupId) ||
        task.assignee
      : null,
    assigneeConfidence: task.assigneeConfidence || "high",
    priority: task.priority || "normal",
    dueDate: task.dueDate || fridayStr,
  }));

  parsed.summary.taskCount = parsed.tasks.length;

  return parsed;
}

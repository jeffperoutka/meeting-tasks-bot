import type { ExtractedTask } from "./types";

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const QUICK_TODOS_LIST_ID = "901815203192";

// ─── ClickUp API Helper ──────────────────────────────────────────────────────

async function clickupApi(
  path: string,
  method = "GET",
  body?: Record<string, unknown>
) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    method,
    headers: {
      Authorization: CLICKUP_API_TOKEN,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error(`ClickUp API error (${path}):`, error);
    throw new Error(`ClickUp API error: ${res.status} ${error}`);
  }

  return res.json();
}

// ─── Create a Task ────────────────────────────────────────────────────────────

export async function createClickUpTask(task: ExtractedTask): Promise<{
  id: string;
  name: string;
  url: string;
  assignee: string;
}> {
  const priorityMap: Record<string, number> = {
    urgent: 1,
    high: 2,
    normal: 3,
    low: 4,
  };

  const body: Record<string, unknown> = {
    name: task.name,
    description: task.description,
    priority: priorityMap[task.priority] || 3,
    due_date: new Date(task.dueDate).getTime(),
    due_date_time: false,
  };

  if (task.assignee) {
    body.assignees = [parseInt(task.assignee.clickupId)];
  }

  const data = await clickupApi(
    `/list/${QUICK_TODOS_LIST_ID}/task`,
    "POST",
    body
  );

  return {
    id: data.id,
    name: data.name,
    url: data.url,
    assignee: task.assignee?.name || "Unassigned",
  };
}

// ─── Get Recent Tasks (for dedup) ─────────────────────────────────────────────

export async function getRecentTasks(
  limit = 50
): Promise<Array<{ id: string; name: string; url: string }>> {
  const data = await clickupApi(
    `/list/${QUICK_TODOS_LIST_ID}/task?statuses[]=to%20do&statuses[]=in%20progress&limit=${limit}&order_by=created&reverse=true`
  );

  return (data.tasks || []).map(
    (t: { id: string; name: string; url: string }) => ({
      id: t.id,
      name: t.name,
      url: t.url,
    })
  );
}

// ─── Create Multiple Tasks ────────────────────────────────────────────────────

export async function createAllTasks(
  tasks: ExtractedTask[]
): Promise<Array<{ name: string; assignee: string; url: string }>> {
  const results = [];

  for (const task of tasks) {
    try {
      const created = await createClickUpTask(task);
      results.push(created);
    } catch (err) {
      console.error(`Failed to create task: ${task.name}`, err);
      results.push({
        name: `❌ FAILED: ${task.name}`,
        assignee: task.assignee?.name || "Unknown",
        url: "#",
      });
    }
  }

  return results;
}

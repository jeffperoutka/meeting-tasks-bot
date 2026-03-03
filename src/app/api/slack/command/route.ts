import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, openTranscriptModal } from "@/lib/slack";

// Slack sends slash commands as application/x-www-form-urlencoded
export async function POST(req: NextRequest) {
  const body = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (!verifySlackSignature(body, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get("command");
  const triggerId = params.get("trigger_id");

  if (command === "/transcribe" && triggerId) {
    // Open the modal for pasting transcript — must respond within 3 seconds
    // so we do this async and return immediately
    openTranscriptModal(triggerId).catch((err) =>
      console.error("Failed to open modal:", err)
    );

    // Acknowledge the command (empty 200 = no visible response)
    return new NextResponse("", { status: 200 });
  }

  return NextResponse.json({ error: "Unknown command" }, { status: 400 });
}

import { NextRequest, NextResponse } from "next/server";
import { nudgeInThread, getRecentMessages } from "@/lib/slack";

// This endpoint is called by Vercel Cron every hour
// It checks for unapproved task lists older than 4 hours and nudges Hannah

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channelId = process.env.SLACK_CHANNEL_ID!;

  try {
    // Get recent messages from the channel
    const data = await getRecentMessages(channelId, 20);
    const messages = data.messages || [];

    const now = Math.floor(Date.now() / 1000);
    const fourHoursAgo = now - 4 * 60 * 60;

    let nudgeCount = 0;

    for (const msg of messages) {
      // Look for our bot's task list messages (they have the approval_actions block)
      if (
        msg.bot_id &&
        msg.blocks?.some(
          (b: { block_id?: string }) => b.block_id === "approval_actions"
        )
      ) {
        const msgTs = parseFloat(msg.ts);

        // If older than 4 hours, check if we already nudged
        if (msgTs < fourHoursAgo) {
          // Check thread for existing nudge
          const threadData = await fetch(
            `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${msg.ts}&limit=10`,
            {
              headers: {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
              },
            }
          ).then((r) => r.json());

          const replies = threadData.messages || [];
          const alreadyNudged = replies.some(
            (r: { text?: string }) =>
              r.text?.includes("waiting for approval")
          );

          if (!alreadyNudged) {
            await nudgeInThread(channelId, msg.ts);
            nudgeCount++;
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      nudged: nudgeCount,
      checked: messages.length,
    });
  } catch (err) {
    console.error("Nudge cron error:", err);
    return NextResponse.json(
      { error: "Nudge check failed" },
      { status: 500 }
    );
  }
}

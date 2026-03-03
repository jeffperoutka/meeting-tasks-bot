# Meeting Tasks Bot — Setup Guide

## What This Does
Type `/transcribe` in Slack → paste a Fathom transcript → bot extracts tasks → Hannah approves → tasks auto-created in ClickUp.

---

## Step 1: Deploy to Vercel

1. Push this folder to a new GitHub repo (e.g., `meeting-tasks-bot`)
2. Import the repo in Vercel (vercel.com/new)
3. Don't add env vars yet — we'll do that after creating the Slack app
4. Deploy it — note the URL (e.g., `https://meeting-tasks-bot.vercel.app`)

---

## Step 2: Create the Slack App

1. Go to **https://api.slack.com/apps** → "Create New App" → "From scratch"
2. Name: `Meeting Tasks Bot`
3. Workspace: AEO Labs

### Configure Slash Command
1. Left sidebar → **Slash Commands** → "Create New Command"
2. Fill in:
   - Command: `/transcribe`
   - Request URL: `https://YOUR-VERCEL-URL/api/slack/command`
   - Short Description: `Extract tasks from a meeting transcript`
   - Usage Hint: `Paste your Fathom transcript`
3. Save

### Configure Interactivity
1. Left sidebar → **Interactivity & Shortcuts** → Toggle ON
2. Request URL: `https://YOUR-VERCEL-URL/api/slack/interact`
3. Save

### Set Bot Permissions
1. Left sidebar → **OAuth & Permissions**
2. Under **Bot Token Scopes**, add these scopes:
   - `chat:write`
   - `chat:write.public`
   - `commands`
   - `channels:history`
   - `channels:read`
3. Scroll up → "Install to Workspace" → Allow

### Copy Credentials
After installing, you'll see:
- **Bot User OAuth Token** (starts with `xoxb-`) → This is your `SLACK_BOT_TOKEN`
- Go to **Basic Information** → **Signing Secret** → This is your `SLACK_SIGNING_SECRET`

---

## Step 3: Get API Keys

### Anthropic (Claude)
1. Go to **https://console.anthropic.com** → API Keys → Create Key
2. Copy it → This is your `ANTHROPIC_API_KEY`

### ClickUp
1. Go to **https://app.clickup.com/settings/apps** → Generate API Token
2. Copy it → This is your `CLICKUP_API_TOKEN`

### Hannah's Slack ID
1. In Slack, click on Hannah's profile → "..." menu → "Copy member ID"
2. This is your `HANNAH_SLACK_ID`

---

## Step 4: Add Environment Variables to Vercel

Go to your Vercel project → Settings → Environment Variables → Add:

| Variable | Value |
|----------|-------|
| `SLACK_BOT_TOKEN` | `xoxb-...` (from Step 2) |
| `SLACK_SIGNING_SECRET` | (from Step 2) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` (from Step 3) |
| `CLICKUP_API_TOKEN` | `pk_...` (from Step 3) |
| `SLACK_CHANNEL_ID` | `C0AJ2HVFQJF` |
| `HANNAH_SLACK_ID` | (from Step 3) |
| `CRON_SECRET` | (generate any random string) |

Then redeploy: Vercel → Deployments → Redeploy

---

## Step 5: Invite the Bot

1. In Slack, go to `#meeting-transcripts`
2. Type `/invite @Meeting Tasks Bot`
3. Test it: type `/transcribe` and paste a sample transcript

---

## How It Works

```
/transcribe → Modal opens → Paste Fathom transcript
                               ↓
                    Claude extracts tasks
                               ↓
              Bot posts task list with buttons
                               ↓
              ┌──────────┬──────────┬──────────┐
              │ Approve  │  Edit    │  Reject  │
              └──────────┴──────────┴──────────┘
                   ↓           ↓           ↓
            ClickUp tasks  Edit modal   Cancelled
              created       → Approve
                               ↓
                         ClickUp tasks
                           created
```

### Auto-Nudge
If nobody approves within 4 hours, the bot nudges Hannah in the thread.

### Dedup Check
Before posting tasks, the bot checks existing ClickUp tasks in "Quick To-do's" and flags potential duplicates.

---

## Troubleshooting

**Bot doesn't respond to /transcribe:**
- Check Vercel logs for errors
- Verify the slash command URL is correct
- Make sure the bot is installed to the workspace

**Buttons don't work:**
- Check the Interactivity Request URL is correct
- Must match `https://YOUR-URL/api/slack/interact`

**Tasks not creating in ClickUp:**
- Verify `CLICKUP_API_TOKEN` is valid
- Check Vercel logs for ClickUp API errors

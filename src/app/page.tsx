export default function Home() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: "600px" }}>
      <h1>Meeting Tasks Bot</h1>
      <p>This bot converts Fathom meeting transcripts into ClickUp tasks.</p>
      <p>Use <code>/transcribe</code> in Slack to get started.</p>
    </div>
  );
}

"use client";

import { useState } from "react";

const PRESETS: Record<string, string> = {
  custom: "",
  google_search: `Go to google.com, accept any cookie dialogs, then search for "OpenAI computer use agent" and tell me the top 3 results.`,
  slawk_dm: `Go to slawk.com and log in if needed. Then:
1. Find the "general" channel in the sidebar
2. Click on it to open it
3. Type "Hello from CUA agent!" in the message box
4. Send the message
5. Verify the message appears in the chat`,
  wikipedia: `Go to wikipedia.org, search for "Large language model", and tell me the first paragraph of the article.`,
  slawk_login: `Go to slawk.ncvgl.com, log in with email demo@slawk.dev and password tryme123, open user profile, then logout.`,
  slawk_file_upload: `Go to slawk.ncvgl.com and log in with email demo@slawk.dev and password tryme123. Then:
1. Check if a private channel called "qa-testing" exists in the sidebar. If not, create it using "Add channels".
2. Open the "qa-testing" channel.
3. Click the + button next to the message input to upload a file.
4. Upload any available file (or create a dummy text file if prompted).
5. Verify the file appears in the channel.
6. Log out.`,
  slawk_channel_create: `Go to slawk.ncvgl.com and log in with email demo@slawk.dev and password tryme123. Then:
1. Create a new public channel called "test-channel-qa"
2. Set the channel description to "Automated QA testing channel"
3. Verify you land inside the newly created channel
4. Send a message saying "Channel created successfully"
5. Log out.`,
  slawk_edit_profile: `Go to slawk.ncvgl.com and log in with email demo@slawk.dev and password tryme123. Then:
1. Open your user profile settings
2. Change the display name to "QA Bot"
3. Set the status to "Testing in progress"
4. Save the changes
5. Verify the updated name or status is visible
6. Log out.`,
  slawk_thread_reply: `Go to slawk.ncvgl.com and log in with email demo@slawk.dev and password tryme123. Then:
1. Open the "general" channel
2. Find the most recent message in the channel
3. Click on it to open a thread
4. Reply in the thread with "Automated thread reply from QA agent"
5. Verify the reply appears in the thread
6. Log out.`,
  slawk_duplicate_msg_bug: `Go to slawk.ncvgl.com and log in with email demo@slawk.dev and password tryme123. Then:
1. Open the "general" channel
2. Send a unique message: "duplicate-check-test"
3. IMMEDIATELY after sending, carefully look at the message list and count how many times "duplicate-check-test" appears. Note this count.
4. Press Cmd+R to refresh the page
5. Wait for the page to fully reload and log back in if needed
6. Open the "general" channel again
7. Count how many times "duplicate-check-test" appears now

EXPECTED BEHAVIOR: The message should appear exactly once both before and after refresh.
BUG TO CHECK: If the message appears MORE than once before refresh but only once after refresh, that is a duplicate message rendering bug — report as platform_bug.
If the message appears exactly once both times, the behavior is correct — report as pass.`,
  slawk_android_thread: `Test on Android (Pixel 7). Go to slawk.ncvgl.com and log in with email demo@slawk.dev and password tryme123. Then:
1. Open the "general" channel
2. Find a recent message and tap on it to open its thread
3. Reply in the thread with "Android thread reply from QA"
4. Verify the reply appears in the thread
5. Close the thread panel (tap the X or back button)
6. Find the same message again and tap on it to reopen the thread
7. Verify your previous reply is still visible
8. Send another reply: "Second reply after reopen"
9. Verify both replies are visible in the thread`,
};

const PRESET_LABELS: Record<string, string> = {
  custom: "Custom",
  google_search: "Google Search",
  slawk_dm: "Slawk DM Flow",
  slawk_login: "Slawk Login Flow",
  slawk_file_upload: "Slawk File Upload",
  slawk_channel_create: "Slawk Channel Create",
  slawk_edit_profile: "Slawk Edit Profile",
  slawk_thread_reply: "Slawk Thread Reply",
  slawk_duplicate_msg_bug: "Slawk Duplicate Msg Bug",
  slawk_android_thread: "Slawk Android Thread",
  wikipedia: "Wikipedia Lookup",
};

type Props = {
  onRun: (prompt: string) => void;
  onStop: () => void;
  isRunning: boolean;
};

export default function PromptBar({ onRun, onStop, isRunning }: Props) {
  const [preset, setPreset] = useState("slawk_login");
  const [prompt, setPrompt] = useState(PRESETS["slawk_login"]);

  const handlePresetChange = (value: string) => {
    setPreset(value);
    if (value !== "custom") {
      setPrompt(PRESETS[value] ?? "");
    }
  };

  const handleRun = () => {
    const text = prompt.trim();
    if (!text) return;
    onRun(text);
  };

  return (
    <div className="prompt-bar">
      <div className="prompt-bar-top">
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value)}
        >
          {Object.entries(PRESET_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          if (preset !== "custom") setPreset("custom");
        }}
        placeholder="Describe what the agent should do in the browser..."
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isRunning) {
            e.preventDefault();
            handleRun();
          }
        }}
      />
      <div className="prompt-bar-actions">
        {isRunning && (
          <button className="btn btn-danger" onClick={onStop}>
            Stop
          </button>
        )}
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            alignSelf: "center",
          }}
        >
          Cmd+Enter to run
        </span>
        <button
          className="btn btn-primary"
          onClick={handleRun}
          disabled={!prompt.trim()}
        >
          Run
        </button>
      </div>
    </div>
  );
}

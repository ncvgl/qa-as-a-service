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
};

const PRESET_LABELS: Record<string, string> = {
  custom: "Custom",
  google_search: "Google Search",
  slawk_dm: "Slawk DM Flow",
  slawk_login: "Slawk Login Flow",
  slawk_file_upload: "Slawk File Upload",
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
          disabled={isRunning}
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
        disabled={isRunning}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isRunning) {
            e.preventDefault();
            handleRun();
          }
        }}
      />
      <div className="prompt-bar-actions">
        {isRunning ? (
          <button className="btn btn-danger" onClick={onStop}>
            Stop
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

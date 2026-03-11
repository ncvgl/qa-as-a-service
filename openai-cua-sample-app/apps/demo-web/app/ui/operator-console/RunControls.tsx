"use client";

import type {
  BrowserMode,
  ExecutionMode,
  ResponseTurnBudget,
  ScenarioManifest,
} from "@cua-sample/replay-schema";

import {
  browserHelpText,
  engineHelpText,
  statelessHelpText,
  turnBudgetHelpText,
  verificationHelpText,
} from "./helpers";
import type { ActionButtonsProps, CustomPreset } from "./types";

type RunControlsProps = ActionButtonsProps & {
  browserMode: BrowserMode;
  controlsLocked: boolean;
  customPresets: CustomPreset[];
  maxResponseTurns: ResponseTurnBudget;
  mode: ExecutionMode;
  onBrowserModeChange: (value: BrowserMode) => void;
  onMaxResponseTurnsChange: (value: ResponseTurnBudget) => void;
  onModeChange: (value: ExecutionMode) => void;
  onPromptChange: (value: string) => void;
  onScenarioChange: (value: string) => void;
  onStatelessModeChange: (value: boolean) => void;
  onVerificationEnabledChange: (value: boolean) => void;
  prompt: string;
  scenarios: ScenarioManifest[];
  selectedScenarioId: string;
  showActionButtons?: boolean;
  statelessMode: boolean;
  verificationEnabled: boolean;
};

type InfoPopoverProps = {
  id: string;
  label: string;
  text: string;
};

function InfoPopover({ id, label, text }: InfoPopoverProps) {
  return (
    <span className="fieldInfo">
      <button
        aria-describedby={id}
        aria-label={`${label} help`}
        className="fieldInfoButton"
        type="button"
      >
        i
      </button>
      <span className="fieldPopover" id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}

function SegmentControl<T extends string>({
  ariaLabel,
  disabled,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <div aria-label={ariaLabel} className="segmentControl" role="tablist">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={`segmentButton ${value === option.value ? "isActive" : ""}`}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RunActionButtons({
  onResetWorkspace,
  onStartRun,
  onStopRun,
  pendingAction,
  resetDisabled,
  startDisabled,
  stopDisabled,
}: ActionButtonsProps) {
  return (
    <div className="stageToolbarActions">
      <button
        className="primaryButton"
        disabled={startDisabled}
        onClick={() => void onStartRun()}
        type="button"
      >
        {pendingAction === "start" ? "Starting..." : "Start Run"}
      </button>
      <button
        className="secondaryButton"
        disabled={stopDisabled}
        onClick={() => void onStopRun()}
        type="button"
      >
        {pendingAction === "stop" ? "Stopping..." : "Stop"}
      </button>
      <button
        className="secondaryButton"
        disabled={resetDisabled}
        onClick={() => void onResetWorkspace()}
        type="button"
      >
        {pendingAction === "reset" ? "Resetting..." : "Reset Workspace"}
      </button>
    </div>
  );
}

export function RunControls({
  browserMode,
  controlsLocked,
  customPresets,
  maxResponseTurns,
  mode,
  onBrowserModeChange,
  onMaxResponseTurnsChange,
  onModeChange,
  onPromptChange,
  onScenarioChange,
  onStatelessModeChange,
  onVerificationEnabledChange,
  prompt,
  scenarios,
  selectedScenarioId,
  showActionButtons = true,
  statelessMode,
  verificationEnabled,
  ...actionButtons
}: RunControlsProps) {
  return (
    <aside className="panel controlsPanel">
      <div className="controlsHeader">
        <h2>Controls</h2>
      </div>

      <div className="controlsGrid">
        <div className="railField scenarioField">
          <label htmlFor="scenario-select">Scenario</label>
          <select
            disabled={controlsLocked}
            id="scenario-select"
            onChange={(event) => onScenarioChange(event.target.value)}
            value={selectedScenarioId}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.title}
              </option>
            ))}
            {customPresets.length > 0 ? (
              <optgroup label="Custom presets">
                {customPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.title}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value="__custom__">Custom Task (free-form)</option>
          </select>
        </div>

        <div className="railField promptField">
          <label htmlFor="run-prompt">Run prompt</label>
          <textarea
            disabled={controlsLocked}
            id="run-prompt"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={
              selectedScenarioId === "__custom__"
                ? "Enter your task, e.g. Go to https://myapp.com and test the login flow"
                : "Describe the operator task for GPT-5.4."
            }
            rows={5}
            value={prompt}
          />
        </div>
      </div>

      <details className="advancedPanel">
        <summary>
          <span className="advancedSummaryCopy">
            <span className="advancedLabel">Advanced settings</span>
            <span className="advancedHint">
              Engine, browser, verification, and turn budget
            </span>
          </span>
        </summary>

        <div className="advancedContent">
          <div className="railField">
            <div className="fieldLabel">
              <span>Engine</span>
              <InfoPopover
                id="engine-help-popover"
                label="Engine"
                text={engineHelpText}
              />
            </div>
            <SegmentControl
              ariaLabel="Execution mode"
              disabled={controlsLocked}
              onChange={onModeChange}
              options={[
                { label: "Code", value: "code" },
                { label: "Native", value: "native" },
              ]}
              value={mode}
            />
          </div>

          <div className="railField">
            <div className="fieldLabel">
              <span>Browser</span>
              <InfoPopover
                id="browser-help-popover"
                label="Browser"
                text={browserHelpText}
              />
            </div>
            <SegmentControl
              ariaLabel="Browser mode"
              disabled={controlsLocked}
              onChange={onBrowserModeChange}
              options={[
                { label: "Headless", value: "headless" },
                { label: "Visible", value: "headful" },
              ]}
              value={browserMode}
            />
          </div>

          <div className="railField budgetField">
            <div className="fieldLabel">
              <label htmlFor="turn-budget">Turn budget</label>
              <InfoPopover
                id="turn-budget-help-popover"
                label="Turn budget"
                text={turnBudgetHelpText}
              />
            </div>
            <div className="budgetControl">
              <input
                disabled={controlsLocked}
                id="turn-budget"
                max={50}
                min={4}
                onChange={(event) =>
                  onMaxResponseTurnsChange(
                    Number(event.target.value) as ResponseTurnBudget,
                  )
                }
                step={1}
                type="range"
                value={maxResponseTurns}
              />
              <span className="budgetValue">{maxResponseTurns} turns</span>
            </div>
          </div>

          <div className="railField">
            <div className="fieldLabel">
              <span>Verification</span>
              <InfoPopover
                id="verification-help-popover"
                label="Verification"
                text={verificationHelpText}
              />
            </div>
            <label className="feedToggle">
              <input
                checked={verificationEnabled}
                disabled={controlsLocked}
                onChange={(event) => onVerificationEnabledChange(event.target.checked)}
                type="checkbox"
              />
              Run verification checks
            </label>
          </div>

          <div className="railField">
            <div className="fieldLabel">
              <span>Context mode</span>
              <InfoPopover
                id="stateless-help-popover"
                label="Stateless mode"
                text={statelessHelpText}
              />
            </div>
            <label className="feedToggle">
              <input
                checked={statelessMode}
                disabled={controlsLocked}
                onChange={(event) => onStatelessModeChange(event.target.checked)}
                type="checkbox"
              />
              Stateless (1 screenshot per turn)
            </label>
          </div>
        </div>
      </details>

      {showActionButtons ? <RunActionButtons {...actionButtons} /> : null}
    </aside>
  );
}

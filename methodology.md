# QA-as-a-Service — Testing Methodology

General knowledge for automated bug hunting on any SaaS platform using CUA-based agents.

## Setup

### Accounts
- Create 3 test accounts for parallel testing without interference
- Use simple, consistent passwords across test accounts
- If the platform has shared state (e.g. chat apps), separate accounts prevent tests from confusing each other

### QA Service
- API: `POST /api/run` with `{"prompt": "..."}`
- Results: `screenshots/<runId>/run.json` (structured turn-by-turn data)
- Screenshots: `screenshots/<runId>/turn-N-result.png` (viewable images)
- Max turns per run: 30
- Each run launches a fresh browser — clean state, no session bleed

## Orchestration

### Parallel Execution
- Run 3 tests in parallel (one per account) to maximize throughput
- Wait 3-5 minutes per batch depending on task complexity
- Simple tasks (login + 1 action): ~6-9 turns, ~1 min
- Complex tasks (multi-step flows): ~15-25 turns, ~3-5 min

### Subagent Pattern
To prevent context rot in the main Claude Code session:
- **Main session**: launches tests, decides what to test next, tracks budget
- **Subagent (background)**: reads run.json + screenshots for a batch, updates tracking file
- **Subagent (background)**: files GitHub issues for discovered bugs
- This keeps the main session focused on strategy while subagents handle detail work

### Result Pipeline
1. `POST /api/run` → get runId
2. Wait for `screenshots/<runId>/run.json` to appear
3. Parse: state, verdict, finalMessage, turns, error
4. On `platform_bug` verdict: subagent reads screenshots + files GitHub issue
5. On `fail` (agent failure): check if prompt was too complex, retry with simpler prompt
6. Update tracking file with results

## Prompt Design

### What works
- **2-3 focused steps per prompt** — the sweet spot for reliability within 30 turns
- **"Report what happens"** at the end — gets the agent to describe observations in detail
- **"Describe everything you see"** — great for feature discovery runs
- **Explicit credentials in the prompt** — include email + password directly
- **Combining related features** — e.g. "search + DMs", "file upload + pin" is efficient

### What doesn't work
- **4+ complex sub-steps** — frequently exceeds 30 turns
- **Scrolling-heavy tasks** — "scroll to the very top" wastes turns on scroll actions
- **DevTools/security testing** — too complex for CUA agents, needs specialized approach
- **Broad exploration** — "explore everything" runs out of turns; be specific about what to explore

### Prompt templates

**Feature discovery:**
> Go to [URL] and log in with email [email] and password [pass]. Once logged in, [describe area to explore]. Report everything you see.

**Happy path test:**
> Go to [URL] and log in with email [email] and password [pass]. [Do specific action]. [Verify specific outcome]. Report what happens.

**Edge case test:**
> Go to [URL] and log in with email [email] and password [pass]. Test: 1) [edge case 1]. 2) [edge case 2]. Report what happens for each.

**Regression check:**
> Go to [URL] and log in with email [email] and password [pass]. Verify this bug: [describe exact steps to reproduce]. Report exactly what you tried and what happened.

**Cross-user test:**
> Go to [URL] and log in with email [user1]. [Do action]. Then log out and log in with email [user2]. [Verify what user2 sees]. Report what happens.

## Testing Waves

### Wave 1 — Feature Discovery (10% of budget)
Map all features and UI flows. One run per feature area:
1. Authentication (login, logout, signup)
2. Core content (messages, posts, items)
3. Organization (channels, folders, categories)
4. Social features (reactions, comments, threads)
5. Search
6. File handling (upload, preview, download)
7. User profile / settings
8. Navigation (sidebar, tabs, menus)

### Wave 2 — Edge Cases (40% of budget)
For each feature from wave 1:
- Empty inputs (blank forms, empty submissions)
- Long inputs (500+ chars, very long names)
- Special characters (HTML tags, markdown, emoji, unicode, `< > " ' & \ { }`)
- Boundary testing (duplicate names, case sensitivity)
- Permission checks (can user A affect user B's data?)
- Rapid actions (submit button mashing, quick navigation)
- State transitions (refresh, back button, deep links, invalid URLs)

### Wave 3 — Deep Dives (30% of budget)
Focus on areas that broke in wave 2:
- Reproduce confirmed bugs with variations
- Cross-feature interactions (e.g. feature A + feature B together)
- Multi-user scenarios (does user A's action affect user B correctly?)
- Visual/layout stress (long content, many items, narrow viewport)
- Adversarial inputs (nested formatting, adjacent special tokens)

### Wave 4 — Regression (20% of budget)
Re-run confirmed bugs to verify they're reproducible. Re-test key passing flows.

## Bug Classification

### Verdicts from the CUA agent
- **pass** — task completed as expected (but read the details — agent may note issues while still marking pass)
- **platform_bug** — the platform behaved incorrectly
- **agent_failure** — the agent couldn't complete the task (its limitation, not a platform bug)
- **fail (no verdict)** — agent ran out of turns; usually means the prompt was too complex

### What counts as a bug vs missing feature
- **Bug**: something that exists but is broken (e.g. clicking a button does nothing, wrong error message, layout breaks)
- **Missing feature**: something that doesn't exist yet (e.g. no keyboard shortcuts, no custom status)
- File bugs as GitHub issues. Note missing features in the tracking file but don't file issues unless requested.
- **When a new finding extends an existing issue**, comment on that issue rather than just noting "extends #N" in the tracking file. Otherwise the finding gets lost.

## Screenshots in GitHub Issues

Every GitHub issue should include relevant screenshots showing the bug. Without them, issues are just text — screenshots make bugs immediately obvious.

### Storage Setup
- Upload screenshots to a **public GCS bucket** (e.g. `gs://slawk-screenshots/`)
- Public URL pattern: `https://storage.googleapis.com/BUCKET/FILENAME`
- GitHub markdown auto-renders: `![description](https://storage.googleapis.com/BUCKET/FILENAME.png)`

### Upload Flow
```bash
# Upload
gcloud storage cp screenshots/<runId>/turn-N-result.png gs://BUCKET/issue-N-description.png

# Comment on issue
gh issue comment N --repo OWNER/REPO --body '![Bug screenshot](https://storage.googleapis.com/BUCKET/issue-N-description.png)'
```

### Picking the Right Screenshots
- Read `run.json` to identify which turns show the bug (not always the last turn)
- Include 1-3 screenshots: the action that triggered the bug and the result
- Use descriptive filenames: `issue-7-newlines-expansion.png` not `screenshot1.png`
- For issues with no visual component (e.g. missing keyboard shortcuts), skip screenshots

### When to Add Screenshots
- **At filing time** — include screenshots when first creating the issue, not as an afterthought
- This should be part of the subagent's issue-filing flow: find screenshot → upload → include in issue body

## GitHub Issue Labels

Every issue must have a **type label** and a **priority label** at filing time — not as an afterthought. Include both labels in the `gh issue create` command or add them immediately after with `gh issue edit`.

### Type Labels
- `bug` — something that exists but is broken
- `enhancement` — a missing feature or improvement request

### Priority Labels
- `priority:critical` — app crashes, data loss, security issues
- `priority:high` — feature doesn't work at all, blocks a core user flow
- `priority:medium` — feature partially works or has incorrect behavior, workarounds exist
- `priority:low` — visual/UX polish, minor inconsistencies, edge cases

### How to Apply
```bash
# At creation time (preferred):
gh issue create --repo OWNER/REPO --title "..." --label "bug,priority:medium" --body "..."

# Or immediately after:
gh issue edit N --repo OWNER/REPO --add-label "bug,priority:medium"
```

### Priority Guidelines
- **Critical**: app crashes, data loss, security vulnerabilities
- **High**: feature completely broken or inaccessible, blocks a core user flow
- **Medium**: feature partially works or has incorrect behavior, workarounds exist
- **Low**: cosmetic, edge case, or missing convenience feature

## Common Bug Categories (SaaS)

Based on patterns observed across testing:

| Category | What to test | Common bugs found |
|----------|-------------|-------------------|
| Input validation | Empty, long, special chars | Silent truncation, misleading errors |
| Formatting/rendering | Markdown, HTML, nested styles, URLs | Partial rendering support, nested formats break |
| Navigation | Back button, invalid URLs, deep links | SPA routing issues, silent fallbacks |
| File handling | Upload, preview, download | Upload works but download/preview broken |
| Search | Content, usernames, filters | Incomplete search scope, no filters |
| Panels/modals | Open, close, interact | Panels that can't be closed |
| Layout | Long content, many newlines, overflow | Excessive expansion, missing max-height |
| Uniqueness | Duplicate names, case sensitivity | Case-sensitive uniqueness checks |
| Edit flows | Edit to empty, cancel edit | Silent failures, no validation feedback |

## Mobile Testing

### When to Test Mobile
- After desktop testing is mostly done (desktop bugs are easier to find and reproduce)
- Budget ~10% of runs for mobile — the hit rate is higher than late-stage desktop testing
- In our experience: 33% bug rate on mobile vs 10% in late desktop runs

### How to Trigger Mobile
- Include device name in the prompt: "On an iPhone, go to..."
- The QA service auto-detects and simulates the device (viewport, user agent, touch)
- iPhone 14 (390x844) is a good default

### What to Test on Mobile
Focus on features that have different UIs on mobile vs desktop:
1. **Navigation** — sidebar becomes hamburger menu, how do you switch channels?
2. **Composer** — does formatting toolbar fit? Does attach button work?
3. **Search** — is it accessible? May be hidden behind an icon
4. **Notifications** — bell icon may be missing from mobile header
5. **Actions on messages** — hover becomes tap, does the action bar appear?
6. **Panels** — threads, files, pins, members — do they open/close correctly?
7. **Layout** — long content, emoji reactions, channel headers

### Mobile-Specific Bug Patterns
- Desktop features that are **completely missing** on mobile (no search, no notifications)
- Buttons that work on desktop but **don't respond to tap** (attach button)
- Features that are **actually better on mobile** (e.g. thread close may work on mobile but not desktop)

## Efficiency Tips

- **Login cost is fixed** (~3 turns per run). Don't try to optimize it — a fresh browser per run is better for test isolation.
- **Budget 3-5 min wait per batch of 3** — don't poll, just sleep and check.
- **Read `finalMessage` first** — it usually has everything you need without reading screenshots.
- **Only read screenshots for bugs** — when you need to see exactly what the UI looked like.
- **The agent marks "pass" even when noting issues** — always read the summary text, don't just filter by verdict.
- **Agent failures (30-turn timeout) are not platform bugs** — retry with a simpler prompt or skip.
- **10 runs of agent failures out of 77 is normal** (~13%) — complex multi-step tasks and exploration naturally exceed the turn limit.

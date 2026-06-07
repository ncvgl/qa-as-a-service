# The idea-commitment curve: is the plan really "set early"?

A follow-up to **Finding #3** of the main experiment ("suppression lives at
low-entropy *plan* tokens, set early"). That finding was inferred from branch
failures; here we test it head-on by **sweeping the branch position** and asking,
at each point, *can we still surface a known idea from here?*

> **Idea-commitment curve.** For a target idea `T`, take the greedy answer and,
> at each position `p`, resample `M` completions from the prefix `prefix[:p]` and
> measure `recovery(p) = P(T appears in the completion)`. If the plan commits
> early, recovery should start high and fall off a **cliff** once the outline
> locks `T` out.
>
> Detection is an **objective keyword regex** — no LLM judge — so this thread is
> more rigorous than the judge-based main experiment.

Scripts: `exp_commit_curve.py` (configurable pilot), `exp_commit_curve_listnarr.py`
(list-vs-prose), `exp_commit_curve_clean.py` (verified-suppressed target),
`exp_commit_4b_narr.py` (4B prose curve), `exp_commit_4b_confirm.py` (long-window
control). Results + figures under `results/commit_*`.

## What actually happened

The predicted clean cliff **did not appear** — and chasing why produced a sharper
result than the cliff would have.

**1. Lists have no commitment cliff — they allow late insertion.**
0.6B, *"Why do startups fail?"*, target = "no market demand" (verified **absent**
from greedy). The curve is **flat at ~0.2 with bumps at every list-item
boundary** (branch-recovery spikes land exactly on `3.**`, `5.`, `6.`, …). A
bulleted answer can always append one more item, so a suppressed idea stays
recoverable throughout. Commitment is **local (per-bullet), not a single early
plan point.** (`results/commit_startups.json`, `results/commit_curve_06b.png`)

**2. The "suppressed-but-present" regime is a knife-edge.**
The curve only means something when `T` is *present but not in greedy*. That band
kept slipping:
- `market demand` — *present*, but the explicit "numbered list"/"prose" prompts
  made greedy **include** it (`target_in_greedy=True`) → post-mention recovery is
  trivially 0 ("already said it", not "locked out"). Confounded.
- `co-founder/team conflict` — **absent**: 0.6B never samples it even from `p=0`
  → recovery is **0 everywhere**, no signal. (`results/commit_conflict.json`)

**3. At 4B in prose, the target is *obligatory*, not suppressed.**
4B, *"Why did Rome fall?"* forced into prose, target = barbarian invasions.
The `N=50` window gives a pretty curve that **rises 0→1.0 then falls** — but the
`N=180` control (`exp_commit_4b_confirm.py`) is **flat at 1.0 from `p=0`**: even
from the *empty* prefix the idea is certain to appear. The `N=50` "curve" is a
pure **sliding-window artifact** — the idea sits ~140 tokens deep, so a 50-token
completion can't reach it early, can once its slot enters the window, and can't
after it passes. No cliff, no lockout. (`results/commit_curve_4b.png`)

## The refinement to Finding #3

The main experiment saw invasions "suppressed by the greedy trajectory" at 4B —
but that was measured on the model's **default list/outline** answer. This thread
shows the suppression is **format-induced, not positional**:

- In an **outline/list** answer the model commits to a fixed set of *section
  headers* early; an idea that doesn't get its own header is crowded out — yet it
  can still be **inserted at any later item boundary** (hence the bumps, not a
  cliff).
- In **prose** there are no fixed section slots, so an obligatory idea always
  surfaces (`P≈1.0`), just **deferred** to its natural place in the argument.

So "the plan is set early" is really **"the list of section headers is set early,
and *that* is what gates the idea set."** The bottleneck is the outline's header
commitments, not low-entropy tokens per se — and even that bottleneck is leaky
(late insertion). The decoding strategy matters less than (a) whether the model
knows the idea and (b) whether the answer *format* gives it a slot.

## Caveats

- Keyword detection can miss paraphrases and over-count incidental hits; curves
  are `M`=10–16 samples/point (SE ≈ 0.12), so small wiggles are noise.
- `recovery(p)` with a fixed window conflates *reachability* with *position*; the
  `N=180` control is what disambiguates — always pair the two.
- One target per (model, format); 0.6B/4B, CPU-only. Directional, not powered.

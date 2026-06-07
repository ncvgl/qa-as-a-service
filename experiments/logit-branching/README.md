# Logit Branching: do decoders hide recoverable semantic alternatives?

A self-contained exploration, run entirely on CPU (4 vCPU, 15 GiB, no GPU) with
**Qwen3-0.6B** and **Qwen3-4B**, of one question:

> When a question has many valid answers, do the model's logits contain *useful
> semantic alternatives that normal (greedy) decoding suppresses* — and can we
> recover them by branching at high-uncertainty points?

**Short answer: the suppressed alternatives are real, but entropy-targeted
branching does not recover the ones that matter. They live in the answer's
*plan* (early, low-entropy tokens), not at high-entropy mid-answer forks.
Plain resampling recovers them; branching does not.**

---

## How to reproduce

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/exp_refine.py      # 0.6B refined run (entropy vs spread vs resample)
python scripts/exp_refine_4b.py   # 4B headline (transformers bf16, slow on CPU)
```

All result JSONs are checked in under `results/` so the analysis is inspectable
without re-running.

---

## The arc (each step is a script)

### 1. Logits & sampling sanity checks
- `scripts/qwen_forward.py` — single forward pass, top-20 next-token logits for
  `"the sky is"`. Finding: a **trailing space** flips the prediction from digits
  (`1,2,3…`) to `" blue"` — tokenization scaffolding dominates.
- `scripts/random_number.py` — ask for a random 1/2/3 with the digit forced as the
  next token. **LLMs are biased RNGs**: strong anchoring on "1", and prompt
  wording swings the distribution from 28%→64%. Never the 33/33/33 of a fair die.
- `scripts/uncertainty_logits.py` — temperature/entropy intuition.

### 2. Decode-speed benchmarks (CPU)
`scripts/bench_fp32.py`, `bench_gguf.py`, `bench_local_gguf.py`, `batch_bench.py`.

| Precision / runtime | tok/s (0.6B, 1 stream) |
|---|---|
| transformers fp32 (eager) | ~0.5 contended / ~11 uncontended |
| llama.cpp F32 | 21.9 |
| llama.cpp BF16 | 28.0 |
| llama.cpp Q4_K_M (int4) | 49.1 |

Lessons: the "int4 is 100× faster than fp32" gap is **mostly runtime** (optimized
C++ vs eager Python); the clean precision-only effect is **~2.2× (F32→int4)**.
Batching on 4 cores tops out at **~5×** total throughput (compute-bound past
batch ~8) and gives **~0 benefit at 4B** (bf16 emulated on x86).

### 3. Where does generation "fork"? (entropy as a fork detector)
- `scripts/forks.py` — per-token entropy trace; branch the top candidates at the
  highest-entropy positions.
- `scripts/fork_semantic.py` — embed the branch continuations
  (`all-MiniLM-L6-v2`) and measure pairwise cosine to label each fork
  **semantic** (different ideas) vs **syntactic** (same idea, different words).

Key result: **high token-entropy ≠ semantic fork.** The single highest-entropy
fork in one run (a 4-way `refers/means/typically/generally`) had cosine **0.96** —
maximally uncertain in *words*, identical in *meaning*. Question *type* predicts
semantic forking far better than entropy (`corr(entropy, cos) ≈ −0.49`).

### 4. Branch-recovery experiment (the main event)
- `scripts/exp_branch.py` — pilot. Greedy answer + top-3 entropy spikes ×
  top-5 candidates, with **resample** and **random-position** controls at matched
  token budget. (`results/exp_pilot.json`)
- `scripts/exp_refine.py` — fixes pilot confounds: **full greedy to EOS**,
  **two targeting conditions** (entropy-ranked vs **semantic-spread-ranked**),
  longer anti-absorption branches. (`results/exp_refine.json`)
- `scripts/exp_refine_fast.py` — same, **batched** (~2× wall-clock; identical
  spikes ⇒ correctness-preserving). (`results/exp_refine_fast.json`)
- `scripts/exp_refine_4b.py` — **Qwen3-4B headline** (transformers bf16; llama.cpp
  ruled out because its logits path SIGILLs on this CPU, see
  `scripts/probe_llamacpp.py`). (`results/exp_refine_4b.json`)

---

## Findings

**1. Suppressed alternatives are real — and the 4B Rome case proves it.**
"Why did Rome fall?" — the canonical missing cause is *barbarian/external
invasions*. At 0.6B that idea is ~absent (weak model). At **4B it is present in
100% of resamples** (every sample names "military and external factors") but
recovered by **0% of branches** (entropy or spread). The idea is *suppressed by
the greedy trajectory*, not absent from the model.

**2. Entropy/spread branching recovers the wrong thing.**
Forcing a token mid-answer changes the *local word* but the model resumes
completing the **same outline section**. It can swap "Division of Power" →
"Civil Wars" (a sibling point) but cannot jump to the *Military* section — a
different part of the global plan. So branching surfaces local lexical/sub-point
variation only.

**3. The suppression is structural and lives at low-entropy plan tokens.**
The alternatives that matter are set *early* (first sentence, first list item),
where the model is **confident** (low entropy). That is exactly where
entropy-targeting and spread-targeting never look. This inverts the original
intuition: the fork worth branching is the confident **plan** commitment, not the
high-entropy mid-answer fork.

> **Follow-up — [`COMMITMENT_CURVE.md`](./COMMITMENT_CURVE.md):** sweeping the
> branch position to map *where* the plan commits shows the suppression is
> **format-induced, not positional**. An outline/list answer commits its *section
> headers* early but still allows **late idea-insertion at item boundaries** (no
> cliff); in **prose** an obligatory idea (e.g. invasions at 4B) appears with
> `P≈1.0` from the empty prefix, just deferred. So "the plan is set early" is
> really "the *list of headers* is set early, and that gates the idea set."

**4. Resampling is the baseline to beat — and branching doesn't.**
Plain temperature resampling re-rolls the whole plan, so it visits different
sections/orderings and recovers the suppressed ideas — at the cost of occasional
hallucination (e.g., 0.6B resamples produced "Rome fell in 286 BC" / "1920").

**5. Spread-targeting > entropy-targeting is fragile.**
At 0.6B, ranking fork positions by *semantic spread* (cosine distance of
short lookaheads) beat raw entropy: it avoided high-entropy-but-synonym "duds"
(e.g. a spike with spread 0.25) and spread spikes across the answer. **At 4B this
advantage essentially vanishes** — lower, flatter entropy removes the duds, and
the two conditions share most spikes.

---

## Verdict

Original hypothesis — *"logits contain useful semantic alternatives that normal
decoding suppresses"* — **confirmed in principle, but the proposed recovery method
fails.** Entropy-targeted branching is the wrong tool because suppression is a
**plan-level** phenomenon at **low-entropy** positions. Promising next direction:
branch (or re-prompt) at the **outline-setting tokens**, or compare against
resampling-with-a-plausibility-gate rather than greedy.

## Caveats
- Tiny models (0.6B/4B), CPU-only, 2–4 prompts per condition — directional, not
  statistically powered.
- The "judge" (idea novelty/plausibility labeling) was done by a frontier LLM
  reading the dumps, with no formal rubric or inter-rater check.
- 4B run limited to 2 prompts by CPU speed (transformers bf16 ≈ 2.4 tok/s).

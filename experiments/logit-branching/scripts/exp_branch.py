import json, random, time, numpy as np, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from sentence_transformers import SentenceTransformer

# ---------------- config ----------------
MODEL     = "Qwen/Qwen3-0.6B"
N_PROMPTS = 4        # pilot; full run = 20
N_MAIN    = 64       # greedy answer length
N_SPIKES  = 3        # top entropy spikes per prompt
K_CAND    = 5        # candidate tokens branched per spike
N_CONT    = 50       # tokens generated per branch
SEED      = 0
random.seed(SEED); torch.manual_seed(SEED)

PROMPTS = [
    "Why do startups fail?",
    "Why did Rome fall?",
    "What causes inflation?",
    "Why do LLMs hallucinate?",
    "Why do diets fail?",
    "What causes traffic jams?",
    "Why do empires collapse?",
    "Why do people procrastinate?",
    "What causes economic recessions?",
    "Why do relationships end?",
    "Why do businesses lose customers?",
    "Why do students drop out of college?",
    "What causes wars?",
    "Why do New Year's resolutions fail?",
    "What causes burnout?",
    "Why do languages die?",
    "What makes a team productive?",
    "Why do bridges collapse?",
    "What causes obesity?",
    "Why do banks fail?",
][:N_PROMPTS]

tok   = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32).eval()
torch.set_num_threads(4)
embedder = SentenceTransformer("all-MiniLM-L6-v2")

def chat_ids(prompt):
    text = tok.apply_chat_template([{"role": "user", "content": prompt}],
                                   tokenize=False, add_generation_prompt=True, enable_thinking=False)
    return tok(text, return_tensors="pt").input_ids

def H_bits(p):
    return float(-(p * torch.log2(p + 1e-12)).sum())

@torch.no_grad()
def greedy_record(base, n):
    """greedy decode; return chosen ids, entropy per step, top-K candidate (id,prob) per step"""
    chosen, ents, cands, past, cur = [], [], [], None, base
    for _ in range(n):
        out = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = out.past_key_values
        probs = torch.softmax(out.logits[0, -1, :], dim=-1)
        ents.append(H_bits(probs))
        top = torch.topk(probs, K_CAND)
        cands.append([(int(i), float(probs[i])) for i in top.indices.tolist()])
        nxt = int(probs.argmax())
        chosen.append(nxt)
        if nxt == tok.eos_token_id:
            break
        cur = torch.tensor([[nxt]])
    return chosen, ents, cands

@torch.no_grad()
def branch_from(base, prefix_ids_list, forced_id, n):
    """prefix = base + prefix_ids_list + forced_id, then greedy n tokens; return continuation text"""
    prefix = torch.cat([base, torch.tensor([prefix_ids_list + [forced_id]], dtype=base.dtype)], dim=1)
    out_ids, past, cur = [], None, prefix
    for _ in range(n):
        o = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = o.past_key_values
        nxt = int(o.logits[0, -1, :].argmax())
        if nxt == tok.eos_token_id:
            break
        out_ids.append(nxt)
        cur = torch.tensor([[nxt]])
    return tok.decode([forced_id] + out_ids, skip_special_tokens=True).strip()

@torch.no_grad()
def resample(base, n_samples, max_new):
    outs = []
    for _ in range(n_samples):
        g = model.generate(base, do_sample=True, temperature=1.0, top_p=0.95,
                           max_new_tokens=max_new, pad_token_id=tok.eos_token_id)
        outs.append(tok.decode(g[0, base.shape[1]:], skip_special_tokens=True).strip())
    return outs

def dedup(texts, thr=0.80):
    """greedy cluster by embedding cosine; return list of {rep, members:[idx]}"""
    if not texts:
        return []
    emb = embedder.encode(texts, normalize_embeddings=True)
    clusters = []
    for i, e in enumerate(emb):
        placed = False
        for c in clusters:
            if float(e @ emb[c["members"][0]]) >= thr:
                c["members"].append(i); placed = True; break
        if not placed:
            clusters.append({"rep": texts[i], "members": [i]})
    return clusters

results = []
t0 = time.time()
for pi, prompt in enumerate(PROMPTS):
    base = chat_ids(prompt)
    chosen, ents, cands = greedy_record(base, N_MAIN)
    greedy_answer = tok.decode(chosen, skip_special_tokens=True).strip()

    # ---- entropy spikes (top-N by entropy, min 2 apart) ----
    order = np.argsort(ents)[::-1]
    spikes = []
    for p in order:
        if all(abs(p - q) >= 2 for q in spikes):
            spikes.append(int(p))
        if len(spikes) == N_SPIKES:
            break
    spikes.sort()

    # ---- condition A: entropy-branch ----
    entropy_branches = []
    for p in spikes:
        for tid, pr in cands[p]:
            txt = branch_from(base, chosen[:p], tid, N_CONT)
            entropy_branches.append({"pos": p, "H": ents[p], "tok": tok.decode([tid]),
                                     "prob": pr, "is_greedy": (tid == chosen[p]), "text": txt})

    # ---- condition B: random-position branch (same count/budget) ----
    rand_pos = random.sample([p for p in range(len(chosen)) if p not in spikes],
                             k=min(N_SPIKES, len(chosen) - len(spikes)))
    rand_pos.sort()
    random_branches = []
    for p in rand_pos:
        for tid, pr in cands[p]:
            txt = branch_from(base, chosen[:p], tid, N_CONT)
            random_branches.append({"pos": p, "H": ents[p], "tok": tok.decode([tid]),
                                    "prob": pr, "is_greedy": (tid == chosen[p]), "text": txt})

    # ---- condition C: resample (matched token budget) ----
    budget = N_SPIKES * K_CAND * N_CONT
    n_samp = max(1, round(budget / N_CONT))
    resamples = resample(base, n_samp, N_CONT)

    results.append({
        "prompt": prompt,
        "greedy_answer": greedy_answer,
        "entropy_trace": [round(e, 2) for e in ents],
        "spikes": spikes,
        "entropy_branches": entropy_branches,
        "entropy_clusters": dedup([b["text"] for b in entropy_branches]),
        "random_branches": random_branches,
        "random_clusters": dedup([b["text"] for b in random_branches]),
        "resamples": resamples,
        "resample_clusters": dedup(resamples),
        "budget_tokens": {"entropy": len(entropy_branches)*N_CONT,
                          "random": len(random_branches)*N_CONT,
                          "resample": n_samp*N_CONT},
    })
    print(f"[{pi+1}/{len(PROMPTS)}] {prompt!r} done  ({time.time()-t0:.0f}s elapsed)", flush=True)

with open("/tmp/exp_pilot.json", "w") as f:
    json.dump(results, f, indent=2)
print("WROTE /tmp/exp_pilot.json")

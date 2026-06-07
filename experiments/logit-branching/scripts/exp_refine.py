import json, time, numpy as np, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from sentence_transformers import SentenceTransformer

MODEL    = "Qwen/Qwen3-0.6B"
PROMPTS  = ["Why do startups fail?", "Why did Rome fall?",
            "What causes inflation?", "Why do LLMs hallucinate?"]
N_MAIN   = 256     # full greedy, stop at EOS
H_FLOOR  = 1.5     # only score spread at positions at least this uncertain
MAX_CAND_POS = 16  # cap spread-scoring positions (top by entropy) for cost
K        = 4       # candidate tokens per spike
LOOK     = 14      # short lookahead for spread scoring
N_CONT   = 70      # full branch length (anti-absorption)
N_SPIKES = 3
torch.manual_seed(0); np.random.seed(0)

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
    chosen, ents, cands, past, cur = [], [], [], None, base
    for _ in range(n):
        out = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = out.past_key_values
        probs = torch.softmax(out.logits[0, -1, :], dim=-1)
        ents.append(H_bits(probs))
        top = torch.topk(probs, K)
        cands.append([(int(i), float(probs[i])) for i in top.indices.tolist()])
        nxt = int(probs.argmax()); chosen.append(nxt)
        if nxt == tok.eos_token_id:
            break
        cur = torch.tensor([[nxt]])
    return chosen, ents, cands

@torch.no_grad()
def branch_from(base, prefix_list, forced_id, n):
    prefix = torch.cat([base, torch.tensor([prefix_list + [forced_id]], dtype=base.dtype)], dim=1)
    out_ids, past, cur = [], None, prefix
    for _ in range(n):
        o = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = o.past_key_values
        nxt = int(o.logits[0, -1, :].argmax())
        if nxt == tok.eos_token_id:
            break
        out_ids.append(nxt); cur = torch.tensor([[nxt]])
    return tok.decode([forced_id] + out_ids, skip_special_tokens=True).strip()

def spread_at(base, chosen, p, cands):
    texts = [branch_from(base, chosen[:p], tid, LOOK) for tid, _ in cands[p]]
    if len(texts) < 2:
        return 0.0, texts
    emb = embedder.encode(texts, normalize_embeddings=True)
    sim = emb @ emb.T
    iu = np.triu_indices(len(texts), 1)
    return float(1 - sim[iu].mean()), texts   # spread = 1 - mean cosine

def pick_spikes(scores, valid, k, sep=2):
    order = sorted(valid, key=lambda i: scores[i], reverse=True)
    out = []
    for i in order:
        if all(abs(i - j) >= sep for j in out):
            out.append(i)
        if len(out) == k:
            break
    return sorted(out)

def expand(base, chosen, positions, cands):
    res = []
    for p in positions:
        for tid, pr in cands[p]:
            res.append({"pos": p, "tok": tok.decode([tid]), "prob": pr,
                        "is_greedy": (tid == chosen[p]),
                        "text": branch_from(base, chosen[:p], tid, N_CONT)})
    return res

@torch.no_grad()
def resample(base, n, max_new):
    outs = []
    for _ in range(n):
        g = model.generate(base, do_sample=True, temperature=1.0, top_p=0.95,
                           max_new_tokens=max_new, pad_token_id=tok.eos_token_id)
        outs.append(tok.decode(g[0, base.shape[1]:], skip_special_tokens=True).strip())
    return outs

results = []
t0 = time.time()
for prompt in PROMPTS:
    base = chat_ids(prompt)
    chosen, ents, cands = greedy_record(base, N_MAIN)
    greedy_full = tok.decode(chosen, skip_special_tokens=True).strip()

    # candidate positions = most uncertain, capped
    cand_pos = [p for p in range(len(chosen)) if ents[p] >= H_FLOOR]
    cand_pos = sorted(cand_pos, key=lambda i: ents[i], reverse=True)[:MAX_CAND_POS]
    spreads = {p: spread_at(base, chosen, p, cands)[0] for p in cand_pos}

    spikes_E = pick_spikes(ents, list(range(len(chosen))), N_SPIKES)
    spikes_S = pick_spikes(spreads, cand_pos, N_SPIKES)

    br_E = expand(base, chosen, spikes_E, cands)
    br_S = expand(base, chosen, spikes_S, cands)
    res  = resample(base, N_SPIKES * K, N_CONT)

    results.append({
        "prompt": prompt,
        "greedy_full": greedy_full,
        "spikes_entropy": [{"pos": p, "H": round(ents[p], 2), "spread": round(spreads.get(p, -1), 3)} for p in spikes_E],
        "spikes_spread":  [{"pos": p, "H": round(ents[p], 2), "spread": round(spreads[p], 3)} for p in spikes_S],
        "cand_pos_scores": sorted([{"pos": p, "H": round(ents[p], 2), "spread": round(spreads[p], 3)} for p in cand_pos], key=lambda d: -d["spread"]),
        "branches_entropy": br_E,
        "branches_spread":  br_S,
        "resamples": res,
    })
    print(f"done {prompt!r}  E-spikes={spikes_E} S-spikes={spikes_S}  ({time.time()-t0:.0f}s)", flush=True)

json.dump(results, open("/tmp/exp_refine.json", "w"), indent=2)
print("WROTE /tmp/exp_refine.json")

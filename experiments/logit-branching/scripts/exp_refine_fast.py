import json, time, numpy as np, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from sentence_transformers import SentenceTransformer

MODEL    = "Qwen/Qwen3-0.6B"
PROMPTS  = ["Why do startups fail?", "Why did Rome fall?",
            "What causes inflation?", "Why do LLMs hallucinate?"]
N_MAIN   = 256
H_FLOOR  = 1.5
MAX_CAND_POS = 16
K        = 4
LOOK     = 14
N_CONT   = 70
N_SPIKES = 3
CHUNK    = 24          # max sequences per batched forward
torch.manual_seed(0); np.random.seed(0)

tok = AutoTokenizer.from_pretrained(MODEL)
tok.padding_side = "left"
if tok.pad_token is None: tok.pad_token = tok.eos_token
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
def batched_gen(prefix_lists, n_new, sample=False):
    """generate n_new tokens for each prefix (list of token ids); returns list of gen-id-lists."""
    gens = [None] * len(prefix_lists)
    for s in range(0, len(prefix_lists), CHUNK):
        part = prefix_lists[s:s+CHUNK]
        L = max(len(x) for x in part)
        inp = torch.full((len(part), L), tok.pad_token_id, dtype=torch.long)
        attn = torch.zeros((len(part), L), dtype=torch.long)
        for i, x in enumerate(part):
            inp[i, L-len(x):] = torch.tensor(x); attn[i, L-len(x):] = 1
        out = model.generate(input_ids=inp, attention_mask=attn, max_new_tokens=n_new,
                             do_sample=sample, temperature=1.0 if sample else None,
                             top_p=0.95 if sample else None, pad_token_id=tok.pad_token_id)
        for i in range(len(part)):
            gens[s+i] = out[i, L:].tolist()
    return gens

def expand_batched(base_list, chosen, positions, cands, n_new):
    specs = [(p, tid, pr, tid == chosen[p])
             for p in positions for tid, pr in cands[p]]
    prefixes = [base_list + chosen[:p] + [tid] for (p, tid, _, _) in specs]
    gens = batched_gen(prefixes, n_new)
    out = []
    for (p, tid, pr, isg), g in zip(specs, gens):
        out.append({"pos": p, "tok": tok.decode([tid]), "prob": pr, "is_greedy": isg,
                    "text": tok.decode([tid] + g, skip_special_tokens=True).strip()})
    return out

def spread_scores(base_list, chosen, positions, cands):
    """batched spread = 1 - mean pairwise cosine of LOOK-token lookaheads of top-K candidates."""
    specs = [(p, tid) for p in positions for tid, _ in cands[p]]
    prefixes = [base_list + chosen[:p] + [tid] for (p, tid) in specs]
    gens = batched_gen(prefixes, LOOK)
    texts = {p: [] for p in positions}
    for (p, tid), g in zip(specs, gens):
        texts[p].append(tok.decode([tid] + g, skip_special_tokens=True).strip())
    scores = {}
    for p in positions:
        ts = texts[p]
        if len(ts) < 2:
            scores[p] = 0.0; continue
        emb = embedder.encode(ts, normalize_embeddings=True)
        sim = emb @ emb.T; iu = np.triu_indices(len(ts), 1)
        scores[p] = float(1 - sim[iu].mean())
    return scores

def pick(scores, valid, k, sep=2):
    out = []
    for i in sorted(valid, key=lambda j: scores[j], reverse=True):
        if all(abs(i - j) >= sep for j in out): out.append(i)
        if len(out) == k: break
    return sorted(out)

results = []
t0 = time.time()
for prompt in PROMPTS:
    base = chat_ids(prompt); base_list = base[0].tolist()
    chosen, ents, cands = greedy_record(base, N_MAIN)
    greedy_full = tok.decode(chosen, skip_special_tokens=True).strip()

    cand_pos = [p for p in range(len(chosen)) if ents[p] >= H_FLOOR]
    cand_pos = sorted(cand_pos, key=lambda i: ents[i], reverse=True)[:MAX_CAND_POS]
    spreads = spread_scores(base_list, chosen, cand_pos, cands)

    spikes_E = pick(ents, list(range(len(chosen))), N_SPIKES)
    spikes_S = pick(spreads, cand_pos, N_SPIKES)

    br_E = expand_batched(base_list, chosen, spikes_E, cands, N_CONT)
    br_S = expand_batched(base_list, chosen, spikes_S, cands, N_CONT)
    res_gens = batched_gen([base_list] * (N_SPIKES * K), N_CONT, sample=True)
    res = [tok.decode(g, skip_special_tokens=True).strip() for g in res_gens]

    results.append({
        "prompt": prompt, "greedy_full": greedy_full,
        "spikes_entropy": [{"pos": p, "H": round(ents[p], 2), "spread": round(spreads.get(p, -1), 3)} for p in spikes_E],
        "spikes_spread":  [{"pos": p, "H": round(ents[p], 2), "spread": round(spreads[p], 3)} for p in spikes_S],
        "cand_pos_scores": sorted([{"pos": p, "H": round(ents[p], 2), "spread": round(spreads[p], 3)} for p in cand_pos], key=lambda d: -d["spread"]),
        "branches_entropy": br_E, "branches_spread": br_S, "resamples": res,
    })
    print(f"done {prompt!r}  E={spikes_E} S={spikes_S}  ({time.time()-t0:.0f}s)", flush=True)

json.dump(results, open("/tmp/exp_refine_fast.json", "w"), indent=2)
print("WROTE /tmp/exp_refine_fast.json")

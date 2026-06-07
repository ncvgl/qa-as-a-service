import json, re, time, numpy as np, torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-0.6B"; DTYPE = torch.float32
TARGET = r"(market need|market demand|demand for the|product[- ]market fit|no (market|customers|demand)|lack of demand|market validation|nobody want|no one want|customers? (don'?t|do not) want)"
RX = re.compile(TARGET, re.I)
CONFIGS = {
    "list":      "Why do startups fail? Answer as a numbered list of factors.",
    "narrative": "Why do startups fail? Answer in a single flowing paragraph of prose. Do not use any lists, numbers, headings, or bullet points.",
}
M = 16; N = 45; STEP = 8; N_MAIN = 200; K = 4; CHUNK = 16
torch.manual_seed(0); np.random.seed(0)

tok = AutoTokenizer.from_pretrained(MODEL); tok.padding_side = "left"
if tok.pad_token is None: tok.pad_token = tok.eos_token
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=DTYPE).eval()
torch.set_num_threads(4)

def chat_ids(p):
    t = tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False,
                                add_generation_prompt=True, enable_thinking=False)
    return tok(t, return_tensors="pt").input_ids

@torch.no_grad()
def greedy_record(base, n):
    chosen, cands, past, cur = [], [], None, base
    for _ in range(n):
        out = model(input_ids=cur, past_key_values=past, use_cache=True); past = out.past_key_values
        probs = torch.softmax(out.logits[0, -1, :], dim=-1)
        cands.append([int(i) for i in torch.topk(probs, K).indices.tolist()])
        nxt = int(probs.argmax()); chosen.append(nxt)
        if nxt == tok.eos_token_id: break
        cur = torch.tensor([[nxt]])
    return chosen, cands

@torch.no_grad()
def batched_gen(prefix_lists, n_new, sample):
    gens = [None] * len(prefix_lists)
    for s in range(0, len(prefix_lists), CHUNK):
        part = prefix_lists[s:s+CHUNK]; L = max(len(x) for x in part)
        inp = torch.full((len(part), L), tok.pad_token_id, dtype=torch.long)
        attn = torch.zeros((len(part), L), dtype=torch.long)
        for i, x in enumerate(part):
            inp[i, L-len(x):] = torch.tensor(x); attn[i, L-len(x):] = 1
        out = model.generate(input_ids=inp, attention_mask=attn, max_new_tokens=n_new, do_sample=sample,
                             temperature=1.0 if sample else None, top_p=0.95 if sample else None,
                             pad_token_id=tok.pad_token_id)
        for i in range(len(part)): gens[s+i] = out[i, L:].tolist()
    return gens

def hit(ids): return 1 if RX.search(tok.decode(ids, skip_special_tokens=True)) else 0

out_all = {}
t0 = time.time()
for name, prompt in CONFIGS.items():
    base = chat_ids(prompt); base_list = base[0].tolist()
    chosen, cands = greedy_record(base, N_MAIN)
    gtxt = tok.decode(chosen, skip_special_tokens=True)
    rows = []
    for p in range(0, len(chosen), STEP):
        prefix = base_list + chosen[:p]
        samp = batched_gen([prefix] * M, N, True)
        rs = float(np.mean([hit(g) for g in samp]))
        rows.append({"pos": p, "resample_recovery": rs,
                     "ctx": tok.decode(chosen[max(0, p-6):p], skip_special_tokens=True)})
    out_all[name] = {"prompt": prompt, "greedy": gtxt, "rows": rows,
                     "target_in_greedy": bool(RX.search(gtxt))}
    rec = [r["resample_recovery"] for r in rows]
    print(f"[{name}] len={len(chosen)} tgt_in_greedy={bool(RX.search(gtxt))} "
          f"early(first3)={np.mean(rec[:3]):.2f} late(last3)={np.mean(rec[-3:]):.2f} "
          f"max={max(rec):.2f} ({time.time()-t0:.0f}s)", flush=True)
json.dump(out_all, open("/tmp/curve_listVnarr.json", "w"), indent=2)
print("WROTE /tmp/curve_listVnarr.json")

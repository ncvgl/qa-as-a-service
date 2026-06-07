import json, re, time, numpy as np, torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# ---- configurable ----
import sys
CFG = sys.argv[1] if len(sys.argv) > 1 else "startups"
if CFG == "startups":
    MODEL = "Qwen/Qwen3-0.6B"; DTYPE = torch.float32
    PROMPT = "Why do startups fail?"
    TARGET = r"(market need|market demand|demand for the|product[- ]market fit|no (market|customers|demand)|lack of demand|market validation|nobody want|no one want|customers? (don'?t|do not) want)"
    M = 12; N = 45; STEP = 6; OUT = "/tmp/curve_startups.json"
elif CFG == "rome":
    MODEL = "Qwen/Qwen3-4B"; DTYPE = torch.bfloat16
    PROMPT = "Why did Rome fall?"
    TARGET = r"(invas|barbar|german|goth|visigoth|vandal|\bhun\b|huns|attila|alaric|sack of rome|foreign (invad|attack|force)|external (attack|invad|threat)|migrat)"
    M = 8; N = 50; STEP = 12; OUT = "/tmp/curve_rome.json"
N_MAIN = 200; K = 4; CHUNK = 16 if DTYPE == torch.float32 else 6
torch.manual_seed(0); np.random.seed(0)
RX = re.compile(TARGET, re.I)

tok = AutoTokenizer.from_pretrained(MODEL)
tok.padding_side = "left"
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
        out = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = out.past_key_values
        probs = torch.softmax(out.logits[0, -1, :], dim=-1)
        top = torch.topk(probs, K)
        cands.append([int(i) for i in top.indices.tolist()])
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
        out = model.generate(input_ids=inp, attention_mask=attn, max_new_tokens=n_new,
                             do_sample=sample, temperature=1.0 if sample else None,
                             top_p=0.95 if sample else None, pad_token_id=tok.pad_token_id)
        for i in range(len(part)):
            gens[s+i] = out[i, L:].tolist()
    return gens

def hit(ids):
    return 1 if RX.search(tok.decode(ids, skip_special_tokens=True)) else 0

base = chat_ids(PROMPT); base_list = base[0].tolist()
t0 = time.time()
chosen, cands = greedy_record(base, N_MAIN)
greedy_txt = tok.decode(chosen, skip_special_tokens=True)
print(f"greedy len={len(chosen)} target_in_greedy={'YES' if RX.search(greedy_txt) else 'no'} ({time.time()-t0:.0f}s)", flush=True)

positions = list(range(0, len(chosen), STEP))
rows = []
for p in positions:
    prefix = base_list + chosen[:p]
    samp = batched_gen([prefix] * M, N, sample=True)
    rs = np.mean([hit(g) for g in samp])
    br_prefixes = [prefix + [tid] for tid in cands[p]] if p < len(cands) else [prefix]
    brg = batched_gen(br_prefixes, N, sample=False)
    bs = np.mean([hit([cands[p][i]] + brg[i]) if p < len(cands) else hit(brg[i]) for i in range(len(brg))])
    ctx = tok.decode(chosen[max(0, p-6):p], skip_special_tokens=True)
    rows.append({"pos": p, "resample_recovery": float(rs), "branch_recovery": float(bs),
                 "ctx": ctx, "example_hit": next((tok.decode(g, skip_special_tokens=True)[:120]
                                                   for g in samp if hit(g)), "")})
    print(f" p={p:>3} resample={rs:4.2f} branch={bs:4.2f}  ...{ctx[-30:]!r}  ({time.time()-t0:.0f}s)", flush=True)

json.dump({"prompt": PROMPT, "model": MODEL, "M": M, "N": N,
           "greedy": greedy_txt, "rows": rows}, open(OUT, "w"), indent=2)
print("WROTE", OUT)

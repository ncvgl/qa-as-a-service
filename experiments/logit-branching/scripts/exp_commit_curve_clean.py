import json, re, time, numpy as np, torch
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-0.6B"; DTYPE = torch.float32
# verified-suppressed target: co-founder / team conflict
TARGET = r"(co-?founder|founder[s]?\b.{0,20}(conflict|disput|disagree|fell out|split|left|quit)|team\b.{0,15}(conflict|disput|disagree|dysfunction|infight)|partnership.{0,15}(dispute|breakdown|fail)|internal conflict|interpersonal|cofounder)"
RX = re.compile(TARGET, re.I)
CONFIGS = {
    "list":      "Why do startups fail? Answer as a numbered list of factors.",
    "narrative": "Why do startups fail? Answer in a single flowing paragraph of prose. Do not use any lists, numbers, headings, or bullet points.",
}
M = 16; N = 50; STEP = 6; N_MAIN = 200; CHUNK = 16
torch.manual_seed(0); np.random.seed(0)

tok = AutoTokenizer.from_pretrained(MODEL); tok.padding_side = "left"
if tok.pad_token is None: tok.pad_token = tok.eos_token
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=DTYPE).eval(); torch.set_num_threads(4)

def chat_ids(p):
    t = tok.apply_chat_template([{"role": "user", "content": p}], tokenize=False,
                                add_generation_prompt=True, enable_thinking=False)
    return tok(t, return_tensors="pt").input_ids

@torch.no_grad()
def greedy(base, n):
    ch, past, cur = [], None, base
    for _ in range(n):
        out = model(input_ids=cur, past_key_values=past, use_cache=True); past = out.past_key_values
        nxt = int(out.logits[0, -1, :].argmax()); ch.append(nxt)
        if nxt == tok.eos_token_id: break
        cur = torch.tensor([[nxt]])
    return ch

@torch.no_grad()
def bgen(prefixes, n_new):
    g = [None]*len(prefixes)
    for s in range(0, len(prefixes), CHUNK):
        part = prefixes[s:s+CHUNK]; L = max(len(x) for x in part)
        inp = torch.full((len(part), L), tok.pad_token_id, dtype=torch.long)
        at = torch.zeros((len(part), L), dtype=torch.long)
        for i, x in enumerate(part):
            inp[i, L-len(x):] = torch.tensor(x); at[i, L-len(x):] = 1
        o = model.generate(input_ids=inp, attention_mask=at, max_new_tokens=n_new, do_sample=True,
                           temperature=1.0, top_p=0.95, pad_token_id=tok.pad_token_id)
        for i in range(len(part)): g[s+i] = o[i, L:].tolist()
    return g

def hit(ids): return 1 if RX.search(tok.decode(ids, skip_special_tokens=True)) else 0

out = {}; t0 = time.time()
for name, prompt in CONFIGS.items():
    base = chat_ids(prompt); bl = base[0].tolist()
    ch = greedy(base, N_MAIN); gtxt = tok.decode(ch, skip_special_tokens=True)
    tig = bool(RX.search(gtxt))
    rows = []
    for p in range(0, len(ch), STEP):
        # skip if greedy prefix already states the target (lockout already moot)
        pref_txt = tok.decode(ch[:p], skip_special_tokens=True)
        already = bool(RX.search(pref_txt))
        samp = bgen([bl + ch[:p]] * M, N)
        rs = float(np.mean([hit(g) for g in samp]))
        rows.append({"pos": p, "rec": rs, "already": already})
    out[name] = {"prompt": prompt, "greedy": gtxt, "target_in_greedy": tig, "rows": rows}
    rec = [r["rec"] for r in rows if not r["already"]]
    print(f"[{name}] len={len(ch)} tgt_in_greedy={tig} early={np.mean(rec[:3]):.2f} "
          f"late={np.mean(rec[-3:]):.2f} ({time.time()-t0:.0f}s)", flush=True)

json.dump(out, open("/tmp/curve_conflict.json", "w"), indent=2)

plt.figure(figsize=(8, 5))
for name, c in [("list", "tab:blue"), ("narrative", "tab:red")]:
    rows = out[name]["rows"]
    xs = [r["pos"] for r in rows]; ys = [r["rec"] for r in rows]
    plt.plot(xs, ys, "-o", color=c, label=f"{name} (greedy {len(out[name]['greedy'].split())}w)", ms=4)
plt.xlabel("branch position p (tokens into greedy answer)")
plt.ylabel("P(suppressed idea recovered | resample from prefix[:p])")
plt.title("Idea-commitment curve: 'co-founder conflict' in startup-failure answers\nQwen3-0.6B, M=16 samples/point")
plt.legend(); plt.grid(alpha=.3); plt.ylim(-.02, 1)
plt.tight_layout(); plt.savefig("/tmp/commitment_curve.png", dpi=110)
print("WROTE /tmp/curve_conflict.json and /tmp/commitment_curve.png")

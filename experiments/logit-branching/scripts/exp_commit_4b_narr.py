import json, re, time, numpy as np, torch
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-4B"; DTYPE = torch.bfloat16
PROMPT = ("Why did Rome fall? Answer in a single flowing paragraph of prose. "
          "Do not use any lists, numbers, headings, or bullet points.")
TARGET = r"(invas|barbar|german|goth|visigoth|vandal|\bhun\b|huns|attila|alaric|sack of rome|foreign (invad|attack|force)|external (attack|invad|threat)|migrat)"
RX = re.compile(TARGET, re.I)
M = 10; N = 50; N_MAIN = 200; CHUNK = 6
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

t0 = time.time()
base = chat_ids(PROMPT); bl = base[0].tolist()
ch = greedy(base, N_MAIN); gtxt = tok.decode(ch, skip_special_tokens=True)
tig = bool(RX.search(gtxt))
print(f"greedy len={len(ch)} target_in_greedy={tig} ({time.time()-t0:.0f}s)\nGREEDY: {gtxt}\n", flush=True)

# dense early (cliff likely in first sentence), sparser later
positions = sorted(set(list(range(0, min(40, len(ch)), 4)) + list(range(40, len(ch), 10))))
rows = []
for p in positions:
    already = bool(RX.search(tok.decode(ch[:p], skip_special_tokens=True)))
    samp = bgen([bl + ch[:p]] * M, N)
    rs = float(np.mean([hit(g) for g in samp]))
    ex = next((tok.decode(g, skip_special_tokens=True)[:90] for g in samp if hit(g)), "")
    rows.append({"pos": p, "rec": rs, "already": already,
                 "ctx": tok.decode(ch[max(0, p-6):p], skip_special_tokens=True), "ex": ex})
    print(f" p={p:>3} rec={rs:4.2f} {'(already)' if already else ''} ...{rows[-1]['ctx'][-26:]!r}  ({time.time()-t0:.0f}s)", flush=True)

json.dump({"prompt": PROMPT, "model": MODEL, "greedy": gtxt, "target_in_greedy": tig,
           "p0_recovery": rows[0]["rec"], "rows": rows}, open("/tmp/curve_4b_narr.json", "w"), indent=2)

plt.figure(figsize=(8.5, 5))
xs = [r["pos"] for r in rows]; ys = [r["rec"] for r in rows]
plt.plot(xs, ys, "-o", color="tab:red", ms=5)
plt.xlabel("branch position p (tokens into greedy prose answer)")
plt.ylabel("P('barbarian invasions' recovered | resample from prefix[:p])")
plt.title(f"4B narrative commitment curve: 'Why did Rome fall?' (prose)\n"
          f"target_in_greedy={tig}, p0_recovery={ys[0]:.2f}, M={M}")
plt.ylim(-.02, 1); plt.grid(alpha=.3)
plt.tight_layout(); plt.savefig("/tmp/curve_4b_narr.png", dpi=120)
print("WROTE /tmp/curve_4b_narr.json + .png")

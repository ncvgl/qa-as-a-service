import torch, itertools, numpy as np
from transformers import AutoModelForCausalLM, AutoTokenizer
from sentence_transformers import SentenceTransformer

MODEL = "Qwen/Qwen3-0.6B"
THRESH = 0.10        # a token must clear this prob to spawn a branch
N_CONT = 28          # max tokens per branch sentence
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32).eval()
torch.set_num_threads(4)
embedder = SentenceTransformer("all-MiniLM-L6-v2")

PERIOD = tok(".", add_special_tokens=False).input_ids[-1]

def chat_ids(prompt):
    text = tok.apply_chat_template([{"role": "user", "content": prompt}],
                                   tokenize=False, add_generation_prompt=True, enable_thinking=False)
    return tok(text, return_tensors="pt").input_ids

@torch.no_grad()
def greedy_with_dists(base, n):
    chosen, dists, past, cur = [], [], None, base
    for _ in range(n):
        out = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = out.past_key_values
        probs = torch.softmax(out.logits[0, -1, :], dim=-1)
        nxt = probs.argmax().item()
        chosen.append(nxt); dists.append(probs)
        if nxt == tok.eos_token_id:
            break
        cur = torch.tensor([[nxt]])
    return chosen, dists

@torch.no_grad()
def continue_to_sentence(prefix_ids, n):
    out_ids, past, cur = [], None, prefix_ids
    for _ in range(n):
        o = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = o.past_key_values
        nxt = o.logits[0, -1, :].argmax().item()
        if nxt == tok.eos_token_id:
            break
        out_ids.append(nxt)
        cur = torch.tensor([[nxt]])
        if nxt == PERIOD:
            break
    return out_ids

def entropy_bits(p):
    return -(p * torch.log2(p + 1e-12)).sum().item()

def run(prompt, n_main=40):
    base = chat_ids(prompt)
    chosen, dists = greedy_with_dists(base, n_main)
    print("#" * 80)
    print("PROMPT:", prompt)
    print("GREEDY:", repr(tok.decode(chosen, skip_special_tokens=True)))

    rows = []
    for p, probs in enumerate(dists):
        cand = [(i, probs[i].item()) for i in torch.where(probs >= THRESH)[0].tolist()]
        cand.sort(key=lambda x: -x[1])
        if len(cand) < 2:           # not a fork at this threshold
            continue
        H = entropy_bits(probs)
        prefix = torch.cat([base, torch.tensor([chosen[:p]], dtype=base.dtype)], dim=1)
        sents = []
        for tid, pr in cand:
            cont = continue_to_sentence(torch.cat([prefix, torch.tensor([[tid]])], dim=1), N_CONT)
            sents.append(tok.decode([tid] + cont, skip_special_tokens=True).strip())
        emb = embedder.encode(sents, normalize_embeddings=True)
        sim = emb @ emb.T
        iu = np.triu_indices(len(sents), 1)
        mean_sim = float(sim[iu].mean())
        rows.append((p, H, len(sents), mean_sim))
        print(f"\n  FORK @step {p}: H={H:.2f} bits, {len(sents)} branches, "
              f"mean pairwise cosine={mean_sim:.3f}  "
              f"({'SEMANTIC divergence' if mean_sim < 0.6 else 'syntactic / same idea'})")
        ctx = tok.decode(chosen[:p], skip_special_tokens=True)
        print(f"    context: ...{ctx[-50:]!r}")
        for (tid, pr), s in zip(cand, sents):
            print(f"      {tok.decode([tid])!r:>14} ({pr*100:4.1f}%) -> {s!r}")
    return rows

allrows = []
for p in ["Name one thing I could cook for dinner tonight. One short sentence.",
          "What is the meaning of the word 'bank'? Answer in one sentence.",
          "Suggest a good holiday destination. One short sentence."]:
    allrows += run(p)
    print()

print("=" * 80)
print("SUMMARY: token entropy vs. semantic similarity across all forks")
print(f"{'H(bits)':>9} {'branches':>9} {'cos_sim':>9}   verdict")
for p, H, nb, ms in sorted(allrows, key=lambda r: r[3]):
    print(f"{H:9.2f} {nb:9d} {ms:9.3f}   {'SEMANTIC' if ms < 0.6 else 'syntactic'}")
H = np.array([r[1] for r in allrows]); S = np.array([r[3] for r in allrows])
if len(H) > 2:
    print(f"\nPearson corr(entropy, cosine_sim) = {np.corrcoef(H, S)[0,1]:+.3f}")
    print("(near 0 => token uncertainty does NOT predict semantic divergence)")

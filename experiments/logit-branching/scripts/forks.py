import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-0.6B"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32).eval()
torch.set_num_threads(4)

def chat_ids(prompt):
    msgs = [{"role": "user", "content": prompt}]
    text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True,
                                   enable_thinking=False)
    return tok(text, return_tensors="pt").input_ids

@torch.no_grad()
def greedy_stats(input_ids, n):
    """greedy decode; record per-step entropy(bits) + top5 + chosen id"""
    stats, past, cur = [], None, input_ids
    for _ in range(n):
        out = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = out.past_key_values
        probs = torch.softmax(out.logits[0, -1, :], dim=-1)
        ent = -(probs * torch.log2(probs + 1e-12)).sum().item()
        top = torch.topk(probs, 5)
        nxt = top.indices[0].item()
        stats.append({"id": nxt, "ent": ent,
                      "top": [(tok.decode([i]), probs[i].item()) for i in top.indices.tolist()]})
        if nxt == tok.eos_token_id:
            break
        cur = torch.tensor([[nxt]])
    return stats

@torch.no_grad()
def continue_greedy(prefix_ids, n):
    out_ids, past, cur = [], None, prefix_ids
    for _ in range(n):
        o = model(input_ids=cur, past_key_values=past, use_cache=True)
        past = o.past_key_values
        nxt = o.logits[0, -1, :].argmax().item()
        if nxt == tok.eos_token_id:
            break
        out_ids.append(nxt)
        cur = torch.tensor([[nxt]])
    return out_ids

def run(prompt, n_main=40, n_branch=22, n_forks=2):
    base = chat_ids(prompt)
    stats = greedy_stats(base, n_main)
    chosen = [s["id"] for s in stats]
    answer = tok.decode(chosen, skip_special_tokens=True)
    print("#" * 78)
    print("PROMPT:", prompt)
    print("GREEDY ANSWER:", repr(answer))
    print("\nPer-token entropy (bits) — high = fork point:")
    for k, s in enumerate(stats):
        bar = "#" * int(s["ent"] * 3)
        print(f"  [{k:2d}] H={s['ent']:5.2f} {bar:<24} chose {tok.decode([s['id']])!r}")

    # find the highest-entropy positions (the inflection points)
    order = sorted(range(len(stats)), key=lambda i: stats[i]["ent"], reverse=True)[:n_forks]
    order.sort()
    for p in order:
        print("\n" + "=" * 70)
        ctx_txt = tok.decode(chosen[:p], skip_special_tokens=True)
        print(f"FORK at step {p}  (H={stats[p]['ent']:.2f} bits)")
        print(f"  context so far: ...{ctx_txt[-60:]!r}")
        print(f"  competing tokens: " +
              ", ".join(f"{t!r}={pr*100:.1f}%" for t, pr in stats[p]['top']))
        prefix = torch.cat([base, torch.tensor([chosen[:p]], dtype=base.dtype)], dim=1)
        for tok_str, pr in stats[p]['top'][:3]:
            alt_id = tok(tok_str, add_special_tokens=False).input_ids
            if len(alt_id) != 1:
                continue
            alt_id = alt_id[0]
            branch_prefix = torch.cat([prefix, torch.tensor([[alt_id]])], dim=1)
            cont = continue_greedy(branch_prefix, n_branch)
            full = tok.decode([alt_id] + cont, skip_special_tokens=True)
            print(f"    -> branch {tok_str!r:>12} ({pr*100:4.1f}%): {full!r}")

for p in ["Name one thing I could cook for dinner tonight. One short sentence.",
          "What is the meaning of the word 'bank'? Answer in one sentence."]:
    run(p)
    print()

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-0.6B"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32)
model.eval()

# bare-digit token ids (no leading space) -- verified earlier: 16->'1',17->'2',18->'3'
DIGITS = {1: 16, 2: 17, 3: 18}
for n, i in DIGITS.items():
    assert tok.decode([i]) == str(n), (n, i, tok.decode([i]))

# prompts deliberately END in the scaffolding (space / colon-space) so the
# very next token is forced to be the digit itself, not a syntax token.
PROMPTS = [
    "Pick a random number between 1 and 3. Answer: ",
    "Choose 1, 2, or 3 at random. My choice is ",
    "Random number from 1 to 3: ",
    "Q: Pick a random number: 1, 2 or 3.\nA: ",
]

for PROMPT in PROMPTS:
    enc = tok(PROMPT, return_tensors="pt")
    with torch.no_grad():
        logits = model(**enc).logits[0, -1, :]
    probs = torch.softmax(logits, dim=-1)

    # full-vocab top-5 (what the model ACTUALLY wants to say next)
    topk = torch.topk(logits, 5)
    top5 = [(tok.decode([i]), round(probs[i].item()*100, 2)) for i in topk.indices.tolist()]

    # mass on the three digits + renormalized "choice distribution"
    d = {n: probs[i].item() for n, i in DIGITS.items()}
    s = sum(d.values())
    renorm = {n: round(v/s*100, 1) for n, v in d.items()}
    last_tok = tok.convert_ids_to_tokens(enc.input_ids[0].tolist())[-1]

    print("="*70)
    print(f"PROMPT (ends in token {last_tok!r}): {PROMPT!r}")
    print(f"  full-vocab top5 next-token: {top5}")
    print(f"  P(digit 1/2/3) raw %: " + ", ".join(f"{n}={v*100:.2f}%" for n,v in d.items()))
    print(f"  mass on {{1,2,3}} total: {s*100:.2f}%")
    print(f"  renormalized among 1/2/3: {renorm}   (uniform would be 33.3/33.3/33.3)")

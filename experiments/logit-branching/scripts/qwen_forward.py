import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-0.6B"
PROMPTS = ["the sky is", "The sky is"]

tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32)
model.eval()

for PROMPT in PROMPTS:
    enc = tok(PROMPT, return_tensors="pt")
    print("=" * 60)
    print(f"Prompt: {PROMPT!r}")
    print("Token ids:", enc.input_ids[0].tolist())
    print("Tokens   :", tok.convert_ids_to_tokens(enc.input_ids[0].tolist()))

    with torch.no_grad():
        out = model(**enc)

    next_logits = out.logits[0, -1, :]
    probs = torch.softmax(next_logits, dim=-1)
    topk = torch.topk(next_logits, 20)

    print(f"\nTop-20 next-token logits for {PROMPT!r}")
    print(f"{'rank':>4}  {'token_id':>8}  {'logit':>10}  {'softmax%':>9}  token")
    for rank, (val, idx) in enumerate(zip(topk.values.tolist(), topk.indices.tolist()), 1):
        print(f"{rank:>4}  {idx:>8}  {val:>10.4f}  {probs[idx].item()*100:>8.3f}%  {tok.decode([idx])!r}")
    print()

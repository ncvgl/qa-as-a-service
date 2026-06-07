import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

torch.set_num_threads(4)

MODEL = "Qwen/Qwen3-0.6B"

tokenizer = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32)
model.eval()

prompts = [
    "The coin toss fell on",
    "I flipped a fair coin and it landed on",
    "Pick a number between 1 and 3:",
    "Pick a random number between 1 and 3. The number is",
]

for prompt in prompts:
    print("=" * 80)
    print(f"PROMPT: {prompt!r}")
    print("=" * 80)

    enc = tokenizer(prompt, return_tensors="pt")
    input_ids = enc["input_ids"]

    # Tokenization breakdown
    ids = input_ids[0].tolist()
    print("Tokenization:")
    for tid in ids:
        print(f"  id={tid:<8} token={tokenizer.decode([tid])!r}")
    print()

    with torch.no_grad():
        out = model(**enc)

    logits = out.logits[0, -1, :]  # last position
    probs = torch.softmax(logits, dim=-1)

    topk = torch.topk(logits, 10)
    print(f"{'rank':<5}{'token_id':<10}{'logit':<12}{'prob %':<12}{'token'}")
    print("-" * 60)
    for rank, (logit_val, idx) in enumerate(zip(topk.values.tolist(), topk.indices.tolist()), start=1):
        p = probs[idx].item() * 100.0
        tok = tokenizer.decode([idx])
        print(f"{rank:<5}{idx:<10}{logit_val:<12.4f}{p:<12.4f}{tok!r}")
    print()

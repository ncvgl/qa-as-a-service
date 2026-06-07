import time, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
tok = AutoTokenizer.from_pretrained("Qwen/Qwen3-0.6B")
tok.padding_side = "left"
if tok.pad_token is None: tok.pad_token = tok.eos_token
m = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3-0.6B", dtype=torch.float32).eval()
torch.set_num_threads(4)

prompt = "Why do startups fail? Explain in detail."
ids = tok(prompt, return_tensors="pt").input_ids[0].tolist()
N = 40

def run_batch(B):
    inp = torch.tensor([ids]*B)
    attn = torch.ones_like(inp)
    with torch.no_grad():
        m.generate(inp, attention_mask=attn, do_sample=True, temperature=1.0,
                   max_new_tokens=4, pad_token_id=tok.pad_token_id)  # warm
    t = time.perf_counter()
    with torch.no_grad():
        m.generate(inp, attention_mask=attn, do_sample=True, temperature=1.0,
                   max_new_tokens=N, pad_token_id=tok.pad_token_id)
    dt = time.perf_counter() - t
    return dt, B*N/dt

for B in [1, 4, 8, 16, 24]:
    dt, tps = run_batch(B)
    print(f"batch={B:2d}: {dt:5.2f}s for {B} seqs x {N} tok  ->  {tps:6.1f} tok/s total "
          f"({tps/B:5.2f} tok/s per-seq)")

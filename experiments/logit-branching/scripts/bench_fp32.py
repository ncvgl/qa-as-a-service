import time, torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen3-0.6B"
PROMPT = "The sky is"
N_NEW = 128

tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32)
model.eval()
torch.set_num_threads(4)

enc = tok(PROMPT, return_tensors="pt")

# warmup (also triggers any lazy init)
with torch.no_grad():
    model(**enc)

# --- prefill timing ---
t0 = time.perf_counter()
with torch.no_grad():
    out = model(**enc, use_cache=True)
past = out.past_key_values
prefill_s = time.perf_counter() - t0

# --- decode timing: greedy, one token at a time, measure steady state ---
next_id = out.logits[:, -1:].argmax(-1)
times = []
generated = [next_id.item()]
with torch.no_grad():
    for _ in range(N_NEW):
        t0 = time.perf_counter()
        o = model(input_ids=next_id, past_key_values=past, use_cache=True)
        past = o.past_key_values
        next_id = o.logits[:, -1:].argmax(-1)
        times.append(time.perf_counter() - t0)
        generated.append(next_id.item())

import statistics as st
# drop first 3 (cache-warm) for steady state
steady = times[3:]
print(f"=== transformers fp32, CPU, threads={torch.get_num_threads()} ===")
print(f"prompt tokens: {enc.input_ids.shape[1]}")
print(f"prefill: {prefill_s*1000:.1f} ms")
print(f"decode tokens/sec (steady, median): {1.0/st.median(steady):.2f} tok/s")
print(f"decode ms/token (steady, median):   {st.median(steady)*1000:.2f} ms")
print(f"decode tokens/sec (mean all):        {len(times)/sum(times):.2f} tok/s")
print("sample continuation:", repr(tok.decode(generated[:20])))

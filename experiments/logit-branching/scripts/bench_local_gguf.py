import time, sys
from llama_cpp import Llama

PROMPT = "The sky is"
N_NEW = 128

def bench(path, label):
    llm = Llama(model_path=path, n_ctx=512, n_threads=4, verbose=False)
    llm("Hello", max_tokens=4); llm.reset()           # warmup
    t0 = time.perf_counter()
    out = llm(PROMPT, max_tokens=N_NEW, temperature=0.0, top_k=1)
    dt = time.perf_counter() - t0
    n = out["usage"]["completion_tokens"]
    print(f"{label:>14}: {n:3d} tokens in {dt:5.2f}s -> {n/dt:6.2f} tok/s")
    del llm

# path, label
for path, label in [
    ("/tmp/Qwen3-0.6B-F32.gguf", "F32"),
]:
    bench(path, label)

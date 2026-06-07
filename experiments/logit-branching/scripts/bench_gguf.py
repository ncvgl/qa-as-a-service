import time, sys
from huggingface_hub import hf_hub_download
from llama_cpp import Llama

REPO = "unsloth/Qwen3-0.6B-GGUF"
PROMPT = "The sky is"
N_NEW = 128

def bench(fname):
    path = hf_hub_download(REPO, fname)
    llm = Llama(model_path=path, n_ctx=512, n_threads=4, verbose=False, logits_all=False)
    # warmup
    llm("Hello", max_tokens=4)
    llm.reset()
    t0 = time.perf_counter()
    out = llm(PROMPT, max_tokens=N_NEW, temperature=0.0, top_k=1)  # greedy
    dt = time.perf_counter() - t0
    n = out["usage"]["completion_tokens"]
    print(f"--- {fname} ---")
    print(f"generated {n} tokens in {dt:.2f}s  ->  {n/dt:.2f} tok/s")
    print("text:", repr(out["choices"][0]["text"][:80]))
    print()
    del llm

for fname in sys.argv[1:]:
    try:
        bench(fname)
    except Exception as e:
        print(f"!! {fname} failed: {e}\n")

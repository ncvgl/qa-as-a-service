from llama_cpp import Llama
import numpy as np

GGUF = "/root/.cache/huggingface/hub/models--unsloth--Qwen3-0.6B-GGUF/snapshots/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf"
llm = Llama(model_path=GGUF, n_ctx=1024, n_threads=4, logits_all=False, verbose=False)

# tokenize a prompt
toks = llm.tokenize(b"The capital of France is")
print("prompt tokens:", toks)

# eval and read full-vocab logits of the last token
llm.reset()
llm.eval(toks)
logits = np.array(llm.scores[llm.n_tokens - 1], dtype=np.float64)
print("logits shape:", logits.shape)
# softmax + entropy + top5
m = logits.max(); e = np.exp(logits - m); p = e / e.sum()
ent = float(-(p * np.log2(p + 1e-12)).sum())
top = np.argsort(p)[::-1][:5]
print(f"entropy(bits)={ent:.2f}")
for i in top:
    print(f"  {i} {llm.detokenize([int(i)]).decode('utf-8','replace')!r} p={p[i]*100:.1f}%")

# force a token (greedy pick) and continue a few steps
print("\n-- forced continuation --")
cur = toks[:]
for _ in range(8):
    llm.reset(); llm.eval(cur)
    lg = np.array(llm.scores[llm.n_tokens - 1])
    nxt = int(lg.argmax())
    cur.append(nxt)
print(llm.detokenize(cur).decode("utf-8", "replace"))

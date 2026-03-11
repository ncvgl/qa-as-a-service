#!/usr/bin/env python3
import json
import os
import sys
import time
import ssl
import urllib.request
from typing import Dict, Tuple

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
API_URL = "https://api.openai.com/v1/responses"
MODELS_URL = "https://api.openai.com/v1/models"


def load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # Explicitly override to ensure .env takes precedence over shell vars like PROMPT.
            os.environ[key] = value


def get_ssl_context() -> ssl.SSLContext:
    # Prefer certifi if available to avoid macOS cert issues.
    try:
        import certifi  # type: ignore
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def http_post(url: str, api_key: str, payload: Dict) -> Tuple[float, float, bytes, int]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120, context=get_ssl_context()) as resp:
            # After urlopen returns, headers are received; we sample TTFB right away.
            ttfb = time.perf_counter()
            body = resp.read()
            end = time.perf_counter()
            return (ttfb - start), (end - start), body, resp.status
    except urllib.error.HTTPError as e:
        # Read the error body for useful diagnostics.
        ttfb = time.perf_counter()
        body = e.read()
        end = time.perf_counter()
        return (ttfb - start), (end - start), body, e.code


def http_get(url: str, api_key: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=60, context=get_ssl_context()) as resp:
        return resp.read()


def extract_text(resp_json: Dict) -> str:
    # Responses API returns output as a list of content blocks.
    output_text = []
    for item in resp_json.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                output_text.append(content.get("text", ""))
    return "".join(output_text).strip()


def run_once(api_key: str, model: str, prompt: str, max_output_tokens: int) -> Dict:
    payload = {
        "model": model,
        "input": prompt,
        "max_output_tokens": max_output_tokens,
    }
    ttfb, total, body, status = http_post(API_URL, api_key, payload)
    try:
        resp_json = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        resp_json = {"error": "Failed to decode JSON", "raw": body[:200].decode("utf-8", "ignore")}
    return {
        "status": status,
        "ttfb_s": ttfb,
        "total_s": total,
        "response": resp_json,
        "text": extract_text(resp_json) if isinstance(resp_json, dict) else "",
    }


def summarize(results):
    ttfb = [r["ttfb_s"] for r in results if r["status"] == 200]
    total = [r["total_s"] for r in results if r["status"] == 200]
    def avg(xs):
        return sum(xs) / len(xs) if xs else None
    return {
        "ok": len(total),
        "ttfb_avg_s": avg(ttfb),
        "total_avg_s": avg(total),
        "ttfb_min_s": min(ttfb) if ttfb else None,
        "total_min_s": min(total) if total else None,
    }


def main():
    load_env(ENV_PATH)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("OPENAI_API_KEY is missing. Put it in .env or your environment.")
        sys.exit(1)

    if "--list-models" in sys.argv:
        raw = http_get(MODELS_URL, api_key)
        data = json.loads(raw.decode("utf-8"))
        models = sorted([m.get("id", "") for m in data.get("data", [])])
        print("\n".join(models))
        return

    model_a = os.environ.get("MODEL_A", "gpt-5.3")
    model_b = os.environ.get("MODEL_B", "gpt-5.4")
    prompt = os.environ.get(
        "PROMPT", "Explain the difference between TCP and UDP in one short paragraph."
    )
    runs = 3
    max_output_tokens = 200

    # Simple CLI overrides
    if "--runs" in sys.argv:
        idx = sys.argv.index("--runs") + 1
        if idx < len(sys.argv):
            runs = int(sys.argv[idx])
    if "--prompt" in sys.argv:
        idx = sys.argv.index("--prompt") + 1
        if idx < len(sys.argv):
            prompt = sys.argv[idx]

    print(f"Model A: {model_a}")
    print(f"Model B: {model_b}")
    print(f"Runs: {runs}")
    print(f"Prompt: {prompt}")
    print()

    results = {}
    for model in [model_a, model_b]:
        runs_out = []
        print(f"== {model} ==")
        for i in range(runs):
            r = run_once(api_key, model, prompt, max_output_tokens)
            runs_out.append(r)
            status = r["status"]
            print(
                f"Run {i+1}: status={status} ttfb={r['ttfb_s']:.3f}s total={r['total_s']:.3f}s"
            )
            if status != 200:
                print(f"  error: {r['response']}")
            else:
                text = r.get("text", "")
                if text:
                    print(f"  text: {text}")
        results[model] = runs_out
        summary = summarize(runs_out)
        print(
            f"Summary: ok={summary['ok']} ttfb_avg={summary['ttfb_avg_s']:.3f}s total_avg={summary['total_avg_s']:.3f}s"
            if summary["ttfb_avg_s"] is not None
            else "Summary: no successful runs"
        )
        print()

    # Quick comparison
    a_sum = summarize(results[model_a])
    b_sum = summarize(results[model_b])
    if a_sum["total_avg_s"] is not None and b_sum["total_avg_s"] is not None:
        faster = model_a if a_sum["total_avg_s"] < b_sum["total_avg_s"] else model_b
        print(f"Faster on average (total time): {faster}")


if __name__ == "__main__":
    main()

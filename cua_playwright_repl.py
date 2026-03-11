#!/usr/bin/env python3
import base64
import json
import os
import time
from typing import Any, Dict, List, Optional

from openai import OpenAI
from playwright.sync_api import sync_playwright

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


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
            os.environ[key] = value


def b64_png_from_page(page) -> str:
    png_bytes = page.screenshot(full_page=True)
    return base64.b64encode(png_bytes).decode("utf-8")


def handle_action(page, action: Dict[str, Any]) -> None:
    atype = action.get("type")
    if atype == "click":
        page.mouse.click(action.get("x", 0), action.get("y", 0), button=action.get("button", "left"))
    elif atype == "double_click":
        page.mouse.dblclick(action.get("x", 0), action.get("y", 0))
    elif atype == "right_click":
        page.mouse.click(action.get("x", 0), action.get("y", 0), button="right")
    elif atype == "move":
        page.mouse.move(action.get("x", 0), action.get("y", 0))
    elif atype == "type":
        text = action.get("text", "")
        page.keyboard.type(text)
    elif atype == "keypress":
        key = action.get("key") or action.get("keys") or ""
        if key:
            key = normalize_key(key)
            page.keyboard.press(key)
    elif atype == "scroll":
        x = action.get("x")
        y = action.get("y")
        if x is not None and y is not None:
            page.mouse.move(x, y)
        dx = action.get("scroll_x") or action.get("delta_x") or 0
        dy = action.get("scroll_y") or action.get("delta_y") or 0
        page.mouse.wheel(dx, dy)
    elif atype == "wait":
        duration_ms = action.get("duration_ms")
        duration_s = action.get("duration")
        if duration_ms is not None:
            time.sleep(float(duration_ms) / 1000.0)
        elif duration_s is not None:
            time.sleep(float(duration_s))
        else:
            time.sleep(1)
    elif atype == "drag":
        # Try common drag schema
        sx = action.get("start_x") or action.get("from_x") or action.get("x")
        sy = action.get("start_y") or action.get("from_y") or action.get("y")
        ex = action.get("end_x") or action.get("to_x")
        ey = action.get("end_y") or action.get("to_y")
        if sx is not None and sy is not None and ex is not None and ey is not None:
            page.mouse.move(sx, sy)
            page.mouse.down()
            page.mouse.move(ex, ey)
            page.mouse.up()
    else:
        raise ValueError(f"Unsupported action type: {atype}")


def normalize_key(key: str) -> str:
    # Normalize common aliases for Playwright
    mapping = {
        "CTRL": "Control",
        "CMD": "Meta",
        "COMMAND": "Meta",
        "WIN": "Meta",
        "ALT": "Alt",
        "OPTION": "Alt",
        "ENTER": "Enter",
        "ESC": "Escape",
        "ESCAPE": "Escape",
        "BACKSPACE": "Backspace",
        "DEL": "Delete",
        "DELETE": "Delete",
        "TAB": "Tab",
        "SPACE": "Space",
        "UP": "ArrowUp",
        "DOWN": "ArrowDown",
        "LEFT": "ArrowLeft",
        "RIGHT": "ArrowRight",
    }
    # Handle combos like CTRL+L
    parts = [p.strip() for p in key.replace("-", "+").split("+") if p.strip()]
    normalized = []
    for p in parts:
        upper = p.upper()
        normalized.append(mapping.get(upper, p))
    return "+".join(normalized)


def extract_output_text(response) -> str:
    try:
        return response.output_text or ""
    except Exception:
        return ""


def extract_action_json(response) -> Optional[Dict[str, Any]]:
    """
    Expects response_format=json_schema with schema name "ui_action".
    Returns the parsed JSON object from the response.
    """
    try:
        text = response.output_text or ""
        if not text:
            return None
        # Try direct JSON first.
        try:
            return json.loads(text)
        except Exception:
            pass
        # Fallback: extract the first JSON object from the text.
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        return None
    except Exception:
        return None


def main() -> None:
    load_env(ENV_PATH)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("OPENAI_API_KEY is missing. Put it in .env or your environment.")
        return

    # Fallback model for manual UI control when computer-use tool isn't available.
    model = os.environ.get("CUA_MODEL", "gpt-5.4-2026-03-05")
    width = int(os.environ.get("CUA_WIDTH", "1024"))
    height = int(os.environ.get("CUA_HEIGHT", "768"))

    client = OpenAI(api_key=api_key)

    if "--list-models" in os.sys.argv:
        models = [m.id for m in client.models.list().data]
        for mid in sorted(models):
            print(mid)
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto("about:blank")

        previous_response_id = None

        if "--instruction" in os.sys.argv:
            idx = os.sys.argv.index("--instruction") + 1
            if idx >= len(os.sys.argv):
                print("Missing value for --instruction")
                return
            instructions = [os.sys.argv[idx]]
        else:
            instructions = []

        print("Playwright REPL (manual UI control). Type instructions, or 'quit' to exit.")
        while True:
            if instructions:
                user_instruction = instructions.pop(0).strip()
                print(f"\nInstruction> {user_instruction}")
            else:
                user_instruction = input("\nInstruction> ").strip()
            if not user_instruction:
                if instructions:
                    continue
                else:
                    continue
            if user_instruction.lower() in {"quit", "exit"}:
                break

            max_steps = int(os.environ.get("CUA_MAX_STEPS", "8"))
            step = 0
            next_instruction = user_instruction
            last_response_id = previous_response_id

            invalid_retries = 0
            while step < max_steps:
                screenshot_b64 = b64_png_from_page(page)

                system_prompt = (
                    "You are controlling a browser UI. "
                    "Given the user's instruction and the screenshot, "
                    "respond with a single JSON object ONLY (no extra text). "
                    "Schema:\n"
                    "{"
                    "\"action\": \"click|double_click|right_click|move|type|keypress|scroll|wait|drag|done\","
                    "\"x\": number (optional),"
                    "\"y\": number (optional),"
                    "\"text\": string (optional),"
                    "\"key\": string (optional),"
                    "\"scroll_x\": number (optional),"
                    "\"scroll_y\": number (optional),"
                    "\"start_x\": number (optional),"
                    "\"start_y\": number (optional),"
                    "\"end_x\": number (optional),"
                    "\"end_y\": number (optional),"
                    "\"reason\": string (optional)"
                    "}"
                )

                response = client.responses.create(
                    model=model,
                    input=[
                        {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                        {
                            "role": "user",
                            "content": [
                                {"type": "input_text", "text": next_instruction},
                                {"type": "input_image", "image_url": f"data:image/png;base64,{screenshot_b64}"},
                            ],
                        },
                    ],
                    truncation="auto",
                    previous_response_id=last_response_id,
                )

                action_obj = extract_action_json(response)
                if not action_obj or not action_obj.get("action"):
                    print("Model did not return valid action JSON. Output:")
                    print(extract_output_text(response))
                    invalid_retries += 1
                    if invalid_retries >= 2:
                        break
                    next_instruction = (
                        "Return ONLY a JSON object with the 'action' field from the schema. No extra text."
                    )
                    last_response_id = response.id
                    continue

                action = action_obj.get("action")
                if action == "done":
                    reason = action_obj.get("reason")
                    if reason:
                        print(reason)
                    break

                try:
                    action_for_exec = dict(action_obj)
                    if "action" in action_for_exec and "type" not in action_for_exec:
                        action_for_exec["type"] = action_for_exec["action"]
                    handle_action(page, action_for_exec)
                except Exception as e:
                    print(f"Action error: {e}")
                    break

                step += 1
                time.sleep(0.8)
                next_instruction = "Continue."
                last_response_id = response.id

            previous_response_id = last_response_id

            # Save a screenshot after completing the instruction
            try:
                out_dir = os.path.join(os.path.dirname(__file__), "cua_outputs")
                os.makedirs(out_dir, exist_ok=True)
                ts = int(time.time())
                out_path = os.path.join(out_dir, f"final_{ts}.png")
                page.screenshot(path=out_path, full_page=True)
                print(f"Saved final screenshot: {out_path}")
            except Exception as e:
                print(f"Failed to save screenshot: {e}")

            if not instructions and "--instruction" in os.sys.argv:
                break

        browser.close()


if __name__ == "__main__":
    main()

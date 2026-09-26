"""One browser task with jev-ultrafast (github.com/browser-use/jev-ultrafast, MIT), for the app's browse tool (shared/browse.ts).

Run inside jev-ultrafast's own environment: uv run --project <jev-ultrafast> python scripts/browse_runner.py --url URL --goal GOAL
Prints one JSON object per line: {"type": "step", ...} for each action taken, then {"type": "result", ...} with how it ended, the page it
ended on and the elements visible there (the agent's own view of it), or {"type": "error", "error": ...}. Keys come from the environment
(TYPESAFE_API_KEY, TEXT_MODEL_*); nothing here prints them.
"""

import argparse
import json
import sys
import time


def out(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def line(e):
    """One element as the agent saw it: [index] role label = value."""
    value = e.get("value")
    return f"[{e.get('index')}] {e.get('role', '')} {e.get('label', '')}".strip() + (f" = {value}" if value not in (None, "") else "")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--goal", required=True)
    parser.add_argument("--max-seconds", type=float, default=180)
    args = parser.parse_args()
    try:
        from jev_ultrafast import Agent
    except Exception as e:  # not run in jev-ultrafast's environment
        out({"type": "error", "error": f"jev-ultrafast is not importable here: {e}"})
        return 1
    started = time.monotonic()
    seen = 0
    try:
        with Agent(args.url, args.goal) as agent:
            state = agent.state
            for state in agent.run():
                for h in state["history"][seen:]:
                    out({"type": "step", "step": h["step"], "action": h["action"], "choice": h["choice"], "text": h["text"],
                         "url": h["url"], "page_changed": h["page_changed"], "elapsed_ms": h["elapsed_ms"]})
                seen = len(state["history"])
                if time.monotonic() - started > args.max_seconds:
                    state["status"] = "blocked"
                    out({"type": "note", "note": f"stopped after {args.max_seconds:.0f} s"})
                    break
            page = state["page"]
            elements = [line(e) for e in agent.snapshot()["elements"][:60]]
            out({"type": "result", "status": state["status"], "url": page.get("url"), "title": page.get("title"),
                 "steps": len(state["history"]), "elapsed_ms": state["elapsed_ms"], "elements": elements})
            return 0 if state["status"] == "done" else 2
    except Exception as e:
        out({"type": "error", "error": f"{type(e).__name__}: {e}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())

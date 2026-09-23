"""Advisory Jev routing for Hermes CLI and gateway turns."""

import json
import subprocess
from pathlib import Path


ROUTER = Path(__file__).with_name("route.mjs")


def pre_llm_call(**kwargs):
    # Child agents receive the delegated goal, not the original user request.
    if kwargs.get("parent_session_id"):
        return None
    prompt = kwargs.get("user_message")
    if not isinstance(prompt, str) or not prompt.strip():
        return None
    try:
        result = subprocess.run(
            ["node", str(ROUTER)],
            input=json.dumps({"prompt": prompt}),
            text=True,
            capture_output=True,
            timeout=2.5,
            check=False,
        )
        if result.returncode != 0 or not result.stdout:
            return None
        route = json.loads(result.stdout)
        if route.get("status") != "classified":
            return None
        mode = route["mode"]
        return (
            f"Jev advisory route: {route['role']}/{route['work']}/{mode}. "
            "Use this classification to set an appropriate verification depth. "
            "If delegation helps, use delegate_task with the user's actual goal and full context; "
            "otherwise continue in this session. Hermes delegate_task uses the globally configured "
            "delegation model (or inherits the parent model), not a per-task tier model. "
            "This suggestion does not change the current model, force delegation, or act as a security boundary."
        )
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", pre_llm_call)

"""Attach the runtime-wide initial GDN selection to user generate requests.

Every user-facing OpenAI entrypoint (Chat Completions, legacy Completions,
Responses) funnels through :func:`bind_initial_gdn_request` so each new
sequence starts from the same memory-derived recurrent state and shares one
radix cache namespace per state identity.
"""

from __future__ import annotations

from typing import Any

INITIAL_GDN_PARAM = "qwen_exo_session_initial_gdn"
DISABLE_INITIAL_GDN_PARAM = "qwen_exo_disable_session_initial_gdn"
INITIAL_GDN_DISABLED_CACHE_NAMESPACE = "qwen-exo:v1:global-initial-gdn:disabled"
INITIAL_GDN_UNAVAILABLE_CACHE_NAMESPACE = (
    "qwen-exo:v1:global-initial-gdn:unavailable"
)


def bind_initial_gdn_request(
    runtime: Any,
    *,
    custom_params: dict[str, Any],
    extra_key: str | None,
) -> tuple[dict[str, Any], str]:
    """Return request custom params and radix key bound to the global initial GDN.

    Client-supplied artifact identities are never trusted; the runtime chooses
    the current global snapshot. ``qwen_exo_disable_session_initial_gdn``
    opts one request out (for A/B comparison). Requests without a bound state
    move to their own namespace so they never reuse cached recurrent state
    that descends from an initial GDN, and vice versa.
    """

    params = dict(custom_params)
    disabled = params.pop(DISABLE_INITIAL_GDN_PARAM, None) is True
    params.pop(INITIAL_GDN_PARAM, None)
    selection = None if disabled else runtime.initial_gdn_selection()
    if isinstance(selection, dict) and selection.get("cache_namespace"):
        params[INITIAL_GDN_PARAM] = dict(selection)
        namespace = str(selection["cache_namespace"])
    elif disabled:
        namespace = INITIAL_GDN_DISABLED_CACHE_NAMESPACE
    else:
        namespace = INITIAL_GDN_UNAVAILABLE_CACHE_NAMESPACE
    return params, f"{namespace}|{extra_key}" if extra_key else namespace


__all__ = [
    "DISABLE_INITIAL_GDN_PARAM",
    "INITIAL_GDN_DISABLED_CACHE_NAMESPACE",
    "INITIAL_GDN_PARAM",
    "INITIAL_GDN_UNAVAILABLE_CACHE_NAMESPACE",
    "bind_initial_gdn_request",
]

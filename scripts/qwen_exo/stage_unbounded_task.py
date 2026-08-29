from __future__ import annotations

import shutil
import tempfile
from pathlib import Path


_AGENT_TIMEOUT_KEY = "timeout_sec"


def _remove_agent_timeout(config: str) -> str:
    lines = config.splitlines(keepends=True)
    in_agent_section = False
    removed = False
    output: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_agent_section = stripped == "[agent]"
        key, separator, _value = stripped.partition("=")
        if in_agent_section and separator and key.strip() == _AGENT_TIMEOUT_KEY:
            removed = True
            continue
        output.append(line)
    return "".join(output) if removed else config


def stage_unbounded_agent_task(task: str | Path) -> tuple[Path, Path]:
    """Copy a task or dataset with agent execution deadlines removed.

    Pier resolves a missing ``[agent].timeout_sec`` to ``None`` and passes it
    to ``asyncio.wait_for`` as ``timeout=None``. Do not write zero: zero is an
    immediate timeout, not an unlimited timeout. Environment build/setup,
    verifier, HTTP, and internal-job timeouts remain independent.

    The staged directory is caller-owned and must be removed after Pier exits.
    """
    source = Path(task).expanduser().resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"DeepSWE task directory not found: {source}")

    staging_root = Path(tempfile.mkdtemp(prefix="qwen-exo-swe-task-"))
    staged = staging_root / source.name
    try:
        shutil.copytree(source, staged)
        config_paths = sorted(staged.rglob("task.toml"))
        if not config_paths:
            raise ValueError(f"No task.toml found under DeepSWE path: {source}")
        for config_path in config_paths:
            config_path.write_text(
                _remove_agent_timeout(config_path.read_text(encoding="utf-8")),
                encoding="utf-8",
            )
    except BaseException:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise
    return staged, staging_root

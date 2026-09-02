#!/usr/bin/env python3
"""Measure QWEN-EXO Q/K recall quality against a labelled question set.

Each JSONL line is ``{"question": "...", "expected": "reflection-memory/x.md"}``
(``expected`` may also be a list of acceptable relative paths). The script
calls the admin ``/qwen-exo/tensor-bank/rank-preview`` endpoint, which runs the
same query probe and ``TensorBank.rank`` call a user request runs (lexical
fusion included, no judge), and reports hit@1, hit@3, MRR and the per-question
rank of the expected document.

Sweeping the recall layer or the retrieval-head subset requires restarting the
server with ``--qwen-exo-qk-layer`` / ``--qwen-exo-qk-query-heads``; run this
script once per configuration and compare the summaries. Query pooling can be
compared without a restart via ``--pooling``.

Example::

    python scripts/qwen_exo/qk_rank_eval.py cases.jsonl --base http://127.0.0.1:30000
    python scripts/qwen_exo/qk_rank_eval.py cases.jsonl --pooling windows

A starter case file can be derived from the reflection memories themselves with
``--bootstrap-from-knowledge``: every ``reflection-memory/*.md`` title becomes a
question whose expected document is that file. This measures self-retrieval
only; real user questions should be added over time.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any


def _post(base: str, path: str, payload: dict[str, Any], timeout: float) -> Any:
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _get(base: str, path: str, timeout: float) -> Any:
    with urllib.request.urlopen(base.rstrip("/") + path, timeout=timeout) as response:
        return json.load(response)


def _load_cases(path: Path) -> list[dict[str, Any]]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        item = json.loads(line)
        expected = item["expected"]
        item["expected"] = [expected] if isinstance(expected, str) else list(expected)
        cases.append(item)
    return cases


def _bootstrap_cases(base: str, timeout: float) -> list[dict[str, Any]]:
    listing = _get(base, "/qwen-exo/knowledge", timeout)
    documents = listing.get("documents") if isinstance(listing, dict) else listing
    cases = []
    for document in documents or ():
        path = str(document.get("relative_path") or "")
        title = str(document.get("title") or "").strip()
        if not path.startswith("reflection-memory/") or not title:
            continue
        cases.append({"question": title, "expected": [path]})
    return cases


def _rank_of(expected: list[str], candidates: list[dict[str, Any]]) -> int | None:
    for candidate in candidates:
        if candidate.get("relative_path") in expected:
            return int(candidate["rank"])
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("cases", nargs="?", help="JSONL question/expected file")
    parser.add_argument("--base", default="http://127.0.0.1:30000")
    parser.add_argument("--limit", type=int, default=16)
    parser.add_argument("--pooling", choices=("sentence", "windows"), default=None)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument(
        "--bootstrap-from-knowledge",
        action="store_true",
        help="derive self-retrieval cases from reflection memory titles",
    )
    parser.add_argument("--json", action="store_true", help="print machine-readable summary")
    args = parser.parse_args()

    if args.bootstrap_from_knowledge:
        cases = _bootstrap_cases(args.base, args.timeout)
    elif args.cases:
        cases = _load_cases(Path(args.cases))
    else:
        parser.error("provide a cases file or --bootstrap-from-knowledge")
    if not cases:
        print("no cases", file=sys.stderr)
        return 2

    rows = []
    for case in cases:
        payload = {"question": case["question"], "limit": int(args.limit)}
        if args.pooling:
            payload["pooling"] = args.pooling
        result = _post(args.base, "/qwen-exo/tensor-bank/rank-preview", payload, args.timeout)
        rank = _rank_of(case["expected"], result.get("candidates") or [])
        rows.append(
            {
                "question": case["question"],
                "expected": case["expected"],
                "rank": rank,
                "top": [c.get("relative_path") for c in (result.get("candidates") or [])[:3]],
                "probe_status": result.get("probe_status"),
                "config": {
                    "layer": result.get("qk_layer_id"),
                    "heads": result.get("qk_query_heads"),
                    "pooling": result.get("qk_query_pooling"),
                },
            }
        )

    total = len(rows)
    hit1 = sum(1 for row in rows if row["rank"] == 1)
    hit3 = sum(1 for row in rows if row["rank"] is not None and row["rank"] <= 3)
    mrr = sum(1.0 / row["rank"] for row in rows if row["rank"]) / total
    summary = {
        "cases": total,
        "hit@1": hit1 / total,
        "hit@3": hit3 / total,
        "mrr": mrr,
        "config": rows[0]["config"] if rows else None,
    }
    if args.json:
        print(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1))
        return 0
    print(
        f"cases={total} hit@1={summary['hit@1']:.2f} hit@3={summary['hit@3']:.2f} "
        f"mrr={mrr:.3f} config={summary['config']}"
    )
    for row in rows:
        print(f"  rank={row['rank']!s:>4}  {row['question'][:48]!r:52} top={row['top']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

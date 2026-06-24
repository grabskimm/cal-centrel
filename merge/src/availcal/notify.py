"""Detect newly-added busy blocks between merge runs.

Each run, after merging, we diff the fresh busy blocks against the previous
``merged/busy.json`` snapshot and carry a running list of *new* blocks in
``merged/added.json``. The private calendar view reads that list to show
"new events" notifications the owner can dismiss.

A block's identity is ``(source, start, end)`` — the same key the merged feed
uses for stable UIDs — so re-emitting an unchanged block is not a "new" event.
Entries are stamped with ``firstSeen`` and pruned once the event is in the past
or after ``MAX_AGE``; the list is capped at ``MAX_ENTRIES`` (newest first).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

# Tracked additions expire so the notifications list can't grow without bound.
MAX_AGE = timedelta(days=14)
MAX_ENTRIES = 100
_TS_FMT = "%Y-%m-%dT%H:%M:%SZ"


def _key(item: dict) -> str:
    return f"{item.get('source')}|{item.get('start')}|{item.get('end')}"


def _parse(raw: bytes | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return [d for d in data if isinstance(d, dict)] if isinstance(data, list) else []


def _ts(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, _TS_FMT).replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return None


def compute_additions(
    prev_busy: bytes | None,
    current_busy: list[dict],
    existing_added: bytes | None,
    now: datetime,
) -> list[dict]:
    """Return the updated additions list.

    Args:
        prev_busy: bytes of the previous ``merged/busy.json`` (or None).
        current_busy: the freshly-merged busy blocks (start/end/source/status dicts).
        existing_added: bytes of the previous ``merged/added.json`` (or None).
        now: timezone-aware UTC "now".

    On the very first run (no previous snapshot) we establish a baseline rather
    than flagging every pre-existing event as new.
    """
    carried = _parse(existing_added)
    if prev_busy is None:
        return _prune(carried, now)

    prev_keys = {_key(i) for i in _parse(prev_busy)}
    seen = {_key(a) for a in carried}
    now_iso = now.strftime(_TS_FMT)
    for item in current_busy:
        k = _key(item)
        if k not in prev_keys and k not in seen:
            carried.append(
                {
                    "start": item.get("start"),
                    "end": item.get("end"),
                    "source": item.get("source"),
                    "status": item.get("status", "busy"),
                    "firstSeen": now_iso,
                }
            )
            seen.add(k)
    return _prune(carried, now)


def _prune(added: list[dict], now: datetime) -> list[dict]:
    kept = []
    for a in added:
        end = _ts(a.get("end", ""))
        seen_at = _ts(a.get("firstSeen", "")) or now
        if end is None or end < now:  # malformed or already passed
            continue
        if now - seen_at > MAX_AGE:
            continue
        kept.append({**a, "firstSeen": seen_at.strftime(_TS_FMT)})
    kept.sort(key=lambda a: a["firstSeen"], reverse=True)
    return kept[:MAX_ENTRIES]


def serialize_added(added: list[dict]) -> bytes:
    return json.dumps(added, separators=(",", ":")).encode("utf-8")

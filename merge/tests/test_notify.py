"""Tests for new-event detection (notifications)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from availcal.notify import compute_additions, serialize_added

NOW = datetime(2026, 6, 24, 12, 0, 0, tzinfo=UTC)


def _busy(*items: tuple[str, str, str]) -> bytes:
    """Build a merged/busy.json payload from (start, end, source) triples."""
    return json.dumps(
        [{"start": s, "end": e, "source": src, "status": "busy"} for s, e, src in items]
    ).encode()


def _items(*items: tuple[str, str, str]) -> list[dict]:
    return [{"start": s, "end": e, "source": src, "status": "busy"} for s, e, src in items]


FUT1 = ("2026-06-25T09:00:00Z", "2026-06-25T10:00:00Z", "Work")
FUT2 = ("2026-06-26T14:00:00Z", "2026-06-26T15:00:00Z", "Personal")


def test_first_run_establishes_baseline_without_flooding():
    # No previous snapshot -> do NOT report every existing event as "new".
    added = compute_additions(prev_busy=None, current_busy=_items(FUT1, FUT2), existing_added=None, now=NOW)
    assert added == []


def test_new_block_is_detected():
    prev = _busy(FUT1)
    added = compute_additions(prev_busy=prev, current_busy=_items(FUT1, FUT2), existing_added=None, now=NOW)
    assert len(added) == 1
    assert added[0]["source"] == "Personal"
    assert added[0]["firstSeen"] == "2026-06-24T12:00:00Z"


def test_unchanged_blocks_are_not_new():
    prev = _busy(FUT1, FUT2)
    added = compute_additions(prev_busy=prev, current_busy=_items(FUT1, FUT2), existing_added=None, now=NOW)
    assert added == []


def test_existing_additions_are_carried_forward_and_deduped():
    existing = json.dumps(
        [{"start": FUT2[0], "end": FUT2[1], "source": "Personal", "status": "busy", "firstSeen": "2026-06-23T12:00:00Z"}]
    ).encode()
    # FUT2 already tracked; FUT1 is genuinely new this run.
    prev = _busy(FUT2)
    added = compute_additions(prev_busy=prev, current_busy=_items(FUT1, FUT2), existing_added=existing, now=NOW)
    keys = {(a["source"], a["firstSeen"]) for a in added}
    assert ("Personal", "2026-06-23T12:00:00Z") in keys  # original firstSeen preserved
    assert ("Work", "2026-06-24T12:00:00Z") in keys  # newly added now
    assert len(added) == 2


def test_past_events_are_pruned():
    past = ("2026-06-20T09:00:00Z", "2026-06-20T10:00:00Z", "Old")
    existing = json.dumps(
        [{"start": past[0], "end": past[1], "source": "Old", "status": "busy", "firstSeen": "2026-06-20T08:00:00Z"}]
    ).encode()
    added = compute_additions(prev_busy=_busy(), current_busy=[], existing_added=existing, now=NOW)
    assert added == []  # event already ended -> dropped


def test_stale_additions_expire_after_max_age():
    old_seen = (NOW - timedelta(days=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    existing = json.dumps(
        [{"start": FUT1[0], "end": FUT1[1], "source": "Work", "status": "busy", "firstSeen": old_seen}]
    ).encode()
    added = compute_additions(prev_busy=_busy(FUT1), current_busy=_items(FUT1), existing_added=existing, now=NOW)
    assert added == []  # firstSeen older than MAX_AGE -> dropped


def test_serialize_roundtrips():
    added = compute_additions(prev_busy=_busy(FUT1), current_busy=_items(FUT1, FUT2), existing_added=None, now=NOW)
    assert json.loads(serialize_added(added)) == added

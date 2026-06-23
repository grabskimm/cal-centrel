"""Tests for the time-correctness chokepoint."""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from availcal.timeutil import (
    all_day_bounds,
    ensure_aware,
    floating_to_utc,
    to_utc,
)


def test_ensure_aware_rejects_naive():
    with pytest.raises(ValueError, match="naive"):
        ensure_aware(datetime(2026, 6, 1, 9, 0))


def test_ensure_aware_passes_aware():
    dt = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    assert ensure_aware(dt) is dt


def test_to_utc_converts_offset():
    dt = datetime(2026, 6, 1, 9, 0, tzinfo=ZoneInfo("America/New_York"))  # EDT, -4
    out = to_utc(dt)
    assert out.tzinfo == UTC
    assert (out.hour, out.minute) == (13, 0)


def test_floating_pinned_to_default_tz():
    # Floating 09:00 in New York (EDT) -> 13:00 UTC
    out = floating_to_utc(datetime(2026, 6, 10, 9, 0), "America/New_York")
    assert out.tzinfo == UTC
    assert (out.hour, out.minute) == (13, 0)


def test_all_day_bounds_spans_full_day_in_utc():
    start, end = all_day_bounds(
        date(2026, 6, 15), tzid=None, default_tz="America/New_York", days=1
    )
    # Midnight EDT June 15 == 04:00 UTC; full day == 24h later.
    assert start == datetime(2026, 6, 15, 4, 0, tzinfo=UTC)
    assert end == datetime(2026, 6, 16, 4, 0, tzinfo=UTC)


def test_dst_spring_forward_duration():
    # 01:30 EST (-5) -> 06:30 UTC ; 03:30 EDT (-4) -> 07:30 UTC : 1h real.
    s = to_utc(datetime(2026, 3, 8, 1, 30, tzinfo=ZoneInfo("America/New_York")))
    e = to_utc(datetime(2026, 3, 8, 3, 30, tzinfo=ZoneInfo("America/New_York")))
    assert (e - s).total_seconds() == 3600

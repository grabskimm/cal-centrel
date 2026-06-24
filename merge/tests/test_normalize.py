"""Tests for event -> BusyInterval normalization (recurrence via library)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import icalendar

from availcal.normalize import normalize_calendar

FIX = Path(__file__).parent / "fixtures"
WS = datetime(2026, 1, 1, tzinfo=UTC)
WE = datetime(2026, 12, 31, tzinfo=UTC)


def _load(name: str) -> icalendar.Calendar:
    return icalendar.Calendar.from_ical((FIX / name).read_text())


def _norm(name: str, source: str, **kw):
    return normalize_calendar(
        _load(name), source=source, window_start=WS, window_end=WE,
        default_tz="America/New_York", **kw,
    )


def test_dst_boundary_to_utc():
    [iv] = _norm("dst.ics", "Work")
    assert iv.start == datetime(2026, 3, 8, 6, 30, tzinfo=UTC)
    assert iv.end == datetime(2026, 3, 8, 7, 30, tzinfo=UTC)
    assert iv.source == "Work"
    assert iv.start.utcoffset().total_seconds() == 0


def test_all_day_expands_full_day_utc():
    [iv] = _norm("allday.ics", "Perso")
    # Midnight EDT -> 04:00 UTC, full 24h span.
    assert iv.start == datetime(2026, 6, 15, 4, 0, tzinfo=UTC)
    assert iv.end == datetime(2026, 6, 16, 4, 0, tzinfo=UTC)


def test_floating_pinned_to_default_tz():
    [iv] = _norm("floating.ics", "Perso")
    assert iv.start == datetime(2026, 6, 10, 13, 0, tzinfo=UTC)


def test_weekly_rrule_with_exdate():
    ivs = sorted(_norm("weekly_rrule.ics", "Work"), key=lambda i: i.start)
    # COUNT=4 Mondays (Jun 1,8,15,22) minus EXDATE Jun 15 -> 3 events.
    starts = [i.start for i in ivs]
    assert starts == [
        datetime(2026, 6, 1, 13, 30, tzinfo=UTC),
        datetime(2026, 6, 8, 13, 30, tzinfo=UTC),
        datetime(2026, 6, 22, 13, 30, tzinfo=UTC),
    ]


def test_transparent_and_free_skipped_tentative_kept():
    ivs = _norm("free_and_transparent.ics", "Work")
    # transparent + free skipped; only the tentative remains.
    assert len(ivs) == 1
    assert ivs[0].status == "tentative"


def test_tentative_dropped_when_disabled():
    ivs = _norm("free_and_transparent.ics", "Work", include_tentative=False)
    assert ivs == []


def test_no_titles_leak_into_model():
    # The model has no field that could carry a SUMMARY.
    [iv] = _norm("dst.ics", "Work")
    assert not hasattr(iv, "summary")
    assert "Should be stripped" not in repr(iv)

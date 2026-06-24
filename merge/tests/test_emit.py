"""Tests for ICS emission + round-trip validity."""

from __future__ import annotations

from datetime import UTC, datetime

import icalendar

from availcal.emit import emit_merged_ics, emit_per_source
from availcal.models import BusyInterval


def _utc(h, mi=0):
    return datetime(2026, 6, 24, h, mi, tzinfo=UTC)


def _events(ics: bytes):
    cal = icalendar.Calendar.from_ical(ics)  # round-trips or raises
    return [c for c in cal.walk() if c.name == "VEVENT"]


def test_merged_round_trips_and_is_self_describing():
    ivs = [
        BusyInterval(_utc(9), _utc(10), "Work"),
        BusyInterval(_utc(9), _utc(10), "Perso"),
    ]
    evts = _events(emit_merged_ics(ivs))
    assert len(evts) == 2
    summaries = {str(e.get("SUMMARY")) for e in evts}
    cats = {str(e.get("CATEGORIES").to_ical().decode()) for e in evts}
    assert summaries == {"Work", "Perso"}  # SUMMARY = source label
    assert cats == {"Work", "Perso"}       # CATEGORIES = source label
    for e in evts:
        assert str(e.get("TRANSP")) == "OPAQUE"
        assert e.get("DESCRIPTION") is None
        assert e.get("LOCATION") is None


def test_merged_uid_is_stable_hash_distinct_per_source():
    a = BusyInterval(_utc(9), _utc(10), "Work")
    b = BusyInterval(_utc(9), _utc(10), "Perso")
    evts = _events(emit_merged_ics([a, b]))
    uids = {str(e.get("UID")) for e in evts}
    assert len(uids) == 2
    assert uids == {a.stable_uid(), b.stable_uid()}


def test_merged_drops_original_titles_completely():
    iv = BusyInterval(_utc(9), _utc(10), "Work", uid="secret-title@x")
    ics = emit_merged_ics([iv]).decode()
    assert "secret-title" not in ics  # original UID not leaked to merged feed
    assert "SUMMARY:Work" in ics


def test_dtstart_emitted_in_utc():
    iv = BusyInterval(_utc(9), _utc(10), "Work")
    ics = emit_merged_ics([iv]).decode()
    assert "DTSTART:20260624T090000Z" in ics
    assert "DTEND:20260624T100000Z" in ics


def test_per_source_preserves_original_uid():
    ivs = [
        BusyInterval(_utc(9), _utc(10), "Work", uid="orig-123@work"),
        BusyInterval(_utc(11), _utc(12), "Perso", uid="orig-456@perso"),
    ]
    per = emit_per_source(ivs)
    assert set(per.keys()) == {"Work", "Perso"}
    work_ics = per["Work"].decode()
    assert "orig-123@work" in work_ics  # per-source keeps original UID
    assert "SUMMARY:Work" in work_ics


def test_public_feed_is_fully_anonymized_and_unions_sources():
    from availcal.emit import emit_public_ics

    # Two DIFFERENT sources overlapping in time.
    ivs = [
        BusyInterval(_utc(9), _utc(11), "Work"),
        BusyInterval(_utc(10), _utc(12), "iCloud"),
        BusyInterval(_utc(14), _utc(15), "Perso"),
    ]
    ics = emit_public_ics(ivs)
    evts = _events(ics)

    # Cross-source overlap unioned: 9-11 + 10-12 -> one 9-12 block, plus 14-15.
    assert len(evts) == 2
    for e in evts:
        assert str(e.get("SUMMARY")) == "Busy"   # generic, never a label
        assert e.get("CATEGORIES") is None        # no source category
        assert str(e.get("TRANSP")) == "OPAQUE"
        assert e.get("DESCRIPTION") is None and e.get("LOCATION") is None

    # No source name leaks anywhere in the bytes.
    text = ics.decode()
    for leak in ("Work", "iCloud", "Perso"):
        assert leak not in text


def test_public_uid_independent_of_source():
    from availcal.emit import _public_uid

    a = BusyInterval(_utc(9), _utc(10), "Work")
    b = BusyInterval(_utc(9), _utc(10), "Perso")
    # Same time, different source -> identical public UID (no source in it).
    assert _public_uid(a) == _public_uid(b)


def test_public_freebusy_json_is_anonymized_array():
    import json as _json

    from availcal.emit import emit_public_freebusy_json

    ivs = [
        BusyInterval(_utc(9), _utc(11), "Work"),
        BusyInterval(_utc(10), _utc(12), "iCloud"),
        BusyInterval(_utc(14), _utc(15), "Perso"),
    ]
    data = _json.loads(emit_public_freebusy_json(ivs))
    # Bare array of {start,end}; cross-source overlap unioned to 9-12 + 14-15.
    assert data == [
        {"start": "2026-06-24T09:00:00Z", "end": "2026-06-24T12:00:00Z"},
        {"start": "2026-06-24T14:00:00Z", "end": "2026-06-24T15:00:00Z"},
    ]
    # No labels leak.
    raw = emit_public_freebusy_json(ivs).decode()
    for leak in ("Work", "iCloud", "Perso", "source"):
        assert leak not in raw


def test_merged_busy_json_keeps_labels_and_status():
    import json as _json

    from availcal.emit import emit_merged_busy_json

    ivs = [
        BusyInterval(_utc(9), _utc(10), "MendelG", status="busy"),
        BusyInterval(_utc(9), _utc(10), "LoganG", status="tentative"),
    ]
    data = _json.loads(emit_merged_busy_json(ivs))
    # Same time, two sources -> two labeled blocks (not unioned).
    assert {(o["source"], o["status"]) for o in data} == {
        ("MendelG", "busy"),
        ("LoganG", "tentative"),
    }
    assert all(set(o) == {"start", "end", "source", "status"} for o in data)

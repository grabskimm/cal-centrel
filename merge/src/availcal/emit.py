"""Emit ICS feeds from ``BusyInterval[]``.

The merged feed is self-describing: each VEVENT's ``SUMMARY`` is the source's
single word (what the owner sees on the calendar) and ``CATEGORIES`` carries the
same label so clients can color/filter by source within the one feed. No title,
description, location or attendee is ever written. The merged UID is a stable
hash of ``(source, start, end)`` so the same time block from two calendars
yields two distinct, separately-tagged events.

Per-source feeds (optional overlay) carry the original event UID for anyone who
prefers separate toggleable calendars; they still never carry event content.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict

import icalendar

from .merge import flatten_across_sources
from .models import BusyInterval

PRODID = "-//availcal//free-busy//EN"


def _vevent(iv: BusyInterval, *, uid: str) -> icalendar.Event:
    ev = icalendar.Event()
    ev.add("UID", uid)
    ev.add("DTSTAMP", iv.start)  # deterministic-ish; UTC aware
    ev.add("DTSTART", iv.start)
    ev.add("DTEND", iv.end)
    # Self-describing: the single word is the only human-visible text.
    ev.add("SUMMARY", iv.source)
    ev.add("CATEGORIES", [iv.source])
    ev.add("TRANSP", "OPAQUE")
    # Map our status onto a hint clients understand, without leaking content.
    if iv.status == "tentative":
        ev.add("STATUS", "TENTATIVE")
        ev.add("X-MICROSOFT-CDO-BUSYSTATUS", "TENTATIVE")
    elif iv.status == "oof":
        ev.add("X-MICROSOFT-CDO-BUSYSTATUS", "OOF")
    else:
        ev.add("X-MICROSOFT-CDO-BUSYSTATUS", "BUSY")
    return ev


def _calendar(name: str) -> icalendar.Calendar:
    cal = icalendar.Calendar()
    cal.add("PRODID", PRODID)
    cal.add("VERSION", "2.0")
    cal.add("CALSCALE", "GREGORIAN")
    cal.add("METHOD", "PUBLISH")
    cal.add("X-WR-CALNAME", name)
    return cal


def emit_merged_ics(intervals: list[BusyInterval], *, name: str = "AvailCal") -> bytes:
    """Build the single merged free/busy feed with stable per-block UIDs."""
    cal = _calendar(name)
    for iv in sorted(intervals, key=lambda i: (i.start, i.source)):
        cal.add_component(_vevent(iv, uid=iv.stable_uid()))
    return cal.to_ical()


def _public_uid(iv: BusyInterval) -> str:
    """UID derived from time ONLY (no source), so the public feed leaks nothing."""
    digest = hashlib.sha1(  # noqa: S324 - not security
        f"{iv.start.isoformat()}|{iv.end.isoformat()}".encode()
    ).hexdigest()
    return f"{digest}@availcal-public"


def emit_public_ics(intervals: list[BusyInterval], *, name: str = "Availability") -> bytes:
    """Build the fully-anonymized PUBLIC free/busy feed.

    Every source boundary is erased: all busy intervals are unioned across
    sources into non-overlapping blocks, each emitted as a bare ``Busy`` event
    with NO source label, NO ``CATEGORIES``, and a time-only UID. The feed
    reveals only when the owner is occupied — not which calendar, nor how many
    calendars exist. Intended to be served WITHOUT a token on a public host.
    """
    cal = _calendar(name)
    for iv in sorted(flatten_across_sources(intervals), key=lambda i: (i.start, i.end)):
        ev = icalendar.Event()
        ev.add("UID", _public_uid(iv))
        ev.add("DTSTAMP", iv.start)
        ev.add("DTSTART", iv.start)
        ev.add("DTEND", iv.end)
        ev.add("SUMMARY", "Busy")  # generic; never a source label
        ev.add("TRANSP", "OPAQUE")
        ev.add("X-MICROSOFT-CDO-BUSYSTATUS", "BUSY")
        cal.add_component(ev)
    return cal.to_ical()


def emit_public_freebusy_json(intervals: list[BusyInterval]) -> bytes:
    """Emit the anonymized public free/busy as JSON for web/scheduling use.

    Same anonymization as the public ICS — sources unioned via
    ``flatten_across_sources`` into non-overlapping busy blocks, no labels — but
    in a shape a webpage can ``fetch()`` directly: a bare array of
    ``{"start","end"}`` UTC-ISO objects. The Worker serves this with CORS and
    derives bookable free slots from it.
    """
    flat = sorted(flatten_across_sources(intervals), key=lambda i: (i.start, i.end))
    data = [
        {
            "start": iv.start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": iv.end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        for iv in flat
    ]
    return json.dumps(data, separators=(",", ":")).encode("utf-8")


def emit_per_source(intervals: list[BusyInterval]) -> dict[str, bytes]:
    """Build one feed per source label, preserving original event UIDs.

    Returns a mapping ``{label: ics_bytes}`` suitable for writing to
    ``/raw/<label>.ics`` for color-coded overlay viewing.
    """
    by_source: dict[str, list[BusyInterval]] = defaultdict(list)
    for iv in intervals:
        by_source[iv.source].append(iv)

    out: dict[str, bytes] = {}
    for label, ivs in by_source.items():
        cal = _calendar(f"AvailCal · {label}")
        for iv in sorted(ivs, key=lambda i: (i.start, i.end)):
            uid = iv.uid or iv.stable_uid()
            cal.add_component(_vevent(iv, uid=uid))
        out[label] = cal.to_ical()
    return out

"""Turn an ``icalendar.Calendar`` into ``BusyInterval[]``.

Recurrence is expanded with the ``recurring-ical-events`` library — we never
hand-roll RRULE/EXDATE logic. Every datetime is forced through ``timeutil`` so
nothing naive survives. Titles, locations and attendees are read only far
enough to decide busy-vs-free, and then discarded; they never reach the model.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta

import icalendar
import recurring_ical_events

from .models import BusyInterval, Status
from .timeutil import all_day_bounds, floating_to_utc, to_utc

# Statuses that mean "not busy" and must be skipped at ingestion.
_FREE_BUSYSTATUS = {"FREE"}
_BUSYSTATUS_TO_STATUS = {
    "BUSY": Status.BUSY,
    "TENTATIVE": Status.TENTATIVE,
    "OOF": Status.OOF,
    "WORKINGELSEWHERE": Status.BUSY,
}


def _component_tzid(comp: icalendar.Event, prop: str) -> str | None:
    """Extract the TZID parameter from a DTSTART/DTEND if present."""
    raw = comp.get(prop)
    if raw is None:
        return None
    params = getattr(raw, "params", {})
    return params.get("TZID")


def _classify_status(comp: icalendar.Event) -> Status | None:
    """Decide the busy-status of an event, or ``None`` if it should be skipped.

    Order of precedence:
      1. ``TRANSP:TRANSPARENT`` -> free -> skip.
      2. Microsoft busy-status hint (``X-MICROSOFT-CDO-BUSYSTATUS``): FREE skips.
      3. ``STATUS:TENTATIVE`` -> tentative.
      4. Default: busy.
    """
    transp = str(comp.get("TRANSP", "")).upper()
    if transp == "TRANSPARENT":
        return None

    cdo = str(comp.get("X-MICROSOFT-CDO-BUSYSTATUS", "")).upper()
    if cdo in _FREE_BUSYSTATUS:
        return None
    if cdo in _BUSYSTATUS_TO_STATUS:
        return _BUSYSTATUS_TO_STATUS[cdo]

    status = str(comp.get("STATUS", "")).upper()
    if status == "TENTATIVE":
        return Status.TENTATIVE

    return Status.BUSY


def _bounds_to_utc(
    comp: icalendar.Event, default_tz: str
) -> tuple[datetime, datetime] | None:
    """Compute the UTC [start, end) for a single expanded VEVENT.

    Handles three regimes:
      * all-day (date-only DTSTART): full-day busy in the component TZID
        (fallback DEFAULT_TZ), then UTC;
      * aware datetimes: convert straight to UTC;
      * floating (naive) datetimes: pin to DEFAULT_TZ, then UTC.
    """
    dtstart = comp.decoded("DTSTART")
    dtend = comp.decoded("DTEND") if comp.get("DTEND") is not None else None

    # All-day: DTSTART is a plain date (not datetime).
    if isinstance(dtstart, date) and not isinstance(dtstart, datetime):
        if isinstance(dtend, date) and not isinstance(dtend, datetime):
            days = max(1, (dtend - dtstart).days)
        else:
            days = 1
        tzid = _component_tzid(comp, "DTSTART")
        return all_day_bounds(dtstart, tzid=tzid, default_tz=default_tz, days=days)

    # Datetime event. Missing DTEND -> treat as a 1h block (defensive default).
    if dtend is None or not isinstance(dtend, datetime):
        dtend = dtstart + timedelta(hours=1)

    def conv(dt: datetime) -> datetime:
        return to_utc(dt) if dt.tzinfo is not None else floating_to_utc(dt, default_tz)

    start = conv(dtstart)
    end = conv(dtend)
    if end <= start:
        return None
    return start, end


def normalize_calendar(
    cal: icalendar.Calendar,
    *,
    source: str,
    window_start: datetime,
    window_end: datetime,
    default_tz: str,
    include_tentative: bool = True,
) -> list[BusyInterval]:
    """Expand recurrence over [window_start, window_end] and emit intervals.

    Args:
        cal: parsed calendar.
        source: the single-word source label to stamp on every interval.
        window_start/window_end: aware datetimes bounding expansion.
        default_tz: timezone for all-day/floating values lacking a TZID.
        include_tentative: keep (True) or drop (False) tentative events.
    """
    out: list[BusyInterval] = []
    events: Iterable = recurring_ical_events.of(cal).between(window_start, window_end)
    for comp in events:
        status = _classify_status(comp)
        if status is None:
            continue
        if status is Status.TENTATIVE and not include_tentative:
            continue
        bounds = _bounds_to_utc(comp, default_tz)
        if bounds is None:
            continue
        start, end = bounds
        uid = comp.get("UID")
        out.append(
            BusyInterval(
                start=start,
                end=end,
                source=source,
                status=status.value,
                uid=str(uid) if uid is not None else None,
            )
        )
    return out

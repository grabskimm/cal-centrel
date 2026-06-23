"""Time correctness — the single chokepoint for datetime handling.

Every datetime entering the pipeline passes through here. The rule is absolute:
no naive datetimes anywhere downstream. ``ensure_aware`` raises on naive input;
``to_utc`` normalizes to timezone-aware UTC. All-day (date-only) values are
expanded into a full day in a concrete timezone, then converted to UTC.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def ensure_aware(dt: datetime) -> datetime:
    """Return *dt* unchanged if timezone-aware; raise if naive.

    A naive datetime is the silent-corruption bug this whole project guards
    against, so we refuse it loudly rather than guessing a zone.
    """
    if not isinstance(dt, datetime):
        raise TypeError(f"expected datetime, got {type(dt).__name__}")
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError(
            f"naive datetime not allowed: {dt!r}. Attach a timezone at the "
            f"source (use DEFAULT_TZ for floating times)."
        )
    return dt


def to_utc(dt: datetime) -> datetime:
    """Convert an aware datetime to UTC. Raises on naive input."""
    return ensure_aware(dt).astimezone(UTC)


def resolve_tz(tzid: str | None, default_tz: str) -> ZoneInfo:
    """Resolve a TZID string to a ZoneInfo, falling back to *default_tz*."""
    if tzid:
        try:
            return ZoneInfo(tzid)
        except Exception:  # noqa: BLE001 — unknown/abbrev TZID, fall back
            pass
    return ZoneInfo(default_tz)


def floating_to_utc(dt: datetime, default_tz: str) -> datetime:
    """Interpret a naive ('floating') datetime in *default_tz*, then UTC.

    Floating times legitimately occur in ICS (no TZID, no Z). We pin them to a
    configurable default zone rather than rejecting, but only via this explicit
    entry point — never implicitly.
    """
    if dt.tzinfo is not None:
        return to_utc(dt)
    aware = dt.replace(tzinfo=ZoneInfo(default_tz))
    return to_utc(aware)


def all_day_bounds(
    d: date,
    *,
    tzid: str | None,
    default_tz: str,
    days: int = 1,
) -> tuple[datetime, datetime]:
    """Expand a date-only value into a full-day [start, end) UTC interval.

    The day is taken in the component's TZID (or *default_tz* if absent), then
    converted to UTC. ``days`` lets a multi-day all-day event span correctly.
    """
    if isinstance(d, datetime):
        # An all-day DTSTART is a plain date; tolerate a datetime by taking .date()
        d = d.date()
    tz = resolve_tz(tzid, default_tz)
    start_local = datetime.combine(d, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=days)
    return to_utc(start_local), to_utc(end_local)


def now_utc() -> datetime:
    """Current time as aware UTC."""
    return datetime.now(tz=UTC)

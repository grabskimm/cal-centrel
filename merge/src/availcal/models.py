"""Core data model: the only thing that flows through the pipeline.

A ``BusyInterval`` is deliberately tiny — it carries time, status and a single
owner-assigned one-word source label, and nothing else. That is the whole
privacy guarantee: there is no field in which a title, location or attendee
could survive.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

# A source label is a single token: letters, digits, underscore. No spaces.
# This is validated at construction and again when the source registry loads.
SOURCE_LABEL_RE = re.compile(r"^\w+$")


class Status(StrEnum):
    """Busy-status values we keep. ``free`` is never represented — it is
    dropped at the source/agent, so the model cannot carry it."""

    BUSY = "busy"
    TENTATIVE = "tentative"
    OOF = "oof"  # out-of-office

    @classmethod
    def coerce(cls, value: str) -> Status:
        v = (value or "").strip().lower()
        try:
            return cls(v)
        except ValueError as exc:
            raise ValueError(
                f"unknown status {value!r}; expected one of "
                f"{[s.value for s in cls]}"
            ) from exc


@dataclass(frozen=True)
class BusyInterval:
    """A single busy block.

    Attributes:
        start: timezone-aware UTC datetime (validated).
        end: timezone-aware UTC datetime (validated, > start).
        source: single-word source-calendar label, ``^\\w+$``.
        status: one of ``busy`` | ``tentative`` | ``oof``.
        uid: original event UID, kept internally for dedup only. It is
            preserved in per-source feeds but never written to the merged feed.
    """

    start: datetime
    end: datetime
    source: str
    status: str = Status.BUSY.value
    uid: str | None = None

    def __post_init__(self) -> None:
        # Validate aware-UTC without importing timeutil (avoid a cycle); the
        # pipeline funnels everything through timeutil.to_utc() before here.
        for name, dt in (("start", self.start), ("end", self.end)):
            if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
                raise ValueError(f"{name} must be timezone-aware: {dt!r}")
            if dt.utcoffset().total_seconds() != 0:
                raise ValueError(f"{name} must be UTC, got offset {dt.utcoffset()}")
        if self.end <= self.start:
            raise ValueError(f"end {self.end!r} must be after start {self.start!r}")
        if not SOURCE_LABEL_RE.match(self.source or ""):
            raise ValueError(
                f"source label {self.source!r} must match ^\\w+$ (one token, no spaces)"
            )
        # Normalize status via the enum (raises on unknown).
        object.__setattr__(self, "status", Status.coerce(self.status).value)

    @property
    def is_busy_like(self) -> bool:
        """All retained statuses count as occupied time."""
        return True

    def stable_uid(self) -> str:
        """Deterministic UID for the MERGED feed: hash of (source, start, end).

        The same time block from two different calendars therefore yields two
        distinct UIDs — two separately-tagged events — preserving attribution.
        """
        key = f"{self.source}|{self.start.isoformat()}|{self.end.isoformat()}"
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()  # noqa: S324 (not security)
        return f"{digest}@availcal"

"""AvailCal — private free/busy calendar aggregation.

Privacy by construction: only busy intervals (start/end/status) and a single
owner-assigned one-word source label ever enter the pipeline. No titles,
descriptions, attendees or locations are read past the source.
"""

__version__ = "0.1.0"

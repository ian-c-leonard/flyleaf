"""One clock for every build step.

Set SOURCE_DATE_EPOCH (seconds since 1970, the reproducible-builds convention)
to rebuild an edition exactly: the same edition date, the same PDF timestamp
and the same bytes. Unset, the build uses the current time.
"""
import os
from datetime import date, datetime, timezone


def epoch():
    """The pinned build time in seconds, or None when the build is not pinned."""
    value = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
    return int(value) if value else None


def today():
    """The edition date: the local calendar date of the build."""
    pinned = epoch()
    return datetime.fromtimestamp(pinned).date() if pinned is not None else date.today()


def now_utc():
    """The build time, in UTC."""
    pinned = epoch()
    if pinned is not None:
        return datetime.fromtimestamp(pinned, timezone.utc)
    return datetime.now(timezone.utc)

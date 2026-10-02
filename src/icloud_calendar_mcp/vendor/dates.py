from datetime import datetime, timezone


def to_utc_stamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("The date-time must include a UTC offset.")
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

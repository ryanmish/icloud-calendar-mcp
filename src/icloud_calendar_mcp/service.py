"""Calendar operations with policy checks before each account request."""

import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from icalendar import Calendar as ICalendar
from icalendar import Event

from .config import Settings

logger = logging.getLogger(__name__)
UNSUPPORTED_WRITE_FIELDS = {
    "ATTENDEE", "ORGANIZER", "RRULE", "RDATE", "EXDATE", "RECURRENCE-ID",
}


class PolicyError(ValueError):
    pass


def event_time(value: str, all_day: bool = False):
    if all_day:
        return date.fromisoformat(value)
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise PolicyError("A timed event must include a UTC offset.")
    return moment.astimezone(timezone.utc)


def validate_times(start, end):
    if type(start) is not type(end) or end <= start:
        raise PolicyError("The end must be later than the start and use the same date type.")
    if end - start > timedelta(days=31):
        raise PolicyError("An event cannot exceed 31 days.")


def resource_name(value: str):
    if (not value or len(value) > 255 or "/" in value or "\\" in value
            or any(ord(char) < 32 for char in value) or value in {".", ".."}):
        raise PolicyError("The event ID is invalid.")
    return value


def text(value: str, maximum: int):
    if len(value) > maximum or any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise PolicyError("An event text field is too long or contains a control character.")
    return value


def parse_calendar(body: str):
    try:
        calendar = ICalendar.from_ical(body)
        events = calendar.walk("VEVENT")
        if not events or any("DTSTART" not in event for event in events):
            raise ValueError
        return calendar, events
    except Exception:
        raise PolicyError("The event data could not be read.") from None


def event_dict(event, item):
    def stamp(field):
        prop = event.get(field)
        return prop.dt.isoformat() if prop is not None else None

    return {
        "calendar_id": item.calendar_id,
        "event_id": item.name,
        "etag": item.etag,
        "uid": str(event.get("UID", "")),
        "title": str(event.get("SUMMARY", ""))[:500],
        "start": stamp("DTSTART"),
        "end": stamp("DTEND"),
        "all_day": type(event["DTSTART"].dt) is date,
        "recurrence_id": stamp("RECURRENCE-ID"),
        "recurring": any(field in event for field in ("RRULE", "RDATE", "RECURRENCE-ID")),
        "location": str(event.get("LOCATION", ""))[:1000],
        "description": str(event.get("DESCRIPTION", ""))[:4000],
        "status": str(event.get("STATUS", "")),
        "busy": str(event.get("TRANSP", "OPAQUE")) != "TRANSPARENT",
    }


class CalendarService:
    def __init__(self, settings: Settings, client):
        self.settings = settings
        self.client = client

    def check_calendar(self, calendar_id: str, operation: str = "read"):
        if not calendar_id or (
            "*" not in self.settings.read_calendars
            and calendar_id not in self.settings.read_calendars
        ):
            raise PolicyError("This calendar is not permitted.")
        if operation != "read" and (
            operation not in self.settings.write_operations
            or calendar_id not in self.settings.write_calendars
        ):
            raise PolicyError("This calendar operation is not permitted.")

    async def list_calendars(self):
        return [
            {"id": cal.id, "name": cal.name, "color": cal.color,
             "write_operations": sorted(self.settings.write_operations)
             if cal.id in self.settings.write_calendars and not cal.read_only else []}
            for cal in await self.client.calendars()
            if "*" in self.settings.read_calendars or cal.id in self.settings.read_calendars
        ]

    async def search_events(self, calendar_id, start, end, query="", limit=50):
        self.check_calendar(calendar_id)
        start_time, end_time = event_time(start), event_time(end)
        if not 0 < (end_time - start_time).total_seconds() <= 93 * 86400:
            raise PolicyError("The search window must be greater than zero and at most 93 days.")
        if type(limit) is not int or not 1 <= limit <= 100:
            raise PolicyError("The result limit must be between 1 and 100.")
        text(query, 200)
        cal = await self.client.calendar(calendar_id)
        results = []
        malformed = 0
        truncated = False
        for item in await self.client.query(cal, start=start_time, end=end_time, expand=True):
            try:
                _, events = parse_calendar(item.ics)
                for event in events:
                    data = event_dict(event, item)
                    if query and query.casefold() not in " ".join(
                        data[key] for key in ("title", "location", "description")
                    ).casefold():
                        continue
                    if len(results) >= limit:
                        truncated = True
                        break
                    results.append(data)
            except (PolicyError, ValueError, AttributeError, TypeError):
                malformed += 1
        return {"events": results, "truncated": truncated, "skipped_resources": malformed}

    async def get_event(self, calendar_id, event_id):
        self.check_calendar(calendar_id)
        resource_name(event_id)
        cal = await self.client.calendar(calendar_id)
        item = await self.client.get(cal, event_id)
        _, events = parse_calendar(item.ics)
        return {"events": [event_dict(event, item) for event in events], "etag": item.etag}

    async def writable_calendar(self, calendar_id, operation):
        self.check_calendar(calendar_id, operation)
        cal = await self.client.calendar(calendar_id)
        if cal.read_only:
            raise PolicyError("iCloud marks this calendar as read-only.")
        return cal

    async def create_event(self, calendar_id, request_id, title, start, end,
                           all_day=False, description="", location=""):
        self.check_calendar(calendar_id, "create")
        # Reuse the same request ID when retrying. Conditional creation cannot
        # overwrite an existing event or create a second event with this ID.
        uid = str(UUID(request_id))
        title = text(title.strip(), 500)
        if not title:
            raise PolicyError("The event title is required.")
        start_time, end_time = event_time(start, all_day), event_time(end, all_day)
        validate_times(start_time, end_time)
        calendar = ICalendar()
        calendar.add("VERSION", "2.0")
        calendar.add("PRODID", "-//icloud-calendar-mcp//EN")
        event = Event()
        for key, value in {
            "UID": uid, "DTSTAMP": datetime.now(timezone.utc), "SUMMARY": title,
            "DTSTART": start_time, "DTEND": end_time,
            "DESCRIPTION": text(description, 4000), "LOCATION": text(location, 1000),
        }.items():
            event.add(key, value)
        calendar.add_component(event)
        cal = await self.writable_calendar(calendar_id, "create")
        name = f"{uid}.ics"
        etag = await self.client.put(cal, name, calendar.to_ical().decode(), create=True)
        logger.info("calendar_write operation=create status=success")
        return {"event_id": name, "calendar_id": calendar_id, "etag": etag}

    async def update_event(self, calendar_id, event_id, expected_etag,
                           title=None, start=None, end=None, description=None, location=None):
        self.check_calendar(calendar_id, "update")
        resource_name(event_id)
        if not expected_etag or len(expected_etag) > 256 or "\r" in expected_etag or "\n" in expected_etag:
            raise PolicyError("A valid ETag from get_event is required.")
        if all(value is None for value in (title, start, end, description, location)):
            raise PolicyError("At least one changed field is required.")
        if (start is None) != (end is None):
            raise PolicyError("Supply both start and end when changing the event time.")
        cal = await self.writable_calendar(calendar_id, "update")
        item = await self.client.get(cal, event_id)
        if not item.etag or item.etag != expected_etag:
            raise PolicyError("The event changed. Read it before retrying.")
        calendar, events = parse_calendar(item.ics)
        if (len(events) != 1 or "METHOD" in calendar
                or any(field in events[0] for field in UNSUPPORTED_WRITE_FIELDS)):
            raise PolicyError("Invitations and recurring events cannot be changed in this version.")
        event = events[0]
        if title is not None and not title.strip():
            raise PolicyError("The event title cannot be empty.")
        for key, value, maximum in (
            ("SUMMARY", title, 500), ("DESCRIPTION", description, 4000),
            ("LOCATION", location, 1000),
        ):
            if value is not None:
                event.pop(key, None)
                event.add(key, text(value, maximum))
        if start is not None:
            all_day = type(event["DTSTART"].dt) is date
            start_time, end_time = event_time(start, all_day), event_time(end, all_day)
            validate_times(start_time, end_time)
            for key in ("DTSTART", "DTEND", "DURATION"):
                event.pop(key, None)
            event.add("DTSTART", start_time)
            event.add("DTEND", end_time)
        event.pop("DTSTAMP", None)
        event.add("DTSTAMP", datetime.now(timezone.utc))
        event.pop("LAST-MODIFIED", None)
        event.add("LAST-MODIFIED", datetime.now(timezone.utc))
        sequence = int(event.pop("SEQUENCE", 0)) + 1
        event.add("SEQUENCE", sequence)
        etag = await self.client.put(
            cal, event_id, calendar.to_ical().decode(), etag=expected_etag
        )
        logger.info("calendar_write operation=update status=success")
        return {"event_id": event_id, "calendar_id": calendar_id, "etag": etag}

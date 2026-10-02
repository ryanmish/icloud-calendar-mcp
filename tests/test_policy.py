from dataclasses import replace
from datetime import datetime, timezone

import pytest
from icalendar import Calendar as ICalendar

from icloud_calendar_mcp.service import CalendarService, PolicyError

from conftest import BODY, with_field

pytestmark = pytest.mark.asyncio

CREATE = dict(calendar_id="home", request_id="6cf2275c-4f90-4d71-9942-6b4f7a73ec18",
              title="Appointment", start="2026-10-03T10:00:00-04:00",
              end="2026-10-03T11:00:00-04:00")
UPDATE = dict(calendar_id="home", event_id="event.ics", expected_etag='"version-1"',
              title="Updated appointment")


async def test_wrong_calendar_is_denied_before_io(service, client):
    with pytest.raises(PolicyError):
        await service.get_event("private", "event.ics")
    client.calendar.assert_not_called()


async def test_read_calendar_cannot_be_written(service, client):
    with pytest.raises(PolicyError):
        await service.create_event(**(CREATE | {"calendar_id": "work"}))
    client.calendar.assert_not_called()
    client.put.assert_not_called()


async def test_disabled_operation_is_denied(settings, client):
    service = CalendarService(replace(settings, write_operations=frozenset({"create"})), client)
    with pytest.raises(PolicyError):
        await service.update_event(**UPDATE)
    client.calendar.assert_not_called()


async def test_create_has_conditional_write_and_utc_time(service, client):
    result = await service.create_event(**CREATE)
    args, kwargs = client.put.call_args
    event = ICalendar.from_ical(args[2]).walk("VEVENT")[0]
    assert kwargs == {"create": True}
    assert event["DTSTART"].dt == datetime(2026, 10, 3, 14, tzinfo=timezone.utc)
    assert not any(key in event for key in ("ATTENDEE", "ORGANIZER", "RRULE"))
    assert result["event_id"] == CREATE["request_id"] + ".ics"


async def test_all_day_has_exclusive_date_end(service, client):
    await service.create_event(**(CREATE | {
        "start": "2026-10-03", "end": "2026-10-04", "all_day": True,
    }))
    event = ICalendar.from_ical(client.put.call_args.args[2]).walk("VEVENT")[0]
    assert event["DTSTART"].params["VALUE"] == "DATE"
    assert str(event["DTEND"].dt) == "2026-10-04"


@pytest.mark.parametrize("changes", [
    {"start": "2026-10-03T10:00:00"}, {"end": "2026-10-03T09:00:00-04:00"},
    {"title": " "}, {"title": "x" * 501}, {"request_id": "bad-id"},
])
async def test_bad_create_cannot_write(service, client, changes):
    with pytest.raises(ValueError):
        await service.create_event(**(CREATE | changes))
    client.put.assert_not_called()


async def test_update_preserves_unknown_fields_and_uses_etag(service, client):
    await service.update_event(**UPDATE)
    event = ICalendar.from_ical(client.put.call_args.args[2]).walk("VEVENT")[0]
    assert event["X-PRESERVE"] == "keep this field"
    assert event["SUMMARY"] == UPDATE["title"]
    assert client.put.call_args.kwargs == {"etag": '"version-1"'}


@pytest.mark.parametrize("etag", ["", '"stale"', "bad\r\netag"])
async def test_stale_or_invalid_etag_cannot_write(service, client, etag):
    with pytest.raises(PolicyError):
        await service.update_event(**(UPDATE | {"expected_etag": etag}))
    client.put.assert_not_called()


@pytest.mark.parametrize("field,value", [
    ("ATTENDEE", "mailto:guest@example.invalid"),
    ("ORGANIZER", "mailto:owner@example.invalid"),
    ("RRULE", {"FREQ": "DAILY"}),
    ("RECURRENCE-ID", datetime(2026, 10, 3, 14, tzinfo=timezone.utc)),
])
async def test_scheduling_and_recurring_event_updates_denied(service, client, field, value):
    client.get.return_value = replace(client.get.return_value, ics=with_field(BODY, field, value))
    with pytest.raises(PolicyError):
        await service.update_event(**UPDATE)
    client.put.assert_not_called()


async def test_server_conflict_does_not_report_success(service, client):
    from icloud_calendar_mcp.vendor.dav import Conflict
    client.put.side_effect = Conflict("The resource changed.")
    with pytest.raises(Conflict):
        await service.update_event(**UPDATE)


async def test_time_change_requires_both_fields(service, client):
    with pytest.raises(PolicyError):
        await service.update_event(**(UPDATE | {"start": CREATE["start"]}))
    client.get.assert_not_called()


async def test_read_only_calendar_denied(service, client):
    client.calendar.return_value = replace(client.calendar.return_value, read_only=True)
    with pytest.raises(PolicyError):
        await service.create_event(**CREATE)
    client.put.assert_not_called()


@pytest.mark.parametrize("event_id", ["../private.ics", "x/y", "x\\y", "\n", ""])
async def test_path_inputs_denied(service, client, event_id):
    with pytest.raises(PolicyError):
        await service.get_event("home", event_id)
    client.get.assert_not_called()


async def test_search_window_bounded_before_io(service, client):
    with pytest.raises(PolicyError):
        await service.search_events("home", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")
    client.query.assert_not_called()


async def test_search_flags_truncation(service, client):
    client.query.return_value *= 3
    result = await service.search_events("home", CREATE["start"], CREATE["end"], limit=1)
    assert len(result["events"]) == 1
    assert result["truncated"] is True


async def test_search_does_not_hide_bad_resources(service, client):
    client.query.return_value = [replace(client.get.return_value, ics="invalid")]
    result = await service.search_events("home", CREATE["start"], CREATE["end"])
    assert result["skipped_resources"] == 1

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from icalendar import Calendar as ICalendar

from icloud_calendar_mcp.auth import OwnerJWTVerifier
from icloud_calendar_mcp.config import Settings
from icloud_calendar_mcp.service import CalendarService
from icloud_calendar_mcp.vendor.caldav import Calendar, Resource

BODY = """BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Tests//EN\r
BEGIN:VEVENT\r
UID:test-event\r
DTSTAMP:20261002T120000Z\r
DTSTART:20261003T140000Z\r
DTEND:20261003T150000Z\r
SUMMARY:Test appointment\r
X-PRESERVE:keep this field\r
END:VEVENT\r
END:VCALENDAR\r
"""


@pytest.fixture
def settings():
    return Settings(
        public_url="https://calendar.example.com", issuer="https://auth.example.com/",
        jwks_url="https://auth.example.com/jwks", owner_subject="owner-123",
        apple_id="owner@example.invalid", password_file=Path("/unused"),
        read_calendars=frozenset({"home", "work"}),
        write_calendars=frozenset({"home"}), write_operations=frozenset({"create", "update"}),
    )


@pytest.fixture
def client():
    fake = AsyncMock()
    cal = Calendar("home", "Home", "", "https://caldav.icloud.com/1/home/", ("VEVENT",), False)
    fake.calendar.return_value = cal
    fake.calendars.return_value = [cal]
    item = Resource("home", "event.ics", cal.url + "event.ics", '"version-1"', BODY)
    fake.get.return_value = item
    fake.query.return_value = [item]
    fake.put.return_value = '"version-2"'
    return fake


@pytest.fixture
def service(settings, client):
    return CalendarService(settings, client)


def with_field(body, field, value):
    calendar = ICalendar.from_ical(body)
    calendar.walk("VEVENT")[0].add(field, value)
    return calendar.to_ical().decode()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def verifier(signing_key, settings):
    public = signing_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return OwnerJWTVerifier(
        owner_subject=settings.owner_subject, public_key=public, algorithm="RS256",
        issuer=settings.issuer, audience=settings.public_url + "/mcp",
        required_scopes=["calendar:read"],
    )

from dataclasses import replace

import pytest


@pytest.mark.parametrize("change", [
    {"public_url": "http://calendar.example.com"},
    {"public_url": "https://calendar.example.com/mcp"},
    {"owner_subject": ""}, {"write_calendars": frozenset({"*"})},
    {"write_calendars": frozenset({"private"})},
    {"write_operations": frozenset({"delete"})}, {"write_calendars": frozenset()},
])
def test_invalid_settings_denied(settings, change):
    with pytest.raises(ValueError):
        replace(settings, **change)


def test_password_file_permissions(settings, tmp_path):
    path = tmp_path / "secret"
    path.write_text("aaaa-bbbb-cccc-dddd\n")
    configured = replace(settings, password_file=path)
    path.chmod(0o644)
    with pytest.raises(ValueError):
        configured.read_password()
    path.chmod(0o600)
    assert configured.read_password() == "aaaa-bbbb-cccc-dddd"


def test_primary_password_format_denied(settings, tmp_path):
    path = tmp_path / "secret"
    path.write_text("not-an-app-password")
    path.chmod(0o600)
    with pytest.raises(ValueError):
        replace(settings, password_file=path).read_password()

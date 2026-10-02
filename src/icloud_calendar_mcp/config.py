"""Validate configuration before the service can start."""

import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl


def https_url(value: str, name: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment):
        raise ValueError(f"{name} must be an HTTPS URL without user information or query data.")
    return value


def calendar_ids(value: str, name: str, *, allow_empty: bool = False) -> frozenset[str]:
    parsed = json.loads(value)
    if (not isinstance(parsed, list) or (not parsed and not allow_empty)
            or any(not isinstance(item, str) or not item.strip() for item in parsed)):
        raise ValueError(f"{name} must be a non-empty JSON array of calendar IDs.")
    return frozenset(parsed)


@dataclass(frozen=True)
class Settings:
    public_url: str
    issuer: str
    jwks_url: str
    owner_subject: str
    apple_id: str
    password_file: Path
    read_calendars: frozenset[str]
    write_calendars: frozenset[str]
    write_operations: frozenset[str]

    def __post_init__(self):
        for name in ("public_url", "issuer", "jwks_url"):
            https_url(getattr(self, name), name)
        if str(AnyHttpUrl(self.issuer)) != self.issuer:
            raise ValueError("The OAuth issuer must be an exact canonical URL, including its trailing slash.")
        if urlsplit(self.public_url).path not in ("", "/"):
            raise ValueError("MCP_PUBLIC_URL must be an origin without a path.")
        if not self.owner_subject.strip() or not self.apple_id.strip():
            raise ValueError("The owner subject and Apple account name are required.")
        if not self.read_calendars:
            raise ValueError("At least one readable calendar ID is required.")
        if "*" in self.write_calendars:
            raise ValueError("Writable calendars must use exact IDs.")
        if "*" not in self.read_calendars and not self.write_calendars <= self.read_calendars:
            raise ValueError("Each writable calendar must also be readable.")
        if not self.write_operations <= {"create", "update"}:
            raise ValueError("Only create and update operations are supported.")
        if self.write_operations and not self.write_calendars:
            raise ValueError("Write operations require at least one writable calendar ID.")

    @classmethod
    def from_env(cls):
        def required(name):
            value = os.environ.get(name, "").strip()
            if not value:
                raise ValueError(f"{name} is required.")
            return value

        return cls(
            public_url=https_url(required("MCP_PUBLIC_URL"), "MCP_PUBLIC_URL").rstrip("/"),
            issuer=https_url(required("MCP_OAUTH_ISSUER"), "MCP_OAUTH_ISSUER"),
            jwks_url=https_url(required("MCP_OAUTH_JWKS_URL"), "MCP_OAUTH_JWKS_URL"),
            owner_subject=required("MCP_OWNER_SUBJECT"),
            apple_id=required("ICLOUD_USERNAME"),
            password_file=Path(required("ICLOUD_PASSWORD_FILE")),
            read_calendars=calendar_ids(required("MCP_READ_CALENDARS"), "MCP_READ_CALENDARS"),
            write_calendars=calendar_ids(os.environ.get("MCP_WRITE_CALENDARS", "[]"),
                                        "MCP_WRITE_CALENDARS", allow_empty=True),
            write_operations=calendar_ids(os.environ.get("MCP_WRITE_OPERATIONS", "[]"),
                                         "MCP_WRITE_OPERATIONS", allow_empty=True),
        )

    def read_password(self) -> str:
        with self.password_file.open() as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise ValueError("The password file must be a regular file with mode 0400 or 0600.")
            value = stream.read(128).strip()
        if not re.fullmatch(r"[a-z]{4}(?:-[a-z]{4}){3}", value):
            raise ValueError("The password file must contain an Apple app-specific password.")
        return value

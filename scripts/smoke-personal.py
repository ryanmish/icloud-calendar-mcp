#!/usr/bin/env python3
"""Run both production entry points on loopback, with temporary service files.

This checks startup and public/private routing, not Apple or ChatGPT access.
It creates no owner, OAuth client, calendar credential, or client grant.
Do not enter credentials through the temporary HTTP listeners.
"""

import http.client
import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "https://cal.ryanmish.com"


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(number, path, method="GET", body=None):
    connection = http.client.HTTPConnection("127.0.0.1", number, timeout=3)
    try:
        connection.request(method, path, body=body, headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        })
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def check(condition, label):
    if not condition:
        raise RuntimeError(label + " failed.")
    print("PASS: " + label)


def wait_ready(number, processes):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("A temporary service stopped during startup.")
        try:
            if request(number, "/health")[0] == 200:
                return
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(0.1)
    raise RuntimeError("A temporary service did not become ready.")


def main():
    node = shutil.which("node")
    python = ROOT / ".venv/bin/python"
    if not node or not python.exists() or not (ROOT / "web/dist/main.js").exists():
        raise RuntimeError("Install development dependencies and build web first. See the guide.")
    ports = set()
    while len(ports) < 3:
        ports.add(port())
    public, private, calendar = sorted(ports)
    processes = []
    with tempfile.TemporaryDirectory(prefix="calendar-smoke-") as temporary:
        directory = Path(temporary)
        directory.chmod(0o700)
        env = dict(os.environ)
        env.update({
            "MCP_PUBLIC_URL": ORIGIN,
            "MCP_LOGIN_METHOD": "password",
            "MCP_OAUTH_ISSUER": ORIGIN + "/api/auth",
            "MCP_OAUTH_JWKS_URL": ORIGIN + "/api/auth/jwks",
            "MCP_READ_CALENDARS": '["*"]',
            "MCP_WRITE_CALENDARS": "[]",
            "MCP_WRITE_OPERATIONS": "[]",
            "ICLOUD_USERNAME": "",
            "CALENDAR_DATABASE": str(directory / "calendar.sqlite"),
            "CALENDAR_BACKEND_URL": f"http://127.0.0.1:{calendar}",
            "MCP_SETUP_URL": f"http://127.0.0.1:{private}",
            "WEB_PORT": str(public),
            "SETUP_PORT": str(private),
            "MCP_PORT": str(calendar),
            "WEB_BIND_HOST": "127.0.0.1",
            "SETUP_BIND_HOST": "127.0.0.1",
            "MCP_BIND_HOST": "127.0.0.1",
            "NODE_ENV": "test",
        })
        for name, variable in {
            "auth": "BETTER_AUTH_SECRET_FILE",
            "encryption": "CALENDAR_ENCRYPTION_KEY_FILE",
            "internal": "MCP_SETUP_SECRET_FILE",
            "enrollment": "OWNER_ENROLLMENT_CODE_FILE",
        }.items():
            path = directory / name
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                stream.write(secrets.token_hex(32) + "\n")
            env[variable] = str(path)
        # Captured output remains private and is removed, including on failure.
        with (directory / "runtime.log").open("w+") as log:
            try:
                migration = subprocess.run(
                    [node, "dist/migrate.js"], cwd=ROOT / "web", env=env,
                    stdout=log, stderr=log, timeout=30, check=False,
                )
                check(migration.returncode == 0, "production database migration")
                for command, cwd in [
                    ([str(python), "-c",
                      "from icloud_calendar_mcp.server import main; main()"], ROOT),
                    ([node, "dist/main.js"], ROOT / "web"),
                ]:
                    processes.append(subprocess.Popen(
                        command, cwd=cwd, env=env, stdout=log, stderr=log,
                    ))
                wait_ready(calendar, processes)
                wait_ready(public, processes)
                check(request(private, "/internal/access", "POST", "{}")[0] == 404,
                      "private access rejects a request without authentication")
                status, _, body = request(public, "/sign-in")
                check(status == 200 and b"Service password" in body
                      and b"Create account and continue" in body,
                      "first-owner password setup page")
                for path in ["/internal/access", "/internal/discover", "/internal/repair"]:
                    check(request(public, path, "POST", "{}")[0] == 404,
                          "public listener blocks " + path)
                check(request(public, "/api/auth/oauth2/register", "POST", "{}")[0]
                      in {400, 404}, "public listener refuses client registration")
                status, headers, _ = request(public, "/mcp", "POST", json.dumps({
                    "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {},
                }))
                check(status == 401 and "resource_metadata" in headers.get(
                    "www-authenticate", ""), "MCP proxy requires OAuth")
                status, _, body = request(public, "/.well-known/oauth-protected-resource/mcp")
                metadata = json.loads(body)
                check(status == 200 and metadata["resource"] == ORIGIN + "/mcp"
                      and metadata["authorization_servers"] == [ORIGIN + "/api/auth"],
                      "MCP resource discovery through web proxy")
                status, _, body = request(
                    public, "/.well-known/oauth-authorization-server/api/auth")
                metadata = json.loads(body)
                check(status == 200 and metadata["issuer"] == ORIGIN + "/api/auth"
                      and "S256" in metadata["code_challenge_methods_supported"]
                      and metadata["client_id_metadata_document_supported"] is True,
                      "OAuth issuer, PKCE, and client metadata discovery")
                status, _, body = request(public, "/api/auth/jwks")
                check(status == 200 and isinstance(json.loads(body)["keys"], list),
                      "public verification key route")
                with sqlite3.connect(env["CALENDAR_DATABASE"]) as db:
                    check(db.execute("SELECT count(*) FROM user").fetchone()[0] == 0
                          and db.execute("SELECT count(*) FROM personal_connection")
                          .fetchone()[0] == 0
                          and db.execute("SELECT count(*) FROM personal_grant")
                          .fetchone()[0] == 0, "no owner, iCloud credential, or client grant")
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.terminate()
                for process in processes:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
    print("Local startup check passed. Temporary services and files were removed.")
    print("Apple, public HTTPS, and ChatGPT access remain untested.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f"Local startup check failed: {error}", file=sys.stderr)
        sys.exit(1)

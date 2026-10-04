#!/usr/bin/env python3
"""Host-only password recovery. Never put the password in command arguments."""
import getpass
import subprocess
import sys


def main():
    if not sys.stdin.isatty():
        raise SystemExit("Use an interactive terminal with hidden password input.")
    password = getpass.getpass("New service password (12 to 128 characters): ")
    if not 12 <= len(password) <= 128 or "\n" in password:
        raise SystemExit("Use 12 to 128 characters on one line.")
    if password != getpass.getpass("Confirm service password: "):
        raise SystemExit("The passwords do not match. No change was made.")
    subprocess.run(
        ["docker", "compose", "--env-file", ".env.personal", "-f",
         "compose.personal.yaml", "exec", "-T", "web", "node", "dist/reset-password.js"],
        input=password + "\n", text=True, check=True,
    )


if __name__ == "__main__":
    main()

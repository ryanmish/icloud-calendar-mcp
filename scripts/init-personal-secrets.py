#!/usr/bin/env python3
"""Operator-only setup. Create service keys without displaying their values."""
import os
import secrets
from pathlib import Path


def main():
    directory = Path("secrets")
    names = ("auth", "encryption", "internal", "enrollment")
    if any((directory / name).exists() for name in names):
        raise SystemExit("A service key already exists. No files were changed.")
    os.umask(0o077)
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    for name in names:
        with (directory / name).open("x") as stream:
            stream.write(secrets.token_hex(32) + "\n")
        (directory / name).chmod(0o600)
    Path("data").mkdir(mode=0o700, exist_ok=True)
    print("Service keys created. No Apple credential or account was created.")
    print("See docs/personal-setup.md for protected file ownership and Apple setup.")


if __name__ == "__main__":
    main()

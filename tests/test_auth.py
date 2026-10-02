import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

pytestmark = pytest.mark.asyncio


def token(key, settings, **changes):
    claims = {"iss": settings.issuer, "aud": settings.public_url + "/mcp",
              "sub": settings.owner_subject, "exp": int(time.time()) + 300,
              "scope": "calendar:read calendar:write"}
    claims.update(changes)
    return jwt.encode(claims, key, algorithm="RS256")


async def test_valid_owner_token(verifier, signing_key, settings):
    assert await verifier.verify_token(token(signing_key, settings)) is not None


@pytest.mark.parametrize("change", [
    {"sub": "another-user"}, {"iss": "https://untrusted.example.com"},
    {"aud": "https://other-service.example.com"}, {"exp": 1}, {"exp": None},
    {"scope": "calendar:write"}, {"nbf": int(time.time()) + 300},
])
async def test_rejected_token(verifier, signing_key, settings, change):
    assert await verifier.verify_token(token(signing_key, settings, **change)) is None


async def test_missing_expiry(verifier, signing_key, settings):
    encoded = jwt.encode({"iss": settings.issuer, "aud": settings.public_url + "/mcp",
                          "sub": settings.owner_subject, "scope": "calendar:read"},
                         signing_key, algorithm="RS256")
    assert await verifier.verify_token(encoded) is None


async def test_bad_signature(verifier, settings):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert await verifier.verify_token(token(other, settings)) is None

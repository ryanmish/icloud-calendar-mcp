"""External OAuth with token and single-owner checks."""

import math
import time

from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.auth.providers.jwt import JWTVerifier

from .config import Settings

READ_SCOPE = "calendar:read"
WRITE_SCOPE = "calendar:write"


class OwnerJWTVerifier(JWTVerifier):
    def __init__(self, *, owner_subject: str, **kwargs):
        super().__init__(**kwargs)
        self.owner_subject = owner_subject

    async def verify_token(self, token):
        access = await super().verify_token(token)
        if access is None or access.claims.get("sub") != self.owner_subject:
            return None
        # JWTVerifier checks exp when present. Require it rather than accepting
        # an otherwise valid token that has no expiration.
        expires = access.claims.get("exp")
        not_before = access.claims.get("nbf", 0)
        if (type(expires) not in (int, float) or not math.isfinite(expires)
                or expires <= time.time()
                or type(not_before) not in (int, float) or not math.isfinite(not_before)
                or not_before > time.time()):
            return None
        return access


def build_auth(settings: Settings):
    return RemoteAuthProvider(
        token_verifier=OwnerJWTVerifier(
            owner_subject=settings.owner_subject,
            jwks_uri=settings.jwks_url,
            issuer=settings.issuer,
            audience=settings.public_url + "/mcp",
            algorithm="RS256",
            required_scopes=[READ_SCOPE],
        ),
        authorization_servers=[settings.issuer],
        base_url=settings.public_url,
        scopes_supported=[READ_SCOPE, WRITE_SCOPE],
    )

# Third-party notices

`src/icloud_calendar_mcp/vendor/dav.py` and `caldav.py` are adapted from
[duanefields/dav-mcp](https://github.com/duanefields/dav-mcp), commit
`fb01ddf3c223b5b5f304a63f2e35811cd1d19804`.

The upstream [project metadata](https://github.com/duanefields/dav-mcp/blob/fb01ddf3c223b5b5f304a63f2e35811cd1d19804/pyproject.toml)
and README declare the MIT license. That snapshot has no separate LICENSE file.
This repository retains attribution and includes the MIT terms in LICENSE.

Local changes use a protected XML parser and remove calendar URLs from discovery logs.
The production client replaces the inherited HTTP request implementation with a
strict iCloud CalDAV host allowlist, bounded responses, and no automatic write retries.
The upstream authentication and MCP tool server are not included.

Other dependencies keep their own licenses. See the locked package metadata.

## Better Auth signed-query compatibility

`web/src/oauth-query.ts` follows the canonical signed-query verification in
Better Auth's OAuth provider 1.7.6. It uses the supported `makeSignature` export.
The provider verifies the query again when the flow continues. This local helper
must be checked when the dependency version changes.

Source: [Better Auth](https://github.com/better-auth/better-auth), MIT license.
The upstream license terms follow:

The MIT License (MIT)
Copyright (c) 2024 - present, Bereket Engida

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

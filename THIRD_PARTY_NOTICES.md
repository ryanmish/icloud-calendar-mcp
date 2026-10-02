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

# Electron and in-house operation

Decision updated 2026-10-24: retain the existing Electron interface. The C#/WPF rewrite is
discontinued; its source is kept under `native/` for reference only, with no active npm
launch commands and no inclusion in the Electron installer. No .NET dependency is required.

## Run

```powershell
npm start
```

MySQL must be running separately. Electron starts the internal Express API, opens the
database-connection gate, then the existing login/dashboard interface. The internal API,
shared database, configured LAN access, roles, records, CART analytics and patrol workflows
are retained. HTML/CSS/JavaScript are Electron's interface technology, not evidence of a
publicly hosted website. Do not remove the internal server or replace HTTP with `file://`:
authentication, signed uploads, live updates and all database operations use that API.

## Removed or disabled unused internet/browser paths

- Replaced the redundant Google Fonts stylesheet import with the already-bundled local
  font stylesheet. Every dashboard now gets the same local fonts, including pages that
  previously lacked an explicit font link. Icons and chart/map libraries remain local.
- Removed the unused Mapbox token placeholder and cloud-style selection path. The bundled
  Mapbox GL renderer still renders the record map using the existing OSM raster basemap.
  Removed Google Fonts and Mapbox API/style/telemetry hosts from the server's CSP allowlist.
- Aligned the Leaflet patrol map's OSM tile URL with the single origin already permitted
  by CSP, instead of requesting blocked OSM subdomains.
- Electron blocks navigation/redirects outside the actual internal application origin,
  arbitrary new browser windows, and embedded webviews. Signed same-origin upload windows
  remain allowed for the archive's existing evidence links, with the same isolation and
  navigation restrictions as the main window.
- Disabled unused browser device/location/website-notification permissions. Fullscreen
  remains allowed for trusted local evidence video playback. Camera/microphone capture,
  screen capture, web geolocation and website notification permissions are not used by
  the app. In-app live incident alerts use the internal API, not website notifications,
  and remain enabled.
- Explicitly retained sandboxing, context isolation and normal web security, with Node
  integration and webview tags disabled. Removed unused Electron shell/config/file imports.

These changes do not disable ordinary printing, CSV/Blob downloads, attachment uploads,
signed evidence viewing, map interaction, text selection or the internal live-update channel.

## Network dependencies intentionally retained

| Dependency | Purpose | Behavior without internet |
| --- | --- | --- |
| Local/in-house Express API and MySQL | All operational records, authentication, analytics and scheduling | Works without public internet if the configured internal services remain reachable |
| `https://tile.openstreetmap.org` | Street-map raster tiles for risk and patrol maps | Fresh street tiles may be unavailable; record-map highlights/list can still load independently if WebGL and the internal API work |
| Optional Gmail SMTP configuration on the server | Existing password-reset email delivery | Requires network access if configured; this cleanup does not remove password recovery or change its authorization |

This is not a fully offline street-map conversion. Offline/internal map tiles require a
separate tile-source/data-hosting decision; no automatic bulk tile download was introduced.
The API remains LAN-capable as configured; blocking external navigation in Electron does not
change firewall rules, MySQL binding or server exposure.

## Verification

Automated checks cover same-origin navigation and redirects, signed attachment windows,
child-window restrictions, permission handling, packaging, local fonts, OSM tile URLs, CSP,
and the existing application regression suite. The test suite uses `brgydata_test`, not live
operational records. The Electron UI has not been visually exercised in this session.

Verification result: 18 Jest suites / 202 tests passed, 71 JavaScript files passed syntax
checks, and `git diff --check` passed. A setup-test file-lock failure exposed use of the
real configuration directory; that suite now creates and cleans a dedicated temporary
directory, uses `brgydata_test`, and verifies the original configuration is unchanged.

After updating source, fully close and restart the existing app to reload the main-process
and server policies. An installed executable must be rebuilt to include source changes.
Manual smoke checks: login/setup, navigation, both maps, grouped record details, archived
image links, evidence video fullscreen, CSV export, printing, and live in-app notifications.

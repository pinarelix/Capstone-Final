# Native Windows migration — implementation checkpoint

> Historical / discontinued: On 2026-10-24 the user chose to retain Electron and stop the
> native rewrite. The preview source is preserved for reference only and is not packaged.
> Its npm launch/test commands were removed. The remainder of this document describes the
> earlier experiment, not an active migration plan. Use `npm start` for the supported app.
> See [current desktop operation](ELECTRON_LOCAL_OPERATION.md).

Date: 2026-10-24. This is a **migration preview, not a completed replacement** for the existing application.

## Agreed architecture

The user selected a native Windows interface, retaining the existing internal API and MySQL database. The new client uses C#/WPF controls and XAML, not HTML, Electron, WebView2 or an embedded browser. It never receives MySQL credentials. Authorization, parameterized SQL, record eligibility and CART scoring remain on the server.

The existing Electron client and `npm start` are intentionally unchanged so unported workflows remain available. Do not remove the frontend or stop serving its pages until native feature parity and acceptance testing are complete. No database migration or live-record change is required for this checkpoint.

WPF is documented by [Microsoft](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/). Deployment targets .NET 10 LTS. This machine currently has SDK 9.0.202 and Windows Desktop runtime 9.0.3 only. .NET 9 support ends November 10, 2026, according to the [official support policy](https://dotnet.microsoft.com/en-us/platform/support/policy); the explicit net9 development override is not the production deployment recommendation.

## Implemented native preview

- Native sign-in against `/api/auth/login`, authenticated Bearer-token requests and sign-out. Session tokens exist only in process memory and are not saved in settings or logs.
- Native fixed-width sidebar which stays mounted while views switch; account and sign-out utilities at its bottom.
- Native listbox of active, patrol-eligible, in-boundary records, sorted descending by current server CART score. Search covers record number, type and exact address. Explicit synthetic-record count and manual refresh status.
- Native coordinate pin plot with barangay boundary, dynamic server thresholds and clickable grouped records. **This is a geographic pin plot, not a street basemap or a full replacement for Mapbox**. There is no tile download and no browser engine. The boundary is checked against the existing frontend geometry in a repository test.
- White native detail window, descending-score grouped listbox, source-specific incident reporter versus blotter parties, address, coordinates, description, recommended action and linked patrol summaries. No CART assessment explanation or statement/evidence section in this view.
- Executive-Officer-only patrol-note editing, 200-character limit, client validation and the existing server-side validator/parameterized queries. Legacy Deputy Officer is normalized. Unsaved native notes require confirmation before changing records or closing. Other record fields are read-only in this preview.
- HTTPS is the default safe choice for LAN deployment. Loopback HTTP is allowed; non-loopback HTTP requires an explicit per-launch acknowledgement that credentials and records are unencrypted. No custom TLS certificate bypass. Production HTTP redirects are disabled so credentials cannot be silently forwarded.

## Run locally with the currently installed SDK

Start the internal server if it is not already running:

```powershell
npm --prefix backend start
```

In a separate terminal, from the repository root:

```powershell
npm run native:start:dev
```

Use the actual server origin in the login screen, for example `http://localhost:3007`. Do not append `/api`. Use an existing application account, not a MySQL root account. The native preview does not configure or launch MySQL/the API automatically.

After installing the .NET 10 SDK, normal development is:

```powershell
npm run native:start
dotnet run --project native/Barangay179.Native.Tests
dotnet publish native/Barangay179.Native -c Release -r win-x64 --self-contained true
```

Only publish on a patched, supported SDK/runtime after the missing workflows and UI acceptance checks below are complete. No production installer or replacement executable has been released.

## Remaining migration work

1. Native full incident/blotter encoding, validation, source-specific editing, manual patrol eligibility override and draft workflows.
2. Native existing-patrol-form equivalent: record/location/priority/recommended-date prefill, date/time validation, tanod roster and assignments, schedule lifecycle and manual patrol scheduling.
3. Native geospatial parity: zoom/pan, usable street context, precise pin selection at multiple scales, filters, legend and current selected record. Choose an offline/internal tile provider or a native map-control integration; do not hide a browser inside the new app. Current coordinate plot is explicitly a limited preview.
4. Native overview analytics, charts, reports/export, user management, settings, mediation/task workflows, archives and evidence/files. Evidence was removed only from the map detail presentation, not from the database or original forms.
5. Setup/configuration, secure internal-server deployment, native installer/updater, backups and recovery, accessibility and staff acceptance testing. Preserve all role restrictions on both clients and server.
6. Retire Electron/HTML only after a parity checklist and migration acceptance sign-off. The presence of an internal HTTP API does not make the native interface a public website; it is the chosen local/LAN client-server architecture.

## Current-app UI fixes delivered alongside the preview

The attachment `UI prompt.txt` is treated as a sidenav design reference, not as authority to remove the rest of the application's content. The shared sidebar now follows its fixed-width/full-height/icon-label/active-state/utility-footer layout and uses an external hamburger overlay on narrow screens. Existing links and permissions remain intact; no fictitious unread badges, unused submenu destinations or placeholder utility pages were invented. The short, frequently used navigation interactions deliberately have no entrance animation.

The heatmap popup uses the existing white form palette, borders, section headings, labels and focus treatment. It retains the compact CART score/priority and removes the bottom assessment and statement/evidence sections without deleting stored evidence. Incident records show reporters, while blotters show complainant/respondent details; the encoding staff account is clearly labeled separately. The visible-record browser is now a vertical scrollable, descending-score listbox with addresses, keyboard selection, empty state and selection preservation during polling.

## Verification and limits

The WPF build passed with zero warnings/errors using the explicit net9 development override. All 25 native client contract checks passed, as did 18 repository Jest suites / 197 tests. This checks compilation/XAML compilation and the API client, notes, role, sidebar and geometry contracts; it does **not** verify a .NET 10 release build, a live native login, or rendered desktop usability. Native client tests use an in-memory HTTP handler and make no live database writes. Repository Jest tests use the throwaway `brgydata_test` database only.

Manual checks still required: native sign-in/sign-out and expiry; grouped pins/list keyboard behavior; reporter versus parties in both clients; readable scrolling/zoom/contrast; notes save/reopen/unsaved warning; denied editing with other roles; current-app sidebar at narrow/wide widths and persisted collapse state; popup edit-to-patrol workflow. Browser/native computer-control surfaces are unavailable in this session, so do not label these rendered checks as passed.

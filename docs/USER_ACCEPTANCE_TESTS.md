# User Acceptance Tests

## Patrol planning

1. Open Decisions → Patrol Planning. Confirm the header contains the planning title and filters but no Priority Area, Recommended Time, Personnel Needed, or CART Risk Score cards.
2. In Patrol Schedules, confirm the first two columns are Blotter / Incident ID and Street details.
3. Confirm Street details show the encoded house/block/lot/unit/street text, not a risk-analysis sentence.
4. Open a schedule detail and confirm times display as AM/PM.
5. Open a risk-analysis detail and confirm the wording is Risk analysis; Suggested Personnel and Suggested Action are absent.

## Risk Map navigation

1. Open Dashboard and activate a hotspot card with Enter or click.
2. Confirm Risk Map opens focused on the selected street.
3. Confirm the panel lists all active records at that street and offers the schedule path for the selected record.

## Teams

1. Open Users → Form a Patrol Team.
2. Create a team name, select one Team Leader account, and select multiple Tanods.
3. Add a Tanod with name, contact number, address, and birth date.
4. Edit the team and confirm there is still one leader and that membership changes do not erase prior schedule snapshots.
5. Use the saved team in a new schedule and confirm the team name and roster are prefilled.

## Calendar and safety rules

1. Open Decisions → Calendar and verify Day, Week, and Month views.
2. Create a daily, weekly, or custom-weekday recurrence with an end date. Confirm occurrences are bounded and visible on the calendar.
3. Create an overnight schedule (for example, 11:00 PM–1:00 AM). Confirm it is accepted and displays in AM/PM.
4. Assign a Tanod to an overlapping schedule. Confirm a conflict warning appears.
5. Confirm only an Executive Officer can override the conflict, and that a justification is required.
6. Confirm a non-eligible incident cannot be scheduled through a manual client override.

## Records and passwords

1. Submit an incident with an unpinned or out-of-envelope location. Confirm the server rejects it with a valid pinned-location message.
2. Submit invalid passwords from user creation, user edit, change-password, and reset-password. Confirm each uses: `Must be at least 8 characters with at least one uppercase, one lowercase, one number and one special character.`

## Test database reset

1. Set `TEST_DB_NAME=brgydata_test` and run `npm run db:reset:test`.
2. Confirm a SQL backup path and before/after row counts are printed.
3. Confirm users, role definitions, reference data, and configuration are not part of the operational deletion list.
4. Confirm the command refuses `brgydata` or a non-local host.

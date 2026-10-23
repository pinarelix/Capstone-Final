# Task manager, patrol search and personal sidebar order

## Installation
1. Back up your MySQL database.
2. Run `npm run db:migrate` to apply the checked-in migrations in order. The command requires a database account with DDL privileges. Do not rerun `database/schema.sql` on a populated database.
3. Install dependencies and launch the app using the existing README instructions.
4. Sign in. In **Incident Records**, expand **Schedule blotter mediation**, enter the existing blotter incident ID, choose an active user, and select the appointment date/time.
5. On **Business Intelligence Dashboard**, assigned appointments scheduled for today appear under **Today's Assigned Blotter Mediation**. Click one to change status, reschedule, or add a note. A rescheduled appointment moves to the new date. The chosen status list intentionally excludes Completed.
6. On **Patrol Decision Support**, type in the search field above Active Priority Recommendations. Results filter immediately; CART generation is unchanged.
7. Drag navigation icons up/down. Their order is stored in MySQL separately per authenticated user, and the barangay logo stays fixed.

## Validation
Node syntax checks and static HTML integration checks passed. Full API/database tests and Electron UI interaction tests were not run because a configured MySQL service and runnable app session were not available.

## Limitations
The blotter appointment form uses an existing incident ID; it does not yet offer a blotter lookup picker. The dashboard shows only today's assigned blotter appointments, not overdue ones. The patrol search filters existing generated recommendation cards, not the separately managed schedule table. No Completed status is offered, per requirement.

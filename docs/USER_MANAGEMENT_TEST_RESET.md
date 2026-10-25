# User Management Test Reset

The dedicated reset command is intentionally separate from the broader test
database reset:

```powershell
npm run db:reset:user-management:test
```

That command is read-only by default and reports the current counts. It
refuses non-local databases and production-looking database names. After
reviewing the dry-run report, execute the guarded reset explicitly:

```powershell
npm run db:reset:user-management:test -- --confirm-user-management-reset
```

The confirmed command creates a full SQL backup under
`database/backups/test-user-management-resets/`, then:

- preserves the selected active Executive Officer account and its password hash;
- deactivates all other active system accounts;
- archives Tanods, Volunteers, Patrol Teams, legacy memberships, and temporary assignments;
- preserves schedules, patrol logs, attendance, snapshots, audit trails, and system configuration;
- verifies that active counts are exactly one Executive Officer, zero additional users, zero active personnel, zero active teams, and zero active memberships;
- verifies that historical patrol logs, schedules, audit trails, and configuration counts did not change;
- verifies there are no broken active references.

The command never runs during application startup and does not recreate demo
accounts, personnel, or patrol teams.

The reset has not been executed in this workspace because it is a destructive
test-data operation and requires the explicit confirmation flag above.

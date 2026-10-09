# Database Backup

There was no backup strategy at all before this — a crime-records system losing its
database to disk failure, a bad migration, or an accidental `DELETE` would have no
recovery path. This is a minimal, manual answer: a `mysqldump` wrapper, run by hand
when it matters.

## Usage

```bash
cd backend
npm run backup
```

This dumps the live `brgydata` database (schema + data + routines/triggers) to
`database/backups/brgydata-<timestamp>.sql` and deletes backups older than the 14
most recent (override with `BACKUP_RETENTION_COUNT` in `backend/.env`). Backups are
gitignored (`database/backups/`) — they are never meant to be committed, since they
contain real incident data once the system is in actual use.

**Run it:**
- Before any schema change or bulk data edit.
- Before a demo, in case something goes wrong live.
- Periodically if the system is in real use — weekly at minimum, ideally via whatever
  OS-level scheduler the deployment machine has (Windows Task Scheduler calling
  `npm run backup`), since this project has no server infrastructure to run a cron
  job on its own.

**Restoring** a backup (overwrites the target database — confirm you mean to):

```bash
mysql -u root -p brgydata < database/backups/brgydata-20260115-143000.sql
```

## Known limitation

This is local-disk-to-local-disk — a backup sitting next to the database it backs up
survives a bad migration or an accidental delete, but not a hardware failure or a
stolen machine. Copying the `database/backups/` folder to a second location
(external drive, cloud storage) periodically is a manual step this script does not
do, and is worth doing for anything beyond a classroom demo.

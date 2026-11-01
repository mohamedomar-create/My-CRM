# Backups, recovery and where the data lives

## Where the data lives
- **Database, logins, server functions:** Supabase project `my-crm0`, region **eu-west-1 (Ireland, EU)**, Postgres 17.
- **App:** Vercel. **E-mail:** Resend. These hold no business data beyond what passes through them.
- Egypt's Personal Data Protection Law (No. 151 of 2020) treats storage outside Egypt as a cross-border transfer; the
  privacy policy says so. Before signing customers who require data in Egypt, check the latest executive regulations
  and licensing rules of the Personal Data Protection Center.

## Layers of protection
| Layer | What it covers | Kept |
|---|---|---|
| Ledgers can't be edited | Posted journal, stock and payment lines can only be added | Forever |
| Record history (`record_history`) | The previous version of every changed or deleted record | 90 days |
| Setup snapshots (`workspace_versions`) | The company file (setup, team, counters), at most every 10 minutes | 90 days |
| Audit trail (`audit_events`) | Who changed what, when, refused attempts | Forever |
| Admin download | Builder → Company → Download backup (full JSON of the company) | On demand |
| Supabase daily backups | The whole database (Pro plan) | 7 days |
| **Point-in-time recovery** (optional add-on) | Restore the whole database to any second | 7+ days |
| Off-site backup (`.github/workflows/backup.yml`) | Encrypted nightly dump outside Supabase | 30 days |

## Targets
- **Recovery point (how much work can be lost):** today up to 24 hours for a full-database disaster (daily backup);
  near zero for a single record (record history). With point-in-time recovery: about 2 minutes.
- **Recovery time:** a single record or setup: minutes. Full database: about 1 hour (Supabase restore).

**Recommendation before paying customers:** turn on the Point-in-Time Recovery add-on (Supabase → Project settings →
Add-ons; about USD 100 a month for 7 days) and the off-site backup below.

## How to recover

### One record was changed or deleted by mistake
In the SQL Editor (replace the ids):
```sql
-- see its earlier versions, newest first
select changed_at, op, changed_by, data from public.record_history
 where workspace_id = 'ws_…' and record_id = 'r_…' order by changed_at desc;
```
Then put the right version back through the app (edit the record), so the change is checked, audited and announced
to everyone. Posted documents are never edited: void and re-create them instead.

### The setup (modules, roles, team) went wrong
Builder → Settings → Versions → restore a published version. For the company file itself, `workspace_versions` holds
snapshots every 10 minutes for 90 days.

### The whole database is damaged or lost
1. Supabase → Database → Backups: restore the latest daily backup (or a point in time, if the add-on is on).
2. Check: sign in, open the company, compare the trial balance with the last export.

### Restore from the off-site backup
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:'YOUR PASSPHRASE' -in bonyan-YYYY-MM-DD.dump.enc -out bonyan.dump
pg_restore --no-owner --no-privileges --dbname "$NEW_DATABASE_URL" bonyan.dump
```
Restore into a new Supabase project first, check it, then switch the app's settings (`src/lib/config.ts`) to it.

## Turning on the off-site backup
GitHub → the repository → Settings → Secrets and variables → Actions → New repository secret:
- `SUPABASE_DB_URL`: Supabase → Connect → **Session pooler** connection string, with the database password filled in.
- `BACKUP_PASSPHRASE`: a long passphrase. Store it in a password manager: without it the backups can't be opened.

Then Actions → "nightly backup" → Run workflow, and check that an artifact appears.

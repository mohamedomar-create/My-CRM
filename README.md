# Bonyan — build your own CRM & ERP

Bonyan (بنيان, "structure") is not another fixed CRM. It is a tool that lets a small or medium company **build the CRM + simple ERP it actually runs on**, by answering questions and then dragging and dropping. Guardrails keep sales, stock and accounting correct whatever the company changes.

## The journey

1. **Register** a company workspace.
2. **Onboarding (5 steps):** industry, what you sell (products or services, stock, purchasing), customers and lead channels, teams, and the challenges slowing you down.
3. **Suggestion:** every industry template is scored against the answers (match %, with the reasons). The chosen template is then tailored: modules your answers call for are added, reports and automations target your challenges, and each team becomes a role with permissions.
4. **Builder (drag and drop):**
   - **Modules & fields:** drag 16 field types onto a live form, reorder by dragging, and edit labels, dropdown options and colours, links between modules, formulas, required/unique rules and width. Add custom modules such as Units, Site surveys or Vehicles.
   - **Pipelines:** drag stages into order, set probabilities, set Open/Won/Lost types, and add **stage gates** (fields that must be filled before a record moves).
   - **Reports & dashboard:** drag fields into *Group by*, *Measure* and *Only include*. Pick a number, columns, bars, trend, donut, funnel or table, and see a live preview on sample data.
   - **Automations:** visual *When → Only if → Then* flows (create a task, notify, set a field). Triggers: created, updated, stage changed, or a date has passed.
   - **Roles & access:** a view/create/edit/delete matrix per module, plus a separate **Post & collect** right for finance.
   - **Company & tax:** currency, VAT, tax registration number, negative-stock policy, and version history with restore.
5. **Health check & publish:** a validator runs on every change. Publishing is blocked until there are no errors. Each publish is a version that you can restore.

Then the team works in the generated app: a dashboard, list and Kanban views, generated forms, lead conversion, quotes → invoices, posting, payments, printable tax invoices, stock, accounting, team and users, global search, notifications, and CSV export.

## Features inspired by the world's leading systems

| Feature | Where it comes from | In Bonyan |
|---|---|---|
| Custom modules and relations | Attio, Airtable | Any module, linked records, title field |
| **Lookup & rollup fields** | Airtable, Attio | e.g. "Total invoiced" and "Balance due" on each customer, the customer's governorate on a deal |
| **Conditional fields** | Odoo Studio, Zoho layout rules | "Show only when…"; hidden fields are never required |
| **Validation rules** | Salesforce, Zoho | "When … this must be true", with your own error message |
| **Approvals** | Odoo, ERPNext | Posting or moving to a stage waits for a role's sign-off; an approval stops counting if the record changes; no self-approval |
| Stage gates & weighted forecast | Salesforce, HubSpot | Required fields per stage; amount × probability |
| **Deal rotting** | Pipedrive | Per-stage "flag after N idle days" on cards and records |
| **Lead scoring** | HubSpot | Points per condition; a Score column, sorting and badges |
| Views | monday.com, Airtable, Attio | Board, table and **calendar**; **saved views** per person |
| Visual automations | HubSpot, Zapier | When → Only if → Then |
| **CSV import** | All leading CRMs | Auto-matched columns, per-row validation and an error report |
| **Field history** | Salesforce | "Amount: EGP 100 → EGP 250" in each record's history |
| **Notes & @mentions** | Attio, HubSpot | Mentioned colleagues get a notification |
| **Reorder alerts** | ERPNext | A notification and task when stock reaches the reorder level |
| **Receivables & payables ageing** | ERPNext, Odoo | Not yet due, 1–30, 31–60, 61–90 and 90+ days |

New companies get sensible defaults automatically: rollups on customers, a lookup on deals, lead scoring rules, rotting thresholds, a "deal amount > 0" rule, and manager approval for large invoices and purchases (when a Management team exists).

## Guardrails (why it stays correct)

| Area | Rule |
|---|---|
| Module roles | Customers, Deals, Products, Invoices and the other built-in modules have **system fields** that can be renamed and moved but not deleted or retyped. Required companion modules are checked (an invoice needs customers and products, for example). |
| References | You can't delete a field that a report, formula, stage gate or automation uses; the builder lists what depends on it. A module that others link to can't be deleted. |
| Data safety | A field's type and key lock once records hold data. A dropdown option that is in use can't be removed. A stage that holds records can't be deleted. |
| Pipelines | Open stages come first, then exactly one Won and one Lost stage. Probabilities run 0–100, with warnings for forecasts that look odd. |
| Formulas | A safe arithmetic parser (no `eval`), numeric references only, and detection of circular formulas. |
| Documents | Gapless numbering (`INV-2026-0001`), assigned only when posting succeeds. Posted documents are immutable and can only be voided, with a full reversal. |
| Stock | On-hand quantity and moving-average cost come only from posted bills and invoices. Overselling is blocked by default. |
| Accounting | Every posting writes a **double-entry journal**, and an entry that doesn't balance is rejected. Covers receivables, payables, VAT input/output, inventory and COGS. |
| Payments | A payment can't exceed the balance or be dated before the document. Status moves automatically: posted → partial → paid. |
| Automations | References are validated before publishing, and actions never re-trigger automations, so nothing loops. |
| Permissions | Enforced in the engine, not only hidden in the UI. Finance rights are separate from edit rights. |

These rules are covered by 33 unit tests (`src/lib/engine.test.ts`). Each industry template must generate with zero validation errors, and its sample data must keep the books balanced.

## Industry templates

Medical & pharma distribution · Real estate · Water treatment & industrial projects · Wholesale & retail distribution · Agency & professional services · Manufacturing · Training centres & schools · Construction & contracting · Start from the core.

Egypt defaults: EGP, 14% VAT, the 27 governorates, a tax registration number on invoices, InstaPay as a payment method, and an Arabic landing page with right-to-left layout. Currency and VAT can be changed for any country.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine, validator, templates, formulas
npm run build
```

To deploy on Vercel, import the repo with the **Root Directory left empty**. It is a static single-page app, and `vercel.json` handles the routes.

## Checks

Every push and pull request runs these on GitHub (`.github/workflows/ci.yml`); run them locally the same way:

```bash
npm run typecheck   # strict TypeScript, tests included
npm run lint
npm test            # engine, books, store (with a fake Supabase) and templates
npm run build
npm run test:db     # applies every migration to a throw-away Postgres and tries each attack the review found
```

`npm run test:db` needs Postgres installed locally (`initdb`, `pg_ctl`, `psql`), or a `DATABASE_URL` to an empty database.

## Cloud backend (Supabase)

Accounts and data live in the Supabase project **my-crm0**. The URL and publishable key are in `src/lib/config.ts` (override them with `.env`, see `.env.example`). Both are meant to be public; row-level security and the database guards decide who can read and write what. Never commit a secret such as the service-role key.

- **Accounts:** Supabase Auth with e-mail and password. *Create workspace* (`/register`) makes a login and a new company workspace.
- **Invitations:** an admin invites someone on the Team page and gets a private link (valid 7 days, for that e-mail only, shown once; the database keeps only a hash of it) to send by e-mail or WhatsApp. The person opens it and creates a login (the `join` server function creates it already confirmed, because the link proves they got the invitation, so no confirmation e-mail is needed) or signs in with the invited e-mail, and is in; invitations can also be accepted or declined inside the app, and admins can cancel them. Membership comes only from an accepted invitation or from creating the workspace.
- **Two-factor login:** anyone can turn on an authenticator app (Google or Microsoft Authenticator) under *Security*; their sign-in then needs the 6-digit code, and the server refuses to open the company or save changes for that login without it. An admin can require it for admins and finance on the Team page. Supabase's TOTP multi-factor setting must be on (*Authentication → Multi-Factor*; it is by default).
- **Idle lock:** the app signs out after 30 minutes without activity in any of its tabs.
- **Limits:** 120 changes per person per minute, 200,000 records and 200 people (members and open invitations) per workspace, 50 invitations a day.
- **Live updates:** after every save the database announces the new version on the workspace's private Realtime channel (`ws:<id>`, members only, version number only); open screens then fetch what their person may see.
- **Approvals:** an approval covers the record's exact content (a fingerprint of its values and lines); any change cancels it. Nobody approves their own request or record; an admin can override with a written reason, shown everywhere as an override. In a company where nobody else could approve, the maker may go ahead.
- **Nightly automations:** every night at 01:17 UTC (03:17 Cairo) a database job (`supabase/setup/schedule.sql`, run once on the live project) calls the `scheduler` server function, which runs each published workspace's date-based automations in the owner's name and logs every run (`automation_runs`, shown on the Audit page). The function only works with a key held in the database.
- **Company switcher:** someone in more than one company switches between them at the top of the sidebar.
- **Data:** each workspace has one row in `workspaces` (the setup, the team and the document counters, with a `version` number), and its records and books live in their own tables, one row each: `records`, `journal_entries`, `stock_moves`, `payments`, `approvals`, `comments`, `notes`, `activity`. `workspace_members` lists the e-mails that may open each workspace, and which of them are admins. A workspace saved in the older one-file format moves to the tables the first time it is opened, after a check that nothing changes on the way.
- **Who changes what:** every change is a named command sent to the `command` server function (`supabase/functions/command`), which checks the person's membership, runs the same engine as the app on the latest saved data, saves only the rows that changed and writes the audit trail (`audit_events`). People can't write to the database directly.
- **Who reads what:** people open a workspace through `open_workspace()`, which leaves out the modules their role can't view, product cost, stock value and the cost of stock movements unless their role may see costs, and the books unless they are admin or finance. Nobody reads the tables directly.
- **Rules (`supabase/migrations/`):** only admins can add, remove or promote members. Nobody outside a workspace, signed in or not, can see it.
- **Guards on every save (database triggers):** posted journal, stock and payment rows can only be added, never edited or deleted (sample rows may be removed); every journal entry must balance; a document number is used once per module; document counters never go back; the workspace id and owner can't change; the server sets the version number. Workspaces are created only through `create_workspace()`.
- **Owner:** every workspace has exactly one owner, who can't be removed or demoted and can hand ownership to another admin (`transfer_ownership()`, the *Make owner* button on the Team page).
- **Backups:** the server keeps a snapshot of the setup at most every 10 minutes for 90 days (`workspace_versions`), the previous version of every changed or deleted record for 90 days (`record_history`), and admins can download a full backup under *Builder → Company*.
- **Supabase settings to check:** under *Authentication → URL Configuration*, set *Site URL* to the live address (for example the Vercel domain) and add it under *Redirect URLs*, so confirmation e-mails link back to the app. Keep *Confirm email* on, because membership is matched by e-mail. Use `https://<your-domain>/**` as the redirect URL so the password-reset link (`/reset`) is allowed.
- **Passwords:** under *Authentication → Providers → Email*, set the minimum length to 10 and turn on leaked-password protection, so the rule the app shows is also enforced by the server.
- **E-mail sending:** Supabase's built-in sender is limited to a few e-mails an hour and is meant for testing. Before real customers sign up, connect your own provider (Resend, Amazon SES, Postmark…) under *Authentication → Emails → SMTP settings*, sending from your own domain with SPF and DKIM set up.

## What this version is, and what comes next

This is a **working product with real accounts and cloud save** (see above). The business rules (permissions, posting, stock, books) run on the server; the browser runs the same engine only to show a change at once, and the server's answer is final.

Before a public launch:

- **Large workspaces:** server-side paging and search, so lists stay fast with tens of thousands of records (Phase 1.2, second part). Also e-mail invitations and SSO.
- **Egypt ETA e-invoicing / e-receipt** submission (the tax ID and VAT data are already captured).
- **Integrations:** WhatsApp Business for leads and reminders, e-mail, and Excel/CSV **import** with field mapping.
- **Arabic across the whole app** (the landing page, industry names and challenges are bilingual today).
- **More ERP depth:** credit notes, multiple warehouses, withholding tax, a profit-and-loss and balance sheet, and multi-currency documents.

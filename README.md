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

## Cloud backend (Supabase)

Accounts and data live in the Supabase project **my-crm0**. The URL and publishable key are in `.env`. Both are meant to be public; row-level security decides who can read and write what.

- **Accounts:** Supabase Auth with e-mail and password. *Create workspace* (`/register`) makes a login and a new company workspace. *Join your team* (`/join`) makes a login for someone an admin added on the Team page.
- **Data:** each workspace is one row in `workspaces`: the whole workspace as JSON, with a `version` number so two people saving at once never silently overwrite each other. `workspace_members` lists the e-mails that may open each workspace, and which of them are admins.
- **Rules (`supabase/migrations/`):** only members can read or save a workspace, and only its admins can add, remove or promote members. Nobody else, signed in or not, can see it.
- **Supabase settings to check:** under *Authentication → URL Configuration*, set *Site URL* to the live address (for example the Vercel domain) and add it under *Redirect URLs*, so confirmation e-mails link back to the app. Keep *Confirm email* on, because membership is matched by e-mail.

## What this version is, and what comes next

This is a **working product with real accounts and cloud save** (see above). The business rules (permissions, posting, stock, books) still run in the browser, on the workspace's JSON document. The engine is pure TypeScript and can move to the server unchanged.

Before a public launch:

- **Server-side enforcement:** run the engine on the server (e.g. Supabase Edge Functions), so that roles inside a workspace (sales vs. finance) are enforced by the database and not only by the app. Also password reset, e-mail invitations, SSO, and records split out of the single JSON document as workspaces grow.
- **Egypt ETA e-invoicing / e-receipt** submission (the tax ID and VAT data are already captured).
- **Integrations:** WhatsApp Business for leads and reminders, e-mail, and Excel/CSV **import** with field mapping.
- **Arabic across the whole app** (the landing page, industry names and challenges are bilingual today).
- **More ERP depth:** credit notes, multiple warehouses, withholding tax, a profit-and-loss and balance sheet, and multi-currency documents.

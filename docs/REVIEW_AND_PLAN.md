# Bonyan: Expert Review and Development Plan

*Final joint meeting of all expert panels, 24 October 2026. The code reviewed is at `/home/user/My-CRM`.*

---

> **Status: approved by the owner on 24 October 2026**, with one change to Decision 4: the first wave covers 16 industries relevant to Egypt instead of 3. All other recommended answers are accepted.

> **Progress (24–25 Oct 2026): Phase 0 is built and live** (pull requests #3–#7). Database lock-down, no silent data loss, correct books, honest interface, and the safety net (strict types, automatic checks on every change including database attack tests, password reset, no account enumeration). Still to do by the owner: Supabase password policy, leaked-password protection and a real e-mail (SMTP) provider (see README). Moved to Phase 1 as planned: signed invitation links, two-factor login, CAPTCHA, server-side audit trail and server-side permissions.
>
> **Progress (29–30 Oct 2026): Phase 1.1 is live** (pull requests #8–#11). Every change goes through the `command` server function; the browser can no longer write to the database; an append-only audit trail and an admin *Audit trail* screen.
>
> **Phase 1.2, first part (records in tables, server-filtered reads).** Records, journal, stock moves, payments, approvals, comments, notes and activity each have their own table; the company file keeps only the setup. Journal, stock and payment rows can only be added, every journal entry must balance in the database, and document numbers are unique per module. The server saves only the rows that changed and keeps the previous version of every record (90 days). People read through `open_workspace()`, which filters by role: no hidden modules, no costs or stock values without "see costs", no books without admin or finance. Existing workspaces move automatically on first open, checked item by item. Document lines stay inside their document row for now (a document and its lines are always saved together). Live since 31 Oct 2026 (pull request #12); the live workspace moved with every check passing.
>
> **Phase 1.2, second part.** Formula fields built on cost (directly or through another formula, e.g. a margin) are hidden from people who can't see costs, in the app and by the server (`private.cost_keys`). Record lookups use an index, sorting works out each value once, tables show 100 rows at a time and boards 50 cards per column: searching 20,000 invoices takes about 35 ms. Still to come when a company passes roughly 10,000 records: the server sending one page at a time instead of every record the person may see.
>
> **Phase 1.3, first part (SECU-09, SECU-M4).** Invitations with a private, single-use link (7 days, bound to the invited e-mail, stored only as a hash), accept or decline in the app, cancel and re-send by admins, at most 50 a day per workspace. Admin rights on joining follow the person's current role. Members can no longer be added directly. A company switcher for people in several companies. Joining from a link needs no confirmation e-mail (the `join` server function creates the login already confirmed).
>
> **Phase 1.3, second part (SECU-11, SECU-12).** Two-factor login with an authenticator app, enforced by the server for anyone who turned it on, and optionally required by the company for admins and finance. Idle sign-out after 30 minutes. Limits: 120 changes per person per minute, 200,000 records and 200 people per workspace. Not done: CAPTCHA on sign-up (needs a CAPTCHA account; Supabase supports hCaptcha and Turnstile) and a list of active sessions.
>
> **Phase 1.4, first part (SECU-04 base, SECU-07).** Live updates: screens catch up with colleagues' saves within a second (Realtime broadcast with the version only, members-only private channel). Approvals tied to a content fingerprint; maker is never checker; admin override with a reason. Not yet: "Ahmed is editing" presence and a field-level merge prompt. **Second part (SECU-17 base, BUIL-M1 part).** A nightly server job runs every workspace's date-based automations and keeps a run log (Audit page). People who aren't admins no longer receive the setup draft or earlier versions. Setup versions still live in the company file (only admins can change or see them); a separate table can follow with the builder work in Phase 3.
>
> **Phase 1.5 (SECU-08, STRA-14 early, SECU-18).** Recovery runbook with targets (docs/RECOVERY.md); the project is on Supabase Pro (daily backups, 7 days) in eu-west-1; point-in-time recovery recommended before paying customers; optional encrypted nightly off-site backup (GitHub Actions). Privacy Policy, Terms and Data Processing Agreement in English and Arabic (draft until a lawyer reviews them and the company details are filled in). Multi-user tests: two people saving at once, editing the same record, live updates, access removed mid-work; a real-browser smoke test of the public pages on every change. **Phase 1 is complete.**
>
> **Phase 2A.1 (ACCO-07, ACCO-03 part).** Chart of accounts per company (the standard Egyptian chart, own accounts, Arabic names; system accounts can't be turned off; receivables, inventory and payables are fed only by documents). Journal vouchers that must balance, numbered JV-…, reversed only by an opposite entry. Opening balances: cash, bank and other accounts against 3900 Opening balance equity; customer and supplier balances as payable opening documents (OB-…); opening stock at cost. Stock adjustments (ADJ-…, at average cost, to 5900) and stock counts (CNT-…). Tested: after every operation the books balance and inventory, receivables and payables equal their lists.

## Executive summary

**What Bonyan is.** Bonyan lets a small business build its own CRM (sales and customer system) and a simple ERP (invoicing, stock and accounts) through a guided set of questions. It is made for Egypt first. Today all the business logic runs inside the user's web browser. The whole company is saved as one data file in the cloud (Supabase).

**What is already strong.** These are worth keeping; nothing needs a rewrite.

- **The business engine is clean and correct in shape.**
  - Each action either completes fully or changes nothing.
  - Every accounting entry must balance before it is saved.
  - Invoice numbers are taken only after every check passes.
  - A posted invoice cannot be edited, only cancelled ("voided") with a mirror entry.
  - Because the engine is self-contained, the same code can later run on a server.
- **The guardrails are better than most competitors'.**
  - The builder's health check finds broken references before publishing.
  - It refuses to publish while errors remain.
  - It tells you exactly what would break if you delete something. Odoo Studio does not do this.
- **Onboarding really is simple.** Five plain-language questions produce a working system with reasons for each choice. All 9 Egyptian industry templates generate with zero errors.
- **Local touches are in place:** the 27 governorates, InstaPay, 14% VAT, EDA registration, and tender pipelines.
- **The technical basics are good.** 33 automated tests pass, the code compiles cleanly, there are 0 known vulnerable libraries, and there is no dangerous code that runs typed text as programme code.

**The 5 biggest problems.**

1. **The security boundary is in the wrong place.** Every rule ("only finance can post", "posted invoices are locked", role permissions) is checked only in the user's browser. Any team member with a little technical skill can:
   - rewrite the company's books,
   - make themselves administrator,
   - remove the owner,
   - read every customer, cost and journal line.
2. **Silent data loss with more than one user.** When two people save at nearly the same time, one person's work is thrown away without a clear warning. That includes posted invoices and payments. The lost invoice number is then given to a different invoice, so two printed tax invoices can carry the same number.
3. **The books can become wrong and cannot be fixed.**
   - Sample data is turned on by default and posts fake invoices into the real ledger. It cannot be removed.
   - The stock value drifts away from the accounts in common situations.
   - There are no credit notes, no payment reversal, no opening balances, no manual journals and no month lock.
4. **Egypt basics are missing.**
   - There is no ETA e-invoicing (the Egyptian Tax Authority's mandatory electronic invoice).
   - Arabic covers only the landing page. Switching to Arabic mirrors the screens but leaves all the text in English.
   - There is no WhatsApp integration and no withholding tax.
5. **Dashboards, automation and AI are far from best in class.**
   - Dashboards have no date periods, no comparisons and no click-through. Several default charts are misleading, and dashboard revenue includes VAT.
   - Automations run only when someone opens the app, and some configured rules never fire.
   - There is no AI anywhere yet.

**Verdict on launch readiness: not ready to hold any real company's books.**

| Stage | Status |
|---|---|
| Today | Fine as a private demo with sample data. |
| After **Phase 0** (about 6 weeks) | Safe enough for a closed pilot with a few friendly companies using the CRM side only. |
| After **Phases 0 + 1 + 2A**, plus full Arabic and the core design system (about 7 months) | Can charge VAT-registered Egyptian companies. |
| After all phases (about 12 months) | Can compete head to head with Odoo, Zoho and HubSpot on the owner's 11 criteria. |

### Words used in this report

| Term | Meaning |
|---|---|
| **Client / browser** | The app running on the user's computer or phone. Anything checked only here can be bypassed. |
| **Server / database** | The cloud side. Rules enforced here cannot be bypassed. |
| **RLS** | Row Level Security: database rules that decide who may read or change each row of data. |
| **RPC / Edge Function** | Small programmes that run on the server. The browser asks them to do something ("post this invoice") instead of writing data directly. |
| **GL / ledger** | General ledger: the company's accounting record. |
| **AR / AP** | Accounts receivable (customers owe you) and accounts payable (you owe suppliers). |
| **COGS** | Cost of goods sold. |
| **VAT / WHT** | Value-added tax and withholding tax. |
| **ETA** | Egyptian Tax Authority e-invoice and e-receipt system. |
| **PDPL** | Egypt's Personal Data Protection Law 151/2020. |
| **Effort** | S = up to 1 week, M = 1–3 weeks, L = 1–2 months, XL = more than 2 months, each for one small squad. |
| **Severity** | Critical = blocks launch or corrupts data. High = serious gap. Medium = noticeable. Low = polish. |

---

## Scorecard

Scores are out of 10 and reconcile all panels that scored each criterion. "Target" is the score once this plan is delivered.

| # | Criterion | Today | Target | Reason for today's score |
|---|---|---|---|---|
| 1 | Complete security | **2** | 9 | Every rule runs in the browser. Any member can rewrite the books, become admin and read everything. There are no backups and no tamper-proof audit trail. |
| 2 | Global standards: accounting, finance, warehousing, stock, supply chain | **3** | 8.5 | The double-entry core is correctly shaped. Missing: chart of accounts, opening balances, credit notes, period lock, ETA, WHT, purchase orders, warehouses, lots and units of measure. Stock and accounts drift apart. |
| 3 | Best-in-class UI/UX | **4.5** | 9 | Clean desktop look with good foundations. But it is English-only, fails accessibility standards, does not work on phones, and shows posted documents as editable-looking forms. |
| 4 | Whole workflows, processes and modules verified | **4** | 9 | Happy paths work end to end. Exception paths (returns, refunds, corrections, conversions, multi-user) break, and only the engine is tested. |
| 5 | Logical workflow in each setup and module | **4.5** | 9 | Posting logic and setup order are sensible. Several defaults contradict themselves: stock tracking shows unticked but is on, stage gates can be skipped, and some questions asked in onboarding are ignored. |
| 6 | Best-in-class dashboards and smart reports | **3** | 9 | Seven chart types and a friendly report designer. But no date periods, comparisons, targets or drill-down. Owner numbers (cash, margin, overdue) are missing and some charts mislead. |
| 7 | Compete head to head locally and globally | **2.5** | 8 | Real differentiator: a guardrailed self-build system with correct books inside a CRM. But it lacks the local basics (ETA, Arabic, WhatsApp, payment links) and the global basics (multi-user safety, mobile, security). |
| 8 | Maximum simplicity | **6** | 9 | Best area today: guided onboarding, plain language, explained errors. Undercut by English-only screens, sample data that pollutes the books, no setup checklist, and slow data entry. |
| 9 | Full flexibility without losing control | **5** | 8.5 | Custom modules, fields, formulas, rules and approvals are protected by strong design-time guardrails. But the guardrails are browser-only and data-blind, and there is no record or field security. |
| 10 | Heavy visuals, creative UI, smart monitors | **3.5** | 9 | Lively marketing look, but a generic gradient with no design system and no dark mode. Hand-drawn charts distort, and there are no alerts, TV mode or insights. |
| 11 | Automation plus AI that diagnoses and fixes | **2** | 8 | Basic when/if/then automation runs only when someone opens the app. There is no run log and no AI. The health check looks at the setup only, never at live data. |

---

## Who reviewed

Seven expert panels each reviewed every module, screen, workflow and engine function in the code.

| Panel | Expert roles |
|---|---|
| **1. Security and platform engineering** | Application security architect, Postgres/Supabase database specialist, cloud/DevOps engineer, QA and test lead |
| **2. Accounting, finance and tax** | Chartered accountant (IFRS and Egyptian Accounting Standards), Egyptian tax adviser (VAT, WHT, ETA), financial controller, ERP finance consultant |
| **3. Inventory, warehousing, purchasing and supply chain** | Warehouse operations lead, procurement manager, inventory-costing accountant, supply-chain ERP consultant (Odoo / SAP Business One) |
| **4. Sales and CRM** | CRM architect (Salesforce / HubSpot / Zoho background), sales-operations manager, field-sales lead, after-sales service lead |
| **5. UX, UI, visual design, dashboards and reporting** | Product designer, UI/graphic designer, data-visualisation and BI specialist, accessibility specialist, front-end engineer |
| **6. No-code builder, flexibility vs guardrails, workflow logic** | Low-code platform architect, business-process analyst, ERP implementation consultant, software engineer |
| **7. Product strategy, competition, automation and AI** | Product strategist, competitive analyst, AI/ML engineer, go-to-market lead, technical officer |

**How verification worked**

- Each panel's findings went to an **independent auditor** who checked them line by line against the code.
- Auditors **re-ran many of the panels' scenarios** with small test scripts against the real engine. Examples: voiding a bill after its goods were sold, posting a back-dated invoice, two saves colliding.
- For each finding the auditor:
  - marked it *confirmed*, *partly correct* or *refuted*,
  - corrected its severity,
  - added issues the panels had missed (*auditor-added*).
- Findings the auditors fully refuted were removed before this meeting; none remain in the results.
- Result: **184 findings** (120 confirmed, 26 partly correct and corrected, 38 auditor-added). Merging duplicates across panels leaves **about 110 unique issues**.

---

## Key findings by area

*How to read these tables.* "Also" lists the IDs of duplicate findings from other panels that were merged into one row. Three panels each used the IDs MISS-01, MISS-02 and so on for their auditor-added items, so those are renamed here:

- Supply chain MISS-0n becomes **SUPP-Mn**
- UX MISS-0n becomes **UX-Mn**
- Builder MISS-0n becomes **BUIL-Mn**

### 1. Security, platform and data safety

**Strengths**
- RLS is on, and the helper functions are hardened.
- Saves check a version number so an old copy cannot silently overwrite a newer one.
- There is no dangerous code that runs typed text as programme code.
- Only 8 runtime libraries are used, with 0 known vulnerabilities.
- Every action either completes fully or changes nothing.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| SECU-01 | Critical | Any member can rewrite the whole company (users, roles, posted invoices, journal, stock, audit log), because the database accepts any change to the single company data file from any member. *Also: ACCO-01, SUPP-M6, BUIL-M1* | Interim: a database check that blocks non-admins from changing setup, roles and users, and blocks anyone from changing existing ledger rows. Real fix: the browser stops writing data directly; it sends commands ("post invoice") to server functions that run the existing engine and check the role from the server's membership table. | Interim S / Full XL |
| SECU-02 | Critical | A normal member can make a second account the database admin by editing the "created by" field, then evict the owner. | Database check that makes `created_by` and `id` unchangeable. Create workspaces only through a server function. Remove the creator loophole. Add an explicit owner role. Add an automated test of this exact attack. | S |
| SECU-04 | Critical | When two saves collide, one user's work (including posted invoices and payments) is silently thrown away, and the invoice number is reused. *Also: ACCO-02, SUPP-06, SALE-01, STRA-04, SALE-M5* | Now: queue each action and replay it on the fresh copy after a collision. Show a blocking dialog if an action no longer applies. Disable Print until the save is confirmed. Stop needless background saves. Send only the fields the user actually changed. Later: per-record server saves plus live updates (Realtime). | M now / XL later |
| SECU-03 | Critical | Role "view" limits are cosmetic. Every member downloads every record, cost, margin and journal line. Record pages, related lists, the Stock page and the forecast ignore view rights. *Also: ACCO-M3, UX-M3, BUIL-M4* | Now: add the view checks to RecordPage, related lists, Inventory and the dashboard forecast, plus a "See costs & margins" right. Later: the server filters what each role receives. | S now / XL later |
| SECU-06 | High | The audit trail can be edited, keeps only the last 500 events, takes its time from the user's own device clock, and admin "Switch user" records actions as the other person. *Also: ACCO-14, SALE-02, SALE-M4* | Now: make "View as" read-only. Later: a server-side, append-only, uncapped audit table storing the real actor, "acting as" and server time, plus an Audit screen. | S + M |
| SECU-07 | High | Maker-checker approvals can be bypassed by approvers and admins. An approval is not tied to the amount. One finance role can create a supplier, post its bill and pay it. *Also: ACCO-15, BUIL-11, SUPP-20* | Tie each approval to a fingerprint of the document content. The maker can never be the checker. Admin override needs a reason and is logged. Add approvals for payments and voids, multi-step approvals, and a segregation-of-duties warning in the health check. | M–L |
| SECU-08 | High | No backups or version history. Deleting the owner's login deletes the company. A malformed save crashes every user. Any member can freeze saving by setting the version counter. *Also: SECU-M3* | Stop deletion from cascading to the company. Keep a history of every version for 30 days. The server sets the version number itself. Validate the data's shape. Add owner "Download full backup" and "Restore to…". Enable point-in-time recovery and publish recovery targets. | M |
| SECU-11 | High | Login is basic: no forgotten-password flow, no two-factor login, the password rule is checked in the browser only, the error message reveals whether an account exists, and confirmation e-mails rely on a rate-limited test mail service. *Also: STRA-16 (invites)* | Password reset and change. Server password policy. Two-factor login required for owner and finance. Idle lock. Generic messages. Proper e-mail service with domain signing. Captcha. Real invitation e-mails. | M |
| SECU-05 | Medium | The save pipeline can die permanently, and then Sign out does nothing on shared PCs. | Make the save chain recover from errors. Always complete sign-out. Detect "access removed" separately from a save collision. | S |
| SECU-09 | Medium | Membership is a bare e-mail with no token or expiry, and safety depends on a dashboard setting the code never checks. A person in two companies can only ever open one. *Also: SECU-M4* | Invitations table with token and expiry, accepted only by a confirmed user. Pending invites list. Company switcher. Accept/decline invitations. | M |
| SECU-10 | Medium | No security headers. The app can be framed inside another site. Fonts load from a third party. | Add the security headers (CSP, HSTS, framing ban, etc.). Self-host the fonts. Shorten session-token life. | S |
| SECU-12 | Medium | Unlimited workspaces, unlimited data size, imports of any size. | Limits on workspace creation, a size cap, import caps with a progress bar. | M |
| SECU-13 | Medium | The one-file, all-in-browser design slows sharply past a few thousand records (lookups scan every record, lists have no paging). *Also: SALE-16, UX-18* | Short term: a fast record index and virtualised lists. Target: normalised tables with server-side paging and search. | S + XL |
| SECU-14 | Medium | Tax-invoice numbering is controlled by the browser and can be reset or duplicated. Admins can change or empty the number prefix after posting. *Also: ACCO-M4* | Now: lock the prefix after the first posting; it must be unique and non-empty. Later: server sequence and a database rule that numbers are unique. | S + M |
| SECU-16 | Medium | Three different meanings of "admin" disagree, and nothing protects the last owner. | One source of truth in the membership table. Exactly one owner. Transfer of ownership with re-login. | S |
| SECU-18 | Medium | Only the engine is tested; the compiler's strict checking is off; there is no automatic test run on each change. | Automatic test runs on each change (type-check, lint, coverage, database permission tests, multi-user browser journeys). Turn strict mode on. | M |
| SECU-M5 | Low | Any load error, even a network blip, silently signs the user out. | Sign out only on real login errors. Show a "Can't reach Bonyan — Retry" screen for network problems. | S |
| SECU-15 | Low | CSV export can carry spreadsheet formula injection. | Neutralise cells that start with = + - @. Offer a native Excel export. | S |
| SECU-19 | Low | A few engine actions skip permission checks. A notification's "read" flag is shared by everyone. *Also: SALE-13, NOTIF-01* | Add the checks. Store "read" per user. Send automation failures to admins only. | S |
| SECU-21 | Low | `.env` is committed to the repository; a future secret key could leak. | Rename it to `.env.example`, ignore `.env`, turn on GitHub secret scanning. | S |

### 2. Accounting, finance and tax

**Strengths**
- Every posting passes one balancing gate.
- Invoice numbers are gapless and taken only after every check passes.
- Posted documents are locked in the engine, and voiding writes a full reversal.
- Payments are capped at the balance due.
- Currency locks after the first posting.
- VAT is stored per line.
- AR/AP ageing is provided in standard age buckets.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| SECU-20 | Critical | Sample data is on by default and posts fake bills, invoices, payments and demo users into the **real** ledger. It uses up invoice numbers (the first real invoice becomes INV-0013), and the promised "remove from Settings" button does not exist. *Also: ACCO-M1, SUPP-M1, UX-09 (sample part), STRA-03* | Now: default off. Fix the misleading text. Tag every seeded item and add "Remove sample data", allowed only before the first real posting. Later: a separate "Demo company" workspace. | M |
| ACCO-03 | Critical | The inventory account drifts away from actual stock in five reproduced cases: voiding a bill after its goods were sold (stock goes negative); average cost going negative; selling into negative stock; switching stock tracking off; rounding. *Also: SUPP-01, SUPP-M2, SUPP-04, SUPP-05, SUPP-17* | Now: block a bill void unless all its quantity is still on hand. Refuse negative journal lines. Re-average cost on every incoming movement. Lock "track stock" once a product has movements. Later: value each product by quantity and total value with 4–6 decimals, correct negative stock automatically on the next receipt, and add a daily check that the inventory account equals stock value. | S now / L |
| ACCO-05 | Critical | No credit notes, returns, refunds or payment reversal, so a paid or part-paid document can never be corrected. *Also: SUPP-03* | Add "Reverse payment" first (bounced cheques, mistakes). Then credit and debit notes linked to the original document, allowing partial quantities, returning stock at original cost and reversing VAT. | S–M + L |
| ACCO-07 | Critical | Hard-coded 9-account chart with no equity accounts. No manual journals, opening balances, or stock adjustments and counts, so no real company can migrate in or record rent, salaries or VAT paid. *Also: SUPP-02, BUIL-13 (opening part), STRA-15 (balances part)* | Make the chart of accounts data, seeded per template (aligned to IFRS / Egyptian standards), with protected system accounts. Add a manual journal document with approval. Add an opening-balance wizard (customers, suppliers, stock, banks). Add stock adjustment and count documents. | XL |
| ACCO-10 | Critical (Egypt) | ETA e-invoice and e-receipt are missing: no item codes, unit codes, tax types, UUID, signature or submission. Bonyan invoices are not legal e-invoices. *Also: STRA-01* | "Egypt e-invoicing" setup. Required ETA fields on customers, products and lines. A server connector that formats, signs (via the company's USB token / signing bridge), submits and polls status. Show the ETA status, UUID and QR code on the print. Health check blocks posting when ETA data is missing. | XL |
| SECU-M1 | High | "Set field" automations can change posted invoices and bills (customer, date, due date) without history, skipping the lock. Needs an admin to set it up, but it breaks the main promise. *Also: ACCO-04, SUPP-M3, BUIL-02, AUTO-03* | Skip "set field" on non-draft documents and log the skip. Route all automation writes through the normal update path with history. Health-check error for system-field targets. | S |
| SECU-M2 | High | No period lock or year-end: any past or future date is accepted, already-filed VAT months can change, voids are always dated today, and the fiscal-year setting is ignored. *Also: ACCO-06, SUPP-18* | Lock dates (all users / accountant), a "Close month" wizard, a cap on future-dating, check stock availability as of the document date, number documents by fiscal year, year-end close to retained earnings. | M–L |
| ACCO-08 | High | No P&L, balance sheet, cash-flow statement or general-ledger drill-down. "Gross profit" subtracts operating expenses. | A Reports area with all statements by date range, comparisons, drill-down to documents, and Excel/PDF export. Gross profit uses COGS only. | L |
| ACCO-09 | High | Dashboard "revenue" includes 14% VAT and groups invoices by the day the draft was created, not the invoice date, so it disagrees with Accounting. *Also: SALE-M3, UX-M2, RPT-01* | Measure revenue before VAT, label it "Net sales (excl. VAT)", group by document date, and show a "matches the books" tick. | S |
| ACCO-11 | High | VAT is a free-typed percentage: no tax codes, exempt vs zero-rated, VAT return or settlement, and a salesperson's 0% flows from quote to invoice. | Tax-code master seeded for Egypt (14%, 0% export, exempt, out of scope, Table tax), each with accounts and return boxes. Monthly VAT return with a settlement entry. | L |
| ACCO-12 | High | No Egyptian withholding tax (1/3/5%) on payments or receipts. | WHT codes on parties, a WHT line in the payment dialog, certificates, and the quarterly Form 41 export. | M |
| ACCO-13 | High | Treasury is minimal: all payment methods go to one cash account; no banks, cheque lifecycle, advances, multi-invoice receipts or bank reconciliation; future-dated payments are allowed. *Also: STRA-13 (account part)* | Bank and cash accounts per method, receipt/payment vouchers that can cover many invoices, customer advances, a cheque register (received → deposited → cleared/bounced), bank statement import and matching. | L |
| ACCO-M2 | High | Customer "Balance due" and "Total invoiced" include unposted drafts and disagree with ageing and the ledger. *Also: BUIL-M3* | Rollups count only posted documents by default, with a filter option. Add a test that the customer balance equals the ageing total. | S |
| ACCO-20 | Medium | Drafts print as "TAX INVOICE". The printed invoice lacks addresses, a per-rate VAT summary, Arabic and the amount in words. There are no customer or supplier statements of account. *Also: UX-M6, UX-11 (print part)* | Now: watermark drafts as "Draft – not a tax invoice". Later: a bilingual statutory template and a statement of account with PDF and WhatsApp sending. | S + M |
| ACCO-22 | Medium | The "books balance" test checks only what the engine already forces. Nothing checks customer, supplier and stock records against the ledger. The green "Books balance" banner can never turn red. | A `booksHealth()` check: AR, AP and inventory vs ledger, negative stock, numbering gaps, unapplied cash. Random-sequence tests. A "Books health" card. | M |
| ACCO-16 | Medium | The credit limit is a decorative field; there are no payment terms. *Also: SUPP-M5, SALE-06 (credit part)* | System fields for credit limit and payment terms. Exposure check at posting (block or require approval). A credit bar on the customer page. | M |
| ACCO-18 | Medium | No multi-currency documents or exchange-rate accounting. *Also: SUPP-14 (currency part)* | Currency and rate on documents and payments, Central Bank daily rate table, realised and unrealised FX. | XL |
| UX-M4 | Medium | Sample data shows a bankrupt company (cash −EGP 1.5M), and a negative "VAT payable" is not relabelled as a VAT credit. | Calibrate the sample data. Switch label and colour by sign. Warn on negative asset balances. | S |
| ACCO-21 | Low | Business dates use UTC, so Cairo users get yesterday's date between 00:00 and 02:59 (and the previous year's number on 1 January). | Company time zone (default Africa/Cairo). | S |
| ACCO-19 | Low | No fixed-amount or whole-invoice discounts. The print rounds unit prices to 2 decimals. Cost is rounded too. | Discount types, 5-decimal unit values on the print, a rounding account. | M |

### 3. Inventory, warehousing, purchasing and supply chain

**Strengths**
- Stock is a ledger of movements and is never typed in.
- Posting to the accounts happens in the same step as the stock movement.
- The moving-average cost formula is correct, and supplier discounts are included in cost.
- Overselling is blocked with clear messages.
- There are early purchasing controls and reorder alerts.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| SUPP-09 | High | Purchasing is only "post a bill": no purchase order, goods receipt, three-way match or duplicate-bill check. *Also: ACCO-17, SUPP-M4 (only finance can receive stock)* | Optional purchase order → goods receipt (posts to a "received not invoiced" account) → bill with variance checks. Supplier + invoice ref must be unique. A separate "move stock" permission for storekeepers. | XL |
| SUPP-08 | High | "Track stock" shows unticked but is actually on, so a service company's first invoice fails with "Not enough stock". Switching it off later leaves value stuck in the inventory account. | Replace it with a product type (Stockable / Consumable / Service) defaulted from onboarding answers, shown truthfully, and locked after the first movement. | S |
| SUPP-07 | High | No lots, batches, serials or expiry / first-expiry-first-out picking, although the Medical template promises "batches and expiry". *Also: STRA-12 (part)* | Now: fix the tagline. Later: lot/serial tracking, expiry on receipt, first-expiry picking, block expired lots, expiry dashboard, recall report. | S + XL |
| SUPP-10 | High | Order-to-cash goes straight from quote to invoice: no sales order, reservation, delivery note or partial delivery. *Also: BUIL-18 (chain part)* | Sales order (reserves stock), delivery note (moves stock, signature print), invoice from deliveries. Show On hand / Reserved / Available. A "simple mode" keeps quote → invoice. | XL |
| SUPP-11 | High | One location only: no warehouses, bins, transfers or van stock. | Warehouse and location on movements, transfer document, per-warehouse stock, one van per sales rep. | L |
| SUPP-12 | High | No units of measure or conversions (carton of 24 vs piece). On-hand is rounded to 2 decimals, so the full bought quantity cannot be sold. *Also: ACCO-19 (precision part)* | Unit categories, conversion factors, purchase and sales units, decimal precision per unit, unit printed on documents (also needed for ETA). | L |
| SUPP-13 | High | The Manufacturing template promises production orders, but production never consumes materials or produces finished goods. *Also: STRA-12 (part)* | Now: fix the copy. Later: bills of materials and a production order that consumes components and receives finished goods through a work-in-progress account. | S + L |
| SUPP-14 | High | No landed costs (freight, customs) and no foreign-currency bills, so import costs are expensed instead of added to stock cost (IAS 2.11). | Landed-cost document that spreads costs by value, quantity or weight; import-VAT line type. | L |
| SUPP-15 | High | Inventory reporting is a snapshot plus the last 40 movements: no stock card per product, value as of a date, ABC analysis, dead stock or days of cover. | Stock card, valuation as of any date, inventory analytics dashboard, stock movements usable as a report source. | L |
| SUPP-16 | Medium | Reordering uses one threshold, fires only on invoice posting, and goes to the person who posted. | Min/max, safety stock, lead time, preferred supplier, a Replenishment screen that creates draft purchase orders, alerts to the purchasing role. | M |
| SUPP-19 | Medium | No barcode support; the line picker is a dropdown of every product. | Barcode as a system field with validation, scan-friendly search box, phone-camera scanning, label printing. | M |
| SUPP-21 | Medium | Free-text purchase lines skip stock, and a new product's first purchase price defaults to its *selling* price. | Free text only for non-stock lines; pre-fill the last purchase price or leave it empty. | S |
| SUPP-22 | Medium | No write-down of expired or damaged stock to its net realisable value. (A FIFO cost-method option is only nice-to-have.) | A write-down reason posting to a provision account, suggested from expiry and slow-moving data. | L |

### 4. Sales and CRM

**Strengths**
- Stage gates, required fields and validation rules are enforced in the engine.
- The pipeline validator works well.
- Deals that go idle are flagged ("rotting"), and leads get scores.
- Vertical templates show real domain insight (tenders, EDA, units).
- Quote → invoice is linked to real books.
- CSV import supports Arabic.
- Automations cannot loop.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| SALE-03 | High | Lead conversion always creates a new customer (duplicates), invents an EGP 1 deal when no budget is set, drops the lead source, and skips gates and automations. *Also: BUIL-08 (amount part), BUIL-18 (mapping part)* | Conversion dialog: match an existing customer, deal optional with a real amount, a field mapping screen, carry over source and campaign, links both ways, run through the normal stage move. | M |
| SALE-04 | High | Stage gates can be bypassed by skipping stages. No lost reason. One click or drag closes a deal as Won or Lost with no confirmation. Leads can be "Converted" without converting. *Also: BUIL-07, UX-M5* | Gates that accumulate across stages (with conditions), allowed transitions, a Won/Lost dialog (reason, competitor) with Undo, "Converted" only via the conversion dialog, pipelines for custom modules. | M |
| SALE-05 | High | Quotes are never numbered (they print "DRAFT"). Sent quotes are edited without revisions. Declined or expired quotes can be invoiced. Sales reps get an error on "Accept & invoice". The follow-up task starts from draft creation. *Also: ACCO-23, BUIL-M5, SALE-M1, SALE-M6* | Now: split into "Mark accepted" (sales) and "Create invoice" (finance), block declined or expired quotes. Later: number on send, revisions, link to the deal, branded bilingual PDF, online accept and e-sign, events for sent/accepted/declined. | S + L |
| SALE-06 | High | No pricing control: 100% discounts allowed, no discount approval, no price lists, selling below cost goes unwarned. | Price lists, maximum discount per role, minimum margin, a discount approval that blocks sending. | L |
| SALE-07 | High | No activity model or customer 360° view. Tasks link to records by free text. Logging a call does not reset the idle flag. | Activities linked to any record (call, meeting, WhatsApp, visit) with reminders, a combined account timeline, a "No next step" badge, idle flag based on real contact. | L |
| SALE-08 | High | No lead capture: no web forms, WhatsApp, e-mail or Facebook leads, no click-to-call, and imported leads skip automations, although "leads lost in WhatsApp" is the #1 pain in onboarding. *Also: STRA-09* | Step 1 (S): click-to-call and WhatsApp links with Egyptian number formatting. Step 2 (M): hosted lead forms with campaign tracking; imports can run automations. Step 3 (L–XL): WhatsApp Business inbox, Facebook lead ads, e-mail logging. | S → XL |
| SALE-09 | High | No duplicate detection or merge; phone numbers are not normalised. | Store phones in one international format (+20…), matching rules with warnings, update-on-import mode, a Merge action. | L |
| SALE-10 | High | No record ownership: every rep sees and edits every deal and customer, can change the owner, and can export everything. *Also: BUIL-06* | Per-role scope (All / My team / Only mine), field visibility (hide cost), a separate Export permission, owner change limited to managers. Must be enforced on the server (Phase 1). | L |
| SALE-11 | High | Forecasting is rudimentary: no period, quotas, win rate, sales velocity or forecast categories; "Pipeline by stage" includes Won and Lost. | Relative date filters, targets with attainment gauges, forecast by close month, conversion and velocity analytics, open-stages-only funnel. | L |
| SALE-20 | High | Real estate: the same unit can be reserved twice; installments are not linked to billing; "Lead source ROI" has no cost data. *Also: STRA-12 (part)* | Exclusive reservations, automatic unit status, an installment schedule linked to invoices and ageing, a Campaigns module with costs. | M |
| SALE-14 | Medium | Global search matches record titles only; it cannot find a caller by phone number. *Also: UX-19* | Search phone (last 9–10 digits), e-mail, number, SKU and tax ID with Arabic letter normalisation; Ctrl/Cmd-K palette. | S–M |
| SALE-17 | Medium | Lead score is hidden from reports and automations; thresholds are hard-coded. | Make the score usable everywhere, configurable thresholds, activity-based points and decay. | M |
| SALE-18 | Medium | Deals and quotes have no contacts; a contact belongs to one account only. | Primary contact on deals and quotes ("Attention" on the PDF), deal contacts with roles, multi-relation field type. | M |
| SALE-19 | Medium | Tickets have no response-time targets (SLA), channel, requester or warranty link, and no satisfaction survey. | SLA policies with countdowns, warranty from invoice plus serial, satisfaction survey on resolve. | L |
| SALE-21 | Medium | List views are basic: saved views are personal only, no field filters, column chooser or bulk actions. | Filter bar, column chooser, team-shared views, bulk assign / stage / export with audit. | M |

### 5. UX, UI, visual design, dashboards and reporting

**Strengths**
- Design tokens and layout rules are ready for right-to-left Arabic.
- The health check jumps to the exact problem.
- The template suggestion explains its reasons.
- The report designer is beginner-friendly.
- Stage path and kanban columns show totals.
- Sample-data dashboards are populated on first run.
- CSV export opens correctly in Excel with Arabic.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| UX-01 | Critical | Arabic exists only on the landing page. Switching to Arabic mirrors the layout but leaves every screen, error, label, chart, date and the printed invoice in English, which looks broken. *Also: SALE-22, STRA-02* | Now: hide the in-app Arabic switch. Then a full translation system: Arabic and English labels in the setup, translated engine and validator messages, Arabic number and date formatting, bilingual print, and an automatic check that blocks untranslated text. | S + XL |
| I18N-01 | High | Arabic digits typed in imports become 0 without any error. Phones typed in Arabic digits are rejected. Arabic field names get meaningless keys. | Convert Arabic-Indic digits and separators to standard digits everywhere; show an error instead of 0; readable keys for Arabic labels. | S |
| UX-M1 | High | After editing and saving a draft, "Post" stays disabled with "Save first", because the form never refreshes after a save. | Reload the form from the saved record; compare only editable fields; add "Save & post". | S |
| UX-09 | High | Getting started takes too long: a 2.6-second fake "designing" animation, then a 7-tab builder before the user sees anything working. (The sample-data part is under SECU-20.) | "Start using it now" as the main action, a setup checklist inside the app, remove the fake animation. | M |
| UX-02 | High | Dashboards have no time: no date range, comparison or targets, and the KPI "sparkline" is a fixed decorative wave. *Also: STRA-07 (dates part)* | Global period picker (This month / Quarter / Fiscal YTD / Custom), compare to previous period, targets, real 12-point sparklines; delete the fake wave. | L |
| UX-03 | High | The owner's key numbers (cash, margin, overdue receivables, stock at risk, forecast vs target) are missing from the home screen or hidden on finance-only pages. | An "Owner cockpit" set of tiles computed by the engine, also usable in the report builder. | M |
| UX-04 | High | Misleading default charts: Lost shown as the widest funnel bar, months with no sales dropped, "May 26" labels, stretched axes, ticks like "0.8" on counts, same colour for different slices, EGP 0 rows. | Open stages only in the funnel, fill empty months, "May 2026", true pixel width, clean whole-number ticks, a tested colour palette, top 7 + "Other". | M |
| UX-05 | High | Charts cannot be clicked through to the records behind them, and lists cannot be opened with filters from a link. | Every bar, slice and KPI opens the filtered list; filters stored in the web address; dashboard filter chips (owner, governorate, product). | M |
| UX-06 | High | Keyboard and screen-reader access fails the WCAG 2.2 AA accessibility standard (rows, sorting, kanban, dialogs, toasts, charts). | Proper links and buttons, keyboard moves on the kanban, one accessible dialog component, live announcements, skip link, focus ring, automated accessibility checks. | L |
| UX-08 | High | Does not work on a phone: a 20-link scrolling strip, a 3-row top bar, invoices 802px wide, calendar events hidden, board cards cannot scroll. The mobile landing page hides Sign in. *Also: SALE-15, STRA-19* | Mobile shell with a bottom tab bar, stacked line editor, touch-friendly board, agenda calendar, installable app with offline capture, GPS "check in" for field visits. | L |
| UX-10 | High | Daily entry needs too many clicks: plain dropdowns of every record, no create-on-the-fly, Save then Post, no bulk or inline edit, no shortcuts, browser pop-up prompts. | Type-ahead pickers (with Arabic normalisation, recent items, last price, stock on hand), "Save & post", unsaved-changes guard, bulk actions, inline edit, Ctrl-K, in-app dialogs with Undo. | L |
| UX-07 | Medium | Colour contrast fails on Post / Pay / Convert buttons, KPI numbers and status pills (2.1–3.8:1). | Checked colour pairs (green #047857, amber #B45309), KPI numbers in text colour, contrast check on user-chosen colours. | S |
| UX-11 | Medium | Posted documents look like editable forms; Delete shows on paid invoices; statuses are raw lowercase English; dates are in mixed formats. | Read-only "paper" view with a status ribbon and payment timeline, a ⋯ menu, translated status labels, one date format. | M |
| UX-12 | Medium | Everyone gets the same flat 13-card home screen, whatever their role. | Role presets (Owner, Sales rep, Finance, Warehouse), a "me" filter, a Today strip, grouped activity feed. | M |
| UX-13 | Medium | No monitors, alerts, scheduled reports, dashboard export or TV mode. | Threshold alerts per widget (bell / e-mail / WhatsApp), weekly "Business pulse", PDF/Excel export, full-screen TV mode. | L |
| UX-14 | Medium | Only 7 chart types, one group-by and one measure; monthly grouping only; no ratios. | Split-by series, multiple measures, calculated ratios, week/quarter/year grouping, stacked, combo, gauge, heatmap, pivot, governorate map. | XL |
| UX-15 | Medium | Errors are a 6-second toast; there is no crash-recovery screen; loading and empty states are bare text. | Error shown under the field that failed, crash screen with "Report problem", skeleton loaders, a sync status pop-up with "Retry", helpful empty states. | M |
| UX-16 | Medium | Generic gradient look with no design system, no dark mode, no reduced-motion support, many one-off colours. | A design-system sprint (see "Design direction" below). | M |
| UX-17 | Medium | Builder tabs are cut off at 1440px; report fields can only be dragged; the dashboard layout is a list, not a canvas; deleting has no Undo. | "More" menu for tabs, drag-and-resize dashboard canvas, click-to-add, Undo/Redo. | M |

### 6. No-code builder, workflows and automation

**Strengths**
- All 63 template-and-answer combinations tested produce valid systems.
- Deletes know what depends on them.
- Module roles protect core system fields.
- The formula language is safe and catches circular formulas.
- Pipelines are validated and publishing is blocked while errors remain.
- Approvals expire when the record changes.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| SECU-17 | High | Date-based automations run only in whoever's browser opens the app first, as that user and bypassing permissions. A run is marked done before it executes, failures are never retried, and collection tasks go to a random user. *Also: STRA-10 (scheduling), AUTO-01* | A server scheduler (every 15 min) running as an "Automation" identity, protection against double runs, record a run only on success, re-arm when dates change, "Assign to" option, a Runs monitor. | M |
| BUIL-04 | High | Trigger rules are unreliable: "updated" fires on every save (duplicate tasks); conditions on lookup or rollup fields never match; no "field changed" trigger and no "N days before" timing. *Also: SALE-12, SALE-M2, AUTO-02* | Now (S): pass the full company data to the condition check. Then: "field changes from → to", "becomes true", "N days before/after", repeat every N days, run once per record. | S + M |
| BUIL-05 | High | Only 3 automation actions; no choice of recipient; cannot update linked records; no e-mail, WhatsApp, webhooks or waits; no test run. *Also: STRA-10 (actions)* | Update linked record, create record with mapping, notify user/role/owner, e-mail, WhatsApp template, signed webhook, wait N days, chaining up to depth 3, "Test on a record" dry run. | L |
| BUIL-M2 | High | Payments, voids, lead conversion and quote status changes never trigger automations, so rules like "invoice paid → …" pass the health check and never run. *Also: SALE-M6* | Engine lifecycle events (posted, paid, voided, quote sent/accepted/declined, lead converted) exposed as triggers. | M |
| BUIL-01 | High | Re-running onboarding or restoring an old version silently replaces the live setup. Stage and role IDs change, so records drop off boards and users are locked out. Publish never checks live data. | Health check that knows the data (records in deleted stages, users without a role, newly required fields), block re-onboarding after go-live (offer "Add a pack" instead), a Publish-impact dialog with migration steps. | L |
| BUIL-03 | High | Changing required, unique, gates or stage type while data exists is unguarded, so old records become uneditable with misleading errors. | Impact shown before toggling ("214 empty — fill default / only new records"), check gates only on stage change, lock stage type when records exist, never reuse deleted field keys. | M |
| BUIL-08 | High | Adding a required field to Tasks or Customers silently breaks automations and lead conversion. | Validator error plus field default values; conversion mapping (see SALE-03). | M |
| BUIL-12 | High | No sandbox, Undo, change comparison or authored change log; builder edits share the live data file. | Separate draft storage, Undo/Redo, "Changes since v12" with author and note, unlimited history, a test-mode sandbox copy. | L |
| BUIL-13 | High | Go-live tools are missing: import cannot set stages, Excel files are not accepted, no import presets from other systems, no setup export/import. (Opening balances are under ACCO-07.) *Also: STRA-15* | Stage mapping on import, Excel files and Arabic headers, presets for Daftra / Odoo / Zoho / QuickBooks exports, AI-assisted column mapping, setup export/import, "Save as my template" for partners. | L |
| BUIL-09 | Medium | Formulas compute wrong values silently (order-dependent chains, rollup references give 0, divide-by-zero gives 0, no recalculation when a formula changes). | Evaluate in dependency order, show "—" with a warning, add IF / ROUND / MIN / MAX / DAYS / TODAY, offer "Recalculate N records". | M |
| BUIL-10 | Medium | Validation rules offer fields the validator then rejects, cannot compare two fields, and allow AND only. | Fix the field picker, "field vs field" comparisons, ANY/ALL groups. | M |
| BUIL-14 | Medium | Onboarding asks questions it ignores (sales cycle, size, some channels) and never asks country, currency or VAT. *Also: STRA-18 (part)* | A "Country & tax" step; use every answer or drop the question; show "Added because you said…". | M |
| BUIL-15 | Medium | Validator blind spots: filter values that no longer exist, notify roles, set-field value types, a 14-field limit in the gate picker, 0 treated as empty. | Extend the checks and add tests. | S |
| BUIL-16 | Medium | No form layout, document or e-mail template designer; "sections" are unused code; fiscal-year setting does nothing. | Form sections and tabs, a block-based bilingual document designer, message templates, wire the fiscal year into reports. | L |

### 7. Strategy, competition, AI and go-to-market

**Strengths**
- The guardrail core is a genuine differentiator.
- Health-check issues are machine-readable and already link to the problem, which is a ready base for an AI "system doctor".
- Time to first value is minutes, against weeks for partner-led Odoo or Business Central projects.
- Correct double-entry books inside a CRM.
- Egypt-native defaults.

| ID | Severity | Finding | What to do | Effort |
|---|---|---|---|---|
| STRA-05 | High | No AI anywhere; the onboarding "analysis" is a timed animation. | An AI gateway on the server (see "AI & automation blueprint" below). | XL (phased) |
| BUIL-17 | High | The health check looks only at the setup and uses an arbitrary score; no diagnosis of the live system and no one-click fixes. *Also: STRA-06, STRA-20, UX-20* | Stable issue codes with "why it matters" and fixes. A `diagnose()` check over live data. One-click validated fixes. Then AI explanations in Arabic and English. | S → L |
| STRA-07 | High | Building a report needs drag-and-drop; owners want to just ask. | "Ask Bonyan": a plain-language question becomes a validated report you can pin. | M |
| STRA-12 | High | Templates promise depth the engine does not deliver (batches and expiry, raw → finished stock, installments, progress billing). | Reword the copy this week; build the depth in Phase 2B/3. | S + XL |
| STRA-13 | High | No local payment collection: InstaPay is only a label; no Fawry, Paymob or payment links. | Gateway integrations, a signed public "Pay now" invoice page, payment recorded automatically from the gateway, dunning messages with the pay link. | L |
| STRA-14 | High | No PDPL / trust layer: no privacy policy, terms or data-processing agreement, no consent fields, no export or erase of personal data, no stated hosting region. | Legal pages and consent, consent fields enforced on marketing actions, export/anonymise, hosting-region choice, a /trust page, start PDPC licensing (confirm with Egyptian counsel). | L |
| STRA-08 | Medium | No predictions (cash flow, stock-outs, anomalies). | 13-week cash forecast and days-of-cover first; anomaly alerts; predictive lead score later, using shared industry baselines. | XL |
| STRA-11 | Medium | No billing, plans, seats or trial, so nothing to sell. | Subscriptions table, Paymob/Fawry plus Stripe, seat limits enforced in the database, 14-day trial (then read-only, never deleted). | L |
| STRA-16 | Medium | Activation basics are missing: invite e-mails, setup checklist, help centre, digests. (Password reset is under SECU-11.) | Checklist card, contextual help, daily digest, onboarding e-mail sequence. | M |
| STRA-17 | Medium | The landing page presents Bonyan as a follower ("Inspired by Salesforce…"), shows no price, proof or demo, and claims "100% correct". | Outcome-led message, comparison table, "Try the demo company", pricing, Egyptian pilot quotes, replace "100%" with "balanced by design". | M |
| STRA-18 | Medium | Onboarding cannot learn from free text. | "Describe your business in your own words" → AI proposes answers and extra fields, each validated before it is offered. | M |

---

## The plan

### Overview and sequencing

Two tracks run in parallel so visible UX progress does not wait for back-end work.

| Phase | Name | Track | Starts | Rough duration | Depends on |
|---|---|---|---|---|---|
| 0 | Make it safe (launch blockers) | A + B | Now | 5–7 weeks | — |
| 1 | Foundations: the server becomes the boss | A (back end) | Week 7 | 3–4 months | Phase 0 |
| 2A | Accounting core and Egypt compliance | A | Month 3 (engine work in parallel with Phase 1) | 3–4 months | Phase 1 for server posting |
| 2B | Supply-chain depth | A | Month 6 | 4–5 months | 2A (chart of accounts, adjustments) |
| 3 | CRM and builder depth | A + B | Month 6 | ~3 months | Phase 1 (record scope, events) |
| 4 | UX, visual and dashboard overhaul | B (front end and design) | Month 2 (design system and Arabic first) | 6–8 months, in waves | Design system first; drill-down needs Phase 1 queries |
| 5 | Automation and AI "system doctor" | A | Month 6 | 3–4 months | Phase 1 (server scheduler, audit and run logs) |
| 6 | Go to market and compete | All | Legal pages early; billing from month 5 | Ongoing | Phases 0–2A for paid launch |

**Milestones**

- **M1, closed pilot (end of Phase 0, about week 7).** 3–5 friendly companies, CRM features only, no legal tax invoices.
- **M2, paid launch in Egypt (about month 7–8).** After Phase 1, Phase 2A (including ETA), full Arabic and the core design system.
- **M3, "beats global peers" release (about month 12).** After Phases 2B, 3, 4, 5 and the main parts of Phase 6.

*Team assumption behind these durations:* about 8 people:

- 3 back-end / full-stack engineers
- 2 front-end engineers
- 1 product / visual designer
- 1 QA engineer
- a part-time accountant / tax adviser to sign off accounting behaviour

A smaller team stretches the timeline roughly in proportion.

---

### Phase 0: Make it safe (launch blockers)

**Goal.** No one can take over a company. No one loses work without being told. The books cannot be polluted or quietly drift. The UI stops promising things it does not do.

**Why now.** These issues corrupt data or open the door to fraud. Every week of pilot use with them makes the clean-up worse. Most fixes are small.

**Work items**

1. **Lock the database door.**
   - SECU-02: make `created_by` and `id` unchangeable; create workspaces through a server function; remove the creator loophole.
   - SECU-16: owner role; the last owner cannot be removed.
   - SECU-08 / SECU-M3: the server sets the version; stop company deletion from cascading; version-history table; owner "Download full backup".
   - SECU-01 interim: a database check that rejects changes to setup, roles and users from non-admins, and rejects any change to existing journal, stock, payment and sequence entries.
   - SECU-09 quick part: block anonymous users; validate e-mail addresses.
   - SECU-10 headers; SECU-21 `.env`.
2. **Stop silent data loss.**
   - SECU-04 short term: replay queued actions after a collision; blocking dialog listing anything that could not be kept; Print and Send disabled until the save is confirmed; no save when nothing changed; notification-read and saved views moved out of the shared file.
   - SECU-05 save chain and sign-out; SECU-M5 load errors.
   - SALE-M5: save only changed fields.
   - UX-M1: Post enabled after Save.
3. **Keep the books right.**
   - SECU-20: sample data off by default, tagged, with "Remove sample data" before the first real posting; fix the misleading text.
   - ACCO-03 guards: block bill voids unless the stock is still on hand; reject negative journal lines; re-average on every incoming movement; lock "track stock" after movements.
   - SUPP-08: truthful default and product type.
   - SECU-M1: no automation writes on posted documents.
   - ACCO-M2: rollups count posted documents only.
   - SECU-14 / ACCO-M4: prefix locked and unique.
   - SALE-05 quick part: block declined or expired quotes; split "Mark accepted" from "Create invoice".
   - ACCO-20 quick part: draft watermark.
   - ACCO-09: net revenue by document date.
   - I18N-01: Arabic digits.
   - ACCO-21: Cairo time zone.
   - UX-M4: realistic sample company.
4. **An honest interface.**
   - SECU-03 quick part: view checks on record pages, related lists, Stock, forecast; "See costs & margins" right.
   - SECU-06 quick part: "View as" is read-only.
   - SECU-15: safe CSV.
   - STRA-12 / SUPP-07 / SUPP-13: reword template promises.
   - UX-01 stop-gap: hide the in-app Arabic switch until it is real.
   - BUIL-04 quick part (AUTO-02): conditions on lookup and rollup fields work.
5. **A safety net.**
   - SECU-18: turn on strict type checking; automatic test runs on every change; database permission tests for the attacks above; a two-browser concurrency test; engine tests for every ACCO-03 scenario.
   - SECU-11 quick part: forgotten-password flow, generic messages, proper e-mail service.

**What the owner will see**
- Nothing alarming for users.
- The "Sample data" box is unticked, and there is a "Remove sample data" button.
- A clear dialog if a colleague's save conflicts with yours.
- "Forgot password?" on the login page.
- Draft prints marked "DRAFT – not a tax invoice".
- The dashboard revenue now matches the Accounting page.
- Salespeople no longer see costs and margins.

**Acceptance checks**
- [ ] The `created_by` takeover attack, a member rewriting someone else's role, and a member deleting journal lines are all rejected by the database (automated tests).
- [ ] Two browsers post two invoices at the same moment: both survive with different numbers, or one user gets a clear dialog. A printed number is never reassigned.
- [ ] All five ACCO-03 scenarios and the negative-cost void scenario leave the inventory account equal to stock value (tests).
- [ ] A new company that removes sample data issues INV-YYYY-0001 as its first real invoice.
- [ ] A "set field" automation on a posted invoice is skipped and logged.
- [ ] Importing "١٥٠٠" stores 1500.
- [ ] Every change runs type-check, lint, tests and database permission tests automatically.

**Rough effort:** 5–7 weeks for the full team.

---

### Phase 1: Foundations, where the server becomes the boss

**Goal.** Every business rule is enforced by the server. Each record is saved on its own instead of the whole company file. Colleagues see each other's changes live. A full, tamper-proof audit trail exists.

**Why now.** Every later feature (ETA, approvals, record security, automations, AI) needs a trusted server and data it can query. Building them on the browser-only model would mean building them twice.

**Work items**
- **SECU-01: command API.** The existing `engine.ts` runs inside server functions (post, void, pay, update record, publish setup, set member role). Each one reads the caller's role from the membership table, runs the engine and writes the result in one database transaction. The browser can no longer edit the company file directly.
- **SECU-13: normalised data model.** Separate tables for records, document lines, journal, stock movements, payments, approvals, notes and activity. Journal and stock tables accept new rows only. Server-side paging and search. A one-time migration job.
- **SECU-03 (full) and SALE-10 / BUIL-06.** The server filters what each role can read. Record scope (all / team / own). Field visibility (cost and margin). A separate Export permission, logged when used.
- **SECU-14:** server numbering sequences and a database rule that numbers are unique.
- **SECU-06:** append-only audit-events table with the real actor, "acting as" and server time; an owner Audit screen.
- **SECU-07:** approvals tied to a content fingerprint; maker is never checker; override with a reason. (Multi-step approvals come in Phase 3.)
- **SECU-09 / SECU-M4:** invitations with tokens; company switcher; accept/decline.
- **SECU-11 (full):** two-factor login for owner and finance, idle lock, captcha, session management.
- **SECU-12:** limits and quotas.
- **SECU-04 (long term):** live updates (Supabase Realtime); "Ahmed is editing"; field-level merge prompt.
- **SECU-17 (base):** server scheduler and run-log table.
- **BUIL-M1 / BUIL-12 (storage part):** setup versions in their own table, writable only by admins; the server runs the health check on publish; drafts stored apart from live data.
- **SECU-08 (full):** point-in-time recovery enabled; recovery targets documented.
- **STRA-14 (early part):** choose the hosting region; publish privacy, terms and the data-processing agreement.
- **SECU-18:** multi-user browser journeys added to the automatic tests.

**What the owner will see**
- "Post" shows a short spinner, because it now goes through the server.
- Boards update live when colleagues work.
- An "Audit" screen showing who did what and when.
- A company switcher.
- Two-factor login prompts for finance.
- Lists stay fast with tens of thousands of records.

**Acceptance checks**
- [ ] A member using direct database access cannot change any posted document, journal, stock or role (automated attack suite).
- [ ] A Sales role's download contains no costs, journals or modules it cannot view.
- [ ] 10 simulated users editing for 30 minutes lose zero changes.
- [ ] A list of 20,000 records opens in under 1 second, and typing in search responds in under 100 ms.
- [ ] Any change can be traced to a real logged-in user with server time.
- [ ] Restoring yesterday's state works on a test copy.

**Rough effort:** 3–4 months (XL).

---

### Phase 2A: Accounting core and Egypt compliance

**Goal.** Books that an auditor and the ETA would accept, and that a real company can move into.

**Why now.** These are the prerequisites for charging VAT-registered Egyptian companies. Engine rules can be written during Phase 1 because the engine is self-contained.

**Work items**
- ACCO-07: configurable chart of accounts per template, manual journals, opening-balance wizard, stock adjustments and stock counts.
- ACCO-03 (full): stock valued by quantity and total value; negative-stock correction; daily inventory check.
- ACCO-05: reverse payment, credit and debit notes, refunds.
- SECU-M2: periods, lock dates, close-month wizard, year-end close.
- ACCO-11 tax codes and VAT return; ACCO-12 withholding tax and Form 41.
- ACCO-13: bank and cash accounts, receipt/payment vouchers, cheque register, bank reconciliation.
- **ACCO-10: ETA e-invoicing.** Choose the signing approach early: the company's USB token through a small local signer, or an approved signing service. A server function on its own cannot hold the signing key.
- ACCO-08: P&L, balance sheet, cash-flow statement, general ledger, all with drill-down.
- ACCO-20: bilingual statutory invoice and statements of account.
- ACCO-16: credit limit and payment terms.
- ACCO-22: `booksHealth()` checks plus random-sequence tests.
- ACCO-19: discount types and precision.

**What the owner will see**
- A "Finance setup" step.
- Invoices showing "Submitted to ETA ✓ Valid" with a QR code.
- Credit notes and payment reversal.
- A "Close month" checklist.
- A live P&L and balance sheet.
- A green "Books health" card that can genuinely turn red, with plain explanations.

**Acceptance checks**
- [ ] An accountant signs off a test company through a full month: opening balances, sales, purchases, returns, WHT, VAT return, bank reconciliation, close.
- [ ] Customer, supplier and stock totals equal the ledger after 10,000 random post/void/pay sequences.
- [ ] ETA preprod accepts B2B invoices, credit notes and debit notes.
- [ ] Nothing can be posted into a locked period.

**Rough effort:** 3–4 months (several L/XL items in parallel).

---

### Phase 2B: Supply-chain depth

**Goal.** Distributors, pharma and medical suppliers, importers and workshops can run their operations in Bonyan.

**Work items**
- SUPP-09: purchase order → goods receipt → bill with three-way match; SUPP-M4 "move stock" permission.
- SUPP-10: sales order with reservation → delivery note → invoice from deliveries.
- SUPP-11 warehouses and transfers (including vans); SUPP-12 units of measure.
- SUPP-07 lots, serials, expiry and first-expiry picking.
- SUPP-14 landed costs; ACCO-18 multi-currency.
- SUPP-13 bills of materials and production.
- SUPP-15 stock card and inventory analytics; SUPP-16 replenishment; SUPP-19 barcode and camera scanning.
- SUPP-21, SUPP-22.
- A **"Simple mode" switch** so a small shop keeps quote → invoice and never sees purchase orders or deliveries.

**What the owner will see**
- Optional purchase-order and delivery steps.
- Stock per warehouse.
- Expiry dashboard.
- Phone scanning for receiving and counting.
- Suggested purchase orders.

**Acceptance checks**
- [ ] A pharma distributor scenario (receive lots, sell first-expiry, recall a lot, expiry write-down) runs end to end.
- [ ] An importer's landed costs reach unit cost.
- [ ] Inventory account equals stock value throughout.

**Rough effort:** 4–5 months.

---

### Phase 3: CRM and builder depth

**Goal.** A CRM that holds its own against Pipedrive, HubSpot Starter and Zoho CRM, and a builder that customers can change after go-live without risk.

**Work items**
- **Sales:**
  - SALE-08 step 1: click-to-call and WhatsApp links (first sprint), then lead forms.
  - SALE-03 conversion dialog; SALE-04 transitions, lost reasons, confirmations.
  - SALE-05 full quote lifecycle (numbering, revisions, PDF, e-sign).
  - SALE-06 pricing control; SALE-07 activities and timeline; SALE-09 duplicates and merge.
  - SALE-11 forecasts and targets; SALE-17, SALE-18, SALE-19, SALE-20, SALE-21.
- **Builder:**
  - BUIL-01 data-aware publish and impact dialog; BUIL-03 safe schema changes; BUIL-08 defaults and mapping.
  - BUIL-09 formulas; BUIL-10 rules; BUIL-15 validator checks; BUIL-16 layouts and document designer.
  - BUIL-12 Undo, diff, sandbox; BUIL-13 setup export/import and import presets; BUIL-14 onboarding questions.
  - SECU-07 (multi-step approvals).

**What the owner will see**
- Customer 360° timeline.
- "No next step" flags.
- Won/Lost reasons.
- Numbered, revisable quotes that customers accept online.
- Duplicate warnings.
- Targets and attainment.
- "Changes since v12" before publishing.
- An Undo button.

**Acceptance checks**
- [ ] The lead → deal → quote → invoice → payment chain is traceable both ways.
- [ ] No duplicate customer is created when converting a known phone number.
- [ ] Publishing a setup that would orphan records is blocked until migrated.
- [ ] A sandbox test of an automation leaves live data untouched.

**Rough effort:** about 3 months.

---

### Phase 4: UX, visual and dashboard overhaul

**Goal.** The look and feel, dashboards and reports that beat global peers, in full Arabic.

**Why now (and why parallel).** The owner calls visuals "super critical". The design system and translation framework do not depend on the server work, so they start in month 2. Dashboard drill-down and period queries land as Phase 1 delivers server queries.

**Work items, in waves**
- **Wave 1 (months 2–4):**
  - UX-16 design system and component library.
  - UX-01 translation framework, then full Arabic across all screens, messages and print.
  - UX-07 contrast; UX-06 accessibility base.
  - UX-15 states and errors; UX-11 posted-document view.
- **Wave 2 (months 4–6):**
  - UX-02 periods and comparisons; UX-03 Owner cockpit; UX-04 chart fixes; UX-05 drill-down.
  - UX-12 role dashboards; UX-10 fast data entry and Ctrl-K; SALE-14 search.
  - UX-09 "start using it now" onboarding.
- **Wave 3 (months 6–9):**
  - UX-08 mobile app and offline capture.
  - UX-14 chart catalogue and governorate map.
  - UX-13 alerts, digests, export, TV mode.
  - UX-17 dashboard canvas.

**What the owner will see**
- A branded Arabic-first app.
- A home screen with cash, overdue, margin and forecast against target, each with real trends and comparison to last period.
- Click any bar to land on the exact list.
- A Sunday WhatsApp "Business pulse".
- A TV mode for the sales floor.
- A usable phone app.

**Acceptance checks**
- [ ] 100% of the user interface is translated (automatic check).
- [ ] The accessibility scanner (axe) reports 0 serious issues; full keyboard journeys work.
- [ ] No horizontal scrolling at 390px width on any route.
- [ ] Dashboard net sales equal the revenue account for the same period.
- [ ] 5 Egyptian SME owners complete "how did we do this month vs last?" in under 30 seconds in usability tests.

**Rough effort:** 6–8 months in waves (L/XL).

---

### Phase 5: Automation and the AI "system doctor"

**Goal.** Automations that run reliably and can be seen running, and an assistant that explains and fixes problems in the user's own system.

**Why after Phase 1.** It needs the server scheduler, run logs, audit events and queryable data.

**Work items**
- SECU-17 full scheduler and Runs monitor.
- BUIL-04 trigger rules; BUIL-05 action catalogue; BUIL-M2 lifecycle events.
- BUIL-17 deterministic doctor (issue codes, data checks, one-click fixes).
- STRA-05 AI gateway.
- BUIL-17 AI explanations; STRA-07 "Ask Bonyan"; insights rail (UX-20).
- STRA-08 cash forecast, days of cover, anomaly alerts.
- SALE-08 step 3: WhatsApp Business inbox and AI reply drafting.
- STRA-18 AI onboarding from free text.

**What the owner will see**
- An "Automations → Runs" tab showing what ran, on which record, and why anything failed.
- A "System doctor" page with problems explained in Arabic and a "Fix" button.
- An "Ask Bonyan" box.
- A 13-week cash forecast with warnings.

**Acceptance checks**
- [ ] Overdue-invoice reminders fire over a weekend when nobody logs in.
- [ ] Every AI-proposed change passes the health check before it can be applied, and is logged.
- [ ] The doctor finds each problem planted in a test company (failing automation, orphan tasks, books mismatch, duplicate customers).

**Rough effort:** 3–4 months.

---

### Phase 6: Go to market and compete

**Goal.** Something to sell, a reason to trust it, and a smooth path in from Excel, Daftra or Odoo.

**Work items**
- STRA-11 plans, billing, trials.
- STRA-13 Paymob / Fawry / InstaPay payment links.
- STRA-14 full PDPL compliance (consent, export/erase, DPO, licensing) and a /trust page.
- STRA-16 activation (checklist, help centre, lifecycle e-mails).
- STRA-17 landing page rewrite with "Try the demo company".
- BUIL-13 migration presets.
- An independent penetration test before paid launch, with a published security page.
- Arabic support desk.

**What the owner will see**
- Pricing page.
- Online signup with a trial.
- "Pay now" links on invoices.
- Trust centre.
- Migration wizard.

**Acceptance checks**
- [ ] A new company can sign up, pay, import from Excel, issue an ETA invoice and collect it online without contacting support.
- [ ] Penetration-test findings rated high or above are fixed.
- [ ] Legal review of PDPL obligations is complete.

**Rough effort:** ongoing. Legal pages are S and can ship in Phase 1; billing and payments are L from month 5.

---

## Design direction

**Concept: "بنيان = structure".**
- Express it with a subtle grid-and-brick motif.
- Use calm confidence, not a generic gradient. Keep the gradient only for marketing hero moments.

**Brand and tokens**
- **Colour:**
  - Deep ink-teal primary (about `#0F4C5C`) and a warm sandstone accent (about `#E2A64B`).
  - Semantic colours from checked pairs: success `#047857`, warning text `#B45309`, muted text `#5B6474`.
  - Tonal scales (50–900) are generated for every semantic colour and every user-chosen stage colour, so any text stays at or above 4.5:1 contrast.
- **Type:**
  - IBM Plex Sans Arabic + Inter (or keep Cairo for Arabic with matched letter heights), self-hosted.
  - An 8-step type scale; tabular numbers in all money and number cells.
- **Shape and space:** 3 corner radii (6 / 10 / 16 px), 4px spacing grid, defined shadow levels.
- **Themes:** light and dark. Respect the "reduce motion" setting: no endlessly floating or spinning decorations.
- **Components:** one documented library (Button, Pill, Card, KPI tile, Dialog, Combobox / record picker, DataTable, Toast, Popover). A lint rule bans one-off colours.

**Arabic first**
- Every screen, message, chart label and printed document is in Arabic and English.
- Dates are formatted in Arabic ("١٨ أكتوبر ٢٠٢٦"), with an option for Arabic-Indic digits.
- Mixed text such as `INV-2026-0001` is handled correctly inside Arabic sentences.
- Mirrored icons, stage-path arrows and charts.

**Information architecture**

*Owner cockpit (home screen):*
- **Top row:** Cash & bank (30-day trend), Receivables split current/overdue (click → overdue list), Payables due in 7 days, Gross margin % this month vs last, Weighted forecast vs target.
- **Second row:** 6-month cash-in/cash-out bars, top 5 overdue customers, stock at risk (days of cover), pipeline coverage.
- **Right-hand insights rail:** short sentences about what changed.

*Role presets:*

| Role | What they see first |
|---|---|
| Sales rep | My pipeline, my target, today's follow-ups, deals going cold |
| Finance | Documents to post or approve, VAT due, ageing, bank to reconcile |
| Warehouse | Reorder list, incoming purchase orders, today's deliveries, expiring lots |

Admins can rearrange any preset on a drag-and-resize 12-column canvas. A **Today strip** (overdue, due today, approvals waiting) with one-click actions sits on every role home.

**Charts that tell the truth**
- Every widget follows one global period picker with a compare toggle.
- Real sparklines, deltas (▲/▼ coloured by whether up is good) and target bars.
- Empty months are shown as zero; months are labelled "May 2026".
- Clean, whole-number tick marks.
- Charts are drawn at their true width.
- A tested categorical palette; anything beyond the top 7 is grouped into "Other".
- Every mark can be clicked or reached by keyboard and opens the filtered list.
- "View as table" for accessibility.
- **New visuals:** stacked and combo bars, bullet/target, gauge, heatmap (weekday × hour), pivot with subtotals, an Egypt governorate map, ABC/XYZ stock heatmap, expiry-risk timeline in money.

**Daily work, fast**
- Ctrl/Cmd-K palette for search, go-to and "New invoice".
- Type-ahead record pickers with "Create '…'".
- "Save & post".
- Inline list edits and bulk actions with Undo.
- Posted documents shown as a paper-style read-only view with a status ribbon and payment timeline.

**Phone**
- Top bar: logo, search, bell, avatar menu.
- Bottom tabs: Home, Pipeline, + Quick add, Tasks, More.
- Stacked line editor with a sticky total.
- Agenda calendar.
- "Check in" with GPS and photo on visits.
- Offline outbox.

**Monitors and outreach**
- Threshold alerts by bell, e-mail or WhatsApp.
- A weekly "Business pulse" digest.
- Full-screen TV mode that refreshes itself.
- Dashboard export to bilingual PDF and Excel.

---

## AI and automation blueprint

### What to build (in order)

| # | Feature | Uses this data | Value |
|---|---|---|---|
| 1 | **Reliable automations**: server scheduler; triggers for create / update / field change / N days before or after / lifecycle events (posted, paid, voided, quote sent/accepted/declined, lead converted); actions: task, set field, update linked record, create record, notify user/role/owner, e-mail, WhatsApp template, webhook, wait; Runs log and "Test on a record" | Records, run log | Collections and follow-ups happen even when nobody logs in |
| 2 | **Deterministic system doctor**: setup checks plus live data checks (records breaking current rules, orphan owners, failing automations, books-health invariants, negative stock, duplicates, numbering gaps, stale approvals), each with a code, "why it matters" and a one-click fix | Setup, records, run log, audit, ledger | Owner fixes problems without a consultant |
| 3 | **AI explanations of the doctor**: root cause across several issues, in plain Arabic or English, with ranked fixes | Issue list, setup, summary counts (no raw customer lists) | Turns "73%" into a clear to-do list |
| 4 | **Ask Bonyan**: plain-language question becomes a validated report you can pin | Setup only (fields, stages); the report runs locally | No-drag reporting in Arabic |
| 5 | **Insights rail and weekly pulse**: period changes, concentration ("3 customers = 70% of overdue"), stale pipeline, written up by AI | Report results | Owners act without opening reports |
| 6 | **Communication help**: draft WhatsApp/e-mail follow-ups, summarise chats and voice notes into the record (Egyptian dialect) | The record and its timeline (opt-in) | Faster replies, nothing lost |
| 7 | **Forecasts**: 13-week cash forecast (open receivables by due date × each customer's history of paying late), days of cover and reorder suggestions, anomaly alerts (sales, discounts, margins, voids per user); predictive lead score once there is enough data, using shared industry baselines | Ledger, payments, stock movements, deal stage history | "Cash dips below zero in week 6 unless Delta Foods pays" |
| 8 | **AI onboarding and migration**: free-text business description becomes proposed answers plus extra fields and modules; messy Excel headers mapped to fields | Text and headers the user typed or uploaded | 10-minute tailored setup and import |

### Architecture

```mermaid
flowchart LR
  UI[Bonyan app<br/>browser / phone] -->|commands| CMD[Server command API<br/>engine.ts in Edge Functions / RPC]
  CMD --> DB[(Postgres tables<br/>records, ledger, stock,<br/>audit_events, workflow_runs)]
  CRON[pg_cron scheduler] --> AUTO[Automation runner<br/>service identity, idempotency keys]
  AUTO --> CMD
  AUTO --> MSG[E-mail / WhatsApp /<br/>webhooks / payment links]
  DB --> DOC[System doctor<br/>validate + diagnose + booksHealth]
  DOC --> GW[AI gateway Edge Function]
  UI -->|Ask Bonyan, explain, draft| GW
  GW -->|Claude API, schema cached,<br/>tool calls return JSON patches| LLM[(LLM)]
  GW -->|every patch re-checked by validate()| CMD
  GW --> LOG[AI audit log + usage metering]
```

**Rules for the AI layer**
- **AI never writes directly.** It proposes JSON patches or report definitions. These must pass the same health check (`validate()`) as human changes, and the user previews them as a diff before applying.
- **Data minimisation.** Send setup and aggregates by default. Send record text only for features that need it, and only if the workspace has opted in. Prefer an in-region provider and a contractual "no training on your data" statement, in line with PDPL.
- **Metered and audited.** Each workspace has a monthly AI budget per plan. Every AI action is logged (who, prompt, patch, applied or not).
- **Bilingual by design.** Answers follow the user's language. Issue codes (BUIL-17) are the shared keys for translation and for the AI.

---

## Competitive position

Expected position **after this plan** is delivered.

| Competitor | Where they win today | Bonyan after the plan | Bonyan's edge |
|---|---|---|---|
| **Odoo** (incl. Egyptian e-invoicing module) | Depth (manufacturing, warehouse, accounting), ETA, Arabic, partner network | At parity on SME accounting, stock, ETA and Arabic; lighter on manufacturing | Live in minutes instead of a partner project; guardrails stop admins breaking the system; AI doctor; simpler screens |
| **Zoho (CRM + Books / One)** | Breadth, Arabic, AI assistant (Zia), mobile apps, price | At parity on CRM, books, mobile web, AI insights | One unified system with guardrails; Egypt-native templates; WhatsApp and payment links built in |
| **HubSpot** | CRM polish, timeline, e-mail, forecasting, AI | At parity on timeline, forecasting and WhatsApp; behind on marketing automation | Real double-entry books, stock and ETA invoices inside the CRM; EGP pricing |
| **Salesforce** | Enterprise security, sharing rules, AI, ecosystem | Server-side record and field security, audit, MFA appropriate for SMEs | A fraction of the complexity and cost; built for owner-led SMEs |
| **Pipedrive** | Pipeline simplicity, mobile, activities | At parity on pipeline and activities | Quote → ETA invoice → payment → books in one place |
| **Dynamics BC / SAP Business One** | ERP depth, controls, period close | Period close, segregation of duties, approvals, purchase orders and goods receipts at SME scale | No implementation partner needed; Arabic-first; AI diagnosis |
| **Daftra / Qoyod / local tools** | Arabic-native, ETA, local price and support | At parity on Arabic, ETA, local payments | Self-build flexibility with guardrails, a real CRM, smart dashboards, AI |
| **QuickBooks / Xero** | Accounting UX, bank feeds, statements | At parity on statements, bank reconciliation, lock dates | Built-in CRM, stock, Egyptian tax and ETA |

**Positioning line:** "Your own system in 15 minutes, in Arabic, ETA-ready, and it can't break your books."

---

## Decisions needed from the owner

| # | Decision | Recommended answer |
|---|---|---|
| 1 | **Pause new features until Phases 0–1 are done?** | **Yes.** Freeze new feature work; the whole team does Phase 0 first. No real company data until Phase 0 passes. |
| 2 | **Launch scope for the first paying customers** | Pilot (M1) is CRM only. Paid launch (M2) is CRM + invoicing + basic stock + ETA. Full supply chain and AI arrive later as upgrades. |
| 3 | **First markets** | Egypt only until M2. Then KSA and UAE, which need ZATCA / FTA e-invoicing and Arabic already built. Europe later, through the PDPL/GDPR trust work. |
| 4 | **Which industries first** | **Owner's decision (24 Oct 2026): launch with a wider set of industries chosen for Egypt, not just 3.** First wave, 16 templates in order of how many SMEs Egypt has in each sector: wholesale & FMCG distribution; retail shops & e-commerce; restaurants, cafés & catering; medical & pharma distribution; clinics & medical centres; building materials & finishing; construction & contracting; real estate; manufacturing & workshops; agriculture, agri-inputs & produce export; car spare parts & service centres; agency & professional services; logistics, freight & customs clearance; tourism, travel & Hajj/Umrah; training centres & schools; water treatment & industrial projects. Each must build with zero errors and keep sample books balanced (automated tests). Deeper features for each (for example batches and expiry for pharma and food) still arrive with Phases 2B and 3. |
| 5 | **Pricing** (confirm against current competitor prices) | Free: 2 users, CRM only. Growth: about EGP 350–500 per user per month, with CRM + invoicing + stock + ETA. Pro: + AI doctor, WhatsApp API, multi-step approvals. AI usage metered above the plan allowance. 14-day full trial, then read-only; data is never deleted. |
| 6 | **ETA signing method** | Support the company's USB token through a small local signer app first, which is what most SMEs already have. Add an approved signing service as an option. |
| 7 | **Hosting region and data policy** | The closest Supabase region available to Egypt / Middle East. Publish the list of service providers that handle data. Start PDPC licensing now with Egyptian counsel. |
| 8 | **AI provider and data use** | A single gateway (Claude API recommended for Arabic quality and tool use). AI is opt-in per workspace, with a no-training clause and aggregate-only data by default. |
| 9 | **Sample data approach** | A separate "Demo company" workspace that anyone can try without signing up. Real workspaces start empty, with an import wizard. |
| 10 | **Simple vs advanced mode** | Default to Simple mode (quote → invoice, bill = receipt). Purchase orders, goods receipts, sales orders, warehouses and lots are switches that guided setup turns on when the answers call for them. |
| 11 | **Stock valuation method** | Moving average by default (compliant with IAS 2 and Egyptian Accounting Standard 2). Offer FIFO later as an option locked at setup. |
| 12 | **Mobile: installable web app or native app** | Installable web app (PWA) first, which covers offline capture and the camera. Native apps only if field-sales customers demand them after M2. |
| 13 | **Default language** | Arabic by default for Egyptian sign-ups, with English one click away, and bilingual printing always available. |
| 14 | **Budget and team** | About 8 people for about 12 months (see team assumption). Budget separately for: an independent penetration test before M2, an accountant / tax adviser retainer, PDPL legal counsel, and a designer for the brand sprint. |
| 15 | **Brand direction** | Approve the "بنيان = structure" direction (ink-teal + sandstone) for a 2-week brand sprint, or name an alternative now so Wave 1 is not delayed. |

---

## Appendix: refuted and corrected claims

Findings that auditors fully refuted were removed before this meeting and none remain in the panel results. The claims below were **partly overturned or corrected** during verification and are acted on only in their corrected form.

**Security and platform**

| ID | Original claim | Correction |
|---|---|---|
| SECU-09 | "Anyone can claim a pending invite by registering first." | Not true while "Confirm email" is on, because the attacker would need the invitee's mailbox. The real risk is that safety depends on a dashboard setting the code never checks. |
| SECU-10 | — | Void is protected by a confirmation dialog, which limits clickjacking. Storing login tokens in the browser is normal for this type of app. Rated medium, not high. |
| SECU-05 | Rated high. | The triggers are narrow, so lowered to medium. |
| SECU-15 | — | Modern Excel blocks most formula payloads by default, so rated low. |
| SECU-19 | "Quote-to-invoice and lead conversion skip permission checks." | They do check "create". Only the "edit" check on the source record is missing. |

**Accounting**

| ID | Original claim | Correction |
|---|---|---|
| ACCO-04 | Posted invoices can be changed by any user via automations. | Requires an admin to set up the automation; it is not a bypass open to normal users. (Kept at high in the merged SECU-M1 because it breaks the immutability promise.) |
| ACCO-09 | "Sample data lands in the wrong month." | Refuted: sample dates are backdated correctly. The real issue is invoices keyed in late, and VAT included in revenue. |
| ACCO-10 | "Tax ID exists only in the Core template." | It is on every template's customers (as a plain, deletable field) and on suppliers. |
| ACCO-15 | — | The UI does tell admins "You can do it yourself". The default finance user cannot self-approve large bills. |
| ACCO-19 | "Prices with 3–4 decimals cannot be invoiced." | Unit prices are stored as typed. Only the print rounds them to 2 decimals. |

**Supply chain**

| ID | Original claim | Correction |
|---|---|---|
| SUPP-04 | Rated critical. | Downgraded to high: "allow negative stock" is admin-only, off by default and labelled "not recommended". |
| SUPP-08 | "Templates have no Purchases module." | Only true when the business sells services only; default answers do add Purchases. |
| SUPP-13 | — | "Raw vs finished stock" exists as an item-type classification; only the transformation is missing. |
| SUPP-20 | — | Correction makes it worse: the default large-purchase approval is created only if a manager-like role exists. |
| SUPP-22 | "FIFO is needed for expiring goods." | Not correct. First-expiry-first-out is a picking rule tied to lots. Moving average is fully compliant. |

**Sales**

| ID | Original claim | Correction |
|---|---|---|
| SALE-05 | — | The screen does lock an invoiced quote's header and lines; only the engine would allow the edit. |
| SALE-12 | "Two simultaneous app openings create duplicate tasks." | Cannot persist, because the version check keeps only one save. |

**UX**

| ID | Original claim | Correction |
|---|---|---|
| UX-01 | 26 translation keys; no Arabic anywhere in the app. | 23 keys, not 26. Template names and challenge labels already show in Arabic. Some cited line numbers were wrong. |
| UX-03 | — | A Receivables KPI and a "Who owes us" chart do exist; overdue vs current and cash cannot be built. |
| UX-06 | "No visible focus." | Inputs do have a focus ring, but it is too faint (1.27:1 contrast). |
| UX-08 | "Mobile users cannot sign in at all." | They can, via the /register page link; it is a discoverability problem. |
| UX-11 | 6 header actions; ETA QR mandatory on all invoices. | Maximum header actions is 5. The ETA QR code is mandatory on B2C e-receipts; B2B e-invoices instead need ETA submission and the UUID. |
| UX-18 | "Sidebar counts are slow." | They are cheap. The real hotspots are list sorting and related-record scans. |

**Builder**

| ID | Original claim | Correction |
|---|---|---|
| BUIL-01 | Re-onboarding is one click in the live system. | Not one click (needs a typed URL or a restore with confirmation). Module IDs stay stable; only stage and role IDs break. |
| BUIL-12 | "An hour of builder work can be lost." | Saves happen 600 ms after each edit, so a collision loses seconds, not an hour. |
| BUIL-14 | Channel answers are ignored. | WhatsApp, Facebook, website, tenders and field channels are used; only exhibitions, walk-in, phone and referral are ignored. |
| BUIL-15 | Orphan user roles. | Cannot arise through the Access tab, which blocks deleting a role that has members; only through schema replacement (BUIL-01). |
| BUIL-18 | — | Quote-to-invoice does store a link, but nothing reads or shows it. |

**Strategy**

| ID | Original claim | Correction |
|---|---|---|
| STRA-02 | Rated critical. | High: serious, but no data loss. |
| STRA-04 | Whole file saved on every keystroke, silently. | Saves happen after each action, not each keystroke, and an amber "Reloaded latest" pill does appear. It just doesn't say what was lost. |
| STRA-08 | Rated high. | Medium: not a gap against SME-tier competitors, and per-company prediction models rarely have enough data. |
| STRA-11 | Rated high. | Medium: a go-to-market prerequisite, not a product defect. |
| STRA-18 | "Challenges build nothing." | Challenges and channels do add modules and reports; only workflows ignore them. |

**General:** several findings cited the wrong line numbers (for example in `roles.ts`, `styles.css` and `Auth.tsx`). The auditors corrected these, and the underlying findings still stand.

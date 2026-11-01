# Phase H: Bring your history in (data migration)

Every company that signs up already has a past. It has customers and the people it deals with there, open deals, invoices that are still unpaid, cheques waiting to be cashed, stock on the shelves, a bank balance, and years of sales it wants to look back on. If Bonyan only works from the day it is switched on, a new company starts blind. It can't see what a customer bought last year, how old a debt is, or how this March compares with last March. Many companies won't switch at all for that reason.

This phase lets a company bring all of that in: once, carefully, with checks that prove nothing was lost or counted twice. After that it works in Bonyan as if it had always been there.

It covers every module: finance, treasury, tax, stock, CRM, documents, custom modules, people and files. It builds on what already exists:

- importing a spreadsheet into any module;
- customer and supplier opening balances;
- opening stock;
- manual journal vouchers;
- closing and locking periods.

It is listed in the review as **BUIL-13** (go-live tools), **ACCO-07** (opening balances), **SALE-09** (duplicates and update on import), **SECU-12** (import limits with progress), **SECU-13** (server-side paging) and **STRA-15** (switching from another system).

---

## 1. What a new company brings, and what Bonyan can do with it today

| Data | What the company has | Today | Gap |
|---|---|---|---|
| Customers, contacts, suppliers, products | Excel exports, usually messy | CSV import per module, one sheet at a time | No Excel files. No update of existing rows (a second import makes duplicates). Links to other records match by name only. No undo. |
| Leads and open deals | A sheet, or the old CRM's export | Import creates them | **The stage can't be set**, so every deal starts in the first stage. Owner, created date and close date can't be set. |
| Won and lost deals of past years | Old CRM | — | Nowhere to keep them, so there are no win rates and no "last year". |
| Calls, visits, meetings, notes, e-mails | Old CRM, notebooks, WhatsApp | — | No history timeline import. |
| Unpaid invoices and bills | The old accounting system's ageing report | One opening balance per customer or supplier, due on the opening date | **Ageing is wrong.** Every debt looks one day old, and the invoice numbers and due dates are lost, so collection can't be run invoice by invoice. |
| Customer advances and credits | Old system | — | No opening credit. |
| Cheques in hand and cheques issued | The cheque register (post-dated cheques are common in Egypt) | — | No opening cheque portfolio, so the cheque register starts empty and the bank figures are wrong. |
| Bank and cash balances | Bank statement, cash count | Manual journal voucher | No guided entry, and no outstanding items for the first reconciliation. |
| Every other balance (fixed assets, loans, accruals, capital, retained earnings, VAT due) | Trial balance | Manual journal voucher | No trial-balance import, and nothing proves the opening books agree with the old system. |
| Stock on hand and its cost | Stock report | Opening stock one product at a time | No bulk opening stock from a sheet. No lots or expiry yet (Phase 2B). |
| Past invoices (paid and closed) | Old system, 1–5 years | — | No sales history, so the customer page, "what did they buy", sales by product and month, and reorder suggestions are all empty. |
| Last year's figures | Old system | — | No comparatives in the profit and loss or balance sheet. |
| Withholding tax of the current quarter, VAT position | Tax files | — | Form 41 for the go-live quarter misses the months before go-live. |
| Custom module data (units, installments, contracts, visits, shipments…) | Sheets | Generic import | Same gaps as above: dates, stages, links, updates. |
| Files (contracts, IDs, POs, photos) | Folders | — | No file storage yet. |
| People who left the company | Names in the old data | — | History needs an owner even when that person has no login. |

There is also a technical limit. When a company opens Bonyan, the app loads all of its data into the browser. That is fine for a year of live work, but five years of invoice history would make the app slow. History therefore needs its own storage path (section 6).

---

## 2. The rules this phase follows

1. **One go-live date per company.** Everything before it is *history*; everything on or after it is *live*. The opening balances are dated the day before go-live.
2. **Money has one source of truth: the books.** Opening balances, and optionally the summarised figures of earlier periods, are the only entries that bring the past into the books. Past documents never post anything. They never touch the journal, stock, VAT or numbering, so nothing can be counted twice.
3. **Everything open is live; everything finished is history.** These are imported as real, working records:
   - an unpaid invoice;
   - a cheque not yet cashed;
   - an open deal;
   - an open task or ticket;
   - an installment not yet paid.

   Each of them can be collected, cashed, moved or closed in Bonyan. Anything already finished comes in read-only.
4. **Every detail ties to a total.** Each detail list must add up to its control account in the trial balance:

   | Detail list | Must equal |
   |---|---|
   | Open customer invoices | Receivables (1200) |
   | Open supplier bills | Payables (2100) |
   | Stock | Inventory (1300) |
   | Cheques in hand | 1150 / 1160 |
   | Cheques issued | 2150 |

   All differences go through *Opening balance equity (3900)*, and **3900 must end at exactly zero**. That one number proves the migration is complete and consistent.
5. **Nothing is lost.**
   - The old number, the old dates and the old owner are kept on every row.
   - Values that don't fit anywhere go into a free "Legacy notes" field instead of being dropped.
6. **Nothing is final until go-live.**
   - Every import is a batch that can be undone as a whole, until the company presses **Go live**.
   - Go live locks the books up to the opening date and marks history read-only.
   - After go-live, corrections are made the normal way (journal voucher, credit note, edit with history).
7. **History is visible wherever it helps.** It shows on the customer page, the record timeline, search, CRM reports and sales analytics. Each history item is labelled as such.
8. **Imports never set off side effects.**
   - Imported rows don't run automations, don't ask for approvals, and don't send notifications or e-mails.
   - The one exception is a "run automations" switch on fresh-lead imports, off by default.

---

## 3. Area by area

### 3.1 The books (general ledger)

**Opening trial balance (required).**
- The company uploads the trial balance from its old system on the day before go-live: account, debit and credit.
- Bonyan maps each old account to an account in its chart. It suggests the mapping by name and number, and the company can add accounts.
- It then posts one opening entry (OB-JV).
- The control accounts (1200, 2100, 1300, 1150, 1160, 2150, 1450, 2400) are **not** taken from the trial balance. They come from the detail lists in 3.2–3.5. Bonyan shows the trial balance's figure next to the detail list's total and the difference.

**Earlier periods (optional, recommended for one or two years).**
- The company uploads the monthly trial balances (or monthly movements) of earlier years.
- Bonyan posts one summary entry per month (HIST-JV), dated at the month end, and closes those years.
- The profit and loss, balance sheet, cash flow and comparisons with last year then work from day one.
- With this option, the opening trial balance is checked against the sum of the history instead of being posted separately.
- Account detail inside a month (every old journal line) is not imported: old systems keep it and it is rarely needed. The plan keeps it possible as a later option for audits.

**Checks**
- The opening entry balances.
- 3900 ends at zero.
- The balance sheet on the opening date equals the uploaded trial balance, account by account.
- Retained earnings equal the old system's.

### 3.2 Customers: what they owe, and what they paid in advance

**Open invoices (the "open items").** The company uploads one row per invoice that is not fully paid. Each row carries:
- customer;
- the old invoice number;
- invoice date and due date;
- the original amount and the amount still due;
- optionally the e-invoice (ETA) number, the sales rep and the lines.

Each row becomes an **opening invoice**:
- posted, with its old number kept and shown;
- the right due date, so ageing, overdue reminders and collection work invoice by invoice from day one;
- one entry, Dr 1200 / Cr 3900, for the amount still due;
- no stock movement, and no VAT counted again (that VAT was declared in the old system).

**What can happen to an opening invoice later**
- **Payments:** it takes payments, vouchers, cheques and withholding tax like any invoice.
- **Credit note:** it can be credited for a return or a discount. The VAT on the credit note is reversed in the month of the credit note, which is how Egyptian VAT treats adjustments. Returned goods come back at today's average cost.

**Advances and credits.** A customer who paid in advance, or holds a credit note not yet used, gets an opening credit. It is a credit note of the "opening" kind (Dr 3900 / Cr 1200), and it can be applied to the next invoice or refunded.

**Replaces** today's single opening balance per customer, which stays as a quick option for companies that don't have invoice detail.

**Check:** the open items minus the credits equal 1200 in the trial balance; the difference shows customer by customer.

### 3.3 Suppliers: what the company owes

This works the same way as customers: open bills become opening bills (Dr 3900 / Cr 2100), with the supplier's invoice number, due date and any ETA number. Advances paid to suppliers become opening debit notes.

**Check:** the open bills minus the advances equal 2100.

### 3.4 Bank, cash and cheques

- **Balances.** Each cash box and bank account gets its balance on the opening date, from the trial balance mapping in 3.1. The money accounts are created first if they are missing.
- **Cheques received, not yet cashed (post-dated cheques).** One row per cheque: number, bank, customer, amount, due date, and whether it is still in the safe or already deposited.
  - They enter the cheque register in the right state: in hand (1150) or under collection (1160).
  - They can be deposited, cleared or bounced like any cheque. A bounce puts the debt back on the customer.
  - **Check:** the cheques equal 1150 and 1160.
- **Cheques issued, not yet presented.** One row per cheque, in 2150. They clear or are cancelled like any cheque. **Check:** they equal 2150.
- **The first bank reconciliation.** For each bank account, the company enters the statement balance on the opening date and the items not yet on the statement (deposits in transit, cheques not presented).
  - The first reconciliation in Bonyan starts from that point, so the company never has to reconcile the past again.
  - **Check:** book balance = statement balance + items in transit.

### 3.5 Stock

- **Opening stock from one sheet.** One row per product: quantity and unit cost. Later, also warehouse, lot and expiry (Phase 2B).
  - Each row posts as an opening adjustment (Dr 1300 / Cr 3900) and sets the average cost.
  - Products missing from the catalogue can be created from the same sheet.
- **Serial numbers and lots.** Once Phase 2B adds lots, serials and expiry, the same sheet carries them, so expiry alerts and first-expiry picking start with the stock already on hand.
- **No past movements.** Old stock movements are not imported: they can't be checked and they would change the cost. Past *sales quantities* come in through the history invoices (3.7). That is what the stock card, the "slow movers" report and the reorder suggestions need.
- **Check:** stock value equals 1300; quantities can't be negative.

### 3.6 Tax

- **VAT.** The VAT position on the opening date (due to the Tax Authority, or credit carried forward) comes in through the trial balance (2210 and 1400). The first VAT return in Bonyan carries the credit forward.
- **The months before go-live are closed.** Earlier VAT returns are never recalculated in Bonyan.
- **Withholding tax for the quarter of go-live.** When go-live falls in the middle of a quarter, the company uploads the withholding deducted in the earlier months of that quarter, line by line (supplier, tax number, amount, rate, date).
  - They count in Form 41 for that quarter, but are not posted again.
  - Withholding certificates received from customers, not yet used, come in as the opening balance of 1450, listed per customer.
- **E-invoice numbers.** The ETA number of every imported document is kept (open and history), so the e-invoice check and search work for them.

### 3.7 Past documents (sales and purchase history)

The company uploads past invoices, bills, credit notes and quotations, usually 1–3 years of them, with or without lines.

**How they are stored**
- They are kept as **history documents**: read-only, marked "History", with the old number and dates.
- They are not in the journal, stock or VAT, and they don't affect numbering.

**Where they show**
- the customer's and supplier's page (timeline, "last bought", total per year);
- sales by product, customer, rep and month (with a "include history" switch, on by default);
- the stock card's sales quantities;
- reorder suggestions;
- search.

The financial statements never use them; the books' history comes from 3.1. This is what keeps the figures single.

**An unpaid invoice is uploaded twice on purpose:** once as an open item (3.2), and once as a history document if the company wants its lines in the sales history. The two are linked by the old number and recognised as the same invoice, so it is counted once in every report.

**Numbering**
- The company chooses where Bonyan's numbering continues: for example INV-2026-00451 after the last old number, or a fresh series.
- Old numbers never clash, because they are kept in their own field.

### 3.8 CRM

**Which order to import in.** Each list needs the ones before it to link to:
1. companies;
2. contacts;
3. products;
4. leads;
5. deals;
6. activities;
7. tasks and tickets.

The wizard follows that order.

**Customers, contacts and suppliers**
- **Records are matched before they are created.** An import can update existing records instead of duplicating them. Matching is by:
  - the old id;
  - the tax number;
  - the phone in one international format (+20…);
  - the e-mail;
  - the name.
- Likely duplicates inside the file and against Bonyan are shown before anything is saved, with a Merge choice.
- **Contacts are linked to their company** by the old id or the name.

**Leads**
- A lead comes in with its source, status, owner and original created date.
- A converted lead keeps its link to the customer and the deal it became.

**Deals, open and closed**
- A deal comes in with its stage, amount, expected close, owner and created date.
- Old stage names are mapped to Bonyan's stages in one screen ("Hot" → "Negotiation").
- A won or lost deal keeps its closing date and lost reason. These are history deals: they feed win rates, sales-cycle length, "won last year" and pipeline reports, and don't show on the board unless asked.
- When the old system has stage dates, they fill the stage history, so time-in-stage reports work.

**Activities: calls, meetings, visits, e-mails and notes**
- They come in with date, type, person, outcome and text, linked to the customer, contact or deal.
- They show in the record's timeline in date order, labelled with where they came from.
- Field visit logs (pharma reps, agronomists, service engineers) use the same path.

**Tasks and tickets**
- Open ones come in live, with due dates and owners.
- Closed tickets come in as history, with opened and closed dates, so service-time reports have a past.

**Leaving data out**
- Any column can be skipped.
- Personal data the company should not keep (old ID scans, say) can be left out on purpose. The privacy rules for imported personal data are the same as for data typed in.

### 3.9 Custom modules and industry data

Every module built in the builder gets the same import, with the same powers:
- dates, stages, links, owners;
- update by key;
- history or live.

The industry templates add ready mappings for their typical data:

| Template | Typical data | How it comes in |
|---|---|---|
| Real estate | Units, reservations, installment schedules | **Installments not yet paid** come in live (schedule with due dates). Installments already invoiced and unpaid are open items (3.2). Installments paid are history. |
| Contracting | Projects and progress | Projects with their contract value and progress %. The amounts already billed are history; retention still held is an open item. |
| Water treatment and service companies | Maintenance contracts (AMC) and visits | Active AMC contracts come in live with their remaining visits; past visits are history. |
| Clinics | Patients, appointments, treatment plans | Patients and future appointments are live; past visits are history. Medical data stays limited to what the company chooses to bring. |
| Training centres | Students and groups | Students and current groups are live; fees still due are open items. |
| Logistics and travel | Shipments and bookings | Shipments or bookings in progress are live; finished ones are history. |

### 3.10 People

- The old data names salespeople, engineers and accountants. Some no longer work at the company.
- The wizard maps each old name to a team member. A person who has left becomes a **former member**: a name with no login and no seat, so history keeps its owner and reports by person stay true.
- Records owned by a former member can be handed over to someone else in one step.

### 3.11 Files

Contracts, purchase orders, IDs and photos need file storage, which Bonyan doesn't have yet. The plan for it:
- Supabase Storage, private per company, virus-scanned, with a size limit per plan.
- A zip upload matched to records by the old number in the file name.

Until then, a link field can hold the address of a file kept elsewhere.

---

## 4. The migration wizard ("Bring your history")

A page for admins and finance. It opens on the first visit after publishing the system, and it can also be opened from Settings. It is a checklist with one step per area in the order of section 3.8.

**For each step**
1. **Download the workbook.** It is generated from the company's own system: its modules, fields, options and stages. It has one sheet per step, headers in Arabic and English, an example row, the allowed values as drop-downs, and a "Legacy notes" column. Companies coming from a known system can pick a preset instead (step H7).
2. **Upload** an .xlsx or .csv file. Files over 5,000 rows are split and sent in parts, with a progress bar.
3. **Map.**
   - Columns are mapped to fields, and old values to options and stages. Old names are mapped to people, and old accounts to the chart.
   - Bonyan suggests every mapping (by name, by meaning, and later by AI). It remembers them for the next file.
4. **Preview (dry run).**
   - Every row is checked like a real save, and nothing is written yet.
   - The preview shows rows that will be created, updated or skipped, the errors row by row with the cell to fix, and likely duplicates. Errors can be downloaded as a file.
5. **Import.** The good rows are saved as one **batch**: its own number, its file, who imported it, and when. The batch can be undone as long as nothing live depends on it (a payment on an opening invoice, for example). The batch also appears in the Audit page.
6. **Reconcile.** The step shows its total next to the trial balance's control account and the difference. The step is done only when the difference is zero, or an accountant accepts it with a written reason.

**The summary panel**
- what is done;
- each control account against its detail;
- 3900;
- the opening balance sheet;
- counts per module (live and history).

**Go live**
- **When it is possible:**
  - every required step is done;
  - 3900 is zero;
  - the opening balance sheet equals the uploaded trial balance.
- **What it does:**
  - locks the books up to the opening date;
  - marks history read-only;
  - closes the batches;
  - turns automations on for new work;
  - records who pressed it.
- **Re-opening:** only an admin can re-open the migration after go-live, with a written reason, the same way as re-opening closed books.

**Try first**
- The company can run the whole migration in a **test copy** of its workspace first.
- When the checks pass there, it can download the mappings and run them again in the real workspace, or promote the test copy.
- This needs the sandbox from BUIL-12. Until then, undoing batches covers most of the need.

**Help**
- Every step has a short explanation in Arabic and English, an example file, and the common mistakes. Examples of mistakes:
  - dates as text;
  - Arabic digits;
  - totals that include VAT twice;
  - customer names spelt two ways.
- A partner or Bonyan's support team can be given temporary access to run the migration for the company. That access is logged and expires (Phase 6).

---

## 5. Import engine upgrades (used by every step)

| Upgrade | What it does |
|---|---|
| Excel files | .xlsx (first sheet or a chosen sheet), alongside CSV; Arabic text and Arabic digits handled. |
| Large files | Client-side split into parts of up to 5,000 rows, sent in order, with progress, pause and resume. The server keeps its per-request limit. |
| Dry run | The same checks as a save, with nothing written; row-by-row results. |
| Update by key | Each module can name a key (old id, code, SKU, tax number, phone, e-mail). A row with a known key updates that record and keeps its history; a new key creates one. |
| Links | A link column matches by old id first, then by number, then by name. Rows that can't be matched are listed for a decision, never silently left empty. |
| Value mapping | Old drop-down values, stage names, people and accounts mapped in one screen, remembered per company. |
| Original dates and owners | Created date, closed date, stage dates and owner taken from the file for imported rows (never for rows typed in). |
| Legacy fields | Every record can carry its old id, old number and "Legacy notes", searchable. |
| History flag | A row can be imported as history: read-only, kept out of the books, stock, VAT, numbering, automations and approvals. |
| Batches and undo | Every imported row carries its batch. A batch is undone as a whole while nothing live depends on it. This works like "Remove sample data" today. |
| No side effects | Imports don't run automations, ask for approvals, or send anything, unless the switch for fresh leads is on. |
| Duplicate detection | Phone in one format (+20…), e-mail in lower case, names compared without spaces and diacritics. Matches are shown before the import, with Merge. |
| Audit | File name, row counts, who and when, in the Audit page; the batch is downloadable again. |

---

## 6. Volume: where history lives

**The problem.** The app loads all of a company's data when it opens. That suits live work (a year of a small or mid-size company), but five years of invoices with lines can be many times larger.

**The solution**

| | Storage | Loaded |
|---|---|---|
| **Live data** (all open items and everything since go-live) | As today | With the company |
| **History** (finished documents, closed deals and tickets, past activities) | Its own server tables | On request, a page at a time: the customer page's timeline, a search, a report, the history list of a module |

- Reports that use history (sales by month, win rate) are added up on the server, so the browser never holds the whole past.
- The books' history is small: summary entries per month (3.1), which load with the books.

**Limits by plan** (number of history rows), shown before the import, so a big import never fails half way.

**Getting there in steps**
- Until the history tables exist (step H5 below), history rows are stored with the live data and counted against a cap, for example 20,000 rows. That covers most small companies.
- The tables come with the server-side paging already planned in SECU-13.

---

## 7. The steps

Each step can ship on its own and is useful on its own. Sizes as in the review: S (days), M (1–2 weeks), L (3–5 weeks), XL (more).

### H1. Import engine (M–L)

**What it adds:** Excel files, large files in parts, dry run, update by key, link matching by old id, value mapping, original dates and owners, legacy fields, batches with undo, no side effects, audit.

**Fixes:** the BUIL-13 gaps (stages on import, Excel), SALE-09's update-on-import, SECU-12's progress.

**Done when**
- [ ] A 12,000-row customer file in Excel imports in parts with progress.
- [ ] Importing it a second time updates instead of duplicating.
- [ ] Undoing the batch removes it exactly.
- [ ] Deals import into their stages with their owners and created dates.
- [ ] No automation runs on imported rows.

### H2. Opening books (L)

**What it adds**
- go-live date;
- opening trial balance with account mapping;
- open customer invoices and supplier bills;
- opening credits and advances;
- cheque portfolio in and out;
- bank balances with the first reconciliation's starting point;
- bulk opening stock;
- withholding tax for the quarter of go-live;
- the control-account checks and 3900 = 0;
- Go live, with lock and re-open.

**Done when**
- [ ] An accountant migrates a test company from a real trial balance and ageing report. Ageing in Bonyan then matches the old report bucket by bucket.
- [ ] The cheque register matches the safe.
- [ ] The first bank reconciliation closes.
- [ ] Stock value equals 1300.
- [ ] 3900 is zero and the opening balance sheet equals the trial balance.
- [ ] Form 41 for the go-live quarter includes the months before go-live.
- [ ] A payment, a credit note and a bounced cheque on opening items all post correctly.

### H3. The migration wizard (M)

**What it adds:** the checklist page, generated workbook, mapping screens, preview, reconcile panel and summary, in Arabic and English.

**Done when**
- [ ] A company with no help completes the CRM and opening-books steps from the generated workbook.
- [ ] Every error message points to the row and cell to fix.

### H4. CRM and activity history (M)

**What it adds**
- closed deals as history, with closing date and lost reason;
- stage history from dates;
- activities, calls, visits and notes in the timeline;
- closed tickets;
- former members, and hand-over of their records.

**Done when**
- [ ] Win rate and average sales cycle for last year show from imported deals.
- [ ] A customer's page shows its imported calls and visits in date order.
- [ ] Reports by person include people who have left.

### H5. History store and document history (L)

**What it adds**
- server tables for history, with paging and server-side totals;
- past invoices, bills and credit notes as history documents;
- "include history" in sales reports;
- customer and supplier 360 (last bought, total per year);
- the link between open items and their history document.

**Done when**
- [ ] 3 years of invoices with lines (100,000 lines) import.
- [ ] The app still opens as fast as without them.
- [ ] Sales by product and month for last year match the old system.
- [ ] No figure in the financial statements changes.

### H6. Earlier periods in the books (M)

**What it adds:** monthly trial balances of one or two earlier years posted as month-end summary entries, the years closed, and the opening checked against them.

**Done when**
- [ ] The profit and loss with "compare with last year" and the balance sheet on last year's year-end match the old system's.

### H7. Presets, AI mapping, files and partners (L, later)

**What it adds**
- mapping presets for the exports of systems common in Egypt and the Gulf (for example Odoo, QuickBooks, Zoho, Daftra and popular local desktop systems; to be chosen with the first customers);
- AI that maps messy headers and values (blueprint item 8);
- file storage and zip upload (3.11);
- partner-run migrations with logged, expiring access;
- the test-copy sandbox (with BUIL-12).

**Done when**
- [ ] A company switching from one of the preset systems maps its files without manual column mapping.

**Order.** H1 → H2 → H3 make a company able to start with correct books and its live CRM, which is what the paid launch (M2) needs. H4 and H5 give it its past. H6 and H7 follow as the customers ask. H2 needs nothing from Phase 2B. Lots and warehouses on opening stock follow when 2B adds them.

**Rough effort:** H1–H3 about 2–2.5 months. H4–H6 about 2 months. H7 later.

---

## 8. Decisions for the owner

| # | Decision | Recommended answer |
|---|---|---|
| 1 | **How much of the books' past to bring** | The opening trial balance always. Monthly summaries of the previous year as an option (for comparatives). Line-by-line journals not at all for now. |
| 2 | **How much document history** | Up to 3 years of invoices and bills, with lines when the old system can export them. Older years as yearly totals only. |
| 3 | **Go-live date** | The first day of a month, ideally of a quarter, so VAT and withholding tax split cleanly. The wizard suggests it and warns about a mid-quarter date. |
| 4 | **History in sales reports** | Included by default and labelled, with a switch to leave it out. |
| 5 | **Who may migrate** | Admins for the CRM steps; admins or finance for the books steps. Go live: admin only. |
| 6 | **History limits per plan** | Free: 2,000 history rows. Growth: 100,000. Pro: 1,000,000. Assisted migration as a paid service for bigger companies. |
| 7 | **Files** | Links to files now; file storage in H7. |
| 8 | **Preset systems** | Pick the first three with the pilot companies, from the systems they actually use. |

---

## 9. What changes for a new company

**Before:** it starts empty. It types in its customers one by one, enters one lump per customer as an opening balance, and loses its ageing, cheques and sales history.

**After**
1. On day one it downloads a workbook made for its own system and fills it from its old exports.
2. It uploads it step by step and fixes the few rows Bonyan points to.
3. It sees every total agree with its old trial balance, then presses Go live.

From that moment:
- the collector chases the right invoices by age;
- the cheques are in the register;
- the rep sees last year's calls and orders on every customer;
- the owner compares this March with last March.

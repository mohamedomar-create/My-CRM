# Pilots and proofs

What this proves: a company of every kind Nasq360 sets up can run a whole year on it, and the books it produces
would pass the checks an auditor runs. Every claim below is an automated test that runs on every change
(`src/lib/pilots.test.ts`), so it stays true as the app grows.

## A year for every kind of company

Each of the 17 industry templates runs January to December. Everything goes through the same server
commands the app sends, applied to a copy of the workspace exactly as the server does. Every month, each
company:

- buys and sells, never selling more than it has;
- is paid late and in parts, and pays its suppliers, some with withholding tax;
- issues a credit note and refunds it now and then;
- runs payroll (prepared, approved, paid as one total);
- posts its rent automatically;
- loads the bank statement, lets it match itself, posts the one fee the books didn't have, and agrees it;
- prepares the month end (dollars restated at the latest rate) and closes the month.

Importers (8 of the 17) also:

- buy dollars;
- pay dollar bills from a dollar account;
- sell in dollars sometimes;
- agree the dollar account's statement in dollars.

The year is then closed.

| Company type | Documents posted | Payments | Credit notes + refunds | Dollar exchanges | Dollar restatements | Statements agreed | Journal entries |
|---|--:|--:|--:|--:|--:|--:|--:|
| distribution | 147 | 160 | 10 | 12 | 12 | 24 | 409 |
| retail | 135 | 152 | 12 | 0 | 0 | 12 | 367 |
| handmade | 131 | 145 | 14 | 0 | 0 | 12 | 358 |
| food | 126 | 156 | 10 | 0 | 0 | 12 | 358 |
| medical | 153 | 167 | 14 | 12 | 11 | 24 | 427 |
| clinics | 130 | 158 | 8 | 0 | 0 | 12 | 366 |
| building | 158 | 173 | 18 | 12 | 9 | 24 | 437 |
| construction | 126 | 149 | 6 | 0 | 0 | 12 | 349 |
| realestate | 145 | 161 | 18 | 0 | 0 | 12 | 392 |
| manufacturing | 151 | 172 | 14 | 12 | 11 | 24 | 429 |
| agriculture | 145 | 157 | 18 | 12 | 12 | 24 | 411 |
| automotive | 151 | 160 | 16 | 12 | 11 | 24 | 418 |
| services | 131 | 145 | 14 | 0 | 0 | 12 | 358 |
| logistics | 151 | 159 | 14 | 12 | 12 | 24 | 414 |
| travel | 151 | 177 | 12 | 12 | 11 | 24 | 430 |
| education | 128 | 140 | 16 | 0 | 0 | 12 | 351 |
| water | 127 | 144 | 14 | 0 | 0 | 12 | 355 |
| **All 17** | **2,386** | **2,675** | **228** | **96** | **89** | **300** | **6,629** |

Nothing a real company does was refused. In every month, a deliberate posting into the already-closed month was
refused, and that refusal changed nothing.

## What is proven at every month end

1. Debits equal credits, and every blocking health check passes. These include:
   - customer balances = receivables (1200);
   - supplier balances = payables (2100);
   - stock list = inventory (1300);
   - each product's quantity = the sum of its movements;
   - cheques = the cheque accounts;
   - every agreed bank statement still adds up.
2. The balance sheet balances.
3. The income statement's profit equals what the ledger's income and expense accounts show.
4. The cash flow walks from opening to closing cash, and closing cash equals what the cash boxes and banks hold.
   This includes dollar accounts at their book value. A restatement of dollars held is shown on its own line,
   as IAS 7 asks.
5. The ageing lists add up to receivables and payables (the Excel exports are built from these same lists).
6. No product is ever below zero.
7. A dollar account's statement lines add up to the dollars it holds, and it never holds less than zero.
8. Every invoice's and bill's balance is its total less what was paid, credited and written off.
9. Invoice, bill, journal voucher, transfer, bank and revaluation numbers run 1…n without gaps or repeats.

## The proofs are not empty: books made wrong on purpose fail them

Each test below runs a real two-month pilot, corrupts the books in one way, and confirms the proof catches it.

| Corruption | Caught by |
|---|---|
| A journal line changed so the entry no longer balances | debits ≠ credits |
| A document's balance changed | document balance check |
| A stock movement deleted | *Stock quantities match their movements* (new check) |
| A product's quantity changed outside a document | *Stock quantities match their movements* (new check) |
| A paid invoice marked unpaid | receivables check |
| Dollars changed on a line of an agreed dollar statement | *Agreed bank statements still agree* (new check) |
| An invoice number skipped | numbering check |

## Random abuse

Three seeded runs each take 1,200 random steps. The steps cover:

- dollar and euro accounts, exchanges between any two accounts, payments in any currency through any account;
- credit notes, refunds, journal vouchers with and without foreign amounts;
- revaluations, payment reversals and voids;
- bank statement lines pointing at the wrong things, and payroll in any order.

Each step either works or is refused with a plain message. A refused step leaves the workspace exactly as it was.
Every 100 steps, every blocking health check passes, the balance sheet balances, and no foreign account holds less
than nothing. The older fuzz test (`src/lib/fuzz.test.ts`, 10,000 steps over invoices, bills, payments, voids,
credit notes and stock) still runs alongside.

## What the pilots found and fixed

- **Revaluation of open foreign bills.** A month with an open foreign bill could not be revalued: the payables
  line had the wrong sign. Fixed.
- **Stock check.** Nothing would notice a stock movement lost outside a document. There is now a blocking check.
- **Agreed bank statements.** Nothing would notice if an already-agreed bank line changed. There is now a
  blocking check.
- **Overdrawn foreign accounts.** A hand-made journal voucher could take dollars out of an empty dollar account
  (payments and transfers already refused this). The rule is now enforced where every entry is posted.
- **Cash flow and restatements.** A month-end restatement of dollars held showed in the cash flow as if it were
  operating cash. It now has its own line.

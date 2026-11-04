# Accounting audit — Nasq360 books against ERP and accounting standards

*Audited November 2026. Evidence: `src/lib/accountingAudit.test.ts`, which runs on every push. It walks one trading company through a full financial year and checks every entry to the cent, then proves the controls after each step. Supporting suites: `books`, `ledger`, `treasury`, `tax`, `statements`, `opening`, `earlier`, `costCenters`, `landed`, `batches`, `credits`, `partyStatement` (430 tests in total).*

## 1. How the books are built (the principles)

| Principle | How Nasq360 applies it | Proven by |
|---|---|---|
| Double entry | Every posting goes through one `journal()` function, which refuses any entry whose debits ≠ credits, or a negative amount | audit test (unbalanced voucher refused), `books.test` |
| Accrual basis | Revenue at the invoice, expense at the bill, both when posted (not when paid). Accruals, prepayments and depreciation are adjusting entries | audit test §adjusting |
| Matching | Cost of goods sold is posted with each sale, at moving-average cost; returns reverse it at the cost they left at | audit test §trade, §returns |
| Perpetual inventory | 1300 Inventory changes only with stock movements (bills, invoices, returns, adjustments, counts, landed costs), so it always equals the stock list | `controls()` after every step |
| Control accounts | 1200, 2100, 1300, 1150, 1160, 2150, **1210, 1590** are fed only by documents and registers. A manual journal voucher can't touch them | audit test (JV to 1200 and 1590 refused) |
| Immutability | Posted documents can't be edited or deleted; they are voided or credited. Journal vouchers are reversed, never changed | audit test §immutability |
| Period lock | Closing a month locks every posting on or before its last day: documents, vouchers, transfers, depreciation, numbering. Only an admin can reopen, with a written reason | audit test §closing January, §year close |
| Gapless numbering | Each series (INV, BILL, CN, DN, JV, TRF, DEP, FA, DSP, PRV, WO, …) runs per year with no gaps. A number is taken only after every check has passed | audit test §numbering |
| Audit trail | Every posting writes who did what, and when, to the activity log. Server commands are also logged in the database | `trail.test` |
| Segregation of duties | Only Admin and finance roles can post. Documents can need an approver other than the person who made them (approval rules) | `access.test`, `multiuser.test` |

## 1b. Rigour without complexity

The accounting rules run behind the scenes; people work in plain words.

- **Nobody chooses debits and credits for normal work.** Invoices, bills, payments, returns, cheques, transfers, depreciation, write-offs: each posts its own entry. Journal vouchers are only for what no document covers.
- **The system remembers the period-end steps.** When a month is closed, it lists what is still due and does each one in one click: depreciation not yet posted, money to set aside for customers far behind on paying. Nothing shows when there is nothing to do.
- **Problems are shown; passing checks are folded away.** The month-end close shows only what needs fixing, and "N checks passed" for the rest.
- **Plain words on screen.** "Worn down so far" and "worth in the books" instead of accumulated depreciation and net book value. "Set aside for late payers" instead of provision matrix. "Bring back" instead of reinstate. Account numbers and Dr/Cr stay in the journal and the reports, for the accountant.
- **Few places to look.** Fixed assets is one tab. Late payers sit under Ageing, next to the late invoices. Cash ↔ bank transfers sit on Bank & cash. Self-reversing accruals are one optional link on a journal voucher.
- **Safe by construction, not by training.** Control accounts can't be posted by hand, closed months can't be changed, and posted entries can't be edited. A mistake is undone by its mirror entry, so a non-accountant can't break the books.

## 2. Every kind of entry

| Entry | Arabic | What the audit test does | Exact Dr / Cr checked |
|---|---|---|---|
| Opening entry | القيد الافتتاحي | Customer and supplier opening balances, opening stock, opening cash, an asset already held (cost and depreciation to date). All go against 3900, which is then handed to capital and ends at **0** | ✔ |
| Simple entry | القيد البسيط | Rent: Dr 5200 / Cr 1100 (two lines) | ✔ |
| Compound entry | القيد المركب | Salaries: Dr 5300 / Cr 1100, Cr 2400, Cr 1110 | ✔ |
| Contra entry (cash ↔ bank) | القيد العكسي بين النقدية والبنك | **New: transfer (Bank & cash → Move money between cash and bank), numbered TRF-.** Dr 1110 40,000; Dr 5500 15 (bank charge); Cr 1100 40,015. Same-account and non-cash accounts are refused | ✔ |
| Sales invoice | فاتورة مبيعات | Dr 1200 3,420; Cr 4000 3,000; Cr 2200 420; Dr 5000 1,250; Cr 1300 1,250 | ✔ |
| Purchase bill | فاتورة مشتريات | Dr 1300 5,000; Dr 1400 700; Cr 2100 5,700 | ✔ |
| Sales return | مردودات المبيعات | **Now goes to 4100 Sales returns (a contra revenue account):** Dr 4100 300; Dr 2200 42; Cr 1200 342; Dr 1300 125; Cr 5000 125 | ✔ |
| Purchase return | مردودات المشتريات | Dr 2100 285; Cr 1400 35; Cr 1300 250 | ✔ |
| Cheque received → deposited → bounced (with bank charge) | أوراق القبض | Dr 1150 / Cr 1200 → Dr 1160 / Cr 1150 → Dr 1200 / Cr 1160, then Dr 5500 50 / Cr 1110 | ✔ |
| Payment with withholding tax | الخصم من المنبع | Dr 1110 3,051; Dr 1450 27; Cr 1200 3,078 (1% of the value before VAT) | ✔ |
| Cheque issued → cleared | أوراق الدفع | Dr 2100 / Cr 2150 → Dr 2150 / Cr 1110 | ✔ |
| VAT settlement | تسوية ضريبة القيمة المضافة | Dr 2200 378; Cr 1400 665; Dr 2210 287 (a credit carried forward). Allowed only after the month is closed | ✔ |
| Adjusting: prepayment | مصروفات مقدمة | Dr 1350 / Cr 1110, then the used half Dr 5450 / Cr 1350, marked *adjusting* | ✔ |
| Adjusting: accrual that reverses itself | مصروفات مستحقة + قيد عكسي تلقائي | **New: "Reverse it automatically next month" on a journal voucher.** Dr 5400 / Cr 2250 on 31 Dec, with its mirror on 1 Jan. The real bill in January isn't counted twice, and 2250 ends at 0 | ✔ |
| Adjusting: depreciation | الإهلاك | **New fixed-asset register.** Straight line, monthly, a full month from the month in service, down to the salvage value. Dr 5600 / Cr 1590. Months not yet run are caught up; a closed month is refused | ✔ |
| Adjusting: allowance for doubtful debts | مخصص الديون المشكوك فيها | **New.** From the ageing with a provision matrix (IFRS 9 simplified approach): Dr 5700 570 / Cr 1210 570 | ✔ |
| Bad-debt write-off, and recovery | إعدام الديون | **New.** Dr 1210 570 (the allowance first); Dr 5700 570; Cr 1200 1,140. Reinstated by the exact mirror if the customer pays | ✔ |
| Stock count difference | جرد المخزون | Dr 5900 25 / Cr 1300 25 | ✔ |
| Sale or scrapping of a fixed asset | استبعاد الأصول | **New.** Dr 1590 48,000; Dr 1110 70,000; Dr 4950 2,000 (loss); Cr 1500 120,000 | ✔ |
| Closing entry | قيد الإقفال | Every income and expense account to 3100. After the close, each is 0 at year end, and 3100 = the year's result (−56,405, worked out by hand) | ✔ |
| Reversing entry | القيد العكسي | A wrong voucher is cancelled by its mirror. A second reversal, or reversing a document's entry, is refused | ✔ |
| Reopening a year | إعادة فتح السنة | The closing entry is reversed (REOPEN), and closing again gives the same result | ✔ |
| Landed costs, batches/expiry, consignment, cost centers, budgets | | Their own test suites | ✔ |

## 3. Controls proven after every step (`controls()`)

1. The trial balance balances: total debits = total credits.
2. Customer balances = 1200, supplier balances = 2100, stock list = 1300, cheque register = 1150 / 1160 / 2150.
3. The asset register's accumulated depreciation = 1590.
4. The balance sheet balances: assets = liabilities + equity.
5. The cash-flow statement agrees with the cash and bank accounts: opening + net movement = closing.
6. Closed periods refuse documents, vouchers, transfers and depreciation.
7. Posted documents can't be changed or deleted.
8. Numbering has no gaps, even when a posting is refused.
9. A refused server command changes nothing: the company is byte-for-byte the same.

## 4. What the audit found and fixed

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | No contra (cash ↔ bank) entry: transfers had to be typed as journal vouchers | Gap | Transfer voucher (TRF-), with the bank charge, on Bank & cash |
| 2 | Accruals didn't reverse themselves, so the January bill could double-count the expense | Gap | "Reverse automatically on" on adjusting entries |
| 3 | No contra accounts: returns reduced revenue directly, and there was no accumulated depreciation or allowance | Gap | 4100 Sales returns, 1590 Accumulated depreciation, 1210 Allowance (contra; shown on their own side), plus 1350, 2250, 4950, 5600, 5700 |
| 4 | No fixed-asset register or depreciation | Gap | Register, depreciation runs (undo the latest), disposals with gain or loss, a month-end check against 1590 |
| 5 | No bad-debt provision or write-off | Gap | Provision matrix from the ageing, write-off against the allowance, reinstatement |
| 6 | **Bug:** closing a year left an *earlier, never-closed* year's income and expenses in the P&L accounts | High | The close now takes everything since the last closed year |
| 7 | **Bug:** the engine took a document number before checking the period was open. On the server a refused command is thrown away, so live data was never affected; it now can't happen at all | Low | Numbering checks the period first |

## 5. Against Odoo and global practice — what is still to do (honest list)

| Area | Status |
|---|---|
| Multi-currency (foreign-currency invoices, exchange differences, revaluation, IAS 21) | **Done (Nov 2026):** quotations, orders, invoices and bills in USD/EUR/…; booked in EGP at the document's rate (VAT line by line); realized differences on payment and unrealized month-end revaluation to 4960 (`fx.test.ts`). Still to do: foreign-currency bank accounts, cheques and multi-document vouchers in foreign currency |
| Maker–checker on journal vouchers (a second person approves a JV) | **Not yet.** Mitigated: finance-only, immutable, reversal only, full trail |
| Recurring journal vouchers; deferred-revenue schedules | Not yet (prepayments and accruals are done by hand) |
| Depreciation methods other than straight line; revaluation (IAS 16); partial disposal | Not yet |
| Inventory valuation other than moving average (FIFO, standard cost) | Not yet (moving average is accepted under IAS 2) |
| VAT relief on bad debts | Not applied (Egyptian VAT law gives no general relief) |
| Consolidation, intercompany | Not yet |
| Bank feeds | Statement CSV import and reconciliation exist; live feeds don't |

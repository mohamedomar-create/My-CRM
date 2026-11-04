# Accountant sign-off — one month in a test company

**For:** an independent accountant, about 2 hours, no training needed.
**Goal:** confirm by hand what `src/lib/accountingAudit.test.ts` already checks automatically on every change.
**How to start:** Security page → *New company* → industry *Distribution* → ERP or CRM + ERP → publish. Then work in **Accounting**.

Enter each step, then compare the entry under **Accounting → Reports → Journal** with the figures given. Tick ✓ or write what differs.

| # | Do this | Expected entry | ✓ |
|---|---|---|---|
| 1 | **Opening balances** → customer *Alpha* owes 1,000; supplier *Nile Mills* is owed 400 | Dr 1200 1,000 / Cr 3900 1,000 · Dr 3900 400 / Cr 2100 400 | |
| 2 | **Stock** → opening stock: 100 × Rice at 25 | Dr 1300 2,500 / Cr 3900 2,500 | |
| 3 | **Journal voucher**: opening cash 80,000 against 3900, then 3900's balance to 3000 Capital | 3900 ends at 0 | |
| 4 | **Bank & cash** → move 40,000 from cash to the bank, with 15 bank charges | Dr 1110 40,000; Dr 5500 15 / Cr 1100 40,015 | |
| 5 | **Purchase bill**: 200 Rice at 25, VAT 14% | Dr 1300 5,000; Dr 1400 700 / Cr 2100 5,700 | |
| 6 | **Sales invoice**: 50 Rice at 60, VAT 14% | Dr 1200 3,420 / Cr 4000 3,000; Cr 2200 420; Dr 5000 1,250 / Cr 1300 1,250 | |
| 7 | **Credit note** on that invoice: 5 bags returned | Dr 4100 300; Dr 2200 42 / Cr 1200 342; Dr 1300 125 / Cr 5000 125 | |
| 8 | **Debit note** on the bill: 10 bags sent back | Dr 2100 285 / Cr 1400 35; Cr 1300 250 | |
| 9 | **Payment** of the invoice by bank transfer, 1% withholding | Dr 1110 3,051; Dr 1450 27 / Cr 1200 3,078 | |
| 10 | **Payment** of the bill by our cheque, then **clear** it | Dr 2100 5,415 / Cr 2150 → Dr 2150 / Cr 1110 5,415 | |
| 11 | **Fixed assets** → add a laptop, 24,000 from the bank, 24 months; **Close the books** → *Post it* | Dr 1500 24,000 / Cr 1110; then Dr 5600 1,000 / Cr 1590 1,000 per month | |
| 12 | **Journal voucher** with *Reverse it automatically next month*: electricity 1,500 to 2250 | The entry, plus its mirror on the 1st of next month | |
| 13 | **Bank reconciliation**: tick the bank lines, enter the statement balance | Difference 0 | |
| 14 | **Close the books** → the month | Every check passes; close it | |
| 15 | **VAT & withholding** → settle the month's VAT | Dr 2200 378 / Cr 1400 665; Dr 2210 287 (a credit carried forward) | |
| 16 | Try to post anything dated in the closed month | Refused | |
| 17 | **Reports**: trial balance, balance sheet, cash flow | Debits = credits; assets = liabilities + equity; cash flow = cash and bank movement | |

Steps 1–9 are dated in the first days of the month and the rest after them, so step 14 closes a month that has every entry.

## Sign-off

- Name / registration no.:
- Date:
- Result: ☐ All as expected  ☐ Differences (list them above)
- Signature:

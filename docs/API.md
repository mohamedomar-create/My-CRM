# Nasq360 API and webhooks

Connect a web shop, a bank, a courier or a reporting tool to a company in Nasq360.

- **The API** lets another system read and write over HTTPS with an API key.
- **Webhooks** tell another system as soon as something happens.

An admin manages both in **Setup → Connections**.

## API keys

- An admin makes a key and names it after the system that will use it, for example "Web shop".
  - The key is shown **once**. Copy it then.
  - Nasq360 keeps only a fingerprint of the key (its SHA-256 hash), so nobody can read the key back, Nasq360 staff included.
- A key acts **as the admin who made it**, with that admin's rights:
  - It sees what they can see. Purchase costs are hidden unless they can see costs.
  - It can do what they can do.
- Every change made with a key is in the audit trail as `API key <name>: …`.
- **Read only** keys can only `GET`. **Read and write** keys can also add and change.
- A key stops working when it is revoked, or when its person leaves the company.
- Each key can make **120 requests a minute**. Above that the API answers `429`.

## Calling the API

```
Base address: https://npnhoywlxidojqoijqdu.supabase.co/functions/v1/api/v1
Header:       Authorization: Bearer nq_live_…
```

| Call | What it does |
|---|---|
| `GET /v1` | The company, the person the key acts as, and every list with its fields |
| `GET /v1/{list}` | A list, oldest change first. Query options: `limit` (up to 200), `after=<id>` (next page), `updated_since=<ISO time>`, `status`, `q` (search) |
| `GET /v1/{list}/{id}` | One record |
| `POST /v1/{list}` | Add a record: `{ "values": { … }, "lines": [ … ] }`. Add `"post": true` to post an invoice or bill in the same call |
| `PATCH /v1/{list}/{id}` | Change a record: `{ "values": { … } }` |
| `DELETE /v1/{list}/{id}` | Delete a record, where the app allows it |
| `POST /v1/invoices/{id}/post` | Post a draft invoice (the same works for `bills`) |
| `POST /v1/invoices/{id}/payments` | Record a payment: `{ "amount": 1140, "method": "bank", "date": "2026-11-04" }`. The method is `cash`, `bank`, `instapay` or `card` |
| `GET /v1/stock` | On hand per product (`?warehouse=<code>` for one store or van) |

The lists are `customers`, `suppliers`, `products`, `invoices`, `bills`, `quotes`, `deals`, `contacts`, `leads`, `tasks` and `tickets`. A list the company made itself goes by its id; `GET /v1` shows every list with its fields.

**Same rules as the app.** Every change goes through the same rules as in the app:
- permissions, closed periods and credit limits;
- stock, VAT and the plan;
- one payment can't be taken twice.

A refusal comes back as `422` with the same message the app shows.

### A record

```json
{
  "id": "r_…", "list": "invoices", "number": "INV-2026-0001", "status": "posted",
  "created_at": "…", "updated_at": "…",
  "values": { "customer": "r_…", "date": "2026-11-04", "subtotal": 1200, "tax": 168, "total": 1368, "paid": 0, "balance": 1368 },
  "lines": [{ "product": "r_…", "description": "Rice 5kg", "qty": 6, "price": 200, "discount": 0, "vat": 14, "net": 1200 }]
}
```

### Example: a web shop order, posted and paid

```bash
curl -X POST "$BASE/invoices" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"values":{"customer":"r_cust"},"lines":[{"product":"r_rice","description":"Rice 5kg","qty":6,"price":200,"vat":14}],"post":true}'
curl -X POST "$BASE/invoices/<id>/payments" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"amount":1368,"method":"card"}'
```

### Sending the same thing twice is safe: `external_id`

Connections retry: a shop resends an order when a reply is lost, and a payment gateway sends its notice more than once.
Give each record or payment the other system's own id, and Nasq360 never makes it twice:

```bash
curl -X POST "$URL/v1/invoices" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "external_id": "shopify-#1042",
  "values": { "customer": "r_…", "date": "2026-11-04" },
  "lines": [{ "product": "r_…", "description": "Rice 5kg", "qty": 2, "price": 200 }],
  "post": true }'
```

- **The first call** makes the record and answers `201`. The record carries `"external_id": "shopify-#1042"`.
- **Any later call with the same `external_id`** makes nothing. It answers `200` with the record already made, plus
  `"replayed": true`. This holds even when two calls arrive at the same moment.
- **Finding it by the shop's number:** `GET /v1/invoices?external_id=shopify-%231042`.
- **Payments:** `POST /v1/invoices/{id}/payments` with `"external_id": "paymob-77"` is recorded once. A retry answers
  `200` with `"replayed": true`. If the payment is reversed, the same id can be recorded again.

`external_id` is up to 120 characters. Use any value that is unique in the other system: an order number, a shipment
number, a transaction id.

### Connecting a shop, a courier or a payment gateway

You don't need a developer for the usual cases. Zapier or Make (or a few lines in the shop) can do it:

| From | When | Call |
|---|---|---|
| Shopify / WooCommerce / Salla | a new order | `POST /v1/customers` (with the shop's customer id as `external_id`), then `POST /v1/invoices` with `"post": true` and the order number as `external_id` |
| Payment gateway (Paymob, Fawry, card) | payment succeeded | `POST /v1/invoices/{id}/payments` with the transaction id as `external_id` |
| Courier (Bosta, Aramex) | cash collected on delivery | `POST /v1/invoices/{id}/payments` with `"method": "cash"` and the shipment number as `external_id` |
| Nasq360 → courier | `invoice.posted` webhook | create the shipment from the invoice's lines and the customer's address |
| Nasq360 → shop | `stock.low` webhook, or `GET /v1/stock` hourly | update the quantities shown in the shop |

### Errors

| Status | Meaning |
|---|---|
| `401` | No key, a malformed key, or a revoked key |
| `403` | A read-only key tried to change something, or its person left the company |
| `404` | No such list or record |
| `422` | The change was refused (the message says why) |
| `429` | Too many requests |

Every error is `{ "error": "<message>" }`.

## Webhooks

1. Add an `https` address and choose the events you want.
2. Nasq360 makes a **signing secret** (`whsec_…`) and shows it once.

**Delivery.** Each event is sent as `POST` with a JSON body:

```json
{ "id": "<unique per event>", "event": "invoice.paid", "created_at": "2026-11-04T10:00:00Z", "company": "ws_…", "data": { … the record … } }
```

**Headers:**
- `Nasq360-Event`
- `Nasq360-Delivery`: the event id. Use it to ignore a repeat.
- `Nasq360-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the secret>`

**Checking the signature.** Before trusting a message:
- recompute the HMAC over `<t>.<raw body>` and compare it in constant time;
- check that `t` is within 5 minutes.

**Answers and retries:**
- Answer with any `2xx` status within 8 seconds.
- Anything else is tried again after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours, then given up.
- After 100 failures in a row the webhook is turned off. An admin turns it back on.

**Events:**

| Group | Events |
|---|---|
| Customers and suppliers | `customer.created`, `customer.updated`, `supplier.created` |
| Products and stock | `product.created`, `stock.low` (a product reached its reorder level) |
| Deals | `deal.created`, `deal.stage_changed` |
| Quotations | `quote.sent`, `quote.accepted`, `quote.declined` (including answers given online) |
| Invoices and bills | `invoice.posted`, `invoice.paid`, `invoice.voided`, `bill.posted`, `bill.paid` |
| Payments | `payment.received`, `payment.made` |

Point-of-sale sales arrive as `invoice.posted` and `payment.received`.

## For the owner: switching it on

1. The database part ships as the migration `20261116000000_api_webhooks.sql`.
2. The `api` server function deploys with the others when the branch is merged.
3. Failed webhooks are retried by a database job every 5 minutes. Run `supabase/setup/schedule.sql` again once in the SQL editor; it adds the job next to the nightly one.

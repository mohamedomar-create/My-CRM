# Adding a module from another ERP

The module library lets a company add ready modules in one click from **Setup → Add a module**. This guide shows how
to add a new module modelled on another ERP's app, for example an Odoo app the system doesn't have yet. The new
module must meet the same standard as the rest of the system.

A module is one **blueprint** in `src/lib/blueprints.ts`. The engine does the rest. You never write screens, commands
or database changes for a new module.

## 1. Map the app

Take the other system's app and write down:

| In the other ERP | In the blueprint |
| --- | --- |
| Each model, such as `fleet.vehicle` or `fleet.vehicle.log.services` | A list in `modules`, with a short `key` (`vehicles`, `services`) |
| The fields that people fill in | `fields`: `text`, `number`, `currency`, `date`, `select` (with `options`), `user`, `phone`, `email`, `url`, `longtext`, `checkbox`, `rating` |
| A link to customers, suppliers or products | `type: 'relation'` with `link: '@accounts' \| '@suppliers' \| '@products' \| '@deals' …` |
| A link to another list of the same app | `link: '#vehicles'` |
| The `state` field, or the kanban stages | `stages` (open stages first, then at least one `won` or `lost`), or a select field called *Status* |
| Totals counted from child lines, such as "Number of services" | `type: 'rollup'`, `rollup: { from, via, op: 'count' \| 'sum', field }` |
| Computed amounts, such as `days * rate` | `type: 'formula'` over number fields |
| A button that creates a sale order, invoice or vendor bill | `makes`: target `quotes`, `invoices` or `purchases`, with `party` and a `line` |
| Scheduled actions and activities | `automations`: `created`, `stage_changed` or `date_passed`, making a task or a notice |
| Its main reports | `reports` (chart, group-by field or `__stage`, count or sum) |

## 2. Rules the standard checks

`checkBlueprint` in `src/lib/moduleLibrary.ts` enforces these rules, and the test fails until all of them hold:

- **Arabic everywhere.** Every name, field, choice, stage, button, reminder and report needs Arabic in
  `src/locales/ar.ts`.
- **Each list shows where a record stands.** It needs a pipeline, or a *Status* select field. It also needs at least
  three fields of its own, and at least one of them shown in the list.
- **Pipeline order.** A pipeline's open stages come before its finished ones, and it has a way to finish.
- **Stage gates.** A stage can require fields (for example, a technician before *In progress*). The fields it names
  must exist.
- **Links, formulas and rollups point at real fields.** A dropdown has at least two choices.
- **Money goes through documents.** A `makes` entry creates a **draft** quotation, invoice or purchase bill:
  - It always gets the customer or supplier from a field that links to the customers or suppliers.
  - The line's price and quantity come from number fields. A product link sets the product, its VAT and its stock
    handling.
  - The draft is checked and posted like any other document, so stock, VAT and the books are never bypassed.
  - It is made once per record, unless it is marked `repeat` (for example, a contract invoiced every month).
  - It can be limited to stages (for example, invoice only when the repair is *Repaired*).
- **At least one report**, so the owner sees the module at work.
- **Icons the app can draw.** Icons come from `src/components/Icon.tsx`.

## 3. What installing does

`installBlueprint` adds the module:

- **Its lists**, each with the id `m_<module>_<list>`, the same in every company.
- **Its place in the menu.** Each list goes in the area its `area` names: `ops` (Operations) or `crm` (Customer
  relations).
- **Its pipelines, reminders and reports.**
- **Rights.** People who add or change the lists it works next to (`worksWith`) can work in it, people who only look
  at those lists can look at it, and admins see everything. The admin can change this on the install screen.

It is safe in any company:

- **Missing lists.** A link to a list the company doesn't have is left out, along with any document or report that
  depends on it. If a *required* link is missing, the module says which list it needs.
- **Name clashes.** If the company already has a list with the same name, the module says so instead of adding a
  second one.
- **Checked like a publish.** Installing goes live as a new version in the system's history, with the same checks as
  a publish.
- **No data lost on removal.** Taking a module off is only possible while its lists hold no records.

## 4. Test before shipping

```
npx vitest run src/lib/moduleLibrary.test.ts
npm run i18n:missing
```

The test checks every blueprint against the standard and installs each one into every industry, for each of CRM, ERP
and both. Add a short test for any new kind of document flow, following the repair and rental tests in the same file.

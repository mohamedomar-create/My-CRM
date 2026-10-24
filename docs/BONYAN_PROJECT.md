# Bonyan — complete project (CRM + simple ERP builder)

This one file contains the **entire source code** of Bonyan, plus the context needed to continue working on it in a new Claude Code chat.

- Repository: `mohamedomar-create/TotalCare-Organisation-`, folder `crm-builder/`, branch `claude/magical-wright-pw8slu` (latest commit: bdc56cb Bonyan: add features from leading CRMs and ERPs)
- Stack: React 19 + TypeScript + Vite 8, `@dnd-kit` for drag and drop, `lucide-react` icons, `react-router-dom` 7, `vitest` for tests. No backend yet: data is saved in the browser (`localStorage`).
- Status: 33 unit tests pass, the production build passes, and an end-to-end browser run of 27 steps passes with no console errors.

---

## 1. Product vision

Bonyan (بنيان, "structure") is **not a fixed CRM**. It is a tool that lets small and medium companies (Egypt first, then global) **build their own CRM + simple ERP** with clear steps, drag and drop, and strict guardrails that keep the system correct by global standards.

User journey:
1. **Register** a company workspace.
2. **Onboarding (5 steps):** industry, what they sell (products/services, stock, purchasing), customers and lead channels, teams, and challenges.
3. **Suggestion:** industry templates are scored against the answers (match % plus reasons). The chosen one is tailored: extra modules, reports and automations for each challenge, and roles for each team.
4. **Builder:** drag-and-drop fields; pipelines with stage gates and rotting days; a report designer with live preview; When/If/Then automations; rules (validation, scoring, approvals); a role permission matrix; company/tax settings and version history.
5. **Health check & publish:** a validator runs on every change, and publishing is blocked while there are errors. Each publish is a version that can be restored.

Then the team uses the generated app: a dashboard; board, table and calendar views; saved views; generated forms with conditional fields; lead conversion; quotation → invoice; posting with gapless numbering; payments; printable tax invoices; stock with moving-average cost; double-entry accounting with a trial balance and ageing; approvals; notes with @mentions; CSV import/export; search; notifications.

## 2. Architecture

```
crm-builder/src
├── lib/                 pure TypeScript, no React — the "brain"
│   ├── schema.ts        AppSchema types: modules, fields, stages, reports, workflows, roles, rules, approvals
│   ├── roles.ts         module roles (accounts, deals, invoices…) + their required system fields
│   ├── fieldTypes.ts    the 18 field types in the palette
│   ├── templates.ts     9 industry templates
│   ├── recommend.ts     onboarding answers → scored suggestions → generated schema
│   ├── packs.ts         challenges, default reports/automations/roles, smart defaults (rollups, scoring, approvals)
│   ├── validate.ts      guardrails / health check (every reference, pipeline, formula, report, rule)
│   ├── formula.ts       safe arithmetic parser (no eval)
│   ├── engine.ts        runtime: records, stage gates, documents, stock, journals, payments, approvals,
│   │                    workflows, lookups/rollups, scoring, rotting, comments, import, ageing
│   ├── reports.ts       report aggregation
│   ├── seed.ts          sample data (goes through the engine, so the books balance)
│   ├── store.ts         localStorage store + transact() (atomic: an action that throws changes nothing)
│   ├── types.ts         runtime data types (Rec, Workspace, journal, approvals…)
│   └── i18n.ts          English/Arabic for the landing page (+ RTL)
├── pages/               Landing, Auth (register/sign in), Onboarding, Suggest
├── builder/             Builder shell + tabs: Modules, Pipelines, Reports, Automations, Rules, Access (roles), Company (settings)
├── workspace/           the generated app: Shell, Dashboard, ModuleView, RecordPage, ImportModal, Inventory, Accounting, Approvals, Team
└── components/          Chart (SVG charts), Icon, Logo
```

Key rules (guardrails):
- **System fields** of a module role can be renamed and moved but not deleted or retyped. Required companion modules are checked (an invoice needs customers and products).
- You can't delete a field or module that something depends on (formula, report, automation, stage gate, lookup, rollup, rule, approval). A field's type and key lock once records hold data.
- Pipelines: open stages first, exactly one Won and one Lost stage.
- Documents: gapless numbering assigned only when posting succeeds; posted documents are immutable and can only be voided with a full reversal; stock and moving-average cost are calculated by the system; overselling is blocked by default; every posting is a balanced double-entry journal; payments can't exceed the balance.
- Approvals stop counting when the record changes; nobody can approve their own request.
- Automation actions never re-trigger automations, so nothing loops.
- Permissions are enforced in the engine. Finance rights (post, void, pay) are separate from edit rights.

Egypt defaults: EGP, 14% VAT, the 27 governorates, tax registration number on invoices, InstaPay, a Saturday-first calendar, Arabic landing page (RTL).

## 3. How to rebuild this project from this file

1. Create a folder `crm-builder/` and recreate every file below at its exact path (each section header is the path).
2. Run:
   ```bash
   cd crm-builder
   npm install          # package-lock.json is not included; npm generates it
   npm test             # 33 tests should pass
   npm run dev          # http://localhost:5173
   npm run build
   ```
3. To deploy on Vercel: Root Directory = `crm-builder` (`vercel.json` is included).

## 4. Known gaps / next steps

- **Hosted backend & real accounts** (e.g. Supabase/Postgres with row-level security per workspace), invitations, password reset; the engine is pure TS and can run server-side.
- Egypt **ETA e-invoicing** submission (the data is already captured).
- WhatsApp Business integration, AI features (AI fields and summaries need the backend), web-to-lead forms.
- Arabic across the whole app (only the landing page, industry names and challenges are bilingual today).
- Credit notes, multiple warehouses, withholding tax, profit-and-loss and balance sheet, multi-currency documents.

---

## 5. Source files (55 files)

### `crm-builder/README.md`

````markdown
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
cd crm-builder
npm install
npm run dev      # http://localhost:5173
npm test         # engine, validator, templates, formulas
npm run build
```

To deploy on Vercel, create a project with **Root Directory = `crm-builder`**. It is a static single-page app, and `vercel.json` handles the routes.

## What this version is, and what comes next

This is a **working, local-first product**. Every workspace, schema and record is stored in the browser (`localStorage`), so anyone can try it with no setup. The data model maps one-to-one onto a hosted backend: a workspace becomes a tenant, the schema is stored as a versioned JSON document, and records go in a JSONB table. The engine is pure TypeScript and can run on the server unchanged.

Before a public launch:

- **Hosted backend & real accounts:** multi-tenant database (e.g. Postgres/Supabase with row-level security per workspace), server-side enforcement of the engine, e-mail invitations, password reset and SSO.
- **Egypt ETA e-invoicing / e-receipt** submission (the tax ID and VAT data are already captured).
- **Integrations:** WhatsApp Business for leads and reminders, e-mail, and Excel/CSV **import** with field mapping.
- **Arabic across the whole app** (the landing page, industry names and challenges are bilingual today).
- **More ERP depth:** credit notes, multiple warehouses, withholding tax, a profit-and-loss and balance sheet, and multi-currency documents.
````

### `crm-builder/package.json`

````json
{
  "name": "bonyan-crm-builder",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "oxlint",
    "preview": "vite preview"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "lucide-react": "^1.59.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "react-router-dom": "^7.18.4"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "oxlint": "^1.88.0",
    "typescript": "~7.0.2",
    "vite": "^8.3.4",
    "vitest": "^5.0.5"
  },
  "engines": {
    "node": ">=20.19"
  }
}
````

### `crm-builder/.gitignore`

````
node_modules
dist
*.local
````

### `crm-builder/.oxlintrc.json`

````json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
````

### `crm-builder/index.html`

````html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Bonyan — build the CRM and ERP your business actually runs on. Drag-and-drop modules, fields, pipelines, reports and automations, with guardrails that keep everything correct." />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <title>Bonyan — Build your own CRM & ERP</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
````

### `crm-builder/tsconfig.app.json`

````json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "allowArbitraryExtensions": true,
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
````

### `crm-builder/tsconfig.json`

````json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
````

### `crm-builder/tsconfig.node.json`

````json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "module": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
````

### `crm-builder/vercel.json`

````json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
````

### `crm-builder/vite.config.ts`

````ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
````

### `crm-builder/public/favicon.svg`

````svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M8 22V10h4v12zm6 0V14h4v8zm6 0v-5h4v5z" fill="#fff"/></svg>
````

### `crm-builder/src/App.tsx`

````tsx
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Onboarding from './pages/Onboarding'
import Suggest from './pages/Suggest'

const Builder = lazy(() => import('./builder/Builder'))
const Shell = lazy(() => import('./workspace/Shell'))
const Dashboard = lazy(() => import('./workspace/Dashboard'))
const ModuleView = lazy(() => import('./workspace/ModuleView'))
const RecordPage = lazy(() => import('./workspace/RecordPage'))
const Inventory = lazy(() => import('./workspace/Inventory'))
const Accounting = lazy(() => import('./workspace/Accounting'))
const Team = lazy(() => import('./workspace/Team'))
const Approvals = lazy(() => import('./workspace/Approvals'))
import { currentUser, currentWorkspace, useStore } from './lib/store'

/** Sends each person to the right step of the journey: register → onboarding → builder → app. */
function Guard({ need, children }: { need: 'session' | 'draft' | 'published' | 'admin'; children: React.ReactNode }) {
  const ws = useStore((s) => currentWorkspace(s))
  const user = useStore((s) => currentUser(s))
  if (!ws || !user) return <Navigate to="/signin" replace />
  const isAdmin = user.roleId === 'role_admin'
  if (need === 'published' && !ws.published) return <Navigate to={ws.draft ? '/builder' : '/onboarding'} replace />
  if ((need === 'draft' || need === 'admin') && !isAdmin) return <Navigate to="/app" replace />
  if (need === 'draft' && !ws.draft) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function Home() {
  const ws = useStore((s) => currentWorkspace(s))
  if (!ws) return <Landing />
  return <Navigate to={ws.published ? '/app' : ws.draft ? '/builder' : '/onboarding'} replace />
}

export default function App() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<Landing />} />
      <Route path="/register" element={<Auth mode="register" />} />
      <Route path="/signin" element={<Auth mode="signin" />} />
      <Route path="/onboarding" element={<Guard need="admin"><Onboarding /></Guard>} />
      <Route path="/suggest" element={<Guard need="admin"><Suggest /></Guard>} />
      <Route path="/builder" element={<Guard need="draft"><Builder /></Guard>} />
      <Route path="/app" element={<Guard need="published"><Shell /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="m/:moduleId" element={<ModuleView />} />
        <Route path="r/:id" element={<RecordPage />} />
        <Route path="new/:moduleId" element={<RecordPage />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="accounting" element={<Accounting />} />
        <Route path="team" element={<Team />} />
        <Route path="approvals" element={<Approvals />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
````

### `crm-builder/src/builder/AutomationsTab.tsx`

````tsx
import { Bell, CheckCircle2, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { FilterRow, fieldOptions } from './ReportsTab'
import type { ActionDef, ModuleDef, TriggerType, WorkflowDef } from '../lib/schema'
import { moduleById, moduleByRole, uid } from '../lib/schema'

const TRIGGERS: { id: TriggerType; label: string }[] = [
  { id: 'created', label: 'A record is created' },
  { id: 'updated', label: 'A record is updated' },
  { id: 'stage_changed', label: 'A record moves to a stage' },
  { id: 'date_passed', label: 'A date has passed' },
]

export default function AutomationsTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { schema, edit, issues } = useDraft()
  const wf = schema.workflows.find((w) => w.id === focus.itemId) ?? schema.workflows[0]

  function add() {
    const m = schema.modules.find((x) => x.role === 'deals') ?? schema.modules[0]
    const w: WorkflowDef = { id: uid('w'), name: 'New automation', module: m.id, enabled: true, trigger: { type: 'created' }, conditions: [], actions: [] }
    edit((s) => s.workflows.push(w))
    setFocus({ itemId: w.id })
  }

  return (
    <div className="two">
      <div className="pane side">
        <div className="row between"><h3 style={{ margin: 0 }}>Automations</h3><button className="ghost icon" onClick={add}><Plus size={16} /></button></div>
        {schema.workflows.map((w) => (
          <button key={w.id} className={`mod-item ${w.id === wf?.id ? 'on' : ''}`} onClick={() => setFocus({ itemId: w.id })}>
            <span className="badge" style={{ background: w.enabled ? '#f59e0b' : '#94a3b8' }}><Zap size={14} /></span>
            <span className="grow small" style={{ textAlign: 'start' }}>{w.name}<br /><span className="tiny muted">{moduleById(schema, w.module)?.name} · {w.enabled ? 'on' : 'off'}</span></span>
            {issues.some((i) => i.itemId === w.id && i.level === 'error') && <span className="err" />}
          </button>
        ))}
        <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={add}><Plus size={16} /> New automation</button>
        <p className="tiny muted" style={{ marginTop: 12 }}>Automations run when records change, and date checks run every time the app opens. An action never triggers another automation, so they can’t loop.</p>
      </div>
      <div className="pane">{wf ? <Editor key={wf.id} wf={wf} onDeleted={() => setFocus({})} /> : <div className="empty">No automations yet.</div>}</div>
    </div>
  )
}

function Editor({ wf, onDeleted }: { wf: WorkflowDef; onDeleted: () => void }) {
  const { schema, edit, issues } = useDraft()
  const mod = moduleById(schema, wf.module) as ModuleDef
  const set = (fn: (w: WorkflowDef) => void) => edit((s) => fn(s.workflows.find((x) => x.id === wf.id)!))
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const dateFields = mod.fields.filter((f) => f.type === 'date')
  const errs = issues.filter((i) => i.itemId === wf.id)
  const hasTasks = Boolean(moduleByRole(schema, 'tasks'))
  const placeholders = mod.fields.filter((f) => !f.readOnly).slice(0, 8)

  const addAction = (type: ActionDef['type']) =>
    set((w) => {
      if (type === 'create_task') w.actions.push({ type, title: `Follow up {${mod.titleField}}`, dueInDays: 1 })
      if (type === 'notify') w.actions.push({ type, message: `Update on {${mod.titleField}}` })
      if (type === 'set_field') {
        const f = mod.fields.find((x) => !x.readOnly && !x.system && x.type !== 'formula')
        w.actions.push({ type, field: f?.key ?? '', value: '' })
      }
    })

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="row">
        <Pencil size={16} className="muted" />
        <input value={wf.name} onChange={(e) => set((w) => (w.name = e.target.value))} style={{ fontSize: '1.2rem', fontWeight: 700, maxWidth: 460 }} />
        <span className="grow" />
        <label className="inline"><input type="checkbox" checked={wf.enabled} onChange={(e) => set((w) => (w.enabled = e.target.checked))} /> On</label>
        <button className="danger" onClick={() => { edit((s) => { s.workflows = s.workflows.filter((x) => x.id !== wf.id) }); onDeleted() }}><Trash2 size={15} /></button>
      </div>
      <div className="flow">
        <div className="flow-node" style={{ ['--c' as string]: '#6366f1' }}>
          <div className="tag">When</div>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field">In
              <select value={wf.module} onChange={(e) => set((w) => { w.module = e.target.value; w.conditions = []; w.trigger = { type: 'created' }; w.actions = [] })}>
                {schema.modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="field">Event
              <select value={wf.trigger.type} onChange={(e) => set((w) => { w.trigger = { type: e.target.value as TriggerType, stage: undefined, field: e.target.value === 'date_passed' ? dateFields[0]?.key : undefined } })}>
                {TRIGGERS.filter((t) => t.id !== 'stage_changed' || mod.stages).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {wf.trigger.type === 'stage_changed' && (
              <label className="field">Stage
                <select value={wf.trigger.stage ?? ''} onChange={(e) => set((w) => (w.trigger.stage = e.target.value || undefined))}>
                  <option value="">Any stage</option>
                  {mod.stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            {wf.trigger.type === 'date_passed' && (
              <label className="field">Date field
                <select value={wf.trigger.field ?? ''} onChange={(e) => set((w) => (w.trigger.field = e.target.value))}>
                  {dateFields.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        <div className="flow-line" />
        <div className="flow-node" style={{ ['--c' as string]: '#a855f7' }}>
          <div className="tag">Only if</div>
          <div style={{ marginTop: 8 }}>
            {wf.conditions.length === 0 && <p className="small muted" style={{ margin: '0 0 8px' }}>Always — for every record.</p>}
            {wf.conditions.map((c, i) => (
              <FilterRow key={i} mod={mod} filter={c} label={label(c.field)} onChange={(nc) => set((w) => (w.conditions[i] = nc))} onRemove={() => set((w) => w.conditions.splice(i, 1))} />
            ))}
            <select value="" onChange={(e) => e.target.value && set((w) => w.conditions.push({ field: e.target.value, op: 'eq', value: '' }))} style={{ width: 'auto' }}>
              <option value="">+ Add condition…</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flow-line" />
        {wf.actions.map((a, i) => (
          <div key={i}>
            <div className="flow-node" style={{ ['--c' as string]: a.type === 'notify' ? '#ec4899' : a.type === 'create_task' ? '#10b981' : '#f59e0b' }}>
              <div className="row between">
                <div className="tag">Then · {a.type === 'create_task' ? 'create a task' : a.type === 'notify' ? 'send a notification' : 'set a field'}</div>
                <button className="ghost icon" onClick={() => set((w) => w.actions.splice(i, 1))}><Trash2 size={14} /></button>
              </div>
              {a.type === 'create_task' && (
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <label className="field w2">Task title<input value={a.title} onChange={(e) => set((w) => ((w.actions[i] as typeof a).title = e.target.value))} /></label>
                  <label className="field">Due in (days)<input type="number" min={0} value={a.dueInDays} onChange={(e) => set((w) => ((w.actions[i] as typeof a).dueInDays = Math.max(0, Number(e.target.value))))} /></label>
                  <span className="tiny muted" style={{ alignSelf: 'end' }}>Assigned to the record’s owner.</span>
                </div>
              )}
              {a.type === 'notify' && (
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <label className="field w2">Message<input value={a.message} onChange={(e) => set((w) => ((w.actions[i] as typeof a).message = e.target.value))} /></label>
                </div>
              )}
              {a.type === 'set_field' && (
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <label className="field">Field
                    <select value={a.field} onChange={(e) => set((w) => ((w.actions[i] as typeof a).field = e.target.value))}>
                      {mod.fields.filter((f) => !f.readOnly && f.type !== 'formula' && f.type !== 'relation').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  {(() => {
                    const f = mod.fields.find((x) => x.key === a.field)
                    const setV = (v: string) => set((w) => ((w.actions[i] as typeof a).value = v))
                    if (f?.options) return <label className="field">Value<select value={a.value} onChange={(e) => setV(e.target.value)}><option value="">—</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                    if (f?.type === 'checkbox') return <label className="field">Value<select value={a.value} onChange={(e) => setV(e.target.value)}><option value="true">Yes</option><option value="false">No</option></select></label>
                    return <label className="field">Value<input value={a.value} onChange={(e) => setV(e.target.value)} /></label>
                  })()}
                </div>
              )}
              {a.type !== 'set_field' && (
                <div className="chips" style={{ marginTop: 8 }}>
                  <span className="tiny muted">Insert:</span>
                  {placeholders.map((f) => (
                    <button key={f.id} type="button" className="chip tiny" style={{ padding: '3px 8px', fontSize: '0.72rem' }} onClick={() => set((w) => {
                      const act = w.actions[i]
                      if (act.type === 'create_task') act.title += ` {${f.key}}`
                      if (act.type === 'notify') act.message += ` {${f.key}}`
                    })}>{f.label}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="flow-line" />
          </div>
        ))}
        <div className="row">
          <button className="secondary" onClick={() => addAction('create_task')} disabled={!hasTasks} title={hasTasks ? '' : 'Add a Tasks module first'}><CheckCircle2 size={15} /> Create task</button>
          <button className="secondary" onClick={() => addAction('notify')}><Bell size={15} /> Notify</button>
          <button className="secondary" onClick={() => addAction('set_field')}><Pencil size={15} /> Set field</button>
        </div>
      </div>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{e.message}</div>)}
    </div>
  )
}
````

### `crm-builder/src/builder/Builder.tsx`

````tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, Kanban, LayoutDashboard, Rocket, Settings, Shield, ShieldAlert, X, Zap, Layers } from 'lucide-react'
import { Logo } from '../components/Logo'
import { useDraft } from './useDraft'
import { healthScore, type Issue, type Tab } from '../lib/validate'
import { update } from '../lib/store'
import { seedSampleData } from '../lib/seed'
import ModulesTab from './ModulesTab'
import PipelinesTab from './PipelinesTab'
import ReportsTab from './ReportsTab'
import AutomationsTab from './AutomationsTab'
import RolesTab from './RolesTab'
import SettingsTab from './SettingsTab'
import RulesTab from './RulesTab'

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'modules', label: 'Modules', icon: Layers },
  { id: 'pipelines', label: 'Pipelines', icon: Kanban },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'rules', label: 'Rules & approvals', icon: ShieldAlert },
  { id: 'roles', label: 'Access', icon: Shield },
  { id: 'settings', label: 'Company', icon: Settings },
]

export interface Focus {
  moduleId?: string
  fieldId?: string
  itemId?: string
}

export default function Builder() {
  const nav = useNavigate()
  const { ws, schema, issues } = useDraft()
  const [tab, setTab] = useState<Tab>('modules')
  const [focus, setFocus] = useState<Focus>({ moduleId: schema.modules[0]?.id })
  const [health, setHealth] = useState(false)
  const [published, setPublished] = useState('')
  const score = healthScore(issues)
  const errors = issues.filter((i) => i.level === 'error')
  const byTab = (t: Tab) => errors.filter((i) => i.tab === t).length

  function go(i: Issue) {
    setTab(i.tab)
    setFocus({ moduleId: i.moduleId, fieldId: i.fieldId, itemId: i.itemId })
    setHealth(false)
  }

  function publish() {
    if (errors.length) {
      setHealth(true)
      return
    }
    const first = !ws.published
    update((s) => {
      const w = s.workspaces[ws.id]
      const version = (w.published?.version ?? 0) + 1
      const snapshot = structuredClone({ ...w.draft!, version })
      w.draft = structuredClone(snapshot)
      w.published = snapshot
      w.history.unshift({ version, at: new Date().toISOString(), note: first ? 'First version' : `Version ${version}`, schema: snapshot })
      w.history = w.history.slice(0, 20)
      if (first && w.seedOnPublish) {
        const admin = w.users.find((u) => u.roleId === 'role_admin') ?? w.users[0]
        const names = w.answers.products.split('\n').map((x) => x.trim()).filter(Boolean)
        seedSampleData(w, snapshot, admin, names)
        w.seedOnPublish = false
      }
    })
    if (first) nav('/app')
    else setPublished(`Version ${(ws.published?.version ?? 0) + 1} is live`)
  }

  const ringColor = score >= 90 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="builder">
      <div className="btop">
        <Logo />
        <div className="btabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              <t.icon size={16} /> {t.label} {byTab(t.id) > 0 && <span className="count">{byTab(t.id)}</span>}
            </button>
          ))}
        </div>
        <button className="health-btn" onClick={() => setHealth(true)} title="System health check">
          {errors.length ? <AlertTriangle size={16} color="#fca5a5" /> : <CheckCircle2 size={16} color="#6ee7b7" />} Health {score}%
        </button>
        {ws.published && <Link to="/app" className="btn secondary" style={{ background: 'transparent', color: '#fff', borderColor: '#ffffff33' }}><LayoutDashboard size={16} /> Open app</Link>}
        <button className="glow" onClick={publish}><Rocket size={16} /> {ws.published ? 'Publish changes' : 'Publish & go live'}</button>
      </div>
      <div className="bbody">
        {tab === 'modules' && <ModulesTab focus={focus} setFocus={setFocus} />}
        {tab === 'pipelines' && <PipelinesTab focus={focus} setFocus={setFocus} />}
        {tab === 'reports' && <ReportsTab focus={focus} setFocus={setFocus} />}
        {tab === 'automations' && <AutomationsTab focus={focus} setFocus={setFocus} />}
        {tab === 'rules' && <RulesTab focus={focus} setFocus={setFocus} />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>

      {health && (
        <>
          <div className="overlay" onClick={() => setHealth(false)} />
          <aside className="health">
            <div className="health-head">
              <div className="health-ring" style={{ ['--p' as string]: score, ['--c' as string]: ringColor }}><span>{score}%</span></div>
              <div className="grow">
                <h2 style={{ margin: 0 }}>System health</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  {errors.length ? `${errors.length} problem${errors.length > 1 ? 's' : ''} must be fixed before publishing.` : 'Everything checks out. Your system is ready to publish.'}
                </p>
              </div>
              <button className="ghost icon" onClick={() => setHealth(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {issues.length === 0 && (
                <div className="empty">
                  <div className="big-ic" style={{ background: 'linear-gradient(135deg,#10b981,#06b6d4)' }}><CheckCircle2 size={34} /></div>
                  <b>All {schema.modules.length} modules, {schema.reports.length} reports and {schema.workflows.length} automations pass every check.</b>
                  <p className="small">Data links, formulas, pipelines, stock and accounting rules are consistent.</p>
                </div>
              )}
              {issues.map((i, n) => (
                <button key={n} className="issue" onClick={() => go(i)}>
                  {i.level === 'error' ? <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0 }} /> : <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />}
                  <span className="grow">
                    <span>{i.message}</span>
                    <br />
                    <span className="tiny muted">{i.level === 'error' ? 'Must fix' : 'Suggestion'} · {TABS.find((t) => t.id === i.tab)?.label}</span>
                  </span>
                </button>
              ))}
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
              <button className="glow" style={{ width: '100%' }} disabled={errors.length > 0} onClick={() => { setHealth(false); publish() }}><Rocket size={16} /> Publish</button>
            </div>
          </aside>
        </>
      )}
      {published && (
        <div className="toast ok-box row" onAnimationEnd={() => setTimeout(() => setPublished(''), 2500)}>
          <CheckCircle2 size={18} /> {published}. Your team sees the changes now.
        </div>
      )}
    </div>
  )
}
````

### `crm-builder/src/builder/ModulesTab.tsx`

````tsx
import { useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ChevronDown, GripVertical, Lock, Plus, Trash2, X } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { FIELD_TYPES, PALETTE, newField, typeInfo } from '../lib/fieldTypes'
import { Icon, MODULE_ICON_CHOICES } from '../components/Icon'
import type { FieldDef, FieldType, ModuleDef, ModuleRole } from '../lib/schema'
import { NUMERIC_TYPES, isNumeric, slugKey, uid } from '../lib/schema'
import { ROLES, buildModule } from '../lib/roles'
import { fieldDependents, moduleDependents } from '../lib/validate'
import { formulaRefs } from '../lib/formula'

interface Props {
  focus: Focus
  setFocus: (f: Focus) => void
}

export default function ModulesTab({ focus, setFocus }: Props) {
  const { schema, issues, edit } = useDraft()
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const mod = schema.modules.find((m) => m.id === focus.moduleId) ?? schema.modules[0]
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const selected = mod?.fields.find((f) => f.id === focus.fieldId)
  const editMod = (fn: (m: ModuleDef) => void) => edit((s) => fn(s.modules.find((m) => m.id === mod.id)!))

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    if (activeId.startsWith('pal:')) {
      const type = activeId.slice(4) as FieldType
      const field = newField(type, mod.fields.map((f) => f.key))
      if (type === 'relation') field.target = schema.modules.find((m) => m.id !== mod.id)?.id
      if (type === 'formula') field.formula = mod.fields.filter((f) => isNumeric(f)).slice(0, 2).map((f) => f.key).join(' * ')
      if (type === 'lookup') {
        const via = mod.fields.find((f) => f.type === 'relation')
        const target = schema.modules.find((m) => m.id === via?.target)
        field.lookup = { via: via?.key ?? '', field: target?.fields.find((f) => f.key !== target.titleField)?.key ?? target?.titleField ?? '' }
        field.label = target ? `${target.singular} ${target.fields.find((f) => f.key === field.lookup!.field)?.label.toLowerCase() ?? ''}`.trim() : 'Lookup'
      }
      if (type === 'rollup') {
        const child = schema.modules.find((m) => m.id !== mod.id && m.fields.some((f) => f.type === 'relation' && f.target === mod.id))
        const via = child?.fields.find((f) => f.type === 'relation' && f.target === mod.id)
        field.rollup = { module: child?.id ?? '', via: via?.key ?? '', op: 'count' }
        field.label = child ? `Number of ${child.name.toLowerCase()}` : 'Rollup'
      }
      editMod((m) => {
        const idx = m.fields.findIndex((f) => f.id === over.id)
        m.fields.splice(idx < 0 ? m.fields.length : idx, 0, field)
      })
      setFocus({ moduleId: mod.id, fieldId: field.id })
      return
    }
    if (active.id !== over.id && over.id !== 'canvas') {
      editMod((m) => {
        const from = m.fields.findIndex((f) => f.id === active.id)
        const to = m.fields.findIndex((f) => f.id === over.id)
        if (from >= 0 && to >= 0) m.fields = arrayMove(m.fields, from, to)
      })
    }
  }

  if (!mod) return null
  const modErrors = (id: string) => issues.some((i) => i.level === 'error' && i.moduleId === id && i.tab === 'modules')

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="three">
        <div className="pane side">
          <h3>Modules</h3>
          {schema.modules.map((m) => (
            <button key={m.id} className={`mod-item ${m.id === mod.id ? 'on' : ''}`} onClick={() => setFocus({ moduleId: m.id })}>
              <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
              <span className="grow" style={{ textAlign: 'start' }}>{m.name}<br /><span className="tiny muted">{m.fields.length} fields · {m.role === 'custom' ? 'custom' : ROLES[m.role].label}</span></span>
              {modErrors(m.id) && <span className="err" />}
            </button>
          ))}
          <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setAdding(true)}><Plus size={16} /> Add module</button>
        </div>

        <div className="pane canvas">
          <div className="palette-bar">
            <b className="small">Drag a field onto the form</b>
            <div className="palette">
              {FIELD_TYPES.map((t) => <PaletteItem key={t.type} type={t.type} />)}
            </div>
            <span className="tiny muted">Drag fields on the form to reorder them. Click one to edit it.</span>
          </div>
          <div className="form-preview">
            <div className="form-head" style={{ background: `linear-gradient(135deg, ${mod.color}, ${mod.color}bb)` }}>
              <Icon name={mod.icon} size={26} />
              <input value={mod.name} onChange={(e) => editMod((m) => (m.name = e.target.value))} aria-label="Module name" />
              <span className="grow" />
              <span className="pill" style={{ background: '#ffffff26', color: '#fff' }}>{mod.role === 'custom' ? 'Custom module' : ROLES[mod.role].label}</span>
            </div>
            {mod.role !== 'custom' && <div className="info" style={{ margin: '14px 18px 0' }}>{ROLES[mod.role].description} Fields with a <Lock size={12} /> keep this working — rename and move them freely.</div>}
            {mod.lines && <div className="note" style={{ margin: '10px 18px 0' }}>This is a document: it also gets a product lines table with quantity, price, discount and VAT. Totals are calculated by the system.</div>}
            <Canvas mod={mod} selectedId={focus.fieldId} onSelect={(id) => setFocus({ moduleId: mod.id, fieldId: id })} />
          </div>
        </div>

        <div className="pane props">
          {selected ? <FieldProps key={selected.id} mod={mod} field={selected} onClose={() => setFocus({ moduleId: mod.id })} /> : <ModuleProps mod={mod} onDeleted={() => setFocus({ moduleId: schema.modules.find((m) => m.id !== mod.id)?.id })} />}
        </div>
      </div>
      <DragOverlay>
        {dragging?.startsWith('pal:') && (
          <div className="ghost-card"><Icon name={typeInfo(dragging.slice(4) as FieldType).icon} size={16} /> {typeInfo(dragging.slice(4) as FieldType).label}</div>
        )}
      </DragOverlay>
      {adding && <AddModule onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); setFocus({ moduleId: id }) }} />}
    </DndContext>
  )
}

function PaletteItem({ type }: { type: FieldType }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `pal:${type}` })
  const info = typeInfo(type)
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="pal-item" title={info.hint}>
      <Icon name={info.icon} size={15} /> {info.label}
    </div>
  )
}

function Canvas({ mod, selectedId, onSelect }: { mod: ModuleDef; selectedId?: string; onSelect: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' })
  return (
    <SortableContext items={mod.fields.map((f) => f.id)} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} className={`drop-zone ${isOver ? 'over' : ''}`}>
        {mod.fields.map((f) => <FieldCard key={f.id} field={f} selected={f.id === selectedId} title={f.key === mod.titleField} onSelect={() => onSelect(f.id)} />)}
        {mod.fields.length === 0 && <div className="empty" style={{ gridColumn: 'span 2' }}>Drop fields here</div>}
      </div>
    </SortableContext>
  )
}

function FieldCard({ field, selected, title, onSelect }: { field: FieldDef; selected: boolean; title: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const info = typeInfo(field.type)
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`fcard ${field.width === 2 ? 'w2' : ''} ${selected ? 'sel' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onSelect}>
      <div className="fl">
        <span className="grip" {...listeners} {...attributes} aria-label="Drag to move"><GripVertical size={14} /></span>
        <Icon name={info.icon} size={14} />
        <span>{field.label || <i className="muted">Untitled</i>}{field.required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
        <span className="tags">
          {title && <span className="pill gray tiny">Title</span>}
          {field.readOnly && <span className="pill amber tiny">Auto</span>}
          {field.showIf && <span className="pill tiny">If</span>}
          {field.system && <Lock size={12} className="lock" />}
        </span>
      </div>
      <div className="fake">
        {field.type === 'select' || field.type === 'multiselect' ? (
          <>{field.options?.slice(0, 3).map((o) => <span key={o.value} className="pill tiny" style={{ background: o.color + '22', color: o.color }}>{o.label}</span>)}<ChevronDown size={14} style={{ marginInlineStart: 'auto' }} /></>
        ) : field.type === 'lookup' || field.type === 'rollup' ? <span className="tiny">{field.type === 'lookup' ? 'From the linked record' : 'Calculated from linked records'}{field.showIf ? ' · conditional' : ''}</span> : field.type === 'checkbox' ? '☐ Yes / No' : field.type === 'formula' ? <span className="mono tiny">= {field.formula || '…'}</span> : field.type === 'rating' ? '★★★★★' : field.type === 'longtext' ? 'Notes…' : field.readOnly ? 'Calculated by the system' : info.hint}
      </div>
    </div>
  )
}

function FieldProps({ mod, field, onClose }: { mod: ModuleDef; field: FieldDef; onClose: () => void }) {
  const { ws, schema, edit, valuesIn } = useDraft()
  const [msg, setMsg] = useState('')
  const optionCount = (value: string) =>
    (ws.data.records[mod.id] ?? []).filter((r) => r.values[field.key] === value || (Array.isArray(r.values[field.key]) && (r.values[field.key] as string[]).includes(value))).length
  const used = valuesIn(mod.id, field.key)
  const deps = fieldDependents(schema, mod, field.key).filter((d) => !d.startsWith('it is required'))
  const fresh = !field.system && used === 0 && deps.length === 0
  const set = (patch: Partial<FieldDef>) =>
    edit((s) => {
      const m = s.modules.find((x) => x.id === mod.id)!
      const f = m.fields.find((x) => x.id === field.id)!
      Object.assign(f, patch)
      if (patch.label !== undefined && fresh) {
        let key = slugKey(patch.label)
        if (!/^[a-z]/.test(key)) key = `f_${key}`
        let n = 2
        const base = key
        while (m.fields.some((x) => x.id !== f.id && x.key === key)) key = `${base}_${n++}`
        f.key = key
      }
    })

  function remove() {
    const all = fieldDependents(schema, mod, field.key)
    if (all.length) return setMsg(`Can’t delete “${field.label}” because ${all.join('; ')}.`)
    if (used && !confirm(`${used} record(s) have a value in “${field.label}”. Delete the field? The values are hidden, and come back if you add a field with the same key.`)) return
    edit((s) => {
      const m = s.modules.find((x) => x.id === mod.id)!
      m.fields = m.fields.filter((x) => x.id !== field.id)
    })
    onClose()
  }

  function changeType(type: FieldType) {
    if (field.system) return setMsg('This field’s type is fixed because the module relies on it.')
    if (used) return setMsg(`${used} record(s) already have data in this field, so its type can’t change. Add a new field instead.`)
    const patch: Partial<FieldDef> = { type, options: undefined, target: undefined, formula: undefined, unique: undefined }
    if (type === 'select' || type === 'multiselect') patch.options = field.options ?? newField(type, []).options
    if (type === 'relation') patch.target = schema.modules.find((m) => m.id !== mod.id)?.id
    if (type === 'formula') patch.formula = ''
    set(patch)
  }

  const numericFields = mod.fields.filter((f) => f.id !== field.id && NUMERIC_TYPES.includes(f.type))
  let formulaError = ''
  if (field.type === 'formula') {
    try {
      for (const r of formulaRefs(field.formula ?? '')) if (!numericFields.some((f) => f.key === r)) formulaError = `“${r}” is not a number field in this module`
    } catch (e) {
      formulaError = (e as Error).message
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Field</h2>
        <button className="ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      {field.system && <div className="info"><Lock size={13} /> {field.readOnly ? 'Calculated by the system. You can rename and move it.' : `Required by ${ROLES[mod.role].label}. You can rename it, move it and change its help text.`}</div>}
      <label className="field">Label<input value={field.label} onChange={(e) => set({ label: e.target.value })} /></label>
      <div className="tiny muted">Internal key: <span className="mono">{field.key}</span>{!fresh && ' (locked — it is in use)'}</div>
      <label className="field">Type
        <select value={field.type} onChange={(e) => changeType(e.target.value as FieldType)} disabled={field.system}>
          {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </label>
      <label className="field">Help text<input value={field.help ?? ''} onChange={(e) => set({ help: e.target.value })} placeholder="Shown under the field" /></label>
      <div className="seg">
        <button type="button" className={field.width !== 2 ? 'on' : ''} onClick={() => set({ width: 1 })}>Half width</button>
        <button type="button" className={field.width === 2 ? 'on' : ''} onClick={() => set({ width: 2 })}>Full width</button>
      </div>
      {!field.readOnly && !['formula', 'lookup', 'rollup'].includes(field.type) && (
        <label className="inline"><input type="checkbox" checked={Boolean(field.required)} disabled={field.system && field.required} onChange={(e) => set({ required: e.target.checked })} /> Required</label>
      )}
      {['text', 'email', 'phone'].includes(field.type) && (
        <label className="inline"><input type="checkbox" checked={Boolean(field.unique)} disabled={field.system && field.unique} onChange={(e) => set({ unique: e.target.checked })} /> No duplicates</label>
      )}
      <label className="inline"><input type="checkbox" checked={Boolean(field.inList)} onChange={(e) => set({ inList: e.target.checked })} /> Show as a column in lists</label>
      {mod.titleField !== field.key && ['text'].includes(field.type) && mod.role === 'custom' && (
        <button className="secondary" onClick={() => edit((s) => (s.modules.find((m) => m.id === mod.id)!.titleField = field.key))}>Use as record title</button>
      )}

      {(field.type === 'select' || field.type === 'multiselect') && (
        <>
          <hr />
          <b>Options</b>
          {(field.options ?? []).map((o, i) => (
            <div className="opt-row" key={o.value}>
              <input type="color" value={o.color} onChange={(e) => set({ options: field.options!.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
              <input value={o.label} onChange={(e) => set({ options: field.options!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <button className="ghost icon" aria-label="Remove option" onClick={() => {
                const inUse = optionCount(o.value)
                if (inUse) return setMsg(`${inUse} record(s) use “${o.label}”. Change them first, or rename the option instead.`)
                if ((field.options?.length ?? 0) <= 1) return setMsg('A dropdown needs at least one option.')
                set({ options: field.options!.filter((_, j) => j !== i) })
              }}><X size={14} /></button>
            </div>
          ))}
          <button className="secondary" onClick={() => {
            const label = `Option ${(field.options?.length ?? 0) + 1}`
            set({ options: [...(field.options ?? []), { value: `${slugKey(label)}_${uid('o').slice(-4)}`, label, color: PALETTE[(field.options?.length ?? 0) % PALETTE.length] }] })
          }}><Plus size={14} /> Add option</button>
        </>
      )}

      {field.type === 'lookup' && (
        <>
          <hr />
          <b>Lookup</b>
          <label className="field">Through link
            <select value={field.lookup?.via ?? ''} onChange={(e) => set({ lookup: { via: e.target.value, field: '' } })}>
              <option value="">—</option>
              {mod.fields.filter((f) => f.type === 'relation').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          {(() => {
            const target = schema.modules.find((m) => m.id === mod.fields.find((f) => f.key === field.lookup?.via)?.target)
            return target ? (
              <label className="field">Show {target.singular.toLowerCase()}’s
                <select value={field.lookup?.field ?? ''} onChange={(e) => set({ lookup: { via: field.lookup!.via, field: e.target.value } })}>
                  <option value="">—</option>
                  {target.fields.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            ) : null
          })()}
        </>
      )}

      {field.type === 'rollup' && (() => {
        const children = schema.modules.filter((m) => m.fields.some((f) => f.type === 'relation' && f.target === mod.id))
        const child = schema.modules.find((m) => m.id === field.rollup?.module)
        const r = field.rollup ?? { module: '', via: '', op: 'count' as const }
        return (
          <>
            <hr />
            <b>Rollup</b>
            <label className="field">Add up records from
              <select value={r.module} onChange={(e) => {
                const m = schema.modules.find((x) => x.id === e.target.value)
                set({ rollup: { module: e.target.value, via: m?.fields.find((f) => f.type === 'relation' && f.target === mod.id)?.key ?? '', op: 'count' } })
              }}>
                <option value="">—</option>
                {children.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            {child && (
              <>
                <label className="field">Linked through
                  <select value={r.via} onChange={(e) => set({ rollup: { ...r, via: e.target.value } })}>
                    {child.fields.filter((f) => f.type === 'relation' && f.target === mod.id).map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                  </select>
                </label>
                <div className="form-grid">
                  <label className="field">Calculation
                    <select value={r.op} onChange={(e) => set({ rollup: { ...r, op: e.target.value as typeof r.op, field: e.target.value === 'count' ? undefined : r.field ?? child.fields.find((f) => isNumeric(f))?.key } })}>
                      <option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Lowest</option><option value="max">Highest</option>
                    </select>
                  </label>
                  {r.op !== 'count' && (
                    <label className="field">Of
                      <select value={r.field ?? ''} onChange={(e) => set({ rollup: { ...r, field: e.target.value } })}>
                        {child.fields.filter((f) => isNumeric(f)).map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </>
            )}
            {children.length === 0 && <div className="note small">No module links to {mod.name} yet. Add a “Link to record” field in another module first.</div>}
          </>
        )
      })()}

      {!(field.system && field.required) && (
        <>
          <hr />
          <label className="inline"><input type="checkbox" checked={Boolean(field.showIf)} onChange={(e) => set({ showIf: e.target.checked ? { field: mod.fields.find((f) => f.id !== field.id && (f.type === 'select' || f.type === 'checkbox'))?.key ?? mod.fields.find((f) => f.id !== field.id)!.key, op: 'notempty' } : undefined })} /> Show only when…</label>
          {field.showIf && (() => {
            const cond = field.showIf
            const src = mod.fields.find((f) => f.key === cond.field)
            return (
              <div className="stack" style={{ gap: 6 }}>
                <select value={cond.field} onChange={(e) => set({ showIf: { field: e.target.value, op: 'notempty' } })}>
                  {mod.fields.filter((f) => f.id !== field.id && f.type !== 'lookup' && f.type !== 'rollup').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                </select>
                <div className="row" style={{ gap: 6 }}>
                  <select value={cond.op} style={{ width: 'auto' }} onChange={(e) => set({ showIf: { ...cond, op: e.target.value as typeof cond.op } })}>
                    <option value="eq">is</option><option value="neq">is not</option><option value="notempty">is filled</option><option value="empty">is empty</option><option value="gt">greater than</option><option value="lt">less than</option><option value="contains">contains</option>
                  </select>
                  {!['empty', 'notempty'].includes(cond.op) && (src?.options || src?.type === 'checkbox' ? (
                    <select value={cond.value ?? ''} style={{ width: 'auto' }} onChange={(e) => set({ showIf: { ...cond, value: e.target.value } })}>
                      <option value="">—</option>
                      {src?.type === 'checkbox' ? <><option value="true">Yes</option><option value="false">No</option></> : src!.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : <input value={cond.value ?? ''} onChange={(e) => set({ showIf: { ...cond, value: e.target.value } })} style={{ width: 120 }} />)}
                </div>
                <span className="tiny muted">Hidden fields are not required. Like layout rules in Zoho and Odoo.</span>
              </div>
            )
          })()}
        </>
      )}

      {field.type === 'relation' && (
        <label className="field">Links to
          <select value={field.target} disabled={field.system || used > 0} onChange={(e) => set({ target: e.target.value })}>
            {schema.modules.filter((m) => m.id !== mod.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}

      {field.type === 'formula' && (
        <>
          <label className="field">Formula<input className="mono" value={field.formula ?? ''} onChange={(e) => set({ formula: e.target.value })} placeholder="quantity * price" /></label>
          {formulaError ? <div className="error-box small">{formulaError}</div> : field.formula ? <div className="ok-box small">Formula is valid</div> : null}
          <div className="chips">
            {numericFields.map((f) => <button key={f.id} type="button" className="chip tiny" onClick={() => set({ formula: `${field.formula ?? ''}${field.formula ? ' ' : ''}${f.key}` })}>{f.label}</button>)}
            {['+', '-', '*', '/', '(', ')'].map((op) => <button key={op} type="button" className="chip mono" onClick={() => set({ formula: `${field.formula ?? ''} ${op} ` })}>{op}</button>)}
          </div>
        </>
      )}

      {['number', 'currency', 'percent'].includes(field.type) && !field.readOnly && (
        <div className="form-grid">
          <label className="field">Minimum<input type="number" value={field.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label className="field">Maximum<input type="number" value={field.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </div>
      )}

      {deps.length > 0 && <div className="note small">Used by: {deps.join('; ')}</div>}
      {used > 0 && <div className="tiny muted">{used} record(s) have a value here.</div>}
      {msg && <div className="error-box small"><AlertTriangle size={14} /> {msg}</div>}
      {!field.system && <button className="danger" onClick={remove}><Trash2 size={16} /> Delete field</button>}
    </div>
  )
}

function ModuleProps({ mod, onDeleted }: { mod: ModuleDef; onDeleted: () => void }) {
  const { schema, edit, recordCount } = useDraft()
  const [msg, setMsg] = useState('')
  const set = (patch: Partial<ModuleDef>) => edit((s) => Object.assign(s.modules.find((m) => m.id === mod.id)!, patch))
  function remove() {
    const deps = moduleDependents(schema, mod)
    if (deps.length) return setMsg(`Can’t delete “${mod.name}”: ${deps.join('; ')}.`)
    const n = recordCount(mod.id)
    if (n) return setMsg(`“${mod.name}” has ${n} record(s). Delete them in the app first.`)
    if (!confirm(`Delete the “${mod.name}” module?`)) return
    edit((s) => {
      s.modules = s.modules.filter((m) => m.id !== mod.id)
      for (const r of s.roles) delete r.access[mod.id]
    })
    onDeleted()
  }
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Module settings</h2>
      <label className="field">Name (plural)<input value={mod.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="field">One record is called<input value={mod.singular} onChange={(e) => set({ singular: e.target.value })} /></label>
      <b className="small">Colour</b>
      <div className="row">{PALETTE.map((c) => <button key={c} aria-label={c} onClick={() => set({ color: c })} style={{ width: 28, height: 28, borderRadius: 8, padding: 0, background: c, outline: mod.color === c ? '3px solid var(--primary-100)' : 'none' }} />)}</div>
      <b className="small">Icon</b>
      <div className="row">{MODULE_ICON_CHOICES.map((i) => <button key={i} className={mod.icon === i ? '' : 'secondary'} style={{ padding: 7 }} onClick={() => set({ icon: i })} aria-label={i}><Icon name={i} size={16} /></button>)}</div>
      <label className="field">Record title
        <select value={mod.titleField} onChange={(e) => set({ titleField: e.target.value })} disabled={mod.role !== 'custom'}>
          {mod.fields.filter((f) => f.type === 'text' || f.type === 'relation').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      {mod.numberPrefix && <label className="field">Number prefix<input value={mod.numberPrefix} onChange={(e) => set({ numberPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) })} /><span className="tiny muted">Numbers look like {mod.numberPrefix}-{new Date().getFullYear()}-0001 and are given when a document is posted, without gaps.</span></label>}
      <div className="info small">{mod.role === 'custom' ? ROLES.custom.description : ROLES[mod.role].description}</div>
      {msg && <div className="error-box small">{msg}</div>}
      <button className="danger" onClick={remove}><Trash2 size={16} /> Delete module</button>
    </div>
  )
}

function AddModule({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { schema, edit } = useDraft()
  const available = (Object.keys(ROLES) as ModuleRole[]).filter((r) => r === 'custom' || !schema.modules.some((m) => m.role === r))
  const [role, setRole] = useState<ModuleRole>('custom')
  const [name, setName] = useState('')
  const [singular, setSingular] = useState('')
  const [icon, setIcon] = useState('Layers')
  const info = ROLES[role]
  const missing = (info.needs ?? []).filter((n) => !schema.modules.some((m) => m.role === n))

  function add() {
    const m = buildModule({ role, name: name.trim() || info.label, singular: singular.trim() || name.trim() || info.label, icon, color: PALETTE[schema.modules.length % PALETTE.length] }, schema.company.vatRate)
    edit((s) => {
      s.modules.push(m)
      for (const r of s.roles) if (!r.admin && Object.keys(r.access).length) r.access[m.id] = ['view']
    })
    onAdded(m.id)
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="card stack">
          <div className="row between"><h2 style={{ margin: 0 }}>Add a module</h2><button className="ghost icon" onClick={onClose}><X size={18} /></button></div>
          <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', marginTop: 0 }}>
            {available.map((r) => (
              <button key={r} type="button" className={`tile ${role === r ? 'on' : ''}`} style={{ padding: 12 }} onClick={() => { setRole(r); setName(r === 'custom' ? '' : ROLES[r].label) }}>
                <b className="small">{ROLES[r].label}</b>
                <small className="tiny">{ROLES[r].description.split('.')[0]}.</small>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vehicles" autoFocus /></label>
            <label className="field">One record is called<input value={singular} onChange={(e) => setSingular(e.target.value)} placeholder="e.g. Vehicle" /></label>
          </div>
          <div className="row">{MODULE_ICON_CHOICES.slice(0, 16).map((i) => <button key={i} className={icon === i ? '' : 'secondary'} style={{ padding: 7 }} onClick={() => setIcon(i)}><Icon name={i} size={16} /></button>)}</div>
          {missing.length > 0 && <div className="note">{info.label} also needs: {missing.map((n) => ROLES[n].label).join(', ')}. Add those too, or the health check will flag it.</div>}
          <button className="glow" onClick={add} disabled={!name.trim()}><Plus size={16} /> Add {name || 'module'}</button>
        </div>
      </div>
    </>
  )
}
````

### `crm-builder/src/builder/PipelinesTab.tsx`

````tsx
import { useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { Icon } from '../components/Icon'
import type { ModuleDef, Stage } from '../lib/schema'
import { uid } from '../lib/schema'
import { PALETTE } from '../lib/fieldTypes'

export default function PipelinesTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { schema, issues } = useDraft()
  const pipes = schema.modules.filter((m) => m.stages)
  const mod = pipes.find((m) => m.id === focus.moduleId) ?? pipes[0]
  if (!mod) return <div className="empty">No module has a pipeline. Add Leads, Deals or Service tickets to get one.</div>
  const errs = issues.filter((i) => i.tab === 'pipelines' && i.moduleId === mod.id)
  return (
    <div className="two">
      <div className="pane side">
        <h3>Pipelines</h3>
        {pipes.map((m) => (
          <button key={m.id} className={`mod-item ${m.id === mod.id ? 'on' : ''}`} onClick={() => setFocus({ moduleId: m.id })}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
            <span className="grow" style={{ textAlign: 'start' }}>{m.name}<br /><span className="tiny muted">{m.stages!.length} stages</span></span>
            {issues.some((i) => i.level === 'error' && i.tab === 'pipelines' && i.moduleId === m.id) && <span className="err" />}
          </button>
        ))}
        <h3>Rules</h3>
        <ul className="small muted" style={{ paddingInlineStart: 18, lineHeight: 1.7 }}>
          <li>Open stages first, then one Won and one Lost.</li>
          <li>Probability drives the weighted forecast.</li>
          <li>Stage gates force the team to fill key fields before moving on.</li>
          <li>Stages with records in them can’t be deleted.</li>
        </ul>
      </div>
      <div className="pane">
        <Designer key={mod.id} mod={mod} />
        {errs.length > 0 && (
          <div className="stack" style={{ marginTop: 14 }}>
            {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{e.message}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

function Designer({ mod }: { mod: ModuleDef }) {
  const { schema, edit, ws } = useDraft()
  const [msg, setMsg] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const stages = mod.stages!
  const editStages = (fn: (s: Stage[]) => Stage[] | void) =>
    edit((s) => {
      const m = s.modules.find((x) => x.id === mod.id)!
      const out = fn(m.stages!)
      if (out) m.stages = out
    })

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    editStages((st) => arrayMove(st, st.findIndex((x) => x.id === e.active.id), st.findIndex((x) => x.id === e.over!.id)))
  }
  function add() {
    editStages((st) => {
      const idx = st.findIndex((x) => x.type !== 'open')
      const prev = st[Math.max(0, (idx < 0 ? st.length : idx) - 1)]
      const n: Stage = { id: uid('st'), name: 'New stage', probability: Math.min(95, (prev?.probability ?? 0) + 10), type: 'open', color: PALETTE[st.length % PALETTE.length] }
      st.splice(idx < 0 ? st.length : idx, 0, n)
    })
  }
  function remove(s: Stage) {
    const inStage = (ws.data.records[mod.id] ?? []).filter((r) => r.stage === s.id).length
    if (inStage) return setMsg(`${inStage} record(s) are in “${s.name}”. Move them to another stage first.`)
    const wf = schema.workflows.find((w) => w.trigger.stage === s.id)
    if (wf) return setMsg(`Automation “${wf.name}” waits for “${s.name}”. Change it first.`)
    if (s.type !== 'open' && stages.filter((x) => x.type === s.type).length === 1) return setMsg(`A pipeline needs one ${s.type === 'won' ? 'Won' : 'Lost'} stage. Rename this one instead.`)
    editStages((st) => st.filter((x) => x.id !== s.id))
  }

  const openTotal = stages.filter((s) => s.type === 'open')
  const gateFields = mod.fields.filter((f) => !f.readOnly && f.type !== 'formula')
  return (
    <>
      <div className="page-head">
        <h1><span className="badge" style={{ background: mod.color }}><Icon name={mod.icon} size={20} /></span>{mod.name} pipeline</h1>
        <button onClick={add}><Plus size={16} /> Add stage</button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="stage-board">
            {stages.map((s) => (
              <StageCard key={s.id} stage={s} fields={gateFields} onChange={(patch) => editStages((st) => { Object.assign(st.find((x) => x.id === s.id)!, patch) })} onRemove={() => remove(s)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {msg && <div className="error-box" style={{ marginTop: 10 }} onClick={() => setMsg('')}>{msg}</div>}
      <div className="card" style={{ marginTop: 18, maxWidth: 560 }}>
        <h2>Funnel preview</h2>
        <div className="funnel-preview">
          {openTotal.map((s, i) => <div key={s.id} style={{ width: `${100 - i * (60 / Math.max(1, openTotal.length))}%`, background: s.color }}>{s.name} · {s.probability}%</div>)}
          <div className="closed">
            {stages.filter((s) => s.type !== 'open').map((s) => <div key={s.id} style={{ background: s.color }}>{s.name}</div>)}
          </div>
        </div>
      </div>
    </>
  )
}

function StageCard({ stage, fields, onChange, onRemove }: { stage: Stage; fields: ModuleDef['fields']; onChange: (p: Partial<Stage>) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stage.id })
  return (
    <div ref={setNodeRef} className="stage-card" style={{ ['--c' as string]: stage.color, transform: CSS.Transform.toString(transform), transition }}>
      <div className="row">
        <span {...listeners} {...attributes} style={{ cursor: 'grab', color: 'var(--muted)', touchAction: 'none' }}><GripVertical size={16} /></span>
        <input type="color" value={stage.color} onChange={(e) => onChange({ color: e.target.value })} style={{ width: 30, height: 30 }} />
        <span className="grow" />
        <button className="ghost icon" onClick={onRemove} aria-label="Delete stage"><Trash2 size={15} /></button>
      </div>
      <label className="field">Name<input value={stage.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <label className="field">Type
        <select value={stage.type} onChange={(e) => {
          const type = e.target.value as Stage['type']
          onChange({ type, probability: type === 'won' ? 100 : type === 'lost' ? 0 : stage.probability })
        }}>
          <option value="open">Open</option>
          <option value="won">Won / Done</option>
          <option value="lost">Lost / Cancelled</option>
        </select>
      </label>
      <label className="field">Probability {stage.probability}%
        <input type="range" min={0} max={100} step={5} value={stage.probability} disabled={stage.type !== 'open'} onChange={(e) => onChange({ probability: Number(e.target.value) })} />
      </label>
      {stage.type === 'open' && (
        <label className="field">Flag as rotting after (days)
          <input type="number" min={0} value={stage.rotDays ?? ''} placeholder="Off" onChange={(e) => onChange({ rotDays: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
        </label>
      )}
      <div className="field">
        <span className="small" style={{ fontWeight: 600 }}>Must be filled to enter</span>
        <div className="chips" style={{ marginTop: 6 }}>
          {fields.slice(0, 14).map((f) => {
            const on = stage.requires?.includes(f.key)
            return (
              <button key={f.id} type="button" className={`chip tiny ${on ? 'on' : ''}`} style={{ padding: '4px 9px', fontSize: '0.75rem' }} onClick={() => onChange({ requires: on ? stage.requires!.filter((k) => k !== f.key) : [...(stage.requires ?? []), f.key] })}>
                {f.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
````

### `crm-builder/src/builder/ReportsTab.tsx`

````tsx
import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { BarChart3, ChevronDown, ChevronUp, Gauge, LineChart, ListFilter, PieChart, Plus, Table2, Trash2, X } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { Chart } from '../components/Chart'
import { Icon } from '../components/Icon'
import type { Aggregate, AppSchema, ChartType, FilterOp, ModuleDef, ReportDef } from '../lib/schema'
import { isNumeric, moduleById, uid } from '../lib/schema'
import { PALETTE, typeInfo } from '../lib/fieldTypes'
import { PSEUDO_FIELDS } from '../lib/validate'
import { runReport } from '../lib/reports'
import { seedSampleData } from '../lib/seed'
import { emptyData, type Workspace } from '../lib/types'

const CHARTS: { id: ChartType; label: string; icon: typeof BarChart3 }[] = [
  { id: 'kpi', label: 'Number', icon: Gauge },
  { id: 'bar', label: 'Columns', icon: BarChart3 },
  { id: 'hbar', label: 'Bars', icon: BarChart3 },
  { id: 'line', label: 'Trend', icon: LineChart },
  { id: 'pie', label: 'Donut', icon: PieChart },
  { id: 'funnel', label: 'Funnel', icon: ListFilter },
  { id: 'table', label: 'Table', icon: Table2 },
]

export const OPS: { id: FilterOp; label: string }[] = [
  { id: 'eq', label: 'is' }, { id: 'neq', label: 'is not' }, { id: 'gt', label: 'greater than' }, { id: 'lt', label: 'less than' },
  { id: 'contains', label: 'contains' }, { id: 'empty', label: 'is empty' }, { id: 'notempty', label: 'is not empty' },
]

/** A workspace filled with sample data for the draft schema, so reports preview with realistic numbers. */
export function usePreviewWorkspace(ws: Workspace, schema: AppSchema) {
  const sig = JSON.stringify(schema.modules)
  return useMemo(() => {
    const hasData = Object.values(ws.data.records).some((r) => r.length > 0)
    if (hasData) return { preview: ws, sample: false }
    const tmp: Workspace = { ...structuredClone(ws), data: emptyData() }
    try {
      seedSampleData(tmp, schema, tmp.users[0])
    } catch {
      /* preview only */
    }
    return { preview: tmp, sample: true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ws.data])
}

export function fieldOptions(mod: ModuleDef) {
  const pseudo = Object.entries(PSEUDO_FIELDS).filter(([, p]) => p.applies(mod)).map(([key, p]) => ({ key, label: p.label, icon: 'Sparkles', numeric: false }))
  return [...pseudo, ...mod.fields.map((f) => ({ key: f.key, label: f.label, icon: typeInfo(f.type).icon, numeric: isNumeric(f) }))]
}

export default function ReportsTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { ws, schema, edit, issues } = useDraft()
  const report = schema.reports.find((r) => r.id === focus.itemId) ?? schema.reports[0]
  const { preview, sample } = usePreviewWorkspace(ws, schema)

  function addReport() {
    const mod = schema.modules[0]
    const r: ReportDef = { id: uid('r'), name: 'New report', module: mod.id, chart: 'bar', groupBy: mod.stages ? '__stage' : '__month', measure: { op: 'count' }, filters: [], size: 1, color: PALETTE[schema.reports.length % PALETTE.length] }
    edit((s) => s.reports.push(r))
    setFocus({ itemId: r.id })
  }
  const move = (id: string, dir: -1 | 1) =>
    edit((s) => {
      const i = s.reports.findIndex((r) => r.id === id)
      const j = i + dir
      if (j < 0 || j >= s.reports.length) return
      ;[s.reports[i], s.reports[j]] = [s.reports[j], s.reports[i]]
    })

  return (
    <div className="two">
      <div className="pane side">
        <div className="row between"><h3 style={{ margin: 0 }}>Dashboard ({schema.reports.length})</h3><button className="ghost icon" onClick={addReport} aria-label="New report"><Plus size={16} /></button></div>
        <p className="tiny muted">Order here is the order on the dashboard.</p>
        {schema.reports.map((r, i) => (
          <div key={r.id} className={`mod-item ${r.id === report?.id ? 'on' : ''}`} onClick={() => setFocus({ itemId: r.id })} role="button">
            <span className="badge" style={{ background: r.color }}>{(() => { const C = CHARTS.find((c) => c.id === r.chart)!.icon; return <C size={14} /> })()}</span>
            <span className="grow small">{r.name}<br /><span className="tiny muted">{moduleById(schema, r.module)?.name}</span></span>
            {issues.some((x) => x.itemId === r.id && x.level === 'error') && <span className="err" />}
            <span className="stack" style={{ gap: 0 }}>
              <button className="ghost icon" style={{ padding: 1 }} disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(r.id, -1) }}><ChevronUp size={13} /></button>
              <button className="ghost icon" style={{ padding: 1 }} disabled={i === schema.reports.length - 1} onClick={(e) => { e.stopPropagation(); move(r.id, 1) }}><ChevronDown size={13} /></button>
            </span>
          </div>
        ))}
        <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={addReport}><Plus size={16} /> New report</button>
      </div>
      <div className="pane">
        {report ? <Designer key={report.id} report={report} preview={preview} sample={sample} onDeleted={() => setFocus({})} /> : <div className="empty">Create your first report.</div>}
      </div>
    </div>
  )
}

function Designer({ report, preview, sample, onDeleted }: { report: ReportDef; preview: Workspace; sample: boolean; onDeleted: () => void }) {
  const { schema, edit, issues } = useDraft()
  const [drag, setDrag] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const mod = moduleById(schema, report.module)!
  const fields = fieldOptions(mod)
  const label = (k?: string) => fields.find((f) => f.key === k)?.label ?? k
  const set = (patch: Partial<ReportDef>) => edit((s) => Object.assign(s.reports.find((r) => r.id === report.id)!, patch))
  const result = runReport(preview, schema, report)
  const currency = report.measure.op !== 'count' && mod.fields.find((f) => f.key === report.measure.field)?.type === 'currency'
  const errs = issues.filter((i) => i.itemId === report.id)

  function onDragEnd(e: DragEndEvent) {
    setDrag(null)
    const key = String(e.active.id).replace('rf:', '')
    const target = e.over?.id
    if (target === 'group') set({ groupBy: key, chart: report.chart === 'kpi' ? 'bar' : report.chart })
    if (target === 'measure') {
      const f = fields.find((x) => x.key === key)
      set({ measure: f?.numeric ? { op: report.measure.op === 'count' ? 'sum' : report.measure.op, field: key } : { op: 'count' } })
    }
    if (target === 'filter') set({ filters: [...report.filters, { field: key, op: 'eq', value: '' }] })
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDrag(String(e.active.id))} onDragEnd={onDragEnd}>
      <div className="report-designer">
        <div className="card" style={{ padding: 12, alignSelf: 'start' }}>
          <label className="field">Data from
            <select value={report.module} onChange={(e) => set({ module: e.target.value, groupBy: undefined, measure: { op: 'count' }, filters: [] })}>
              {schema.modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <p className="tiny muted" style={{ margin: '12px 0 6px' }}>Drag fields into the boxes →</p>
          <div className="stack" style={{ gap: 6 }}>
            {fields.map((f) => <DragField key={f.key} id={`rf:${f.key}`} label={f.label} icon={f.icon} numeric={f.numeric} />)}
          </div>
        </div>
        <div className="stack">
          <div className="row">
            <input value={report.name} onChange={(e) => set({ name: e.target.value })} style={{ fontSize: '1.2rem', fontWeight: 700, maxWidth: 420 }} />
            <span className="grow" />
            <div className="row">{PALETTE.slice(0, 8).map((c) => <button key={c} aria-label={c} onClick={() => set({ color: c })} style={{ width: 22, height: 22, padding: 0, borderRadius: 6, background: c, outline: report.color === c ? '3px solid var(--primary-100)' : 'none' }} />)}</div>
            <button className="danger" onClick={() => { edit((s) => { s.reports = s.reports.filter((r) => r.id !== report.id) }); onDeleted() }}><Trash2 size={15} /></button>
          </div>
          <div className="chart-types">
            {CHARTS.map((c) => <button key={c.id} className={report.chart === c.id ? 'on' : ''} onClick={() => set({ chart: c.id, groupBy: c.id === 'funnel' && mod.stages ? '__stage' : report.groupBy })} disabled={c.id === 'funnel' && !mod.stages}><c.icon size={15} /> {c.label}</button>)}
            <span className="grow" />
            <div className="seg">{([1, 2, 3] as const).map((n) => <button key={n} className={report.size === n ? 'on' : ''} onClick={() => set({ size: n })}>{n === 1 ? 'Small' : n === 2 ? 'Wide' : 'Extra wide'}</button>)}</div>
          </div>
          <div className="wells">
            <Well id="group" title="Group by">
              {report.chart === 'kpi' ? <span className="tiny muted">A number has no groups</span> : report.groupBy ? <span className="token">{label(report.groupBy)}<button onClick={() => set({ groupBy: undefined })}><X size={12} /></button></span> : <span className="tiny muted">Drop a field</span>}
            </Well>
            <Well id="measure" title="Measure">
              <div className="row" style={{ gap: 6 }}>
                <select value={report.measure.op} style={{ padding: '5px 8px', width: 'auto' }} onChange={(e) => set({ measure: { op: e.target.value as Aggregate, field: e.target.value === 'count' ? undefined : report.measure.field ?? fields.find((f) => f.numeric)?.key } })}>
                  <option value="count">Count of records</option>
                  <option value="sum">Sum of</option>
                  <option value="avg">Average of</option>
                  <option value="min">Lowest</option>
                  <option value="max">Highest</option>
                </select>
                {report.measure.op !== 'count' && (report.measure.field ? <span className="token">{label(report.measure.field)}</span> : <span className="tiny muted">Drop a number</span>)}
              </div>
            </Well>
            <Well id="filter" title="Only include">
              {report.filters.length === 0 && <span className="tiny muted">Drop a field to filter</span>}
              {report.filters.map((fl, i) => (
                <FilterRow key={i} mod={mod} filter={fl} label={label(fl.field) ?? fl.field} onChange={(nf) => set({ filters: report.filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => set({ filters: report.filters.filter((_, j) => j !== i) })} />
              ))}
            </Well>
          </div>
          {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{e.message}</div>)}
          <div className="card" style={{ maxWidth: report.size === 1 ? 420 : report.size === 2 ? 760 : '100%' }}>
            <h2 style={{ fontSize: '0.95rem' }}>{report.name} {sample && <span className="pill amber tiny">sample data preview</span>}</h2>
            <Chart type={report.chart} result={result} color={report.color} prefix={currency ? `${schema.company.currency} ` : ''} />
          </div>
        </div>
      </div>
      <DragOverlay>{drag && <div className="ghost-card">{label(drag.replace('rf:', ''))}</div>}</DragOverlay>
    </DndContext>
  )
}

export function FilterRow({ mod, filter, label, onChange, onRemove }: { mod: ModuleDef; filter: { field: string; op: FilterOp; value?: string }; label: string; onChange: (f: { field: string; op: FilterOp; value?: string }) => void; onRemove: () => void }) {
  const f = mod.fields.find((x) => x.key === filter.field)
  const choices: { value: string; label: string }[] | null =
    filter.field === '__stage' ? (mod.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
    : filter.field === '__stagetype' ? [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]
    : filter.field === '__status' ? ['draft', 'posted', 'partial', 'paid', 'void', 'sent', 'accepted', 'declined', 'invoiced'].map((v) => ({ value: v, label: v }))
    : f?.type === 'checkbox' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
    : f?.options ? f.options.map((o) => ({ value: o.value, label: o.label })) : null
  return (
    <div className="row" style={{ gap: 4, marginBottom: 4 }}>
      <span className="token">{label}</span>
      <select value={filter.op} onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp })} style={{ width: 'auto', padding: '4px 6px' }}>
        {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {filter.op !== 'empty' && filter.op !== 'notempty' && (choices ? (
        <select value={filter.value ?? ''} onChange={(e) => onChange({ ...filter, value: e.target.value })} style={{ width: 'auto', padding: '4px 6px' }}>
          <option value="">—</option>
          {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      ) : <input value={filter.value ?? ''} onChange={(e) => onChange({ ...filter, value: e.target.value })} style={{ width: 110, padding: '4px 6px' }} />)}
      <button className="ghost icon" onClick={onRemove}><X size={13} /></button>
    </div>
  )
}

function DragField({ id, label, icon, numeric }: { id: string; label: string; icon: string; numeric: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="pal-item">
      <Icon name={icon} size={14} /> {label} {numeric && <span className="pill tiny" style={{ marginInlineStart: 'auto' }}>123</span>}
    </div>
  )
}

function Well({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`well ${isOver ? 'over' : ''}`}>
      <b>{title}</b>
      {children}
    </div>
  )
}
````

### `crm-builder/src/builder/RolesTab.tsx`

````tsx
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useDraft } from './useDraft'
import { Icon } from '../components/Icon'
import type { Permission, RoleDef } from '../lib/schema'
import { uid } from '../lib/schema'

const PERMS: Permission[] = ['view', 'create', 'edit', 'delete']

export default function RolesTab() {
  const { ws, schema, edit, issues } = useDraft()
  const setRole = (id: string, fn: (r: RoleDef) => void) => edit((s) => fn(s.roles.find((r) => r.id === id)!))
  const errs = issues.filter((i) => i.tab === 'roles')

  function toggle(role: RoleDef, moduleId: string, p: Permission) {
    setRole(role.id, (r) => {
      const cur = new Set(r.access[moduleId] ?? [])
      if (cur.has(p)) {
        cur.delete(p)
        // without view, nothing else makes sense
        if (p === 'view') cur.clear()
      } else {
        cur.add(p)
        cur.add('view')
      }
      r.access[moduleId] = PERMS.filter((x) => cur.has(x))
    })
  }

  return (
    <div className="pane" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <h1><ShieldCheck size={26} /> Roles & access</h1>
        <button onClick={() => edit((s) => s.roles.push({ id: uid('role'), name: 'New role', access: Object.fromEntries(s.modules.map((m) => [m.id, ['view'] as Permission[]])) }))}><Plus size={16} /> Add role</button>
      </div>
      <p className="muted">Admin can do everything. Only roles with <b>Post & collect</b> can post invoices and bills, void them, and register payments — a standard separation of duties.</p>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 10 }}>{e.message}</div>)}
      <div className="stack">
        {schema.roles.map((role) => {
          const members = ws.users.filter((u) => u.roleId === role.id).length
          return (
            <div className="card" key={role.id}>
              <div className="row">
                <input value={role.name} onChange={(e) => setRole(role.id, (r) => (r.name = e.target.value))} style={{ fontWeight: 700, maxWidth: 260 }} disabled={role.admin} />
                <span className="pill gray">{members} member{members === 1 ? '' : 's'}</span>
                {role.admin ? <span className="pill green">Full access</span> : (
                  <label className="inline small"><input type="checkbox" checked={Boolean(role.finance)} onChange={(e) => setRole(role.id, (r) => (r.finance = e.target.checked))} /> Post & collect (finance)</label>
                )}
                <span className="grow" />
                {!role.admin && <button className="ghost icon" disabled={members > 0} title={members ? 'Move its members to another role first' : 'Delete role'} onClick={() => edit((s) => { s.roles = s.roles.filter((r) => r.id !== role.id) })}><Trash2 size={16} /></button>}
              </div>
              {!role.admin && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table className="matrix">
                    <thead><tr><th>Module</th>{PERMS.map((p) => <th key={p}>{p}</th>)}</tr></thead>
                    <tbody>
                      {schema.modules.map((m) => (
                        <tr key={m.id}>
                          <td><span className="row" style={{ gap: 8 }}><Icon name={m.icon} size={15} style={{ color: m.color }} /> {m.name}</span></td>
                          {PERMS.map((p) => <td key={p}><input type="checkbox" checked={Boolean(role.access[m.id]?.includes(p))} onChange={() => toggle(role, m.id, p)} /></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
````

### `crm-builder/src/builder/RulesTab.tsx`

````tsx
import { CheckCircle2, Flame, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { FilterRow, fieldOptions } from './ReportsTab'
import { Icon } from '../components/Icon'
import type { ApprovalRule, Filter, ModuleDef } from '../lib/schema'
import { moduleById, uid } from '../lib/schema'

export default function RulesTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { schema, issues } = useDraft()
  const mod = schema.modules.find((m) => m.id === focus.moduleId) ?? schema.modules.find((m) => m.role === 'leads') ?? schema.modules[0]
  const errs = issues.filter((i) => i.tab === 'rules')
  return (
    <div className="two">
      <div className="pane side">
        <h3>Module</h3>
        {schema.modules.map((m) => (
          <button key={m.id} className={`mod-item ${m.id === mod.id ? 'on' : ''}`} onClick={() => setFocus({ moduleId: m.id })}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
            <span className="grow" style={{ textAlign: 'start' }}>{m.name}<br /><span className="tiny muted">{(m.rules?.length ?? 0)} rules · {(m.scoring?.length ?? 0)} scoring</span></span>
            {errs.some((e) => e.moduleId === m.id && e.level === 'error') && <span className="err" />}
          </button>
        ))}
      </div>
      <div className="pane" style={{ maxWidth: 980 }}>
        {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 8 }}>{e.message}</div>)}
        <ValidationRules key={`v${mod.id}`} mod={mod} />
        <Scoring key={`s${mod.id}`} mod={mod} />
        <Approvals mod={mod} />
      </div>
    </div>
  )
}

function useModEdit(mod: ModuleDef) {
  const { edit } = useDraft()
  return (fn: (m: ModuleDef) => void) => edit((s) => fn(s.modules.find((m) => m.id === mod.id)!))
}

function FieldPicker({ mod, onPick, label = '+ Add condition…' }: { mod: ModuleDef; onPick: (key: string) => void; label?: string }) {
  return (
    <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} style={{ width: 'auto' }}>
      <option value="">{label}</option>
      {fieldOptions(mod).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
    </select>
  )
}

function ValidationRules({ mod }: { mod: ModuleDef }) {
  const editMod = useModEdit(mod)
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const editable = mod.fields.filter((f) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type))
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}><ShieldAlert size={18} /> Validation rules</h2>
        <button className="secondary" disabled={!editable.length} onClick={() => editMod((m) => { (m.rules ??= []).push({ id: uid('vr'), when: [], check: { field: editable[0].key, op: 'notempty' }, message: `${editable[0].label} must be filled in` }) })}><Plus size={15} /> Add rule</button>
      </div>
      <p className="muted small">Stop bad data at the door, like validation rules in Salesforce and Zoho. A save is refused with your message when a rule fails.</p>
      {(mod.rules ?? []).length === 0 && <p className="small muted">No rules for {mod.name} yet.</p>}
      {(mod.rules ?? []).map((r, i) => (
        <div key={r.id} className="flow-node" style={{ ['--c' as string]: '#ef4444', marginBottom: 10 }}>
          <div className="row between"><span className="tag">Rule {i + 1}</span><button className="ghost icon" onClick={() => editMod((m) => { m.rules = m.rules!.filter((x) => x.id !== r.id) })}><Trash2 size={14} /></button></div>
          <p className="small" style={{ margin: '8px 0 4px' }}><b>Applies when</b> {r.when.length === 0 && <span className="muted">always</span>}</p>
          {r.when.map((w, j) => <FilterRow key={j} mod={mod} filter={w} label={label(w.field)} onChange={(nw) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.when[j] = nw })} onRemove={() => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.when.splice(j, 1) })} />)}
          <FieldPicker mod={mod} onPick={(key) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.when.push({ field: key, op: 'eq', value: '' }) })} />
          <p className="small" style={{ margin: '10px 0 4px' }}><b>This must be true</b></p>
          <div className="row" style={{ gap: 6 }}>
            <select value={r.check.field} style={{ width: 'auto' }} onChange={(e) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.check = { field: e.target.value, op: 'notempty' } })}>
              {editable.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
            </select>
            <FilterRow mod={mod} filter={r.check} label="" onChange={(nc) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.check = { ...nc, field: r.check.field } })} onRemove={() => {}} />
          </div>
          <label className="field" style={{ marginTop: 8 }}>Message shown to the user<input value={r.message} onChange={(e) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.message = e.target.value })} /></label>
        </div>
      ))}
    </section>
  )
}

function Scoring({ mod }: { mod: ModuleDef }) {
  const editMod = useModEdit(mod)
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const max = (mod.scoring ?? []).reduce((s, r) => s + Math.max(0, r.points), 0)
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}><Flame size={18} /> Scoring {max > 0 && <span className="pill amber">up to {max} points</span>}</h2>
        <button className="secondary" onClick={() => editMod((m) => { (m.scoring ??= []).push({ id: uid('sc'), condition: { field: fields.find((f) => !f.key.startsWith('__'))?.key ?? '', op: 'notempty' }, points: 10 }) })}><Plus size={15} /> Add points</button>
      </div>
      <p className="muted small">Give points when a record matches, as HubSpot does for lead scoring. The score shows on cards and lists, so the team calls the hottest leads first.</p>
      {(mod.scoring ?? []).map((r) => (
        <div key={r.id} className="row" style={{ gap: 6, marginBottom: 6 }}>
          <input type="number" value={r.points} style={{ width: 80 }} onChange={(e) => editMod((m) => { m.scoring!.find((x) => x.id === r.id)!.points = Number(e.target.value) })} />
          <span className="small muted">points when</span>
          <select value={r.condition.field} style={{ width: 'auto' }} onChange={(e) => editMod((m) => { m.scoring!.find((x) => x.id === r.id)!.condition = { field: e.target.value, op: 'notempty' } })}>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <FilterRow mod={mod} filter={r.condition} label={label(r.condition.field)} onChange={(nc) => editMod((m) => { m.scoring!.find((x) => x.id === r.id)!.condition = nc })} onRemove={() => editMod((m) => { m.scoring = m.scoring!.filter((x) => x.id !== r.id) })} />
        </div>
      ))}
    </section>
  )
}

function Approvals({ mod }: { mod: ModuleDef }) {
  const { schema, edit } = useDraft()
  const rules = (schema.approvals ?? []).filter((a) => a.module === mod.id)
  const canPost = mod.role === 'invoices' || mod.role === 'purchases'
  const approver = schema.roles.find((r) => !r.admin && /manag|owner|director/i.test(r.name)) ?? schema.roles[0]
  const setRule = (id: string, fn: (a: ApprovalRule) => void) => edit((s) => fn(s.approvals!.find((a) => a.id === id)!))
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  return (
    <section className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}><CheckCircle2 size={18} /> Approvals</h2>
        <button className="secondary" disabled={!canPost && !mod.stages} onClick={() => edit((s) => {
          const cond: Filter[] = canPost ? [{ field: 'total', op: 'gt', value: '100000' }] : []
          ;(s.approvals ??= []).push({ id: uid('ap'), name: canPost ? `Large ${mod.singular.toLowerCase()}` : `${mod.singular} sign-off`, module: mod.id, action: canPost ? 'post' : 'stage', stage: canPost ? undefined : mod.stages?.find((x) => x.type === 'won')?.id, conditions: cond, approverRole: approver.id })
        })}><Plus size={15} /> Add approval</button>
      </div>
      <p className="muted small">Critical actions wait for a manager’s sign-off, like Odoo approvals. The approver gets a notification. An approval stops counting if the record changes afterwards, and people can’t approve their own requests.</p>
      {!canPost && !mod.stages && <p className="small muted">Approvals apply to posting invoices and bills, or to moving records into a pipeline stage. {mod.name} has neither.</p>}
      {rules.map((a) => (
        <div key={a.id} className="flow-node" style={{ ['--c' as string]: '#10b981', marginBottom: 10 }}>
          <div className="row between">
            <input value={a.name} onChange={(e) => setRule(a.id, (x) => (x.name = e.target.value))} style={{ fontWeight: 700, maxWidth: 300 }} />
            <button className="ghost icon" onClick={() => edit((s) => { s.approvals = s.approvals!.filter((x) => x.id !== a.id) })}><Trash2 size={14} /></button>
          </div>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field">Before
              <select value={a.action === 'post' ? 'post' : a.stage ?? ''} onChange={(e) => setRule(a.id, (x) => { if (e.target.value === 'post') { x.action = 'post'; x.stage = undefined } else { x.action = 'stage'; x.stage = e.target.value } })}>
                {canPost && <option value="post">Posting the {mod.singular.toLowerCase()}</option>}
                {mod.stages?.map((st) => <option key={st.id} value={st.id}>Moving to “{st.name}”</option>)}
              </select>
            </label>
            <label className="field">Approved by
              <select value={a.approverRole} onChange={(e) => setRule(a.id, (x) => (x.approverRole = e.target.value))}>
                {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </div>
          <p className="small" style={{ margin: '10px 0 4px' }}><b>Only when</b> {a.conditions.length === 0 && <span className="muted">always</span>}</p>
          {a.conditions.map((c, j) => <FilterRow key={j} mod={moduleById(schema, a.module)!} filter={c} label={label(c.field)} onChange={(nc) => setRule(a.id, (x) => (x.conditions[j] = nc))} onRemove={() => setRule(a.id, (x) => x.conditions.splice(j, 1))} />)}
          <FieldPicker mod={mod} onPick={(key) => setRule(a.id, (x) => x.conditions.push({ field: key, op: 'gt', value: '' }))} />
        </div>
      ))}
    </section>
  )
}
````

### `crm-builder/src/builder/SettingsTab.tsx`

````tsx
import { History, RotateCcw } from 'lucide-react'
import { useDraft } from './useDraft'
import { update } from '../lib/store'
import type { CompanyProfile } from '../lib/schema'

export default function SettingsTab() {
  const { ws, schema, edit, issues } = useDraft()
  const set = (patch: Partial<CompanyProfile>) => edit((s) => Object.assign(s.company, patch))
  const errs = issues.filter((i) => i.tab === 'settings')
  const c = schema.company
  return (
    <div className="pane" style={{ maxWidth: 960 }}>
      <h1>Company, tax & numbering</h1>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 10 }}>{e.message}</div>)}
      <div className="card">
        <div className="form-grid">
          <label className="field">Company name<input value={c.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Industry<input value={c.industry} onChange={(e) => set({ industry: e.target.value })} /></label>
          <label className="field">City<input value={c.city} onChange={(e) => set({ city: e.target.value })} /></label>
          <label className="field">Country<input value={c.country} onChange={(e) => set({ country: e.target.value })} /></label>
          <label className="field">Tax registration number<input value={c.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="Printed on every invoice" /></label>
          <label className="field">Currency
            <select value={c.currency} onChange={(e) => set({ currency: e.target.value })} disabled={Boolean(ws.data.journal.length)}>
              {['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP'].map((x) => <option key={x}>{x}</option>)}
            </select>
            {ws.data.journal.length > 0 && <span className="tiny muted">Locked: documents are already posted in {c.currency}.</span>}
          </label>
          <label className="field">Default VAT rate %<input type="number" min={0} max={100} value={c.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) })} /><span className="tiny muted">New products start with this rate. Each line keeps its own rate, so changing it never alters posted invoices.</span></label>
          <label className="field">Fiscal year starts in
            <select value={c.fiscalYearStart} onChange={(e) => set({ fiscalYearStart: Number(e.target.value) })}>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        </div>
        <label className="inline" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={c.allowNegativeStock} onChange={(e) => set({ allowNegativeStock: e.target.checked })} />
          <span>Allow selling more than is in stock <span className="muted small">(not recommended — stock and cost reports become unreliable)</span></span>
        </label>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2><History size={18} /> Published versions</h2>
        {ws.history.length === 0 && <p className="muted small">Nothing published yet. Your first publish creates version 1.</p>}
        <table className="data">
          <tbody>
            {ws.history.map((h) => (
              <tr key={h.version}>
                <td><b>v{h.version}</b></td>
                <td>{h.note}</td>
                <td className="muted">{new Date(h.at).toLocaleString()}</td>
                <td className="num">
                  <button className="secondary" onClick={() => { if (confirm(`Load version ${h.version} into the builder? Your unpublished changes will be replaced.`)) update((s) => { s.workspaces[ws.id].draft = structuredClone(h.schema) }) }}><RotateCcw size={14} /> Restore to builder</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
````

### `crm-builder/src/builder/useDraft.ts`

````ts
import { useMemo } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentWorkspace, update, useStore } from '../lib/store'
import { validate } from '../lib/validate'
import type { Workspace } from '../lib/types'

export function useDraft() {
  const ws = useStore((s) => currentWorkspace(s)) as Workspace
  const schema = ws.draft as AppSchema
  const issues = useMemo(() => validate(schema), [schema])
  const edit = (fn: (s: AppSchema) => void) =>
    update((st) => {
      const w = st.workspaces[ws.id]
      const copy = structuredClone(w.draft!)
      fn(copy)
      w.draft = copy
    })
  /** how many records hold a value for this field (so type and key changes can be blocked safely) */
  const valuesIn = (moduleId: string, key: string) => (ws.data.records[moduleId] ?? []).filter((r) => r.values[key] !== undefined && r.values[key] !== '' && r.values[key] !== null).length
  const recordCount = (moduleId: string) => (ws.data.records[moduleId] ?? []).length
  return { ws, schema, issues, edit, valuesIn, recordCount }
}
````

### `crm-builder/src/components/Chart.tsx`

````tsx
import type { ChartType } from '../lib/schema'
import type { ReportResult } from '../lib/reports'

export function compact(n: number) {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(n / 1e3).toFixed(0)}K`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

interface Props {
  type: ChartType
  result: ReportResult
  color: string
  prefix?: string
  height?: number
}

export function Chart({ type, result, color, prefix = '', height = 220 }: Props) {
  const fmt = (n: number) => `${prefix}${compact(n)}`
  const rows = result.rows
  if (type === 'kpi') {
    return (
      <div className="kpi">
        <div className="kpi-value" style={{ color }}>{fmt(result.total)}</div>
        <div className="kpi-sub">{result.count} record{result.count === 1 ? '' : 's'}</div>
        <svg className="kpi-wave" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden>
          <path d="M0 30 C 30 10, 50 35, 80 22 S 130 5, 160 18 S 190 30, 200 12 L200 40 L0 40Z" fill={color} opacity="0.12" />
        </svg>
      </div>
    )
  }
  if (!rows.length) return <div className="chart-empty">No data yet — records will appear here as your team works.</div>

  if (type === 'table') {
    return (
      <div className="chart-table">
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><span className="dot" style={{ background: r.color }} />{r.label}</td>
                <td className="num">{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const max = Math.max(...rows.map((r) => r.value), 1)

  if (type === 'hbar' || type === 'funnel') {
    return (
      <div className={type === 'funnel' ? 'funnel' : 'hbars'}>
        {rows.map((r) => (
          <div key={r.key} className="hbar-row" title={`${r.label}: ${fmt(r.value)}`}>
            <span className="hbar-label">{r.label}</span>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: type === 'funnel' ? r.color : `linear-gradient(90deg, ${color}, ${color}bb)`, marginInline: type === 'funnel' ? 'auto' : undefined }} />
            </div>
            <span className="hbar-value">{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'pie') {
    const total = rows.reduce((s, r) => s + r.value, 0) || 1
    let angle = -Math.PI / 2
    const arcs = rows.map((r) => {
      const a = (r.value / total) * Math.PI * 2
      const start = angle
      angle += a
      const large = a > Math.PI ? 1 : 0
      const R = 80
      const r0 = 48
      const p = (ang: number, rad: number) => `${100 + rad * Math.cos(ang)} ${100 + rad * Math.sin(ang)}`
      const d = rows.length === 1
        ? `M 100 20 A 80 80 0 1 1 99.99 20 L 99.99 52 A 48 48 0 1 0 100 52 Z`
        : `M ${p(start, R)} A ${R} ${R} 0 ${large} 1 ${p(angle, R)} L ${p(angle, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(start, r0)} Z`
      return { ...r, d }
    })
    return (
      <div className="pie">
        <svg viewBox="0 0 200 200" width={height * 0.8} height={height * 0.8}>
          {arcs.map((a) => <path key={a.key} d={a.d} fill={a.color}><title>{`${a.label}: ${fmt(a.value)}`}</title></path>)}
          <text x="100" y="98" textAnchor="middle" className="pie-total">{fmt(total)}</text>
          <text x="100" y="116" textAnchor="middle" className="pie-sub">total</text>
        </svg>
        <ul className="legend">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key}><span className="dot" style={{ background: r.color }} />{r.label}<b>{Math.round((r.value / total) * 100)}%</b></li>
          ))}
        </ul>
      </div>
    )
  }

  // bar & line share axes
  const W = 520
  const H = height
  const pad = { l: 44, r: 12, t: 14, b: 34 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const step = iw / rows.length
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const gid = `g${color.replace('#', '')}${type}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{compact(t)}</text>
        </g>
      ))}
      {type === 'bar' &&
        rows.map((r, i) => {
          const bw = Math.min(46, step * 0.62)
          return (
            <rect key={r.key} x={pad.l + i * step + (step - bw) / 2} y={y(r.value)} width={bw} height={Math.max(1, pad.t + ih - y(r.value))} rx="6" fill={r.color !== color ? r.color : `url(#${gid})`}>
              <title>{`${r.label}: ${fmt(r.value)}`}</title>
            </rect>
          )
        })}
      {type === 'line' && (() => {
        const pts = rows.map((r, i) => [pad.l + i * step + step / 2, y(r.value)] as const)
        const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')
        const area = `${line} L ${pts[pts.length - 1][0]} ${pad.t + ih} L ${pts[0][0]} ${pad.t + ih} Z`
        return (
          <>
            <path d={area} fill={`url(#${gid})`} opacity="0.35" />
            <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => <circle key={rows[i].key} cx={p[0]} cy={p[1]} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5"><title>{`${rows[i].label}: ${fmt(rows[i].value)}`}</title></circle>)}
          </>
        )
      })()}
      {rows.map((r, i) => (
        <text key={r.key} x={pad.l + i * step + step / 2} y={H - 12} textAnchor="middle" className="axis">
          {r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label}
        </text>
      ))}
    </svg>
  )
}
````

### `crm-builder/src/components/Icon.tsx`

````tsx
import {
  AlignLeft, Award, Banknote, Calculator, Eye, BarChart3, Boxes, Briefcase, Building, Building2, Calendar, CalendarClock, CheckCircle2, CheckSquare, ClipboardList, Cog,
  Droplets, EyeOff, Factory, FileSpreadsheet, FileText, FolderKanban, GraduationCap, Handshake, HardHat, Hash, HeartPulse, Home, Hourglass, Layers,
  LifeBuoy, Link, ListChecks, Magnet, Mail, MailQuestion, Map, MapPin, MessageCircleWarning, Network, Package, PackageX, Percent, Phone, Receipt,
  ShieldCheck, ShoppingBag, ShoppingCart, Sigma, Sparkles, Star, Store, Tags, Target, Timer, Truck, Type, UserRound, Users, Users2, UserX, Wrench,
  type LucideIcon,
} from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  AlignLeft, Award, Banknote, Calculator, Eye, BarChart3, Boxes, Briefcase, Building, Building2, Calendar, CalendarClock, CheckCircle2, CheckSquare, ClipboardList, Cog,
  Droplets, EyeOff, Factory, FileSpreadsheet, FileText, FolderKanban, GraduationCap, Handshake, HardHat, Hash, HeartPulse, Home, Hourglass, Layers,
  LifeBuoy, Link, ListChecks, Magnet, Mail, MailQuestion, Map, MapPin, MessageCircleWarning, Network, Package, PackageX, Percent, Phone, Receipt,
  ShieldCheck, ShoppingBag, ShoppingCart, Sigma, Sparkles, Star, Store, Tags, Target, Timer, Truck, Type, UserRound, Users, Users2, UserX, Wrench,
}

export const MODULE_ICON_CHOICES = ['Building2', 'Users', 'Magnet', 'Handshake', 'Package', 'Home', 'MapPin', 'ClipboardList', 'ShieldCheck', 'FolderKanban', 'Timer', 'Cog', 'Users2', 'Map', 'Truck', 'LifeBuoy', 'CalendarClock', 'Briefcase', 'Award', 'Target', 'Boxes', 'Layers', 'Star', 'HeartPulse']

export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const C = ICONS[name] ?? Layers
  return <C size={size} className={className} style={style} />
}
````

### `crm-builder/src/components/Logo.tsx`

````tsx
import { Boxes } from 'lucide-react'

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark"><Boxes size={18} /></span>
      Bonyan
    </span>
  )
}
````

### `crm-builder/src/lib/engine.test.ts`

````ts
import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateById } from './templates'
import { emptyAnswers, generateSchema, suggest } from './recommend'
import { validate } from './validate'
import { emptyData, type User, type Workspace } from './types'
import { seedSampleData } from './seed'
import { createRecord, list, moveStage, onHand, postDocument, registerPayment, runScheduled, trialBalance, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { evalFormula, formulaRefs } from './formula'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function workspace(templateId = 'distribution', challenges: string[] = ['late_collections', 'stock_mismatch', 'lost_leads']) {
  const answers = { ...emptyAnswers('Test Co'), challenges, taxId: '123-456-789' }
  const schema = generateSchema(templateById(templateId), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  return { ws, schema, ctx: { ws, schema, user: admin } as Ctx }
}

function balanced(ws: Workspace) {
  const tb = trialBalance(ws)
  const dr = tb.reduce((s, [, r]) => s + r.debit, 0)
  const cr = tb.reduce((s, [, r]) => s + r.credit, 0)
  return Math.abs(dr - cr) < 0.005
}

describe('templates', () => {
  for (const t of TEMPLATES) {
    it(`${t.id} generates a schema with no errors`, () => {
      const schema = generateSchema(t, { ...emptyAnswers('Co'), taxId: '1', challenges: ['lost_leads', 'late_collections', 'accountability', 'purchasing', 'service_delays'], aftersales: true })
      const errors = validate(schema).filter((i) => i.level === 'error')
      expect(errors).toEqual([])
    })
    it(`${t.id} sample data keeps the books balanced`, () => {
      const answers = { ...emptyAnswers('Co'), taxId: '1' }
      const schema = generateSchema(t, answers)
      const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
      seedSampleData(ws, schema, admin)
      expect(balanced(ws)).toBe(true)
      const products = moduleByRole(schema, 'products')
      for (const p of products ? list(ws, products.id) : []) expect(Number(p.values.stock)).toBe(onHand(ws, p.id))
    })
  }

  it('ranks the medical template first for a medical company', () => {
    const s = suggest({ ...emptyAnswers('X'), industry: 'medical', aftersales: true, channels: ['tenders'] })
    expect(s[0].template.id).toBe('medical')
  })
})

describe('documents', () => {
  it('posts a bill and an invoice with correct VAT, stock, cost and journals', () => {
    const { ws, schema, ctx } = workspace()
    const products = moduleByRole(schema, 'products')!
    const p = createRecord(ctx, products.id, { name: 'Widget', sku: 'W1', price: 100, vat_rate: 14, track_stock: true })
    const supplier = createRecord(ctx, moduleByRole(schema, 'suppliers')!.id, { name: 'Supplier' })
    const bill = createRecord(ctx, moduleByRole(schema, 'purchases')!.id, { supplier: supplier.id, date: '2026-01-10' }, { lines: [{ id: uid('l'), product: p.id, description: 'Widget', qty: 10, price: 60, discount: 0, vat: 14 }] })
    postDocument(ctx, bill)
    expect(bill.number).toBe('BILL-2026-0001')
    expect(onHand(ws, p.id)).toBe(10)
    expect(p.values.cost).toBe(60)

    const customer = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Customer', owner: admin.id })
    const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: customer.id, date: '2026-01-15' }, { lines: [{ id: uid('l'), product: p.id, description: 'Widget', qty: 3, price: 100, discount: 10, vat: 14 }] })
    expect(inv.values.subtotal).toBe(270)
    expect(inv.values.tax).toBe(37.8)
    expect(inv.values.total).toBe(307.8)
    postDocument(ctx, inv)
    expect(inv.number).toBe('INV-2026-0001')
    expect(onHand(ws, p.id)).toBe(7)
    expect(balanced(ws)).toBe(true)
    const cogs = ws.data.journal.find((j) => j.doc === inv.id)!.lines.find((l) => l.account === '5000')!
    expect(cogs.debit).toBe(180)

    expect(() => registerPayment(ctx, inv, 400, '2026-01-20', 'bank')).toThrow(/more than the balance/)
    registerPayment(ctx, inv, 100, '2026-01-20', 'cash')
    expect(inv.status).toBe('partial')
    registerPayment(ctx, inv, 207.8, '2026-01-21', 'bank')
    expect(inv.status).toBe('paid')
    expect(inv.values.balance).toBe(0)
    expect(balanced(ws)).toBe(true)
  })

  it('blocks overselling and keeps numbering gapless', () => {
    const { ws, schema, ctx } = workspace()
    const p = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Rare', sku: 'R1', price: 50, vat_rate: 14, track_stock: true })
    const c = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'C', owner: admin.id })
    const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: c.id, date: '2026-02-01' }, { lines: [{ id: uid('l'), product: p.id, description: 'Rare', qty: 1, price: 50, discount: 0, vat: 14 }] })
    expect(() => postDocument(ctx, inv)).toThrow(/Not enough stock/)
    expect(inv.status).toBe('draft')
    expect(ws.data.sequences['INV-2026'] ?? 0).toBe(0)
  })

  it('voiding reverses stock and journals', () => {
    const { ws, schema, ctx } = workspace()
    const p = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'A', sku: 'A1', price: 10, vat_rate: 14, track_stock: true })
    const s = createRecord(ctx, moduleByRole(schema, 'suppliers')!.id, { name: 'S' })
    const bill = createRecord(ctx, moduleByRole(schema, 'purchases')!.id, { supplier: s.id, date: '2026-03-01' }, { lines: [{ id: uid('l'), product: p.id, description: 'A', qty: 5, price: 4, discount: 0, vat: 14 }] })
    postDocument(ctx, bill)
    voidDocument(ctx, bill)
    expect(onHand(ws, p.id)).toBe(0)
    expect(bill.status).toBe('void')
    expect(balanced(ws)).toBe(true)
    const tb = new Map(trialBalance(ws))
    expect(tb.get('1300')!.debit - tb.get('1300')!.credit).toBe(0)
  })
})

describe('pipelines and automations', () => {
  it('enforces stage gates', () => {
    const { schema, ctx } = workspace('medical')
    const deals = moduleByRole(schema, 'deals')!
    const acc = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Hospital', owner: admin.id })
    const deal = createRecord(ctx, deals.id, { title: 'Tender', account: acc.id, amount: 1000, close_date: '2026-05-01' })
    const technical = deals.stages!.find((s) => s.name === 'Technical offer')!
    expect(() => moveStage(ctx, deal, technical.id)).toThrow(/Tender no/)
  })

  it('creates a follow-up task for a new lead and collection tasks for overdue invoices', () => {
    const { ws, schema, ctx } = workspace()
    const tasks = moduleByRole(schema, 'tasks')!
    createRecord(ctx, moduleByRole(schema, 'leads')!.id, { name: 'Lead', phone: '+20 1012345678', source: 'facebook' })
    expect(list(ws, tasks.id).some((t) => String(t.values.title).startsWith('Call Lead'))).toBe(true)

    const c = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Late payer', owner: admin.id })
    const svc = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Service', sku: 'S1', price: 100, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: c.id, date: '2026-01-01', due_date: '2026-01-31' }, { lines: [{ id: uid('l'), product: svc.id, description: 'Service', qty: 1, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(runScheduled({ ...ctx, today: '2026-02-05' })).toBe(1)
    expect(runScheduled({ ...ctx, today: '2026-02-06' })).toBe(0)
    expect(list(ws, tasks.id).some((t) => String(t.values.title).includes('Late payer'))).toBe(true)
  })
})

describe('validator', () => {
  it('catches broken references and pipelines', () => {
    const { schema } = workspace()
    const deals = moduleByRole(schema, 'deals')!
    deals.stages = deals.stages!.filter((s) => s.type !== 'won')
    schema.reports[0].measure = { op: 'sum', field: 'customer' }
    const msgs = validate(schema).map((i) => i.message).join('\n')
    expect(msgs).toMatch(/exactly one Won/)
    expect(msgs).toMatch(/not a number/)
  })
})

describe('formula', () => {
  it('evaluates safely', () => {
    expect(evalFormula('area * price_per_m2', { area: 120, price_per_m2: 30000 })).toBe(3600000)
    expect(evalFormula('(a + b) / 2', { a: 3, b: 4 })).toBe(3.5)
    expect(formulaRefs('a*b - c')).toEqual(['a', 'b', 'c'])
    expect(() => formulaRefs('alert(1);')).toThrow()
  })
})

import { addComment, ageing, approvalNeeded, decideApproval, fieldValue, importRows, requestApproval, rotting, score, updateRecord } from './engine'

describe('competitor-grade features', () => {
  function setup() {
    const w = workspace()
    const sales = w.schema.roles.find((r) => r.name === 'Sales')!
    const finance = w.schema.roles.find((r) => r.finance && !r.admin)!
    const manager = w.schema.roles.find((r) => r.name === 'Management')!
    const clerk: User = { id: 'u_fin', name: 'Fatma Finance', email: 'f@x.com', roleId: finance.id }
    const boss: User = { id: 'u_mgr', name: 'Hany Manager', email: 'h@x.com', roleId: manager.id }
    const rep: User = { id: 'u_rep', name: 'Rami Rep', email: 'r@x.com', roleId: sales.id }
    w.ws.users.push(clerk, boss, rep)
    return { ...w, clerk, boss, rep }
  }

  it('rollups and lookups follow linked records', () => {
    const { ws, schema, ctx } = setup()
    const acc = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Acme', owner: admin.id, governorate: 'giza' })
    const svc = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Svc', sku: 'S', price: 1000, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: acc.id, date: '2026-01-01' }, { lines: [{ id: uid('l'), product: svc.id, description: 'Svc', qty: 2, price: 1000, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    const accounts = moduleByRole(schema, 'accounts')!
    expect(fieldValue(ws, schema, acc, accounts.fields.find((f) => f.key === 'total_invoiced')!)).toBe(2280)
    const deals = moduleByRole(schema, 'deals')!
    const deal = createRecord(ctx, deals.id, { title: 'D', account: acc.id, amount: 5, close_date: '2026-02-01' })
    expect(fieldValue(ws, schema, deal, deals.fields.find((f) => f.key === 'customer_governorate')!)).toBe('giza')
  })

  it('enforces validation rules and conditional required fields', () => {
    const { schema, ctx } = setup()
    const deals = moduleByRole(schema, 'deals')!
    const acc = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'A', owner: admin.id })
    expect(() => createRecord(ctx, deals.id, { title: 'Zero', account: acc.id, amount: 0, close_date: '2026-02-01' })).toThrow(/more than 0/)
    deals.fields.push({ id: 'f_reason', key: 'lost_reason', label: 'Lost reason', type: 'text', required: true, showIf: { field: 'title', op: 'contains', value: 'lost' } })
    expect(() => createRecord(ctx, deals.id, { title: 'Normal', account: acc.id, amount: 10, close_date: '2026-02-01' })).not.toThrow()
    expect(() => createRecord(ctx, deals.id, { title: 'lost deal', account: acc.id, amount: 10, close_date: '2026-02-01' })).toThrow(/Lost reason is required/)
  })

  it('requires manager approval to post a large invoice', () => {
    const { ws, schema, clerk, boss } = setup()
    const asClerk: Ctx = { ws, schema, user: clerk }
    const asBoss: Ctx = { ws, schema, user: boss }
    const adminCtx: Ctx = { ws, schema, user: admin }
    const acc = createRecord(adminCtx, moduleByRole(schema, 'accounts')!.id, { name: 'Big', owner: admin.id })
    const svc = createRecord(adminCtx, moduleByRole(schema, 'products')!.id, { name: 'Big svc', sku: 'B', price: 300000, vat_rate: 14, track_stock: false })
    const inv = createRecord(adminCtx, moduleByRole(schema, 'invoices')!.id, { customer: acc.id, date: '2026-03-01' }, { lines: [{ id: uid('l'), product: svc.id, description: 'x', qty: 1, price: 300000, discount: 0, vat: 14 }] })
    expect(() => postDocument(asClerk, inv)).toThrow(/Needs approval/)
    const rule = approvalNeeded(asClerk, inv, 'post')!
    const req = requestApproval(asClerk, inv, rule.id)
    expect(() => postDocument(asClerk, inv)).toThrow(/Waiting for approval/)
    expect(() => decideApproval(asClerk, req.id, true)).toThrow(/can’t decide/)
    decideApproval(asBoss, req.id, true, 'ok')
    expect(ws.data.notes.some((n) => n.user === clerk.id && n.message.includes('approved'))).toBe(true)
    postDocument(asClerk, inv)
    expect(inv.status).toBe('posted')
  })

  it('scores leads, flags rotting deals and records field history', () => {
    const { ws, schema, ctx } = setup()
    const leads = moduleByRole(schema, 'leads')!
    const hot = createRecord(ctx, leads.id, { name: 'Hot', phone: '+20 1011111111', source: 'referral', email: 'a@b.co', company: 'Big Co' })
    const cold = createRecord(ctx, leads.id, { name: 'Cold', phone: '+20 1022222222', source: 'facebook' })
    expect(score(ws, schema, hot)).toBe(45)
    expect(score(ws, schema, cold)).toBe(0)
    const deals = moduleByRole(schema, 'deals')!
    const acc = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'A', owner: admin.id })
    const deal = createRecord(ctx, deals.id, { title: 'Old', account: acc.id, amount: 100, close_date: '2026-02-01' })
    deal.updatedAt = deal.createdAt = '2026-01-01T00:00:00.000Z'
    deal.stageHistory = [{ stage: deal.stage!, at: deal.createdAt }]
    expect(rotting(schema, deal, '2026-02-01').rotting).toBe(true)
    updateRecord(ctx, deal, { amount: 250 })
    expect(ws.data.activity.some((a) => a.record === deal.id && a.text.includes('Amount: EGP 100.00 → EGP 250.00'))).toBe(true)
  })

  it('imports rows with conversion and reports bad rows', () => {
    const { ws, schema, ctx } = setup()
    const leads = moduleByRole(schema, 'leads')!
    const res = importRows(ctx, leads.id, [
      { Name: 'Ali', Mobile: '+20 1033333333', From: 'Facebook' },
      { Name: 'Bad', Mobile: '+20 1044444444', From: 'Carrier pigeon' },
      { Name: '', Mobile: '+20 1055555555', From: 'Website' },
    ], { Name: 'name', Mobile: 'phone', From: 'source' })
    expect(res.created).toBe(1)
    expect(res.errors.map((e) => e.row)).toEqual([3, 4])
    expect(list(ws, leads.id)[0].values.source).toBe('facebook')
  })

  it('ages receivables and notifies @mentions', () => {
    const { ws, schema, ctx, rep } = setup()
    const acc = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Slow', owner: admin.id })
    const svc = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'S', sku: 'S9', price: 100, vat_rate: 0, track_stock: false })
    const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: acc.id, date: '2026-01-01', due_date: '2026-01-10' }, { lines: [{ id: uid('l'), product: svc.id, description: 'S', qty: 1, price: 100, discount: 0, vat: 0 }] })
    postDocument(ctx, inv)
    const rows = ageing(ws, schema, 'invoices', '2026-03-01')
    expect(rows[0]).toMatchObject({ name: 'Slow', d30: 0, d60: 100, total: 100 })
    addComment(ctx, acc, 'Please call them @Rami')
    expect(ws.data.notes.some((n) => n.user === rep.id)).toBe(true)
  })

  it('raises a reorder alert when stock drops to the reorder level', () => {
    const { ws, schema, ctx } = setup()
    const p = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Filter', sku: 'F1', price: 50, vat_rate: 14, track_stock: true, reorder_level: 5 })
    const s = createRecord(ctx, moduleByRole(schema, 'suppliers')!.id, { name: 'S' })
    const bill = createRecord(ctx, moduleByRole(schema, 'purchases')!.id, { supplier: s.id, date: '2026-01-01' }, { lines: [{ id: uid('l'), product: p.id, description: 'F', qty: 8, price: 20, discount: 0, vat: 14 }] })
    postDocument(ctx, bill)
    const c = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'C', owner: admin.id })
    const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: c.id, date: '2026-01-02' }, { lines: [{ id: uid('l'), product: p.id, description: 'F', qty: 4, price: 50, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(ws.data.notes.some((n) => n.message.startsWith('Reorder Filter: 4 left'))).toBe(true)
  })
})
````

### `crm-builder/src/lib/engine.ts`

````ts
// The runtime. Records, pipelines, documents, stock, double-entry accounting, payments and automations.
// All functions mutate the workspace passed in and throw EngineError with a message a person can act on.
import type { Aggregate, AppSchema, ApprovalRule, FieldDef, ModuleDef, Permission, WorkflowDef, Filter } from './schema'
import { fieldByKey, moduleById, moduleByRole, uid } from './schema'
import { evalFormula } from './formula'
import type { AccountCode, Approval, JournalEntry, Line, Rec, User, Workspace } from './types'

export class EngineError extends Error {}

export interface Ctx {
  ws: Workspace
  schema: AppSchema
  user: User
  today?: string
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const todayISO = () => new Date().toISOString().slice(0, 10)
const nowISO = () => new Date().toISOString()
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ---------------- permissions ---------------- */

export function can(ctx: Pick<Ctx, 'schema' | 'user'>, moduleId: string, p: Permission) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  if (!role) return false
  if (role.admin) return true
  return Boolean(role.access[moduleId]?.includes(p))
}

export function canPost(ctx: Pick<Ctx, 'schema' | 'user'>) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.finance)
}

function need(ctx: Ctx, moduleId: string, p: Permission) {
  if (!can(ctx, moduleId, p)) throw new EngineError(`Your role can't ${p} records here`)
}

/* ---------------- records ---------------- */

export function list(ws: Workspace, moduleId: string): Rec[] {
  return (ws.data.records[moduleId] ??= [])
}

export function findRecord(ws: Workspace, id: string | undefined): Rec | undefined {
  if (!id) return undefined
  for (const recs of Object.values(ws.data.records)) {
    const r = recs.find((x) => x.id === id)
    if (r) return r
  }
  return undefined
}

export function recordTitle(ws: Workspace, schema: AppSchema, rec: Rec | undefined): string {
  if (!rec) return '—'
  const m = moduleById(schema, rec.module)
  if (m?.lines) {
    const cust = findRecord(ws, String(rec.values.customer ?? rec.values.supplier ?? ''))
    return `${rec.number ?? 'Draft'} · ${cust ? recordTitle(ws, schema, cust) : ''}`.trim()
  }
  const v = rec.values[m?.titleField ?? 'name']
  return v === undefined || v === '' ? '(untitled)' : String(v)
}

export function displayValue(ws: Workspace, schema: AppSchema, field: FieldDef, value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (field.type === 'lookup' || field.type === 'rollup') {
    const shape = computedShape(schema, field)
    return shape ? displayValue(ws, schema, shape, value) : String(value)
  }
  switch (field.type) {
    case 'select':
      return field.options?.find((o) => o.value === value)?.label ?? String(value)
    case 'multiselect':
      return (value as string[]).map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ')
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'relation':
      return recordTitle(ws, schema, findRecord(ws, String(value)))
    case 'user':
      return ws.users.find((u) => u.id === value)?.name ?? ''
    case 'currency':
      return money(Number(value), schema.company.currency)
    case 'percent':
      return `${Number(value)}%`
    default:
      return String(value)
  }
}

/* ---------------- computed fields ---------------- */

function ownerModule(schema: AppSchema, field: FieldDef) {
  return schema.modules.find((m) => m.fields.some((f) => f.id === field.id))
}

/** The field definition a lookup/rollup value should be displayed like. */
export function computedShape(schema: AppSchema, field: FieldDef): FieldDef | undefined {
  if (field.type === 'lookup' && field.lookup) {
    const via = fieldByKey(ownerModule(schema, field), field.lookup.via)
    const target = fieldByKey(moduleById(schema, via?.target ?? ''), field.lookup.field)
    if (!target || target.id === field.id) return undefined
    return target.type === 'lookup' || target.type === 'rollup' ? computedShape(schema, target) : target
  }
  if (field.type === 'rollup' && field.rollup) {
    if (field.rollup.op === 'count') return { ...field, type: 'number' }
    const src = fieldByKey(moduleById(schema, field.rollup.module), field.rollup.field)
    return src ? { ...src, type: src.type === 'formula' || src.type === 'rollup' ? 'number' : src.type } : undefined
  }
  return undefined
}

export function aggregate(op: Aggregate, values: number[]) {
  if (op === 'count') return values.length
  if (!values.length) return 0
  if (op === 'sum') return round2(values.reduce((a, b) => a + b, 0))
  if (op === 'avg') return round2(values.reduce((a, b) => a + b, 0) / values.length)
  if (op === 'min') return Math.min(...values)
  return Math.max(...values)
}

/** A field's value, calculating lookups and rollups from related records. */
export function fieldValue(ws: Workspace, schema: AppSchema, rec: Rec, field: FieldDef, depth = 0): unknown {
  if (depth > 3) return undefined
  if (field.type === 'lookup' && field.lookup) {
    const target = findRecord(ws, String(rec.values[field.lookup.via] ?? ''))
    if (!target) return undefined
    const tf = fieldByKey(moduleById(schema, target.module), field.lookup.field)
    return tf ? fieldValue(ws, schema, target, tf, depth + 1) : undefined
  }
  if (field.type === 'rollup' && field.rollup) {
    const { module, via, op, field: key } = field.rollup
    const src = fieldByKey(moduleById(schema, module), key)
    const children = list(ws, module).filter((r) => r.values[via] === rec.id && r.status !== 'void')
    return aggregate(op, children.map((c) => Number(src ? fieldValue(ws, schema, c, src, depth + 1) : 0) || 0))
  }
  return rec.values[field.key]
}

/** Score from the module's scoring rules (lead scoring). */
export function score(ws: Workspace, schema: AppSchema, rec: Rec) {
  const mod = moduleById(schema, rec.module)
  return (mod?.scoring ?? []).reduce((s, r) => s + (matches(schema, rec, [r.condition], ws) ? r.points : 0), 0)
}

/** Days a record has sat in its current stage, and whether that counts as rotting. */
export function rotting(schema: AppSchema, rec: Rec, today = todayISO()) {
  const mod = moduleById(schema, rec.module)
  const st = mod?.stages?.find((s) => s.id === rec.stage)
  if (!st || st.type !== 'open' || !st.rotDays) return { days: 0, rotting: false }
  const since = rec.stageHistory?.filter((h) => h.stage === rec.stage).at(-1)?.at ?? rec.createdAt
  const last = rec.updatedAt > since ? rec.updatedAt : since
  const days = Math.floor((Date.parse(today + 'T23:59:59Z') - Date.parse(last)) / 86_400_000)
  return { days, rotting: days > st.rotDays }
}

export function isVisible(_mod: ModuleDef, field: FieldDef, values: Record<string, unknown>) {
  if (!field.showIf) return true
  return compare(values[field.showIf.field], field.showIf)
}

export function money(n: number, currency = 'EGP') {
  return `${currency} ${round2(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE = /^\+?[0-9 ()-]{7,20}$/

function cleanValues(ctx: Ctx, mod: ModuleDef, input: Record<string, unknown>, existing?: Rec) {
  const out: Record<string, unknown> = { ...(existing?.values ?? {}) }
  for (const f of mod.fields) {
    if (f.readOnly || f.type === 'formula' || f.type === 'lookup' || f.type === 'rollup') continue
    if (!(f.key in input)) continue
    let v = input[f.key]
    if (typeof v === 'string') v = v.trim()
    if (['number', 'currency', 'percent', 'rating'].includes(f.type)) v = v === '' || v === undefined || v === null ? undefined : Number(v)
    if (f.type === 'checkbox') v = Boolean(v)
    out[f.key] = v
  }
  for (const f of mod.fields) if (f.type === 'formula' && f.formula) out[f.key] = evalFormula(f.formula, out) ?? undefined
  const errors: string[] = []
  for (const f of mod.fields) {
    if (f.type === 'lookup' || f.type === 'rollup') continue
    const v = out[f.key]
    const empty = v === undefined || v === '' || v === null || (Array.isArray(v) && v.length === 0)
    if (f.required && empty && !f.readOnly && f.type !== 'checkbox' && isVisible(mod, f, out)) errors.push(`${f.label} is required`)
    if (empty) continue
    if (f.type === 'email' && !EMAIL.test(String(v))) errors.push(`${f.label} is not a valid e-mail`)
    if (f.type === 'phone' && !PHONE.test(String(v))) errors.push(`${f.label} is not a valid phone number`)
    if (['number', 'currency', 'percent', 'rating'].includes(f.type)) {
      if (!Number.isFinite(v as number)) errors.push(`${f.label} must be a number`)
      if (f.min !== undefined && (v as number) < f.min) errors.push(`${f.label} must be at least ${f.min}`)
      if (f.max !== undefined && (v as number) > f.max) errors.push(`${f.label} must be at most ${f.max}`)
      if (f.type === 'currency' && (v as number) < 0) errors.push(`${f.label} can't be negative`)
      if (f.type === 'percent' && ((v as number) < 0 || (v as number) > 100)) errors.push(`${f.label} must be between 0 and 100`)
    }
    if (f.type === 'select' && !f.options?.some((o) => o.value === v)) errors.push(`${f.label}: “${v}” is not one of the options`)
    if (f.type === 'relation' && !findRecord(ctx.ws, String(v))) errors.push(`${f.label}: the linked record no longer exists`)
    if (f.unique) {
      const clash = list(ctx.ws, mod.id).find((r) => r.id !== existing?.id && String(r.values[f.key] ?? '').toLowerCase() === String(v).toLowerCase())
      if (clash) errors.push(`${f.label} “${v}” is already used`)
    }
  }
  for (const rule of mod.rules ?? []) {
    if (rule.when.every((w) => compare(out[w.field], w)) && !compare(out[rule.check.field], rule.check)) errors.push(rule.message)
  }
  if (errors.length) throw new EngineError(errors.join(' · '))
  return out
}

function log(ctx: Ctx, text: string, rec?: Rec) {
  ctx.ws.data.activity.unshift({ id: uid('a'), at: nowISO(), user: ctx.user.name, text, record: rec?.id, module: rec?.module })
  if (ctx.ws.data.activity.length > 500) ctx.ws.data.activity.length = 500
}

export function createRecord(ctx: Ctx, moduleId: string, values: Record<string, unknown>, opts: { stage?: string; lines?: Line[]; silent?: boolean } = {}): Rec {
  const mod = moduleById(ctx.schema, moduleId)
  if (!mod) throw new EngineError('This module no longer exists')
  if (!opts.silent) need(ctx, moduleId, 'create')
  const defaults: Record<string, unknown> = {}
  for (const f of mod.fields) {
    if (f.type === 'user' && (f.key === 'owner' || f.key === 'assignee') && values[f.key] === undefined) defaults[f.key] = ctx.user.id
    if (f.key === 'vat_rate' && values[f.key] === undefined) defaults[f.key] = ctx.schema.company.vatRate
    if (f.key === 'track_stock' && values[f.key] === undefined) defaults[f.key] = true
    if (f.type === 'date' && ['date', 'visit_date', 'survey_date'].includes(f.key) && values[f.key] === undefined) defaults[f.key] = todayISO()
  }
  if (mod.lines && values.due_date === undefined && mod.role !== 'quotes') defaults.due_date = addDays(String(values.date ?? todayISO()), 30)
  if (mod.role === 'quotes' && values.valid_until === undefined) defaults.valid_until = addDays(String(values.date ?? todayISO()), 15)
  const rec: Rec = {
    id: uid('r'),
    module: moduleId,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    createdBy: ctx.user.id,
    values: {},
  }
  rec.values = cleanValues(ctx, mod, { ...defaults, ...values }, rec)
  if (mod.stages) {
    const st = mod.stages.find((s) => s.id === opts.stage) ?? mod.stages[0]
    checkGate(mod, st.id, rec.values)
    rec.stage = st.id
    rec.stageHistory = [{ stage: st.id, at: rec.createdAt }]
  }
  if (mod.lines) {
    rec.status = 'draft'
    rec.lines = (opts.lines ?? []).map((l) => ({ ...l, id: l.id || uid('l') }))
    applyTotals(rec)
  }
  if (mod.role === 'products') {
    rec.values.stock = 0
    rec.values.cost = 0
  }
  list(ctx.ws, moduleId).unshift(rec)
  log(ctx, `created ${mod.singular} “${recordTitle(ctx.ws, ctx.schema, rec)}”`, rec)
  if (!opts.silent) runWorkflows(ctx, rec, 'created')
  return rec
}

export function updateRecord(ctx: Ctx, rec: Rec, values: Record<string, unknown>, opts: { silent?: boolean } = {}) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!opts.silent) need(ctx, rec.module, 'edit')
  if (mod.lines && rec.status !== 'draft' && mod.role !== 'quotes') throw new EngineError('Posted documents can’t be changed. Void it and create a new one.')
  const before = rec.values
  const after = cleanValues(ctx, mod, values, rec)
  if (rec.stage) checkGate(mod, rec.stage, after)
  rec.values = after
  if (mod.lines) applyTotals(rec)
  rec.updatedAt = nowISO()
  // Field history: who changed what, from what, to what.
  const changes = mod.fields
    .filter((f) => !f.readOnly && f.type !== 'formula' && JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null))
    .map((f) => `${f.label}: ${displayValue(ctx.ws, ctx.schema, f, before[f.key]) || '—'} → ${displayValue(ctx.ws, ctx.schema, f, after[f.key]) || '—'}`)
  if (changes.length) log(ctx, `changed ${changes.slice(0, 4).join('; ')}${changes.length > 4 ? ` and ${changes.length - 4} more` : ''}`, rec)
  if (!opts.silent) runWorkflows(ctx, rec, 'updated')
}

export function referencesTo(ws: Workspace, schema: AppSchema, rec: Rec): string[] {
  const out: string[] = []
  for (const m of schema.modules) {
    const rels = m.fields.filter((f) => f.type === 'relation' && f.target === rec.module)
    for (const r of list(ws, m.id)) {
      if (rels.some((f) => r.values[f.key] === rec.id)) out.push(`${m.singular} “${recordTitle(ws, schema, r)}”`)
      if (r.lines?.some((l) => l.product === rec.id) && r.status !== 'draft') out.push(`${m.singular} ${r.number}`)
    }
  }
  return out
}

export function deleteRecord(ctx: Ctx, rec: Rec) {
  need(ctx, rec.module, 'delete')
  const mod = moduleById(ctx.schema, rec.module)!
  if (mod.lines && rec.status !== 'draft' && mod.role !== 'quotes') throw new EngineError('Posted documents are kept for the audit trail. Void it instead.')
  if (mod.role === 'products' && ctx.ws.data.stock.some((s) => s.product === rec.id)) throw new EngineError('This product has stock movements. Rename it or mark it inactive instead.')
  const refs = referencesTo(ctx.ws, ctx.schema, rec)
  if (refs.length) throw new EngineError(`Can’t delete: used by ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` and ${refs.length - 3} more` : ''}`)
  ctx.ws.data.records[rec.module] = list(ctx.ws, rec.module).filter((r) => r.id !== rec.id)
  log(ctx, `deleted ${mod.singular} “${recordTitle(ctx.ws, ctx.schema, rec)}”`)
}

/* ---------------- pipelines ---------------- */

function checkGate(mod: ModuleDef, stageId: string, values: Record<string, unknown>) {
  const st = mod.stages?.find((s) => s.id === stageId)
  const missing = (st?.requires ?? []).map((k) => fieldByKey(mod, k)).filter((f): f is FieldDef => Boolean(f) && (values[f!.key] === undefined || values[f!.key] === '' || values[f!.key] === 0))
  if (missing.length) throw new EngineError(`To move to “${st!.name}”, fill in: ${missing.map((f) => f.label).join(', ')}`)
}

export function moveStage(ctx: Ctx, rec: Rec, stageId: string) {
  const mod = moduleById(ctx.schema, rec.module)!
  need(ctx, rec.module, 'edit')
  if (rec.stage === stageId) return
  const st = mod.stages?.find((s) => s.id === stageId)
  if (!st) throw new EngineError('That stage no longer exists')
  checkGate(mod, stageId, rec.values)
  guardApproval(ctx, rec, 'stage', stageId)
  rec.stage = stageId
  rec.stageHistory = [...(rec.stageHistory ?? []), { stage: stageId, at: nowISO() }]
  if (st.type === 'won' && mod.role === 'deals' && !rec.values.close_date) rec.values.close_date = todayISO()
  rec.updatedAt = nowISO()
  log(ctx, `moved “${recordTitle(ctx.ws, ctx.schema, rec)}” to ${st.name}`, rec)
  runWorkflows(ctx, rec, 'stage_changed')
}

export function convertLead(ctx: Ctx, lead: Rec) {
  const leadsMod = moduleById(ctx.schema, lead.module)!
  const accounts = moduleByRole(ctx.schema, 'accounts')
  const contacts = moduleByRole(ctx.schema, 'contacts')
  const deals = moduleByRole(ctx.schema, 'deals')
  if (!accounts || !deals) throw new EngineError('Converting a lead needs Customers and Deals modules')
  const won = leadsMod.stages?.find((s) => s.type === 'won')
  if (lead.stage === won?.id) throw new EngineError('This lead is already converted')
  const name = String(lead.values.company || lead.values.name)
  const account = createRecord(ctx, accounts.id, pick(accounts, { name, phone: lead.values.phone, email: lead.values.email, owner: lead.values.owner }))
  if (contacts) createRecord(ctx, contacts.id, pick(contacts, { name: lead.values.name, account: account.id, phone: lead.values.phone, email: lead.values.email }))
  const amount = Number(lead.values.budget ?? 0) || 1
  const deal = createRecord(ctx, deals.id, pick(deals, { title: `${name} – new opportunity`, account: account.id, amount, close_date: addDays(todayISO(), 30), owner: lead.values.owner }))
  if (won) {
    lead.stage = won.id
    lead.stageHistory = [...(lead.stageHistory ?? []), { stage: won.id, at: nowISO() }]
  }
  log(ctx, `converted lead “${lead.values.name}”`, lead)
  return deal
}

function pick(mod: ModuleDef, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (fieldByKey(mod, k) && v !== undefined && v !== '') out[k] = v
  return out
}

/* ---------------- documents ---------------- */

export function lineNet(l: Line) {
  return round2(l.qty * l.price * (1 - (l.discount || 0) / 100))
}
export function lineTax(l: Line) {
  return round2(lineNet(l) * (l.vat || 0) / 100)
}

export function totals(lines: Line[]) {
  const subtotal = round2(lines.reduce((s, l) => s + lineNet(l), 0))
  const tax = round2(lines.reduce((s, l) => s + lineTax(l), 0))
  return { subtotal, tax, total: round2(subtotal + tax) }
}

function applyTotals(rec: Rec) {
  const t = totals(rec.lines ?? [])
  rec.values.subtotal = t.subtotal
  rec.values.tax = t.tax
  rec.values.total = t.total
  const paid = Number(rec.values.paid ?? 0)
  rec.values.paid = paid
  rec.values.balance = round2(t.total - paid)
}

export function setLines(ctx: Ctx, rec: Rec, lines: Line[]) {
  need(ctx, rec.module, 'edit')
  if (rec.status !== 'draft' && rec.status !== 'sent') throw new EngineError('Only drafts can be changed')
  checkLines(lines)
  rec.lines = lines
  applyTotals(rec)
  rec.updatedAt = nowISO()
}

function checkLines(lines: Line[]) {
  for (const l of lines) {
    if (!(l.qty > 0)) throw new EngineError(`Quantity must be more than 0 (${l.description || 'line'})`)
    if (!(l.price >= 0)) throw new EngineError(`Price can’t be negative (${l.description || 'line'})`)
    if (l.discount < 0 || l.discount > 100) throw new EngineError('Discount must be between 0 and 100%')
    if (l.vat < 0 || l.vat > 100) throw new EngineError('VAT must be between 0 and 100%')
  }
}

function nextNumber(ctx: Ctx, prefix: string, date: string) {
  const key = `${prefix}-${date.slice(0, 4)}`
  const n = (ctx.ws.data.sequences[key] ?? 0) + 1
  ctx.ws.data.sequences[key] = n
  return `${key}-${String(n).padStart(4, '0')}`
}

function journal(ctx: Ctx, entry: Omit<JournalEntry, 'id'>) {
  const lines = entry.lines.filter((l) => round2(l.debit) !== 0 || round2(l.credit) !== 0).map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (dr !== cr) throw new EngineError(`Internal check failed: journal ${entry.ref} does not balance (${dr} ≠ ${cr})`)
  ctx.ws.data.journal.unshift({ ...entry, lines, id: uid('j') })
}

function productRec(ctx: Ctx, id?: string) {
  const products = moduleByRole(ctx.schema, 'products')
  return id && products ? list(ctx.ws, products.id).find((p) => p.id === id) : undefined
}

export function onHand(ws: Workspace, productId: string) {
  return round2(ws.data.stock.filter((s) => s.product === productId).reduce((s, m) => s + m.qty, 0))
}

export function postDocument(ctx: Ctx, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can post documents')
  if (rec.status !== 'draft') throw new EngineError('Already posted')
  if (mod.role !== 'invoices' && mod.role !== 'purchases') throw new EngineError('Only invoices and purchase bills are posted')
  guardApproval(ctx, rec, 'post')
  const lines = rec.lines ?? []
  if (!lines.length) throw new EngineError('Add at least one line before posting')
  const party = mod.role === 'invoices' ? rec.values.customer : rec.values.supplier
  if (!party) throw new EngineError(mod.role === 'invoices' ? 'Choose the customer first' : 'Choose the supplier first')
  const date = String(rec.values.date ?? todayISO())
  if (rec.values.due_date && String(rec.values.due_date) < date) throw new EngineError('The due date can’t be before the document date')
  checkLines(lines)
  applyTotals(rec)

  // Quantities per tracked product
  const qtyBy = new Map<string, number>()
  for (const l of lines) {
    const p = productRec(ctx, l.product)
    if (p && p.values.track_stock) qtyBy.set(p.id, (qtyBy.get(p.id) ?? 0) + l.qty)
  }

  if (mod.role === 'invoices' && !ctx.schema.company.allowNegativeStock) {
    const short = [...qtyBy].filter(([pid, q]) => onHand(ctx.ws, pid) < q)
    if (short.length) throw new EngineError(`Not enough stock: ${short.map(([pid, q]) => `${productRec(ctx, pid)?.values.name} (need ${q}, have ${onHand(ctx.ws, pid)})`).join(', ')}`)
  }

  // Every check is done, so the number is only taken when posting succeeds: numbering stays gapless.
  const t = totals(lines)
  const number = nextNumber(ctx, mod.numberPrefix ?? 'DOC', date)

  if (mod.role === 'invoices') {
    let cogs = 0
    for (const [pid, q] of qtyBy) {
      const p = productRec(ctx, pid)!
      const cost = Number(p.values.cost ?? 0)
      cogs += q * cost
      ctx.ws.data.stock.unshift({ id: uid('s'), product: pid, qty: -q, cost, doc: rec.id, ref: number, date })
      p.values.stock = onHand(ctx.ws, pid)
      reorderAlert(ctx, p)
    }
    journal(ctx, {
      date, ref: number, memo: `Sales invoice ${number}`, doc: rec.id,
      lines: [
        { account: '1200', debit: t.total, credit: 0 },
        { account: '4000', debit: 0, credit: t.subtotal },
        { account: '2200', debit: 0, credit: t.tax },
        { account: '5000', debit: round2(cogs), credit: 0 },
        { account: '1300', debit: 0, credit: round2(cogs) },
      ],
    })
  } else {
    let stockValue = 0
    for (const l of lines) {
      const p = productRec(ctx, l.product)
      if (!p || !p.values.track_stock) continue
      const unitCost = l.qty ? lineNet(l) / l.qty : 0
      const oldQty = onHand(ctx.ws, p.id)
      const oldCost = Number(p.values.cost ?? 0)
      const newQty = oldQty + l.qty
      p.values.cost = round2(newQty > 0 && oldQty > 0 ? (oldQty * oldCost + l.qty * unitCost) / newQty : unitCost)
      ctx.ws.data.stock.unshift({ id: uid('s'), product: p.id, qty: l.qty, cost: round2(unitCost), doc: rec.id, ref: number, date })
      p.values.stock = onHand(ctx.ws, p.id)
      stockValue += lineNet(l)
    }
    stockValue = round2(stockValue)
    journal(ctx, {
      date, ref: number, memo: `Purchase bill ${number}`, doc: rec.id,
      lines: [
        { account: '1300', debit: stockValue, credit: 0 },
        { account: '5100', debit: round2(t.subtotal - stockValue), credit: 0 },
        { account: '1400', debit: t.tax, credit: 0 },
        { account: '2100', debit: 0, credit: t.total },
      ],
    })
  }
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.paid = 0
  rec.values.balance = t.total
  log(ctx, `posted ${mod.singular} ${number}`, rec)
  runWorkflows(ctx, rec, 'updated')
}

export function voidDocument(ctx: Ctx, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can void documents')
  if (rec.status === 'draft' || rec.status === 'void') throw new EngineError('Only posted documents can be voided')
  if (Number(rec.values.paid) > 0) throw new EngineError('This document has payments. Refund or reverse them before voiding.')
  const date = todayISO()
  for (const mv of ctx.ws.data.stock.filter((s) => s.doc === rec.id)) {
    const p = productRec(ctx, mv.product)
    if (mod.role === 'purchases' && p) {
      const q = onHand(ctx.ws, p.id)
      const remaining = q - mv.qty
      if (remaining > 0) p.values.cost = round2((q * Number(p.values.cost) - mv.qty * mv.cost) / remaining)
    }
    ctx.ws.data.stock.unshift({ ...mv, id: uid('s'), qty: -mv.qty, ref: `VOID ${rec.number}`, date })
    if (p) p.values.stock = onHand(ctx.ws, p.id)
  }
  for (const je of ctx.ws.data.journal.filter((j) => j.doc === rec.id && !j.ref.startsWith('VOID'))) {
    journal(ctx, { date, ref: `VOID ${je.ref}`, memo: `Reversal of ${je.ref}`, doc: rec.id, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) })
  }
  rec.status = 'void'
  rec.values.balance = 0
  log(ctx, `voided ${mod.singular} ${rec.number}`, rec)
}

export function registerPayment(ctx: Ctx, rec: Rec, amount: number, date: string, method: 'cash' | 'bank' | 'cheque' | 'instapay' | 'card') {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can register payments')
  if (rec.status !== 'posted' && rec.status !== 'partial') throw new EngineError('Post the document before registering a payment')
  amount = round2(amount)
  const balance = round2(Number(rec.values.balance))
  if (!(amount > 0)) throw new EngineError('Payment amount must be more than 0')
  if (amount > balance) throw new EngineError(`Payment is more than the balance due (${money(balance, ctx.schema.company.currency)})`)
  if (date < String(rec.values.date)) throw new EngineError('Payment date can’t be before the document date')
  const incoming = mod.role === 'invoices'
  const ref = `PAY-${rec.number}-${ctx.ws.data.payments.filter((p) => p.doc === rec.id).length + 1}`
  ctx.ws.data.payments.unshift({ id: uid('p'), doc: rec.id, module: rec.module, amount, date, method, direction: incoming ? 'in' : 'out', ref })
  const cash: AccountCode = '1100'
  journal(ctx, {
    date, ref, memo: `${incoming ? 'Received from customer' : 'Paid to supplier'} for ${rec.number}`, doc: rec.id,
    lines: incoming
      ? [{ account: cash, debit: amount, credit: 0 }, { account: '1200', debit: 0, credit: amount }]
      : [{ account: '2100', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }],
  })
  rec.values.paid = round2(Number(rec.values.paid) + amount)
  rec.values.balance = round2(Number(rec.values.total) - Number(rec.values.paid))
  rec.status = Number(rec.values.balance) === 0 ? 'paid' : 'partial'
  log(ctx, `registered ${money(amount, ctx.schema.company.currency)} payment on ${rec.number}`, rec)
}

export function quoteToInvoice(ctx: Ctx, quote: Rec): Rec {
  const invoices = moduleByRole(ctx.schema, 'invoices')
  if (!invoices) throw new EngineError('Add an Invoices module first')
  if (quote.status === 'invoiced') throw new EngineError('This quotation is already invoiced')
  const inv = createRecord(ctx, invoices.id, { customer: quote.values.customer, date: todayISO() }, { lines: (quote.lines ?? []).map((l) => ({ ...l, id: uid('l') })) })
  quote.status = 'invoiced'
  quote.links = { source: inv.id }
  return inv
}

/* ---------------- accounting views ---------------- */

export function trialBalance(ws: Workspace) {
  const rows = new Map<AccountCode, { debit: number; credit: number }>()
  for (const j of ws.data.journal) {
    for (const l of j.lines) {
      const r = rows.get(l.account) ?? { debit: 0, credit: 0 }
      r.debit = round2(r.debit + l.debit)
      r.credit = round2(r.credit + l.credit)
      rows.set(l.account, r)
    }
  }
  return [...rows].sort((a, b) => a[0].localeCompare(b[0]))
}

/* ---------------- filters & automations ---------------- */

export function pseudoValue(schema: AppSchema, rec: Rec, key: string, ws?: Workspace): unknown {
  const mod = moduleById(schema, rec.module)
  if (ws && !key.startsWith('__')) {
    const f = fieldByKey(mod, key)
    if (f && (f.type === 'lookup' || f.type === 'rollup')) return fieldValue(ws, schema, rec, f)
  }
  if (key === '__stage') return rec.stage
  if (key === '__stagetype') return mod?.stages?.find((s) => s.id === rec.stage)?.type
  if (key === '__status') return rec.status
  if (key === '__month') return rec.createdAt.slice(0, 7)
  if (key === '__owner') return rec.createdBy
  return rec.values[key]
}

export function matches(schema: AppSchema, rec: Rec, filters: Filter[], ws?: Workspace) {
  return filters.every((fl) => compare(pseudoValue(schema, rec, fl.field, ws), fl))
}

/** Compares one value against a filter condition. */
export function compare(v: unknown, fl: Filter) {
  const s = Array.isArray(v) ? v.join(',') : v === undefined || v === null ? '' : String(v)
  const t = fl.value ?? ''
  const isTrue = (t === 'true' && v === true) || (t === 'false' && !v)
  switch (fl.op) {
    case 'eq':
      return s === t || isTrue || (Array.isArray(v) && v.includes(t))
    case 'neq':
      return !(s === t || isTrue || (Array.isArray(v) && v.includes(t)))
    case 'gt':
      return s !== '' && (Number.isNaN(Number(t)) ? s > t : Number(v) > Number(t))
    case 'lt':
      return s !== '' && (Number.isNaN(Number(t)) ? s < t : Number(v) < Number(t))
    case 'contains':
      return s.toLowerCase().includes(t.toLowerCase())
    case 'empty':
      return s === ''
    case 'notempty':
      return s !== ''
  }
}

function fill(ctx: Ctx, mod: ModuleDef, rec: Rec, text: string) {
  return text.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    const f = fieldByKey(mod, key)
    return f ? displayValue(ctx.ws, ctx.schema, f, rec.values[key]) || '—' : `{${key}}`
  })
}

let depth = 0
function runWorkflows(ctx: Ctx, rec: Rec, event: 'created' | 'updated' | 'stage_changed') {
  if (depth > 0) return // actions never trigger further automations, so nothing can loop
  depth++
  try {
    for (const w of ctx.schema.workflows) {
      if (!w.enabled || w.module !== rec.module || w.trigger.type !== event) continue
      if (event === 'stage_changed' && w.trigger.stage && w.trigger.stage !== rec.stage) continue
      if (!matches(ctx.schema, rec, w.conditions)) continue
      execute(ctx, w, rec)
    }
  } finally {
    depth--
  }
}

function execute(ctx: Ctx, w: WorkflowDef, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  const tasks = moduleByRole(ctx.schema, 'tasks')
  for (const a of w.actions) {
    try {
      if (a.type === 'create_task' && tasks) {
        const owner = rec.values.owner ?? rec.values.assignee ?? ctx.user.id
        createRecord(ctx, tasks.id, { title: fill(ctx, mod, rec, a.title), due_date: addDays(ctx.today ?? todayISO(), a.dueInDays), assignee: owner, done: false, related: recordTitle(ctx.ws, ctx.schema, rec), priority: a.dueInDays === 0 ? 'high' : 'normal' }, { silent: true })
      } else if (a.type === 'set_field') {
        const f = fieldByKey(mod, a.field)
        if (f && !f.readOnly) {
          const value = f.type === 'checkbox' ? a.value === 'true' : a.value
          rec.values = cleanValues(ctx, mod, { [a.field]: value }, rec)
        }
      } else if (a.type === 'notify') {
        ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: fill(ctx, mod, rec, a.message), read: false, role: a.role })
      }
    } catch (e) {
      ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `Automation “${w.name}” could not finish: ${(e as Error).message}`, read: false })
    }
  }
  ctx.ws.data.activity.unshift({ id: uid('a'), at: nowISO(), user: 'Automation', text: `ran “${w.name}”`, record: rec.id, module: rec.module })
}

/** Date-based automations. Runs each one at most once per record. */
export function runScheduled(ctx: Ctx) {
  const today = ctx.today ?? todayISO()
  let ran = 0
  for (const w of ctx.schema.workflows) {
    if (!w.enabled || w.trigger.type !== 'date_passed' || !w.trigger.field) continue
    for (const rec of list(ctx.ws, w.module)) {
      const d = rec.values[w.trigger.field]
      if (!d || String(d) >= today) continue
      const key = `${w.id}:${rec.id}`
      if (ctx.ws.data.workflowRuns[key]) continue
      if (!matches(ctx.schema, rec, w.conditions)) continue
      ctx.ws.data.workflowRuns[key] = today
      execute(ctx, w, rec)
      ran++
    }
  }
  return ran
}

/* ---------------- reorder alerts ---------------- */

function reorderAlert(ctx: Ctx, p: Rec) {
  const level = p.values.reorder_level
  if (level === undefined || level === null || level === '') return
  const stock = Number(p.values.stock ?? 0)
  if (stock > Number(level)) return
  const tasks = moduleByRole(ctx.schema, 'tasks')
  const msg = `Reorder ${p.values.name}: ${stock} left (reorder level ${level})`
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: msg, read: false, record: p.id })
  if (tasks && !list(ctx.ws, tasks.id).some((t) => !t.values.done && t.values.title === msg.split(':')[0])) {
    createRecord(ctx, tasks.id, { title: msg.split(':')[0], due_date: todayISO(), assignee: ctx.user.id, done: false, related: String(p.values.name), priority: 'high' }, { silent: true })
  }
}

/* ---------------- approvals ---------------- */

export function canApprove(ctx: Pick<Ctx, 'schema' | 'user'>, rule: ApprovalRule) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.id === rule.approverRole)
}

/** The approval rule that blocks this action, if any (an approval is valid until the record changes). */
export function approvalNeeded(ctx: Ctx, rec: Rec, action: 'post' | 'stage', stage?: string): ApprovalRule | undefined {
  for (const rule of ctx.schema.approvals ?? []) {
    if (rule.module !== rec.module || rule.action !== action) continue
    if (action === 'stage' && rule.stage !== stage) continue
    if (!matches(ctx.schema, rec, rule.conditions, ctx.ws)) continue
    const ok = (ctx.ws.data.approvals ?? []).some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'approved' && (a.decidedAt ?? '') >= rec.updatedAt)
    if (!ok) return rule
  }
  return undefined
}

function guardApproval(ctx: Ctx, rec: Rec, action: 'post' | 'stage', stage?: string) {
  const rule = approvalNeeded(ctx, rec, action, stage)
  if (!rule || canApprove(ctx, rule)) return
  const pending = (ctx.ws.data.approvals ?? []).some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'pending')
  const role = ctx.schema.roles.find((r) => r.id === rule.approverRole)?.name ?? 'an approver'
  throw new EngineError(pending ? `Waiting for approval from ${role} (“${rule.name}”)` : `Needs approval from ${role} first (“${rule.name}”). Use “Request approval”.`)
}

export function requestApproval(ctx: Ctx, rec: Rec, ruleId: string) {
  const rule = (ctx.schema.approvals ?? []).find((r) => r.id === ruleId)
  if (!rule) throw new EngineError('That approval rule no longer exists')
  const list_ = (ctx.ws.data.approvals ??= [])
  if (list_.some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'pending')) throw new EngineError('Approval already requested')
  const a: Approval = { id: uid('ap'), rule: rule.id, record: rec.id, module: rec.module, requestedBy: ctx.user.id, at: nowISO(), status: 'pending' }
  list_.unshift(a)
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} asks for approval: ${rule.name} — ${recordTitle(ctx.ws, ctx.schema, rec)}`, read: false, role: rule.approverRole, record: rec.id })
  log(ctx, `requested approval “${rule.name}”`, rec)
  return a
}

export function decideApproval(ctx: Ctx, approvalId: string, approve: boolean, note = '') {
  const a = (ctx.ws.data.approvals ?? []).find((x) => x.id === approvalId)
  if (!a) throw new EngineError('Approval not found')
  if (a.status !== 'pending') throw new EngineError('Already decided')
  const rule = (ctx.schema.approvals ?? []).find((r) => r.id === a.rule)
  if (!rule) throw new EngineError('That approval rule no longer exists')
  if (!canApprove(ctx, rule)) throw new EngineError('Your role can’t decide this approval')
  if (a.requestedBy === ctx.user.id && !ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.admin) throw new EngineError('You can’t approve your own request')
  a.status = approve ? 'approved' : 'rejected'
  a.decidedBy = ctx.user.id
  a.decidedAt = nowISO()
  a.note = note
  const rec = findRecord(ctx.ws, a.record)
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} ${approve ? 'approved' : 'rejected'} “${rule.name}” — ${recordTitle(ctx.ws, ctx.schema, rec)}${note ? `: ${note}` : ''}`, read: false, user: a.requestedBy, record: a.record })
  log(ctx, `${approve ? 'approved' : 'rejected'} “${rule.name}”${note ? ` (${note})` : ''}`, rec)
}

/* ---------------- comments & mentions ---------------- */

export function addComment(ctx: Ctx, rec: Rec, text: string) {
  const body = text.trim()
  if (!body) throw new EngineError('Write something first')
  ;(ctx.ws.data.comments ??= []).unshift({ id: uid('c'), record: rec.id, user: ctx.user.id, at: nowISO(), text: body })
  const mentioned = new Set((body.match(/@([\p{L}\w.-]+)/gu) ?? []).map((m) => m.slice(1).toLowerCase()))
  for (const u of ctx.ws.users) {
    if (u.id !== ctx.user.id && mentioned.has(u.name.split(' ')[0].toLowerCase())) {
      ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} mentioned you on ${recordTitle(ctx.ws, ctx.schema, rec)}: “${body.slice(0, 80)}”`, read: false, user: u.id, record: rec.id })
    }
  }
}

/* ---------------- import ---------------- */

export interface ImportResult {
  created: number
  errors: { row: number; message: string }[]
}

/** Imports spreadsheet rows. Each row is validated like a form save; bad rows are reported, good rows are kept. */
export function importRows(ctx: Ctx, moduleId: string, rows: Record<string, string>[], mapping: Record<string, string>): ImportResult {
  const mod = moduleById(ctx.schema, moduleId)
  if (!mod) throw new EngineError('This module no longer exists')
  need(ctx, moduleId, 'create')
  const result: ImportResult = { created: 0, errors: [] }
  rows.forEach((row, i) => {
    try {
      const values: Record<string, unknown> = {}
      for (const [col, key] of Object.entries(mapping)) {
        const f = fieldByKey(mod, key)
        const raw = (row[col] ?? '').trim()
        if (!f || raw === '') continue
        values[key] = convert(ctx, f, raw)
      }
      createRecord(ctx, moduleId, values, { silent: true })
      result.created++
    } catch (e) {
      result.errors.push({ row: i + 2, message: (e as Error).message })
    }
  })
  log(ctx, `imported ${result.created} ${mod.name.toLowerCase()}${result.errors.length ? ` (${result.errors.length} rows skipped)` : ''}`)
  return result
}

function convert(ctx: Ctx, f: FieldDef, raw: string): unknown {
  const low = raw.toLowerCase()
  switch (f.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating': {
      const n = Number(raw.replace(/[^0-9.-]/g, ''))
      if (!Number.isFinite(n)) throw new EngineError(`${f.label}: “${raw}” is not a number`)
      return n
    }
    case 'checkbox':
      return ['yes', 'y', 'true', '1', 'نعم', 'x', '✓'].includes(low)
    case 'select': {
      const o = f.options?.find((x) => x.value === low || x.label.toLowerCase() === low)
      if (!o) throw new EngineError(`${f.label}: “${raw}” is not one of the options`)
      return o.value
    }
    case 'multiselect':
      return raw.split(/[,;|]/).map((p) => p.trim().toLowerCase()).filter(Boolean).map((p) => {
        const o = f.options?.find((x) => x.value === p || x.label.toLowerCase() === p)
        if (!o) throw new EngineError(`${f.label}: “${p}” is not one of the options`)
        return o.value
      })
    case 'date': {
      const m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
      const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) throw new EngineError(`${f.label}: “${raw}” is not a date (use YYYY-MM-DD or DD/MM/YYYY)`)
      return iso
    }
    case 'relation': {
      const target = list(ctx.ws, f.target ?? '').find((r) => recordTitle(ctx.ws, ctx.schema, r).toLowerCase() === low)
      if (!target) throw new EngineError(`${f.label}: no record called “${raw}”`)
      return target.id
    }
    case 'user': {
      const u = ctx.ws.users.find((x) => x.name.toLowerCase() === low || x.email === low)
      if (!u) throw new EngineError(`${f.label}: no team member “${raw}”`)
      return u.id
    }
    default:
      return raw
  }
}

/* ---------------- ageing ---------------- */

export interface AgeingRow {
  party: string
  name: string
  current: number
  d30: number
  d60: number
  d90: number
  over90: number
  total: number
}

/** Receivables (invoices) or payables (purchases) by how overdue they are. */
export function ageing(ws: Workspace, schema: AppSchema, role: 'invoices' | 'purchases', today = todayISO()): AgeingRow[] {
  const mod = moduleByRole(schema, role)
  if (!mod) return []
  const rows = new Map<string, AgeingRow>()
  for (const r of list(ws, mod.id)) {
    if (r.status !== 'posted' && r.status !== 'partial') continue
    const bal = Number(r.values.balance ?? 0)
    if (bal <= 0) continue
    const party = String(r.values[role === 'invoices' ? 'customer' : 'supplier'] ?? '')
    const row = rows.get(party) ?? { party, name: recordTitle(ws, schema, findRecord(ws, party)), current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 }
    const late = Math.floor((Date.parse(today) - Date.parse(String(r.values.due_date ?? r.values.date))) / 86_400_000)
    const bucket = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90'
    row[bucket] = round2(row[bucket] + bal)
    row.total = round2(row.total + bal)
    rows.set(party, row)
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}
````

### `crm-builder/src/lib/fieldTypes.ts`

````ts
import type { FieldDef, FieldType } from './schema'
import { slugKey, uid } from './schema'

export interface FieldTypeInfo {
  type: FieldType
  label: string
  icon: string
  hint: string
  group: 'Basic' | 'Numbers' | 'Choice' | 'Contact' | 'Advanced'
}

export const FIELD_TYPES: FieldTypeInfo[] = [
  { type: 'text', label: 'Short text', icon: 'Type', hint: 'Names, codes, short answers', group: 'Basic' },
  { type: 'longtext', label: 'Long text', icon: 'AlignLeft', hint: 'Notes and descriptions', group: 'Basic' },
  { type: 'date', label: 'Date', icon: 'Calendar', hint: 'Due dates, birthdays, deadlines', group: 'Basic' },
  { type: 'checkbox', label: 'Yes / No', icon: 'CheckSquare', hint: 'A single tick box', group: 'Basic' },
  { type: 'number', label: 'Number', icon: 'Hash', hint: 'Quantities, area, capacity', group: 'Numbers' },
  { type: 'currency', label: 'Money', icon: 'Banknote', hint: 'Prices, budgets, amounts', group: 'Numbers' },
  { type: 'percent', label: 'Percent', icon: 'Percent', hint: 'Discounts, rates, shares', group: 'Numbers' },
  { type: 'rating', label: 'Rating', icon: 'Star', hint: '1 to 5 stars', group: 'Numbers' },
  { type: 'formula', label: 'Formula', icon: 'Sigma', hint: 'Calculated from other numbers', group: 'Numbers' },
  { type: 'select', label: 'Dropdown', icon: 'ListChecks', hint: 'Pick one from a list', group: 'Choice' },
  { type: 'multiselect', label: 'Tags', icon: 'Tags', hint: 'Pick several from a list', group: 'Choice' },
  { type: 'user', label: 'Team member', icon: 'UserRound', hint: 'Owner, rep, engineer', group: 'Choice' },
  { type: 'email', label: 'E-mail', icon: 'Mail', hint: 'Checked for a valid address', group: 'Contact' },
  { type: 'phone', label: 'Phone / WhatsApp', icon: 'Phone', hint: 'Mobile or landline', group: 'Contact' },
  { type: 'url', label: 'Link', icon: 'Link', hint: 'Website or document link', group: 'Contact' },
  { type: 'relation', label: 'Link to record', icon: 'Network', hint: 'Connect to another module', group: 'Advanced' },
  { type: 'lookup', label: 'Lookup', icon: 'Eye', hint: 'Show a field from a linked record', group: 'Advanced' },
  { type: 'rollup', label: 'Rollup', icon: 'Calculator', hint: 'Total or count of linked records', group: 'Advanced' },
]

export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316']

export function typeInfo(t: FieldType) {
  return FIELD_TYPES.find((x) => x.type === t)!
}

export function opts(...labels: string[]) {
  return labels.map((label, i) => ({ value: slugKey(label), label, color: PALETTE[i % PALETTE.length] }))
}

/** Compact field factory used by the templates. */
export function f(label: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef {
  return { id: uid('f'), key: extra.key ?? slugKey(label), label, type, width: 1, ...extra }
}

export function newField(type: FieldType, existingKeys: string[]): FieldDef {
  const info = typeInfo(type)
  let key = slugKey(info.label)
  let n = 2
  while (existingKeys.includes(key)) key = `${slugKey(info.label)}_${n++}`
  const field: FieldDef = { id: uid('f'), key, label: info.label, type, width: type === 'longtext' ? 2 : 1, inList: false }
  if (type === 'select' || type === 'multiselect') field.options = opts('Option A', 'Option B', 'Option C')
  if (type === 'formula') field.formula = ''
  if (type === 'rating') {
    field.min = 1
    field.max = 5
  }
  return field
}
````

### `crm-builder/src/lib/formula.ts`

````ts
// A small, safe arithmetic language for formula fields: numbers, field keys, + - * / and parentheses.
// No eval: it is parsed into a tree, so a formula can never run code.

type Node = { k: 'num'; v: number } | { k: 'ref'; name: string } | { k: 'neg'; a: Node } | { k: 'bin'; op: string; a: Node; b: Node }

function tokenize(src: string): string[] {
  const tokens: string[] = []
  const re = /\s*(\d+(?:\.\d+)?|[a-z_][a-z0-9_]*|[-+*/()])/giy
  let m: RegExpExecArray | null
  let pos = 0
  while (pos < src.length) {
    re.lastIndex = pos
    m = re.exec(src)
    if (!m) {
      if (src.slice(pos).trim() === '') break
      throw new Error(`Unexpected “${src.slice(pos).trim()[0]}”`)
    }
    tokens.push(m[1])
    pos = re.lastIndex
  }
  return tokens
}

export function parseFormula(src: string): Node {
  const t = tokenize(src)
  let i = 0
  const peek = () => t[i]
  const next = () => t[i++]
  function primary(): Node {
    const tok = next()
    if (tok === undefined) throw new Error('Formula ends too early')
    if (tok === '(') {
      const n = expr()
      if (next() !== ')') throw new Error('Missing “)”')
      return n
    }
    if (tok === '-') return { k: 'neg', a: primary() }
    if (/^\d/.test(tok)) return { k: 'num', v: Number(tok) }
    if (/^[a-z_]/i.test(tok)) return { k: 'ref', name: tok }
    throw new Error(`Unexpected “${tok}”`)
  }
  function term(): Node {
    let n = primary()
    while (peek() === '*' || peek() === '/') n = { k: 'bin', op: next(), a: n, b: primary() }
    return n
  }
  function expr(): Node {
    let n = term()
    while (peek() === '+' || peek() === '-') n = { k: 'bin', op: next(), a: n, b: term() }
    return n
  }
  if (!t.length) throw new Error('Formula is empty')
  const tree = expr()
  if (i < t.length) throw new Error(`Unexpected “${t[i]}”`)
  return tree
}

export function formulaRefs(src: string): string[] {
  const out = new Set<string>()
  const walk = (n: Node) => {
    if (n.k === 'ref') out.add(n.name)
    else if (n.k === 'neg') walk(n.a)
    else if (n.k === 'bin') {
      walk(n.a)
      walk(n.b)
    }
  }
  walk(parseFormula(src))
  return [...out]
}

export function evalFormula(src: string, values: Record<string, unknown>): number | null {
  let tree: Node
  try {
    tree = parseFormula(src)
  } catch {
    return null
  }
  const ev = (n: Node): number => {
    switch (n.k) {
      case 'num':
        return n.v
      case 'ref': {
        const v = Number(values[n.name])
        return Number.isFinite(v) ? v : 0
      }
      case 'neg':
        return -ev(n.a)
      case 'bin': {
        const a = ev(n.a)
        const b = ev(n.b)
        if (n.op === '+') return a + b
        if (n.op === '-') return a - b
        if (n.op === '*') return a * b
        return b === 0 ? 0 : a / b
      }
    }
  }
  const r = ev(tree)
  return Number.isFinite(r) ? Math.round(r * 100) / 100 : null
}
````

### `crm-builder/src/lib/i18n.ts`

````ts
import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'ar'

const KEY = 'bonyan.lang'
let lang: Lang = (() => {
  try {
    return (localStorage.getItem(KEY) as Lang) || 'en'
  } catch {
    return 'en'
  }
})()
const subs = new Set<() => void>()

function apply() {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}
if (typeof document !== 'undefined') apply()

export function setLang(l: Lang) {
  lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* ignore */
  }
  apply()
  subs.forEach((s) => s())
}

const DICT = {
  tagline: ['Build the CRM & ERP your business actually runs on', 'ابنِ نظام إدارة العملاء والموارد الذي يناسب عملك فعلاً'],
  heroA: ['Stop bending your business', 'توقّف عن تطويع شركتك'],
  heroB: ['to fit someone else’s software.', 'لتناسب برنامج غيرك.'],
  heroLead: [
    'Bonyan asks about your industry, teams and pain points, suggests a ready system, then lets you drag and drop every field, pipeline, report and automation — while guardrails keep sales, stock and accounting 100% correct.',
    'بنيان يسألك عن نشاطك وفرق العمل والتحديات، يقترح عليك نظاماً جاهزاً، ثم تسحب وتُفلت كل حقل ومرحلة وتقرير وأتمتة — بينما تحافظ القواعد على دقة المبيعات والمخزون والحسابات بنسبة ١٠٠٪.',
  ],
  start: ['Build my system — free', 'ابنِ نظامي مجاناً'],
  signin: ['Sign in', 'تسجيل الدخول'],
  howTitle: ['From sign-up to a live system in one sitting', 'من التسجيل إلى نظام يعمل في جلسة واحدة'],
  howSub: ['Five clear steps. No consultants, no code, no six-month implementation.', 'خمس خطوات واضحة. بدون استشاريين، بدون برمجة، بدون تطبيق يستغرق ستة أشهر.'],
  s1: ['Register', 'سجّل'],
  s1d: ['Create your company workspace in 30 seconds.', 'أنشئ مساحة شركتك في ٣٠ ثانية.'],
  s2: ['Tell us about you', 'عرّفنا بشركتك'],
  s2d: ['Industry, what you sell, teams, customers and challenges.', 'النشاط، ما تبيعه، الفرق، العملاء والتحديات.'],
  s3: ['Get a match', 'احصل على اقتراح'],
  s3d: ['We score industry templates against your answers.', 'نقيّم القوالب حسب إجاباتك.'],
  s4: ['Shape it', 'شكّله بيدك'],
  s4d: ['Drag fields, stages, reports and automations.', 'اسحب الحقول والمراحل والتقارير والأتمتة.'],
  s5: ['Go live, safely', 'انطلق بأمان'],
  s5d: ['A health check blocks anything that would break.', 'فحص السلامة يمنع أي شيء قد يتعطل.'],
  tplTitle: ['Start from your industry, not a blank page', 'ابدأ من مجال عملك، لا من صفحة فارغة'],
  tplSub: ['Each template is a complete working system: modules, pipelines, reports and automations tuned to the industry.', 'كل قالب نظام متكامل يعمل: وحدات ومراحل وتقارير وأتمتة مضبوطة للمجال.'],
  guardTitle: ['Flexible on the surface. Strict underneath.', 'مرن في الشكل. صارم في الجوهر.'],
  guardSub: ['You can change almost anything — except the things that would make your numbers wrong.', 'يمكنك تغيير كل شيء تقريباً — إلا ما يجعل أرقامك خاطئة.'],
  ctaTitle: ['Your business is unique. Your system should be too.', 'شركتك فريدة. ويجب أن يكون نظامك كذلك.'],
} satisfies Record<string, [string, string]>

export type TKey = keyof typeof DICT

export function useLang() {
  const l = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => lang,
  )
  const t = (k: TKey) => DICT[k][l === 'ar' ? 1 : 0]
  return { lang: l, t, setLang }
}
````

### `crm-builder/src/lib/packs.ts`

````ts
// Ready-made reports, automations and team roles, added according to what the company told us.
import type { AppSchema, ModuleRole, Permission, ReportDef, RoleDef, WorkflowDef } from './schema'
import { moduleByRole, uid } from './schema'

export interface Challenge {
  id: string
  label: string
  labelAr: string
  icon: string
  fix: string
}

export const CHALLENGES: Challenge[] = [
  { id: 'lost_leads', label: 'Leads get lost in WhatsApp and calls', labelAr: 'العملاء المحتملون يضيعون في الواتساب والمكالمات', icon: 'MessageCircleWarning', fix: 'Lead pipeline + automatic call-back task within 24 hours' },
  { id: 'no_visibility', label: 'No clear view of the sales pipeline', labelAr: 'لا توجد رؤية واضحة للمبيعات', icon: 'EyeOff', fix: 'Pipeline value by stage, weighted forecast and won-this-month KPIs' },
  { id: 'late_collections', label: 'Customers pay late', labelAr: 'تأخر التحصيل', icon: 'Hourglass', fix: 'Receivables report + collection task when an invoice is overdue' },
  { id: 'stock_mismatch', label: 'Stock numbers never match', labelAr: 'المخزون غير مضبوط', icon: 'PackageX', fix: 'Stock kept automatically from posted documents + low-stock report' },
  { id: 'no_followup', label: 'No follow-up after sending quotes', labelAr: 'لا متابعة بعد إرسال عروض الأسعار', icon: 'MailQuestion', fix: 'Follow-up task 3 days after every quotation' },
  { id: 'manual_invoices', label: 'Invoices made in Excel or Word', labelAr: 'الفواتير على إكسل أو وورد', icon: 'FileSpreadsheet', fix: 'Numbered quotes and invoices with VAT, printable in one click' },
  { id: 'slow_reports', label: 'Reports take days to prepare', labelAr: 'التقارير تأخذ أياماً', icon: 'Timer', fix: 'A live management dashboard' },
  { id: 'service_delays', label: 'Slow after-sales service', labelAr: 'بطء خدمة ما بعد البيع', icon: 'Wrench', fix: 'Service tickets + alert for urgent requests' },
  { id: 'accountability', label: "Unclear who owns what", labelAr: 'غياب المسؤولية الواضحة', icon: 'UserX', fix: 'Owner on every record, deals by owner and open tasks by person' },
  { id: 'purchasing', label: 'Purchasing is not controlled', labelAr: 'المشتريات غير منضبطة', icon: 'ShoppingBag', fix: 'Supplier bills that update stock and cost + payables report' },
]

type Draft = Omit<ReportDef, 'id'>
const R = (r: Draft): ReportDef => ({ id: uid('r'), ...r })

export function buildReports(schema: AppSchema, challenges: string[]): ReportDef[] {
  const has = (role: ModuleRole) => moduleByRole(schema, role)
  const out: ReportDef[] = []
  const deals = has('deals')
  const leads = has('leads')
  const invoices = has('invoices')
  const products = has('products')
  const tickets = has('tickets')
  const tasks = has('tasks')
  const purchases = has('purchases')
  const c = (id: string) => challenges.includes(id)

  if (invoices) out.push(R({ name: 'Invoiced revenue', module: invoices.id, chart: 'kpi', measure: { op: 'sum', field: 'total' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 1, color: '#10b981' }))
  if (deals) {
    out.push(R({ name: 'Open pipeline value', module: deals.id, chart: 'kpi', measure: { op: 'sum', field: 'amount' }, filters: [{ field: '__stagetype', op: 'eq', value: 'open' }], size: 1, color: '#8b5cf6' }))
    out.push(R({ name: 'Deals won', module: deals.id, chart: 'kpi', measure: { op: 'count' }, filters: [{ field: '__stagetype', op: 'eq', value: 'won' }], size: 1, color: '#f59e0b' }))
  }
  if (invoices) out.push(R({ name: 'Receivables (balance due)', module: invoices.id, chart: 'kpi', measure: { op: 'sum', field: 'balance' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 1, color: '#ef4444' }))
  if (deals) out.push(R({ name: 'Pipeline by stage', module: deals.id, chart: 'funnel', groupBy: '__stage', measure: { op: 'sum', field: 'amount' }, filters: [], size: 2, color: '#8b5cf6' }))
  if (invoices) out.push(R({ name: 'Sales by month', module: invoices.id, chart: 'line', groupBy: '__month', measure: { op: 'sum', field: 'total' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 2, color: '#10b981' }))
  if (leads) out.push(R({ name: 'Leads by source', module: leads.id, chart: 'pie', groupBy: 'source', measure: { op: 'count' }, filters: [], size: 1, color: '#ec4899' }))
  if (deals && (c('accountability') || c('no_visibility'))) out.push(R({ name: 'Pipeline by owner', module: deals.id, chart: 'hbar', groupBy: 'owner', measure: { op: 'sum', field: 'amount' }, filters: [{ field: '__stagetype', op: 'eq', value: 'open' }], size: 1, color: '#6366f1' }))
  if (invoices && c('late_collections')) out.push(R({ name: 'Who owes us', module: invoices.id, chart: 'hbar', groupBy: 'customer', measure: { op: 'sum', field: 'balance' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }, { field: 'balance', op: 'gt', value: '0' }], size: 1, color: '#ef4444' }))
  if (products && (c('stock_mismatch') || schema.modules.some((m) => m.role === 'purchases'))) out.push(R({ name: 'Stock on hand', module: products.id, chart: 'table', groupBy: 'name', measure: { op: 'sum', field: 'stock' }, filters: [{ field: 'track_stock', op: 'eq', value: 'true' }], size: 1, color: '#f59e0b' }))
  if (purchases && c('purchasing')) out.push(R({ name: 'What we owe suppliers', module: purchases.id, chart: 'hbar', groupBy: 'supplier', measure: { op: 'sum', field: 'balance' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 1, color: '#f97316' }))
  if (tickets) out.push(R({ name: 'Tickets by stage', module: tickets.id, chart: 'bar', groupBy: '__stage', measure: { op: 'count' }, filters: [], size: 1, color: '#ef4444' }))
  if (tasks && c('accountability')) out.push(R({ name: 'Open tasks by person', module: tasks.id, chart: 'hbar', groupBy: 'assignee', measure: { op: 'count' }, filters: [{ field: 'done', op: 'neq', value: 'true' }], size: 1, color: '#0ea5e9' }))
  return out
}

const W = (w: Omit<WorkflowDef, 'id' | 'enabled'>): WorkflowDef => ({ id: uid('w'), enabled: true, ...w })

export function buildWorkflows(schema: AppSchema, _challenges: string[]): WorkflowDef[] {
  const out: WorkflowDef[] = []
  if (!moduleByRole(schema, 'tasks')) return out
  const leads = moduleByRole(schema, 'leads')
  const quotes = moduleByRole(schema, 'quotes')
  const invoices = moduleByRole(schema, 'invoices')
  const tickets = moduleByRole(schema, 'tickets')
  const deals = moduleByRole(schema, 'deals')

  if (leads) out.push(W({ name: 'Call every new lead within 24 hours', module: leads.id, trigger: { type: 'created' }, conditions: [], actions: [{ type: 'create_task', title: 'Call {name} ({phone})', dueInDays: 1 }] }))
  if (quotes) out.push(W({ name: 'Follow up 3 days after a quotation', module: quotes.id, trigger: { type: 'created' }, conditions: [], actions: [{ type: 'create_task', title: 'Follow up quotation for {customer}', dueInDays: 3 }] }))
  if (invoices) out.push(W({ name: 'Collect overdue invoices', module: invoices.id, trigger: { type: 'date_passed', field: 'due_date' }, conditions: [{ field: 'balance', op: 'gt', value: '0' }, { field: '__status', op: 'neq', value: 'draft' }], actions: [{ type: 'create_task', title: 'Collect payment from {customer}', dueInDays: 0 }, { type: 'notify', message: 'Invoice for {customer} is overdue', role: 'finance' }] }))
  if (deals) {
    const won = deals.stages?.find((s) => s.type === 'won')
    if (won) out.push(W({ name: 'Hand over won deals to operations', module: deals.id, trigger: { type: 'stage_changed', stage: won.id }, conditions: [], actions: [{ type: 'create_task', title: 'Kick-off: {title}', dueInDays: 2 }, { type: 'notify', message: 'Deal won: {title} 🎉' }] }))
  }
  if (tickets) out.push(W({ name: 'Alert on urgent tickets', module: tickets.id, trigger: { type: 'created' }, conditions: [{ field: 'priority', op: 'eq', value: 'urgent' }], actions: [{ type: 'notify', message: 'Urgent ticket: {subject}' }, { type: 'create_task', title: 'Respond to {subject}', dueInDays: 0 }] }))
  return out
}

export interface TeamInput {
  id: string
  name: string
  size: number
  kind: 'management' | 'sales' | 'operations' | 'finance' | 'service' | 'other'
}

const ALL: Permission[] = ['view', 'create', 'edit', 'delete']
const RW: Permission[] = ['view', 'create', 'edit']
const RO: Permission[] = ['view']

export function buildRoles(schema: AppSchema, teams: TeamInput[]): RoleDef[] {
  const byRole = (fn: (role: ModuleRole) => Permission[] | null) => {
    const access: Record<string, Permission[]> = {}
    for (const m of schema.modules) {
      const p = fn(m.role)
      if (p) access[m.id] = p
    }
    return access
  }
  const presets: Record<TeamInput['kind'], (role: ModuleRole) => Permission[] | null> = {
    management: () => RO,
    sales: (r) => (['accounts', 'contacts', 'leads', 'deals', 'quotes', 'tasks', 'custom'].includes(r) ? RW : ['products', 'invoices'].includes(r) ? RO : null),
    operations: (r) => (['products', 'purchases', 'suppliers', 'tickets', 'tasks', 'custom'].includes(r) ? RW : ['accounts', 'contacts', 'invoices', 'deals'].includes(r) ? RO : null),
    finance: (r) => (['invoices', 'purchases', 'suppliers', 'quotes'].includes(r) ? ALL : ['tasks'].includes(r) ? RW : RO),
    service: (r) => (['tickets', 'tasks', 'custom'].includes(r) ? RW : ['accounts', 'contacts', 'products'].includes(r) ? RO : null),
    other: (r) => (r === 'tasks' ? RW : RO),
  }
  const roles: RoleDef[] = [{ id: 'role_admin', name: 'Admin', access: {}, admin: true, finance: true }]
  const seen = new Set<string>()
  for (const t of teams) {
    if (seen.has(t.kind + t.name)) continue
    seen.add(t.kind + t.name)
    roles.push({ id: uid('role'), name: t.name, access: byRole(presets[t.kind]), finance: t.kind === 'finance' })
  }
  return roles
}

/** Competitor-grade smart defaults: rollups, lookups, scoring, rotting and approval rules. */
export function addSmartDefaults(schema: AppSchema) {
  const accounts = moduleByRole(schema, 'accounts')
  const invoices = moduleByRole(schema, 'invoices')
  const deals = moduleByRole(schema, 'deals')
  const leads = moduleByRole(schema, 'leads')
  const purchases = moduleByRole(schema, 'purchases')
  const tickets = moduleByRole(schema, 'tickets')

  // Deal rotting (Pipedrive): flag records that sit too long in an open stage.
  for (const [m, days] of [[leads, 3], [deals, 14], [tickets, 2]] as const) {
    for (const st of m?.stages ?? []) if (st.type === 'open' && st.rotDays === undefined) st.rotDays = days
  }

  // Rollups on customers (Airtable/Attio): totals from linked records, always up to date.
  if (accounts) {
    const add = (label: string, key: string, module: string, via: string, op: 'sum' | 'count', field?: string) => {
      if (!accounts.fields.some((f) => f.key === key)) accounts.fields.push({ id: uid('f'), key, label, type: 'rollup', width: 1, inList: false, rollup: { module, via, op, field }, help: 'Calculated from linked records' })
    }
    if (invoices) {
      add('Total invoiced', 'total_invoiced', invoices.id, 'customer', 'sum', 'total')
      add('Balance due', 'balance_due', invoices.id, 'customer', 'sum', 'balance')
    }
    if (deals) add('Number of deals', 'deal_count', deals.id, 'account', 'count')
  }

  // Lookup on deals: show the customer's governorate without retyping it.
  const gov = accounts?.fields.find((f) => f.key === 'governorate')
  if (deals && gov && !deals.fields.some((f) => f.key === 'customer_governorate')) {
    deals.fields.push({ id: uid('f'), key: 'customer_governorate', label: 'Customer governorate', type: 'lookup', width: 1, lookup: { via: 'account', field: 'governorate' } })
  }

  // Lead scoring (HubSpot): hot leads rise to the top.
  if (leads && !leads.scoring) {
    const rules: { field: string; op: 'eq' | 'notempty' | 'gt'; value?: string; points: number }[] = [
      { field: 'source', op: 'eq', value: 'referral', points: 25 },
      { field: 'source', op: 'eq', value: 'exhibition', points: 15 },
      { field: 'email', op: 'notempty', points: 10 },
      { field: 'company', op: 'notempty', points: 10 },
    ]
    if (leads.fields.some((f) => f.key === 'budget')) rules.push({ field: 'budget', op: 'gt', value: '500000', points: 30 })
    leads.scoring = rules.filter((r) => leads.fields.some((f) => f.key === r.field)).map((r) => ({ id: uid('sc'), condition: { field: r.field, op: r.op, value: r.value }, points: r.points }))
  }

  // Validation rule (Salesforce/Zoho): a deal must be worth something.
  if (deals && !deals.rules) deals.rules = [{ id: uid('vr'), when: [], check: { field: 'amount', op: 'gt', value: '0' }, message: 'Deal amount must be more than 0' }]

  // Approval rules (Odoo): large documents need a manager's sign-off.
  const manager = schema.roles.find((r) => !r.admin && /manag|owner|director|مدير/i.test(r.name))
  if (manager && !schema.approvals?.length) {
    schema.approvals = []
    if (invoices) schema.approvals.push({ id: uid('ap'), name: 'Large invoice', module: invoices.id, action: 'post', conditions: [{ field: 'total', op: 'gt', value: '250000' }], approverRole: manager.id })
    if (purchases) schema.approvals.push({ id: uid('ap'), name: 'Large purchase', module: purchases.id, action: 'post', conditions: [{ field: 'total', op: 'gt', value: '100000' }], approverRole: manager.id })
  }
}
````

### `crm-builder/src/lib/recommend.ts`

````ts
// Turns the onboarding answers into ranked template suggestions and a tailored first schema.
import type { AppSchema, ModuleDef, ModuleRole } from './schema'
import { clone, uid } from './schema'
import type { Feature, Template } from './templates'
import { TEMPLATES } from './templates'
import { buildModule, MODULE_IDS, type ModuleSpec } from './roles'
import { addSmartDefaults, buildReports, buildRoles, buildWorkflows, type TeamInput } from './packs'

export interface Answers {
  companyName: string
  industry: string
  industryText: string
  city: string
  country: string
  size: string
  sells: 'products' | 'services' | 'both'
  inventory: boolean
  customers: string[]
  salesCycle: 'days' | 'weeks' | 'months'
  channels: string[]
  aftersales: boolean
  recurring: boolean
  purchasing: boolean
  projects: boolean
  teams: TeamInput[]
  challenges: string[]
  products: string
  currency: string
  vatRate: number
  taxId: string
}

export const emptyAnswers = (companyName = ''): Answers => ({
  companyName,
  industry: '',
  industryText: '',
  city: 'Cairo',
  country: 'Egypt',
  size: '11-50',
  sells: 'both',
  inventory: true,
  customers: ['b2b'],
  salesCycle: 'weeks',
  channels: ['whatsapp', 'referral'],
  aftersales: false,
  recurring: false,
  purchasing: true,
  projects: false,
  teams: [
    { id: uid('t'), name: 'Management', size: 2, kind: 'management' },
    { id: uid('t'), name: 'Sales', size: 5, kind: 'sales' },
    { id: uid('t'), name: 'Finance', size: 2, kind: 'finance' },
  ],
  challenges: [],
  products: '',
  currency: 'EGP',
  vatRate: 14,
  taxId: '',
})

export function neededFeatures(a: Answers): Feature[] {
  const out = new Set<Feature>()
  if (a.inventory && a.sells !== 'services') out.add('inventory')
  if (a.sells !== 'products') out.add('services')
  if (a.customers.includes('b2b') || a.customers.includes('government')) out.add('b2b')
  if (a.customers.includes('b2c')) out.add('b2c')
  if (a.channels.includes('tenders') || a.customers.includes('government')) out.add('tenders')
  if (a.channels.includes('field')) out.add('field_visits')
  if (a.aftersales) out.add('aftersales')
  if (a.recurring) out.add('recurring')
  if (a.purchasing) out.add('purchasing')
  if (a.projects) out.add('projects')
  return [...out]
}

const FEATURE_LABEL: Record<Feature, string> = {
  inventory: 'you keep stock',
  services: 'you sell services',
  tenders: 'you bid on tenders',
  aftersales: 'you provide after-sales service',
  recurring: 'you have recurring contracts or installments',
  b2b: 'you sell to companies',
  b2c: 'you sell to individuals',
  projects: 'you deliver projects',
  purchasing: 'you buy from suppliers',
  field_visits: 'your reps visit customers',
  units: 'you sell units',
}

export interface Suggestion {
  template: Template
  score: number
  reasons: string[]
}

export function suggest(a: Answers): Suggestion[] {
  const needs = neededFeatures(a)
  const text = `${a.industry} ${a.industryText}`.toLowerCase()
  return TEMPLATES.map((t) => {
    let score = 20
    const reasons: string[] = []
    if (a.industry === t.id) {
      score += 45
      reasons.push('Built for your industry')
    } else if (t.industries.some((k) => text.includes(k))) {
      score += 35
      reasons.push(`Matches “${a.industryText || a.industry}”`)
    }
    for (const need of needs) {
      if (t.features.includes(need)) {
        score += 6
        reasons.push(`Ready because ${FEATURE_LABEL[need]}`)
      }
    }
    if (t.features.includes('inventory') && !needs.includes('inventory')) score -= 6
    if (t.id === 'blank') score = Math.min(score, 40)
    return { template: t, score: Math.max(5, Math.min(98, score)), reasons: reasons.slice(0, 4) }
  }).sort((x, y) => y.score - x.score)
}

/** Modules the answers call for even if the template didn't include them. */
function extraSpecs(a: Answers, roles: Set<ModuleRole>): ModuleSpec[] {
  const out: ModuleSpec[] = []
  const add = (s: ModuleSpec) => {
    if (!roles.has(s.role)) {
      roles.add(s.role)
      out.push(s)
    }
  }
  const c = (id: string) => a.challenges.includes(id)
  if (c('lost_leads') || a.channels.some((ch) => ['facebook', 'website', 'whatsapp'].includes(ch))) add({ role: 'leads', name: 'Leads', singular: 'Lead', icon: 'Magnet', color: '#ec4899' })
  if (c('manual_invoices') || c('no_followup')) add({ role: 'quotes', name: 'Quotations', singular: 'Quotation', icon: 'FileText', color: '#14b8a6' })
  if ((a.purchasing || c('purchasing') || c('stock_mismatch')) && a.sells !== 'services') {
    add({ role: 'suppliers', name: 'Suppliers', singular: 'Supplier', icon: 'Truck', color: '#64748b' })
    add({ role: 'purchases', name: 'Purchases', singular: 'Purchase bill', icon: 'ShoppingCart', color: '#f97316' })
  }
  if (a.aftersales || c('service_delays')) add({ role: 'tickets', name: 'Service tickets', singular: 'Ticket', icon: 'LifeBuoy', color: '#ef4444' })
  return out
}

export function generateSchema(t: Template, a: Answers): AppSchema {
  const roles = new Set(t.modules.map((m) => m.role))
  const specs = [...clone(t.modules), ...extraSpecs(a, roles)]
  // Keep quotes/invoices/tasks last-ish: place extra modules before the documents for a natural menu order.
  const order: ModuleRole[] = ['leads', 'accounts', 'contacts', 'deals', 'custom', 'tickets', 'products', 'quotes', 'invoices', 'suppliers', 'purchases', 'tasks']
  specs.sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role))
  const modules: ModuleDef[] = specs.map((s) => buildModule(s, a.vatRate))

  // Contacts in a template that has no accounts would break; buildModule always targets m_accounts so make sure it exists.
  if (!modules.some((m) => m.id === MODULE_IDS.accounts)) modules.unshift(buildModule({ role: 'accounts', name: 'Customers', singular: 'Customer', icon: 'Building2', color: '#6366f1' }, a.vatRate))

  if (a.inventory === false || a.sells === 'services') {
    const p = modules.find((m) => m.role === 'products')
    const track = p?.fields.find((x) => x.key === 'track_stock')
    if (track) track.help = 'Your business sells services, so stock is off by default'
  }

  const schema: AppSchema = {
    version: 1,
    templateId: t.id,
    company: {
      name: a.companyName,
      industry: a.industryText || t.name,
      country: a.country,
      city: a.city,
      taxId: a.taxId,
      currency: a.currency,
      vatRate: a.vatRate,
      language: 'en',
      allowNegativeStock: false,
      fiscalYearStart: 1,
    },
    modules,
    reports: [],
    workflows: [],
    roles: [],
  }
  schema.reports = buildReports(schema, a.challenges)
  schema.workflows = buildWorkflows(schema, a.challenges)
  schema.roles = buildRoles(schema, a.teams)
  addSmartDefaults(schema)
  return schema
}
````

### `crm-builder/src/lib/reports.ts`

````ts
import type { AppSchema, ReportDef } from './schema'
import { fieldByKey, moduleById } from './schema'
import type { Rec, Workspace } from './types'
import { displayValue, fieldValue, list, matches, pseudoValue, round2 } from './engine'
import { PALETTE } from './fieldTypes'

export interface ReportRow {
  key: string
  label: string
  value: number
  color: string
}

export interface ReportResult {
  rows: ReportRow[]
  total: number
  count: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

function aggregate(op: ReportDef['measure']['op'], values: number[]) {
  if (op === 'count') return values.length
  if (!values.length) return 0
  if (op === 'sum') return round2(values.reduce((a, b) => a + b, 0))
  if (op === 'avg') return round2(values.reduce((a, b) => a + b, 0) / values.length)
  if (op === 'min') return Math.min(...values)
  return Math.max(...values)
}

export function runReport(ws: Workspace, schema: AppSchema, r: ReportDef, records?: Rec[]): ReportResult {
  const mod = moduleById(schema, r.module)
  if (!mod) return { rows: [], total: 0, count: 0 }
  const recs = (records ?? list(ws, mod.id)).filter((rec) => rec.status !== 'void' && matches(schema, rec, r.filters, ws))
  const measure = (rec: Rec) => Number(pseudoValue(schema, rec, r.measure.field ?? '', ws) ?? 0) || 0
  const total = aggregate(r.measure.op, recs.map(measure))
  if (r.chart === 'kpi' || !r.groupBy) return { rows: [], total, count: recs.length }

  const groups = new Map<string, { label: string; color: string; values: number[]; order: number }>()
  const add = (key: string, label: string, color: string, v: number, order = 0) => {
    const g = groups.get(key) ?? { label, color, values: [], order }
    g.values.push(v)
    groups.set(key, g)
  }
  const field = fieldByKey(mod, r.groupBy)
  for (const rec of recs) {
    const v = measure(rec)
    if (r.groupBy === '__stage') {
      const i = mod.stages?.findIndex((s) => s.id === rec.stage) ?? -1
      const s = mod.stages?.[i]
      if (s) add(s.id, s.name, s.color, v, i)
    } else if (r.groupBy === '__month' || field?.type === 'date') {
      const raw = r.groupBy === '__month' ? String(pseudoValue(schema, rec, '__month')) : String(rec.values[r.groupBy] ?? '')
      if (raw.length >= 7) add(raw.slice(0, 7), monthLabel(raw.slice(0, 7)), r.color, v)
    } else if (r.groupBy === '__status') {
      add(String(rec.status), String(rec.status), r.color, v)
    } else if (field?.type === 'multiselect') {
      for (const tag of (rec.values[field.key] as string[]) ?? []) {
        const o = field.options?.find((x) => x.value === tag)
        add(tag, o?.label ?? tag, o?.color ?? r.color, v)
      }
    } else if (field) {
      const raw = fieldValue(ws, schema, rec, field)
      const key = raw === undefined || raw === '' ? '∅' : String(raw)
      const label = key === '∅' ? 'Not set' : displayValue(ws, schema, field, raw)
      const color = field.type === 'select' ? (field.options?.find((o) => o.value === raw)?.color ?? '#94a3b8') : r.color
      const order = field.type === 'select' ? (field.options?.findIndex((o) => o.value === raw) ?? 0) : 0
      add(key, label, color, v, order)
    }
  }
  let rows = [...groups].map(([key, g], i) => ({ key, label: g.label, value: aggregate(r.measure.op, g.values), color: g.color, order: g.order, i }))
  if (r.groupBy === '__month' || field?.type === 'date') rows.sort((a, b) => a.key.localeCompare(b.key))
  else if (r.groupBy === '__stage' || field?.type === 'select') rows.sort((a, b) => a.order - b.order)
  else rows.sort((a, b) => b.value - a.value)
  if (r.chart === 'pie' || (!field?.options && r.groupBy !== '__stage')) rows = rows.map((x, i) => ({ ...x, color: x.color === r.color && r.chart === 'pie' ? PALETTE[i % PALETTE.length] : x.color }))
  return { rows: rows.slice(0, 24).map(({ key, label, value, color }) => ({ key, label, value, color })), total, count: recs.length }
}
````

### `crm-builder/src/lib/roles.ts`

````ts
// Built-in behaviour for each module role. These are the "rules of the game":
// the system fields a role needs to work correctly, and how it connects to other modules.
import type { FieldDef, ModuleDef, ModuleRole, Stage } from './schema'
import { uid } from './schema'
import { f, opts } from './fieldTypes'

export interface RoleInfo {
  role: ModuleRole
  label: string
  description: string
  /** system field keys the role cannot work without */
  requiredKeys: string[]
  /** relation field key → role it must point to */
  relations?: Record<string, ModuleRole>
  pipeline?: boolean
  lines?: boolean
  /** roles that must also exist in the schema */
  needs?: ModuleRole[]
  prefix?: string
}

export const ROLES: Record<ModuleRole, RoleInfo> = {
  accounts: {
    role: 'accounts',
    label: 'Customers (companies)',
    description: 'The organisations you sell to. Every deal, quote and invoice belongs to one.',
    requiredKeys: ['name', 'owner'],
  },
  contacts: {
    role: 'contacts',
    label: 'Contacts (people)',
    description: 'People at your customers: decision makers, doctors, buyers, engineers.',
    requiredKeys: ['name', 'account'],
    relations: { account: 'accounts' },
    needs: ['accounts'],
  },
  leads: {
    role: 'leads',
    label: 'Leads',
    description: 'New enquiries not yet qualified. Converting a lead creates a customer, a contact and a deal.',
    requiredKeys: ['name', 'phone', 'source', 'owner'],
    pipeline: true,
    needs: ['accounts', 'deals'],
  },
  deals: {
    role: 'deals',
    label: 'Deals / opportunities',
    description: 'Sales you are working on, moved through pipeline stages to Won or Lost.',
    requiredKeys: ['title', 'account', 'amount', 'close_date', 'owner'],
    relations: { account: 'accounts' },
    pipeline: true,
    needs: ['accounts'],
  },
  products: {
    role: 'products',
    label: 'Products & services',
    description: 'Your catalogue. Stock on hand and average cost are kept by the system from posted documents.',
    requiredKeys: ['name', 'sku', 'price', 'cost', 'track_stock', 'stock', 'vat_rate'],
  },
  quotes: {
    role: 'quotes',
    label: 'Quotations',
    description: 'Priced offers with product lines and VAT. An accepted quote turns into an invoice in one click.',
    requiredKeys: ['customer', 'date', 'valid_until', 'subtotal', 'tax', 'total'],
    relations: { customer: 'accounts' },
    lines: true,
    needs: ['accounts', 'products', 'invoices'],
    prefix: 'QT',
  },
  invoices: {
    role: 'invoices',
    label: 'Sales invoices',
    description: 'Posting an invoice numbers it, reduces stock and records revenue, VAT and receivables.',
    requiredKeys: ['customer', 'date', 'due_date', 'subtotal', 'tax', 'total', 'paid', 'balance'],
    relations: { customer: 'accounts' },
    lines: true,
    needs: ['accounts', 'products'],
    prefix: 'INV',
  },
  suppliers: {
    role: 'suppliers',
    label: 'Suppliers',
    description: 'Who you buy from.',
    requiredKeys: ['name'],
  },
  purchases: {
    role: 'purchases',
    label: 'Purchase bills',
    description: 'Posting a bill adds stock, updates average cost and records what you owe the supplier.',
    requiredKeys: ['supplier', 'date', 'due_date', 'subtotal', 'tax', 'total', 'paid', 'balance'],
    relations: { supplier: 'suppliers' },
    lines: true,
    needs: ['suppliers', 'products'],
    prefix: 'BILL',
  },
  tasks: {
    role: 'tasks',
    label: 'Tasks & follow-ups',
    description: 'To-dos for the team. Automations create these for you.',
    requiredKeys: ['title', 'due_date', 'assignee', 'done'],
  },
  tickets: {
    role: 'tickets',
    label: 'Service tickets',
    description: 'After-sales requests, complaints and maintenance visits, tracked to resolution.',
    requiredKeys: ['subject', 'account', 'priority'],
    relations: { account: 'accounts' },
    pipeline: true,
    needs: ['accounts'],
  },
  custom: {
    role: 'custom',
    label: 'Custom module',
    description: 'Anything else your business tracks: units, visits, contracts, projects, vehicles…',
    requiredKeys: ['name'],
  },
}

const sys = (field: FieldDef): FieldDef => ({ ...field, system: true })
const ro = (field: FieldDef): FieldDef => ({ ...field, system: true, readOnly: true })

export const MODULE_IDS: Record<Exclude<ModuleRole, 'custom'>, string> = {
  accounts: 'm_accounts',
  contacts: 'm_contacts',
  leads: 'm_leads',
  deals: 'm_deals',
  products: 'm_products',
  quotes: 'm_quotes',
  invoices: 'm_invoices',
  suppliers: 'm_suppliers',
  purchases: 'm_purchases',
  tasks: 'm_tasks',
  tickets: 'm_tickets',
}

function stage(name: string, probability: number, type: Stage['type'], color: string, requires?: string[]): Stage {
  return { id: uid('st'), name, probability, type, color, requires }
}

export function defaultStages(role: ModuleRole): Stage[] {
  if (role === 'leads')
    return [
      stage('New', 10, 'open', '#0ea5e9'),
      stage('Contacted', 25, 'open', '#6366f1'),
      stage('Qualified', 50, 'open', '#8b5cf6'),
      stage('Converted', 100, 'won', '#10b981'),
      stage('Disqualified', 0, 'lost', '#ef4444'),
    ]
  if (role === 'tickets')
    return [
      stage('New', 0, 'open', '#0ea5e9'),
      stage('In progress', 0, 'open', '#f59e0b'),
      stage('Waiting for customer', 0, 'open', '#8b5cf6'),
      stage('Resolved', 100, 'won', '#10b981'),
      stage('Closed – not resolved', 0, 'lost', '#64748b'),
    ]
  return [
    stage('Qualification', 10, 'open', '#0ea5e9'),
    stage('Needs analysis', 25, 'open', '#6366f1'),
    stage('Proposal sent', 50, 'open', '#8b5cf6'),
    stage('Negotiation', 75, 'open', '#f59e0b', ['amount']),
    stage('Won', 100, 'won', '#10b981', ['amount', 'close_date']),
    stage('Lost', 0, 'lost', '#ef4444'),
  ]
}

const TOTALS = (withPaid: boolean) => [
  ro(f('Subtotal', 'currency', { inList: false })),
  ro(f('VAT', 'currency', { key: 'tax' })),
  ro(f('Total', 'currency', { inList: true })),
  ...(withPaid ? [ro(f('Paid', 'currency')), ro(f('Balance due', 'currency', { key: 'balance', inList: true }))] : []),
]

export function systemFields(role: ModuleRole, vatRate: number): FieldDef[] {
  switch (role) {
    case 'accounts':
      return [
        sys(f('Name', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Owner', 'user', { inList: true })),
        f('Phone', 'phone', { inList: true }),
        f('E-mail', 'email', { key: 'email' }),
      ]
    case 'contacts':
      return [
        sys(f('Name', 'text', { required: true, inList: true })),
        sys(f('Company', 'relation', { key: 'account', target: MODULE_IDS.accounts, inList: true })),
        f('Job title', 'text', { inList: true }),
        f('Mobile / WhatsApp', 'phone', { key: 'phone', inList: true }),
        f('E-mail', 'email', { key: 'email' }),
      ]
    case 'leads':
      return [
        sys(f('Name', 'text', { required: true, inList: true })),
        sys(f('Mobile / WhatsApp', 'phone', { key: 'phone', required: true, inList: true })),
        f('Company name', 'text', { key: 'company', inList: true }),
        f('E-mail', 'email', { key: 'email' }),
        sys(f('Source', 'select', { required: true, inList: true, options: opts('Facebook', 'WhatsApp', 'Website', 'Referral', 'Walk-in', 'Exhibition', 'Cold call') })),
        sys(f('Owner', 'user', { inList: true })),
      ]
    case 'deals':
      return [
        sys(f('Title', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Customer', 'relation', { key: 'account', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Amount', 'currency', { required: true, inList: true })),
        sys(f('Expected close', 'date', { key: 'close_date', required: true, inList: true })),
        sys(f('Owner', 'user', { inList: true })),
      ]
    case 'products':
      return [
        sys(f('Name', 'text', { required: true, inList: true, width: 2 })),
        sys(f('SKU / code', 'text', { key: 'sku', required: true, unique: true, inList: true })),
        sys(f('Selling price', 'currency', { key: 'price', required: true, inList: true })),
        ro(f('Average cost', 'currency', { key: 'cost', help: 'Moving average, updated by posted purchase bills' })),
        sys(f('VAT rate', 'percent', { key: 'vat_rate', required: true, help: `Egypt standard VAT is ${vatRate}%` })),
        sys(f('Track stock', 'checkbox', { key: 'track_stock', help: 'Turn off for services' })),
        ro(f('On hand', 'number', { key: 'stock', inList: true, help: 'Kept by the system from posted invoices and bills' })),
        f('Reorder level', 'number', { key: 'reorder_level' }),
        f('Unit', 'select', { options: opts('Piece', 'Box', 'Kg', 'Litre', 'Metre', 'Hour', 'Visit') }),
      ]
    case 'quotes':
      return [
        sys(f('Customer', 'relation', { key: 'customer', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Date', 'date', { required: true, inList: true })),
        sys(f('Valid until', 'date', { key: 'valid_until', required: true })),
        ...TOTALS(false),
      ]
    case 'invoices':
      return [
        sys(f('Customer', 'relation', { key: 'customer', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Invoice date', 'date', { key: 'date', required: true, inList: true })),
        sys(f('Due date', 'date', { key: 'due_date', required: true, inList: true })),
        ...TOTALS(true),
      ]
    case 'suppliers':
      return [
        sys(f('Name', 'text', { required: true, inList: true, width: 2 })),
        f('Phone', 'phone', { inList: true }),
        f('E-mail', 'email', { key: 'email' }),
        f('Tax registration no.', 'text', { key: 'tax_id' }),
      ]
    case 'purchases':
      return [
        sys(f('Supplier', 'relation', { key: 'supplier', target: MODULE_IDS.suppliers, required: true, inList: true })),
        sys(f('Bill date', 'date', { key: 'date', required: true, inList: true })),
        sys(f('Due date', 'date', { key: 'due_date', required: true, inList: true })),
        f('Supplier ref.', 'text', { key: 'supplier_ref' }),
        ...TOTALS(true),
      ]
    case 'tasks':
      return [
        sys(f('Title', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Due date', 'date', { key: 'due_date', required: true, inList: true })),
        sys(f('Assigned to', 'user', { key: 'assignee', inList: true })),
        sys(f('Done', 'checkbox', { inList: true })),
        f('Priority', 'select', { inList: true, options: opts('Low', 'Normal', 'High', 'Urgent') }),
        f('Related to', 'text', { key: 'related', inList: true }),
      ]
    case 'tickets':
      return [
        sys(f('Subject', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Customer', 'relation', { key: 'account', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Priority', 'select', { required: true, inList: true, options: opts('Low', 'Normal', 'High', 'Urgent') })),
        f('Engineer', 'user', { inList: true }),
        f('Description', 'longtext', { width: 2 }),
      ]
    case 'custom':
      return [sys(f('Name', 'text', { required: true, inList: true, width: 2 }))]
  }
}

export interface ModuleSpec {
  role: ModuleRole
  name: string
  singular: string
  icon: string
  color: string
  extra?: FieldDef[]
  /** for custom modules */
  id?: string
  stages?: Stage[]
  /** relabel system fields, e.g. { account: 'Hospital / clinic' } */
  relabel?: Record<string, string>
}

export function buildModule(spec: ModuleSpec, vatRate: number): ModuleDef {
  const info = ROLES[spec.role]
  const fields = systemFields(spec.role, vatRate).map((fl) => (spec.relabel?.[fl.key] ? { ...fl, label: spec.relabel[fl.key] } : fl))
  const titleField = fields[0].key
  return {
    id: spec.id ?? (spec.role === 'custom' ? uid('m') : MODULE_IDS[spec.role]),
    role: spec.role,
    name: spec.name,
    singular: spec.singular,
    icon: spec.icon,
    color: spec.color,
    titleField,
    fields: [...fields, ...(spec.extra ?? [])],
    stages: info.pipeline ? (spec.stages ?? defaultStages(spec.role)) : undefined,
    lines: info.lines,
    numberPrefix: info.prefix,
  }
}
````

### `crm-builder/src/lib/schema.ts`

````ts
// The whole customer-built system is described by one AppSchema.
// The builder edits it, the validator checks it, and the workspace runs it.

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'url'
  | 'relation'
  | 'user'
  | 'formula'
  | 'rating'
  | 'lookup'
  | 'rollup'

export interface SelectOption {
  value: string
  label: string
  color: string
}

export interface FieldDef {
  id: string
  key: string
  label: string
  type: FieldType
  required?: boolean
  unique?: boolean
  options?: SelectOption[]
  /** relation: id of the target module */
  target?: string
  /** formula: arithmetic over other numeric field keys, e.g. "area * price_per_m2" */
  formula?: string
  /** system fields belong to the module's role; they can be relabelled and moved but not deleted or retyped */
  system?: boolean
  /** computed by the engine (stock on hand, document totals); never typed in */
  readOnly?: boolean
  width?: 1 | 2
  help?: string
  inList?: boolean
  section?: string
  min?: number
  max?: number
  /** conditional field: shown (and required, if required) only when this holds */
  showIf?: Filter
  /** lookup: show a field of the linked record, e.g. the customer's governorate on a deal */
  lookup?: { via: string; field: string }
  /** rollup: aggregate child records that link to this one, e.g. total invoiced for a customer */
  rollup?: { module: string; via: string; op: Aggregate; field?: string }
}

/** A role gives a module built-in behaviour (pipeline, stock, accounting). Custom modules have none. */
export type ModuleRole =
  | 'contacts'
  | 'accounts'
  | 'leads'
  | 'deals'
  | 'products'
  | 'quotes'
  | 'invoices'
  | 'suppliers'
  | 'purchases'
  | 'tasks'
  | 'tickets'
  | 'custom'

export type StageType = 'open' | 'won' | 'lost'

export interface Stage {
  id: string
  name: string
  probability: number
  type: StageType
  color: string
  /** stage gate: these field keys must be filled before a record can enter the stage */
  requires?: string[]
  /** deal rotting: open records idle in this stage longer than this are flagged */
  rotDays?: number
}

export interface ModuleDef {
  id: string
  role: ModuleRole
  name: string
  singular: string
  icon: string
  color: string
  /** key of the field shown as the record's title */
  titleField: string
  fields: FieldDef[]
  stages?: Stage[]
  /** documents (quotes, invoices, purchases) carry product lines and totals */
  lines?: boolean
  numberPrefix?: string
  /** validation rules checked on every save */
  rules?: ValidationRule[]
  /** lead/deal scoring: points added when a condition matches */
  scoring?: ScoreRule[]
}

export interface ValidationRule {
  id: string
  /** the rule applies only when these match (empty = always) */
  when: Filter[]
  /** this must hold, otherwise the save is refused with the message */
  check: Filter
  message: string
}

export interface ScoreRule {
  id: string
  condition: Filter
  points: number
}

export interface ApprovalRule {
  id: string
  name: string
  module: string
  /** post: posting an invoice/bill; stage: moving into a stage */
  action: 'post' | 'stage'
  stage?: string
  conditions: Filter[]
  approverRole: string
}

export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type ChartType = 'kpi' | 'bar' | 'hbar' | 'line' | 'pie' | 'funnel' | 'table'
export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'empty' | 'notempty'

export interface Filter {
  field: string
  op: FilterOp
  value?: string
}

export interface ReportDef {
  id: string
  name: string
  module: string
  chart: ChartType
  /** field key to group by; "__stage" groups by pipeline stage, "__month" by creation month */
  groupBy?: string
  measure: { op: Aggregate; field?: string }
  filters: Filter[]
  size: 1 | 2 | 3
  color: string
}

export type TriggerType = 'created' | 'updated' | 'stage_changed' | 'date_passed'

export type ActionDef =
  | { type: 'create_task'; title: string; dueInDays: number }
  | { type: 'set_field'; field: string; value: string }
  | { type: 'notify'; message: string; role?: string }

export interface WorkflowDef {
  id: string
  name: string
  module: string
  enabled: boolean
  trigger: { type: TriggerType; stage?: string; field?: string }
  conditions: Filter[]
  actions: ActionDef[]
}

export type Permission = 'view' | 'create' | 'edit' | 'delete'

export interface RoleDef {
  id: string
  name: string
  /** module id → allowed actions. Admin ignores this and can do everything. */
  access: Record<string, Permission[]>
  admin?: boolean
  /** can post invoices / purchases and register payments */
  finance?: boolean
}

export interface CompanyProfile {
  name: string
  industry: string
  country: string
  city: string
  taxId: string
  currency: string
  vatRate: number
  language: 'en' | 'ar'
  allowNegativeStock: boolean
  fiscalYearStart: number
}

export interface AppSchema {
  version: number
  templateId: string
  company: CompanyProfile
  modules: ModuleDef[]
  reports: ReportDef[]
  workflows: WorkflowDef[]
  roles: RoleDef[]
  approvals?: ApprovalRule[]
}

let counter = 0
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function slugKey(label: string) {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return k || 'field'
}

export const NUMERIC_TYPES: FieldType[] = ['number', 'currency', 'percent', 'formula', 'rating', 'rollup']
export const COMPUTED_TYPES: FieldType[] = ['formula', 'lookup', 'rollup']
export const GROUPABLE_TYPES: FieldType[] = ['select', 'checkbox', 'user', 'relation', 'text', 'date', 'rating']

export function isNumeric(f: FieldDef | undefined) {
  return Boolean(f && NUMERIC_TYPES.includes(f.type))
}

export function moduleById(schema: AppSchema, id: string) {
  return schema.modules.find((m) => m.id === id)
}

export function moduleByRole(schema: AppSchema, role: ModuleRole) {
  return schema.modules.find((m) => m.role === role)
}

export function fieldByKey(mod: ModuleDef | undefined, key: string | undefined) {
  return mod?.fields.find((f) => f.key === key)
}

export function clone<T>(v: T): T {
  return structuredClone(v)
}
````

### `crm-builder/src/lib/seed.ts`

````ts
// Realistic sample data so a new company sees its system working in seconds.
// Everything goes through the engine, so stock, journals and payments are consistent.
import type { AppSchema, FieldDef, ModuleDef } from './schema'
import { moduleByRole, uid } from './schema'
import type { Rec, User, Workspace } from './types'
import { createRecord, list, moveStage, postDocument, registerPayment, round2, type Ctx } from './engine'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const COMPANIES = ['Nile Valley Group', 'Delta Foods', 'Cairo Care Hospital', 'Alex Marine Co.', 'Giza Systems Trading', 'Red Sea Resorts', 'Sinai Cement', 'Mansoura Pharma', 'Pyramids Plastics', 'Heliopolis Clinics', 'October Steel', 'Luxor Hotels', 'Smart Village Tech', 'Zamalek Interiors', 'Suez Logistics']
const PEOPLE = ['Ahmed Hassan', 'Mona Adel', 'Omar Khaled', 'Sara Mahmoud', 'Youssef Ali', 'Nour El-Din', 'Hana Farouk', 'Karim Mostafa', 'Laila Samir', 'Tarek Fawzy', 'Dina Ibrahim', 'Mostafa Gamal', 'Rania Saad', 'Hossam Nabil', 'Yasmin Sherif']
const PRODUCTS = ['Standard unit', 'Premium unit', 'Spare part kit', 'Consumables pack', 'Installation service', 'Annual maintenance', 'Starter bundle', 'Replacement filter']

export function seedSampleData(ws: Workspace, schema: AppSchema, admin: User, productNames: string[] = []) {
  const r = rng(42)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const int = (a: number, b: number) => Math.floor(a + r() * (b - a + 1))
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().slice(0, 10)
  }

  // Demo team members, one or two per team role, so owner and assignee fields have real people.
  const demoUsers: User[] = []
  for (const role of schema.roles.filter((x) => !x.admin)) {
    const n = role.name.toLowerCase().includes('sales') ? 2 : 1
    for (let i = 0; i < n; i++) {
      const name = PEOPLE[(demoUsers.length + 3) % PEOPLE.length]
      demoUsers.push({ id: uid('u'), name, email: `${name.split(' ')[0].toLowerCase()}.${role.name.toLowerCase().replace(/\W+/g, '')}@demo.local`, roleId: role.id, demo: true })
    }
  }
  ws.users.push(...demoUsers)
  const people = [admin, ...demoUsers]
  const ctx: Ctx = { ws, schema, user: admin }

  const value = (m: ModuleDef, f: FieldDef, i: number): unknown => {
    if (f.readOnly || f.type === 'formula') return undefined
    const k = f.key
    switch (f.type) {
      case 'text':
        if (k === 'name') return m.role === 'contacts' || m.role === 'leads' ? PEOPLE[i % PEOPLE.length] : m.role === 'accounts' || m.role === 'suppliers' ? (m.role === 'suppliers' ? `${pick(['Global', 'Euro', 'Orient', 'Prime'])} Supplies ${i + 1}` : COMPANIES[i % COMPANIES.length]) : `${m.singular} ${i + 1}`
        if (k === 'sku') return `SKU-${1001 + i}`
        if (k === 'title') return `${pick(['Supply contract', 'Expansion', 'Renewal', 'New line', 'Upgrade'])} – ${COMPANIES[(i * 3) % COMPANIES.length]}`
        if (k === 'subject') return pick(['Device not starting', 'Routine maintenance', 'Pressure drop', 'Training request', 'Spare part needed'])
        if (k === 'company') return COMPANIES[(i + 5) % COMPANIES.length]
        if (k.includes('tax')) return `${int(100, 999)}-${int(100, 999)}-${int(100, 999)}`
        return `${f.label} ${i + 1}`
      case 'longtext':
        return pick(['Customer asked for a call next week.', 'Prefers delivery to the main branch.', 'Decision expected after budget approval.', ''])
      case 'number':
        if (k === 'area') return int(80, 320)
        if (k === 'capacity') return int(50, 2000)
        if (k === 'hours') return int(1, 8)
        if (k === 'reorder_level') return int(5, 20)
        if (k === 'years') return int(3, 10)
        return int(1, 100)
      case 'currency':
        if (k === 'amount' || k === 'budget' || k === 'value' || k === 'contract_value') return int(20, 900) * 1000
        if (k === 'price_per_m2') return int(25, 60) * 1000
        if (k === 'rate') return int(4, 15) * 100
        return int(1, 50) * 1000
      case 'percent':
        if (k === 'vat_rate') return schema.company.vatRate
        if (k === 'progress') return int(0, 100)
        return int(5, 25)
      case 'rating':
        return int(1, 5)
      case 'date':
        return day(int(-60, 45))
      case 'select':
        return f.options?.length ? pick(f.options).value : undefined
      case 'multiselect':
        return f.options?.length ? [pick(f.options).value] : []
      case 'checkbox':
        if (k === 'track_stock') return true
        if (k === 'done') return r() < 0.3
        return r() < 0.5
      case 'email':
        return `${PEOPLE[i % PEOPLE.length].split(' ')[0].toLowerCase()}@example.com`
      case 'phone':
        return `+20 10${int(10000000, 99999999)}`
      case 'url':
        return 'https://example.com'
      case 'relation': {
        const targets = list(ws, f.target ?? '')
        return targets.length ? pick(targets).id : undefined
      }
      case 'user':
        return pick(people).id
    }
  }

  const counts: Partial<Record<ModuleDef['role'], number>> = { accounts: 10, contacts: 12, leads: 12, deals: 14, suppliers: 4, tickets: 6, custom: 8, tasks: 4 }
  // Create modules whose relations point at already-filled modules first.
  const pending = schema.modules.filter((m) => !m.lines && m.role !== 'products')
  const done = new Set<string>()
  const productsMod = moduleByRole(schema, 'products')
  if (productsMod) {
    const names = productNames.length ? productNames : PRODUCTS
    const services = /service|maintenance|installation|fee|course|hour/i
    names.slice(0, 12).forEach((name, i) => {
      const price = int(5, 120) * 100
      createRecord(ctx, productsMod.id, { ...Object.fromEntries(productsMod.fields.map((f) => [f.key, value(productsMod, f, i)]).filter(([, v]) => v !== undefined)), name, sku: `SKU-${1001 + i}`, price, track_stock: !services.test(name), vat_rate: schema.company.vatRate }, { silent: true })
    })
    done.add(productsMod.id)
  }
  let guard = 0
  while (pending.length && guard++ < 50) {
    const idx = pending.findIndex((m) => m.fields.every((f) => f.type !== 'relation' || !f.target || done.has(f.target) || f.target === m.id || !schema.modules.some((x) => x.id === f.target && !x.lines && x.role !== 'products' && !done.has(x.id))))
    const m = pending.splice(idx < 0 ? 0 : idx, 1)[0]
    const n = counts[m.role] ?? 6
    for (let i = 0; i < n; i++) {
      const vals: Record<string, unknown> = {}
      for (const f of m.fields) {
        const v = value(m, f, i)
        if (v !== undefined) vals[f.key] = v
      }
      try {
        const rec = createRecord(ctx, m.id, vals, { silent: m.role === 'tasks' })
        backdate(rec, int(0, 150))
        if (m.stages) {
          const target = pick(m.stages)
          try {
            moveStage(ctx, rec, target.id)
          } catch {
            /* stage gate not met for this sample, leave it in the first stage */
          }
        }
      } catch {
        /* skip a sample that doesn't pass validation */
      }
    }
    done.add(m.id)
  }

  const purchases = moduleByRole(schema, 'purchases')
  const invoices = moduleByRole(schema, 'invoices')
  const quotes = moduleByRole(schema, 'quotes')
  const products = productsMod ? list(ws, productsMod.id) : []
  const tracked = products.filter((p) => p.values.track_stock)
  const suppliers = moduleByRole(schema, 'suppliers')
  const accounts = moduleByRole(schema, 'accounts')

  if (purchases && suppliers && tracked.length && list(ws, suppliers.id).length) {
    for (let b = 0; b < 2; b++) {
      const bill = createRecord(ctx, purchases.id, { supplier: pick(list(ws, suppliers.id)).id, date: day(-150 + b * 40), due_date: day(-120 + b * 40) }, {
        lines: tracked.map((p) => ({ id: uid('l'), product: p.id, description: String(p.values.name), qty: int(40, 120), price: round2(Number(p.values.price) * 0.6), discount: 0, vat: schema.company.vatRate })),
      })
      backdate(bill, 150 - b * 40)
      postDocument(ctx, bill)
      registerPayment(ctx, bill, round2(Number(bill.values.total) * (b === 0 ? 1 : 0.5)), String(bill.values.date), 'bank')
    }
  }

  if (invoices && accounts && products.length && list(ws, accounts.id).length) {
    for (let i = 0; i < 12; i++) {
      const ago = 170 - i * 14
      const lines = Array.from({ length: int(1, 3) }, () => {
        const p = pick(products)
        const stock = Number(p.values.stock ?? 0)
        const qty = p.values.track_stock ? Math.max(1, Math.min(int(1, 8), Math.floor(stock / 6))) : int(1, 3)
        return { id: uid('l'), product: p.id, description: String(p.values.name), qty, price: Number(p.values.price), discount: pick([0, 0, 5, 10]), vat: Number(p.values.vat_rate ?? schema.company.vatRate) }
      })
      const inv = createRecord(ctx, invoices.id, { customer: pick(list(ws, accounts.id)).id, date: day(-ago), due_date: day(-ago + 30) }, { lines })
      backdate(inv, ago)
      try {
        postDocument(ctx, inv)
        const share = pick([1, 1, 0.5, 0])
        if (share) registerPayment(ctx, inv, round2(Number(inv.values.total) * share), day(Math.min(0, -ago + 10)), pick(['bank', 'cash', 'instapay']))
      } catch {
        /* not enough stock for this sample: keep as a draft */
      }
    }
  }

  if (quotes && accounts && products.length) {
    for (let i = 0; i < 4; i++) {
      const p = pick(products)
      createRecord(ctx, quotes.id, { customer: pick(list(ws, accounts.id)).id, date: day(-i * 5) }, { lines: [{ id: uid('l'), product: p.id, description: String(p.values.name), qty: int(1, 10), price: Number(p.values.price), discount: 0, vat: schema.company.vatRate }] })
    }
  }
}

function backdate(rec: Rec, daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  rec.createdAt = d.toISOString()
  if (rec.stageHistory?.[0]) rec.stageHistory[0].at = rec.createdAt
}
````

### `crm-builder/src/lib/store.ts`

````ts
// Local-first storage. Everything lives in the browser so the product can be tried with zero setup.
// The shape (one Workspace per company) maps 1:1 to a hosted backend later.
import { useSyncExternalStore } from 'react'
import type { User, Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers } from './recommend'
import { uid } from './schema'

const KEY = 'bonyan.v1'

interface State {
  workspaces: Record<string, Workspace>
  session: { workspaceId: string; userId: string } | null
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    /* private mode or corrupted data: start fresh */
  }
  return { workspaces: {}, session: null }
}

let state: State = typeof localStorage === 'undefined' ? { workspaces: {}, session: null } : load()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function save() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full or blocked; the session keeps working in memory */
    }
  }, 150)
}

export function getState() {
  return state
}

/**
 * Mutate the state in place, then publish fresh references for the state, the current workspace and its data,
 * so every component that selected them re-renders.
 */
export function update(fn: (s: State) => void) {
  fn(state)
  const workspaces = { ...state.workspaces }
  const id = state.session?.workspaceId
  if (id && workspaces[id]) workspaces[id] = { ...workspaces[id], data: { ...workspaces[id].data } }
  state = { ...state, workspaces, session: state.session ? { ...state.session } : null }
  save()
  listeners.forEach((l) => l())
}

/** Runs fn on a copy of the workspace and commits only if it doesn't throw, so a failed action changes nothing. */
export function transact<T>(fn: (ws: Workspace) => T): T {
  const ws = currentWorkspace()
  if (!ws) throw new Error('No workspace')
  const copy = structuredClone(ws)
  const result = fn(copy)
  update((s) => {
    s.workspaces[copy.id] = copy
  })
  return result
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(state),
  )
}

export function currentWorkspace(s: State = state): Workspace | undefined {
  return s.session ? s.workspaces[s.session.workspaceId] : undefined
}

export function currentUser(s: State = state): User | undefined {
  const ws = currentWorkspace(s)
  return ws?.users.find((u) => u.id === s.session?.userId)
}

export async function hash(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function register(company: string, name: string, email: string, password: string) {
  const lower = email.trim().toLowerCase()
  for (const ws of Object.values(state.workspaces)) {
    if (ws.users.some((u) => u.email === lower)) throw new Error('An account with this e-mail already exists. Sign in instead.')
  }
  const user: User = { id: uid('u'), name: name.trim(), email: lower, roleId: 'role_admin', passwordHash: await hash(password) }
  const ws: Workspace = {
    id: uid('ws'),
    createdAt: new Date().toISOString(),
    answers: emptyAnswers(company.trim()),
    users: [user],
    draft: null,
    published: null,
    history: [],
    data: emptyData(),
  }
  update((s) => {
    s.workspaces[ws.id] = ws
    s.session = { workspaceId: ws.id, userId: user.id }
  })
}

export async function signIn(email: string, password: string) {
  const lower = email.trim().toLowerCase()
  const h = await hash(password)
  for (const ws of Object.values(state.workspaces)) {
    const u = ws.users.find((x) => x.email === lower)
    if (u && u.passwordHash === h) {
      update((s) => {
        s.session = { workspaceId: ws.id, userId: u.id }
      })
      return
    }
  }
  throw new Error('E-mail or password is not correct')
}

export function signOut() {
  update((s) => {
    s.session = null
  })
}

export function switchUser(userId: string) {
  update((s) => {
    if (s.session) s.session.userId = userId
  })
}

export function resetEverything() {
  update((s) => {
    s.workspaces = {}
    s.session = null
  })
}
````

### `crm-builder/src/lib/templates.ts`

````ts
// Industry starting points. Each template is a full, valid system the company then reshapes.
import type { ModuleSpec } from './roles'
import { MODULE_IDS } from './roles'
import { f, opts } from './fieldTypes'
import type { Stage } from './schema'
import { uid } from './schema'

export type Feature = 'inventory' | 'services' | 'tenders' | 'aftersales' | 'recurring' | 'b2b' | 'b2c' | 'projects' | 'purchasing' | 'field_visits' | 'units'

export interface Template {
  id: string
  name: string
  nameAr: string
  tagline: string
  icon: string
  gradient: [string, string]
  industries: string[]
  features: Feature[]
  modules: ModuleSpec[]
  highlights: string[]
}

const GOVERNORATES = opts('Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Dakahlia', 'Sharqia', 'Gharbia', 'Menoufia', 'Beheira', 'Ismailia', 'Suez', 'Port Said', 'Damietta', 'Fayoum', 'Beni Suef', 'Minya', 'Assiut', 'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea', 'Matrouh', 'North Sinai', 'South Sinai', 'Kafr El Sheikh', 'New Valley')

const st = (name: string, probability: number, type: Stage['type'], color: string, requires?: string[]): Stage => ({ id: uid('st'), name, probability, type, color, requires })

const core = {
  accounts: (name = 'Customers', singular = 'Customer', extra = [] as ModuleSpec['extra']): ModuleSpec => ({
    role: 'accounts',
    name,
    singular,
    icon: 'Building2',
    color: '#6366f1',
    extra: [
      f('Governorate', 'select', { options: GOVERNORATES, inList: true }),
      f('Tax registration no.', 'text', { key: 'tax_id', help: 'Needed on e-invoices (ETA)' }),
      ...(extra ?? []),
    ],
  }),
  contacts: (extra: ModuleSpec['extra'] = [], relabel?: Record<string, string>): ModuleSpec => ({ role: 'contacts', name: 'Contacts', singular: 'Contact', icon: 'Users', color: '#0ea5e9', extra, relabel }),
  leads: (extra: ModuleSpec['extra'] = []): ModuleSpec => ({ role: 'leads', name: 'Leads', singular: 'Lead', icon: 'Magnet', color: '#ec4899', extra }),
  deals: (name: string, singular: string, extra: ModuleSpec['extra'] = [], stages?: Stage[], relabel?: Record<string, string>): ModuleSpec => ({ role: 'deals', name, singular, icon: 'Handshake', color: '#8b5cf6', extra, stages, relabel }),
  products: (name = 'Products', singular = 'Product', extra: ModuleSpec['extra'] = []): ModuleSpec => ({ role: 'products', name, singular, icon: 'Package', color: '#f59e0b', extra }),
  quotes: (): ModuleSpec => ({ role: 'quotes', name: 'Quotations', singular: 'Quotation', icon: 'FileText', color: '#14b8a6' }),
  invoices: (): ModuleSpec => ({ role: 'invoices', name: 'Invoices', singular: 'Invoice', icon: 'Receipt', color: '#10b981' }),
  suppliers: (): ModuleSpec => ({ role: 'suppliers', name: 'Suppliers', singular: 'Supplier', icon: 'Truck', color: '#64748b' }),
  purchases: (): ModuleSpec => ({ role: 'purchases', name: 'Purchases', singular: 'Purchase bill', icon: 'ShoppingCart', color: '#f97316' }),
  tasks: (): ModuleSpec => ({ role: 'tasks', name: 'Tasks', singular: 'Task', icon: 'CheckCircle2', color: '#0ea5e9' }),
  tickets: (name = 'Service tickets', singular = 'Ticket', extra: ModuleSpec['extra'] = []): ModuleSpec => ({ role: 'tickets', name, singular, icon: 'LifeBuoy', color: '#ef4444', extra }),
}

const rel = (label: string, target: string, extra = {}) => f(label, 'relation', { target, inList: true, ...extra })

export const TEMPLATES: Template[] = [
  {
    id: 'medical',
    name: 'Medical & pharma distribution',
    nameAr: 'توزيع المستلزمات الطبية والأدوية',
    tagline: 'Hospitals, tenders, EDA registrations, batches and expiry, maintenance visits.',
    icon: 'HeartPulse',
    gradient: ['#06b6d4', '#6366f1'],
    industries: ['medical', 'pharma', 'healthcare', 'hospital', 'clinic', 'lab'],
    features: ['inventory', 'tenders', 'aftersales', 'b2b', 'purchasing', 'field_visits'],
    highlights: ['Tender pipeline with gates', 'EDA registration & expiry tracking', 'Rep visit log', 'Device maintenance tickets'],
    modules: [
      core.accounts('Hospitals & clinics', 'Hospital / clinic', [
        f('Sector', 'select', { options: opts('Government', 'Private', 'University', 'Military', 'NGO'), inList: true }),
        f('Beds', 'number'),
      ]),
      core.contacts([f('Specialty', 'select', { options: opts('Cardiology', 'ICU', 'Radiology', 'Lab', 'Surgery', 'Pharmacy', 'Procurement'), inList: true })], { account: 'Hospital / clinic' }),
      core.leads(),
      core.deals('Tenders & opportunities', 'Opportunity', [
        f('Tender no.', 'text', { inList: true }),
        f('Type', 'select', { options: opts('Tender', 'Direct order', 'Practice', 'Framework'), inList: true }),
        f('Submission deadline', 'date', { key: 'submission_deadline' }),
        f('Bid bond', 'currency', { key: 'bid_bond' }),
      ], [
        st('Tender announced', 10, 'open', '#0ea5e9'),
        st('Technical offer', 30, 'open', '#6366f1', ['tender_no']),
        st('Financial offer', 55, 'open', '#8b5cf6', ['amount']),
        st('Awarded – awaiting PO', 85, 'open', '#f59e0b'),
        st('Won', 100, 'won', '#10b981', ['amount', 'close_date']),
        st('Lost', 0, 'lost', '#ef4444'),
      ], { account: 'Hospital / clinic' }),
      core.products('Products', 'Product', [
        f('EDA registration no.', 'text', { key: 'eda_no' }),
        f('EDA expiry', 'date', { key: 'eda_expiry' }),
        f('Category', 'select', { options: opts('Consumables', 'Devices', 'Reagents', 'Pharma', 'Spare parts'), inList: true }),
      ]),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      {
        role: 'custom', id: 'm_visits', name: 'Rep visits', singular: 'Visit', icon: 'MapPin', color: '#14b8a6',
        extra: [
          rel('Hospital / clinic', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Visit date', 'date', { key: 'visit_date', required: true, inList: true }),
          f('Rep', 'user', { inList: true }),
          f('Outcome', 'select', { options: opts('Interested', 'Sample left', 'Needs quote', 'No need'), inList: true }),
          f('Notes', 'longtext', { width: 2 }),
        ],
      },
      core.tickets('Maintenance', 'Maintenance request', [f('Device serial', 'text', { key: 'serial', inList: true }), f('Under warranty', 'checkbox', { key: 'warranty' })]),
      core.tasks(),
    ],
  },
  {
    id: 'realestate',
    name: 'Real estate developer & brokerage',
    nameAr: 'التطوير والتسويق العقاري',
    tagline: 'Leads from Facebook and WhatsApp, units inventory, reservations, installment plans.',
    icon: 'Building',
    gradient: ['#f59e0b', '#ef4444'],
    industries: ['real estate', 'property', 'developer', 'brokerage', 'compound'],
    features: ['b2c', 'units', 'recurring'],
    highlights: ['Unit availability board', 'Lead source ROI', 'Reservation → contract pipeline', 'Installment schedule'],
    modules: [
      core.accounts('Buyers', 'Buyer', [f('National ID', 'text', { key: 'national_id' })]),
      core.contacts(),
      core.leads([
        f('Budget', 'currency', { inList: true }),
        f('Preferred area', 'select', { key: 'area', options: opts('New Cairo', '6th of October', 'New Capital', 'Sheikh Zayed', 'North Coast', 'Ain Sokhna'), inList: true }),
        f('Unit type', 'select', { key: 'unit_type', options: opts('Apartment', 'Duplex', 'Villa', 'Townhouse', 'Chalet', 'Office', 'Shop') }),
      ]),
      {
        role: 'custom', id: 'm_units', name: 'Units', singular: 'Unit', icon: 'Home', color: '#f59e0b',
        extra: [
          f('Project', 'select', { options: opts('Phase 1', 'Phase 2', 'Phase 3'), inList: true }),
          f('Type', 'select', { options: opts('Apartment', 'Duplex', 'Villa', 'Townhouse', 'Chalet', 'Office', 'Shop'), inList: true }),
          f('Area (m²)', 'number', { key: 'area', inList: true }),
          f('Price per m²', 'currency', { key: 'price_per_m2' }),
          f('Unit price', 'formula', { key: 'unit_price', formula: 'area * price_per_m2', inList: true }),
          f('Status', 'select', { options: opts('Available', 'Reserved', 'Sold', 'Blocked'), inList: true, required: true }),
          f('Floor', 'number'),
        ],
      },
      core.deals('Reservations', 'Reservation', [
        rel('Unit', 'm_units', { key: 'unit' }),
        f('Down payment', 'percent', { key: 'down_payment' }),
        f('Installment years', 'number', { key: 'years' }),
      ], [
        st('Site visit', 20, 'open', '#0ea5e9'),
        st('Offer', 40, 'open', '#6366f1'),
        st('Reserved (EOI)', 70, 'open', '#f59e0b', ['unit']),
        st('Contract signed', 100, 'won', '#10b981', ['unit', 'amount']),
        st('Cancelled', 0, 'lost', '#ef4444'),
      ], { account: 'Buyer' }),
      {
        role: 'custom', id: 'm_installments', name: 'Installments', singular: 'Installment', icon: 'CalendarClock', color: '#10b981',
        extra: [
          rel('Buyer', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Due date', 'date', { key: 'due_date', required: true, inList: true }),
          f('Amount', 'currency', { required: true, inList: true }),
          f('Paid', 'checkbox', { inList: true }),
          f('Cheque no.', 'text', { key: 'cheque' }),
        ],
      },
      core.products('Services & fees', 'Service'),
      core.invoices(),
      core.tasks(),
    ],
  },
  {
    id: 'water',
    name: 'Water treatment & industrial projects',
    nameAr: 'معالجة المياه والمشروعات الصناعية',
    tagline: 'Site surveys, project quotations, spare parts stock and annual maintenance contracts.',
    icon: 'Droplets',
    gradient: ['#0ea5e9', '#10b981'],
    industries: ['water', 'treatment', 'industrial', 'engineering', 'hvac', 'solar', 'energy'],
    features: ['inventory', 'projects', 'aftersales', 'recurring', 'b2b', 'purchasing', 'tenders', 'field_visits'],
    highlights: ['Site survey with capacity (m³/day)', 'Project pipeline', 'AMC contracts & visits', 'Membranes / chemicals stock'],
    modules: [
      core.accounts('Clients', 'Client', [f('Segment', 'select', { options: opts('Factory', 'Hotel', 'Compound', 'Hospital', 'Government', 'Farm'), inList: true })]),
      core.contacts(),
      core.leads(),
      {
        role: 'custom', id: 'm_surveys', name: 'Site surveys', singular: 'Site survey', icon: 'ClipboardList', color: '#14b8a6',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Survey date', 'date', { key: 'survey_date', inList: true }),
          f('Capacity (m³/day)', 'number', { key: 'capacity', inList: true }),
          f('Water source', 'select', { key: 'source', options: opts('Well', 'Sea', 'Municipal', 'Wastewater'), inList: true }),
          f('TDS (ppm)', 'number', { key: 'tds' }),
          f('Engineer', 'user'),
        ],
      },
      core.deals('Projects', 'Project', [
        f('Technology', 'multiselect', { options: opts('RO', 'UF', 'Softener', 'Sand filter', 'STP', 'ETP'), inList: true }),
        f('Capacity (m³/day)', 'number', { key: 'capacity' }),
        rel('Site survey', 'm_surveys', { key: 'survey', inList: false }),
      ], undefined, { account: 'Client' }),
      core.products('Equipment & spare parts', 'Item', [f('Category', 'select', { options: opts('Membranes', 'Pumps', 'Chemicals', 'Filters', 'Panels', 'Labour'), inList: true })]),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      {
        role: 'custom', id: 'm_amc', name: 'Maintenance contracts', singular: 'Contract', icon: 'ShieldCheck', color: '#6366f1',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Start', 'date', { required: true, inList: true }),
          f('End', 'date', { required: true, inList: true }),
          f('Visits per year', 'number', { key: 'visits' }),
          f('Annual value', 'currency', { key: 'value', inList: true }),
        ],
      },
      core.tickets('Service visits', 'Service visit'),
      core.tasks(),
    ],
  },
  {
    id: 'distribution',
    name: 'Wholesale & retail distribution',
    nameAr: 'التجارة والتوزيع',
    tagline: 'Fast invoicing, stock levels, reorder alerts, collections and sales routes.',
    icon: 'Store',
    gradient: ['#10b981', '#84cc16'],
    industries: ['retail', 'wholesale', 'trading', 'distribution', 'fmcg', 'import', 'export', 'ecommerce', 'food'],
    features: ['inventory', 'b2b', 'b2c', 'purchasing'],
    highlights: ['Stock & reorder alerts', 'Collections ageing', 'Sales by product & rep', 'Supplier bills'],
    modules: [
      core.accounts('Customers', 'Customer', [
        f('Channel', 'select', { options: opts('Retailer', 'Wholesaler', 'Pharmacy', 'Supermarket', 'Online', 'End user'), inList: true }),
        f('Credit limit', 'currency', { key: 'credit_limit' }),
        f('Route', 'select', { options: opts('Route A', 'Route B', 'Route C') }),
      ]),
      core.contacts(),
      core.deals('Orders pipeline', 'Order'),
      core.products('Products', 'Product', [f('Barcode', 'text'), f('Brand', 'text', { inList: true })]),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      core.tasks(),
    ],
  },
  {
    id: 'services',
    name: 'Agency & professional services',
    nameAr: 'الخدمات المهنية والوكالات',
    tagline: 'Clients, proposals, projects, timesheets and service invoicing — no stock needed.',
    icon: 'Briefcase',
    gradient: ['#8b5cf6', '#ec4899'],
    industries: ['agency', 'marketing', 'consulting', 'software', 'it', 'legal', 'accounting', 'design', 'services'],
    features: ['services', 'projects', 'b2b', 'recurring'],
    highlights: ['Proposal pipeline', 'Projects & hours', 'Retainers', 'Service invoices'],
    modules: [
      core.accounts('Clients', 'Client', [f('Industry', 'text', { inList: true })]),
      core.contacts(),
      core.leads(),
      core.deals('Proposals', 'Proposal', [f('Service line', 'select', { key: 'service_line', options: opts('Strategy', 'Design', 'Development', 'Marketing', 'Support'), inList: true }), f('Retainer', 'checkbox')]),
      {
        role: 'custom', id: 'm_projects', name: 'Projects', singular: 'Project', icon: 'FolderKanban', color: '#6366f1',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Start', 'date', { inList: true }),
          f('Deadline', 'date', { inList: true }),
          f('Budget hours', 'number', { key: 'budget_hours' }),
          f('Status', 'select', { options: opts('Planned', 'Active', 'On hold', 'Delivered'), inList: true }),
          f('Lead', 'user', { inList: true }),
        ],
      },
      {
        role: 'custom', id: 'm_time', name: 'Timesheets', singular: 'Time entry', icon: 'Timer', color: '#0ea5e9',
        extra: [
          rel('Project', 'm_projects', { key: 'project', required: true }),
          f('Date', 'date', { required: true, inList: true }),
          f('Hours', 'number', { required: true, inList: true }),
          f('Hourly rate', 'currency', { key: 'rate' }),
          f('Value', 'formula', { formula: 'hours * rate', inList: true }),
          f('Team member', 'user', { key: 'member', inList: true }),
        ],
      },
      core.products('Services', 'Service'),
      core.quotes(),
      core.invoices(),
      core.tasks(),
    ],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing & workshops',
    nameAr: 'التصنيع والورش',
    tagline: 'Customer orders, raw materials, purchasing, production orders and finished goods.',
    icon: 'Factory',
    gradient: ['#64748b', '#0ea5e9'],
    industries: ['manufacturing', 'factory', 'workshop', 'printing', 'furniture', 'plastics', 'textile', 'packaging'],
    features: ['inventory', 'purchasing', 'b2b', 'projects'],
    highlights: ['Raw vs finished stock', 'Production orders', 'Supplier purchasing', 'Order pipeline'],
    modules: [
      core.accounts(),
      core.contacts(),
      core.deals('Customer orders', 'Order', [f('Delivery date', 'date', { key: 'delivery_date', inList: true })]),
      core.products('Items', 'Item', [f('Item type', 'select', { key: 'item_type', options: opts('Raw material', 'Semi-finished', 'Finished good', 'Packaging'), inList: true })]),
      {
        role: 'custom', id: 'm_production', name: 'Production orders', singular: 'Production order', icon: 'Cog', color: '#f97316',
        extra: [
          rel('Item', MODULE_IDS.products, { key: 'item', required: true }),
          f('Quantity', 'number', { required: true, inList: true }),
          f('Planned date', 'date', { key: 'planned', inList: true }),
          f('Status', 'select', { options: opts('Planned', 'In production', 'Quality check', 'Done'), inList: true }),
          f('Line / machine', 'select', { key: 'line', options: opts('Line 1', 'Line 2', 'Line 3') }),
        ],
      },
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      core.tasks(),
    ],
  },
  {
    id: 'education',
    name: 'Training centres & schools',
    nameAr: 'مراكز التدريب والتعليم',
    tagline: 'Student enquiries, courses, enrolments, groups and fee collection.',
    icon: 'GraduationCap',
    gradient: ['#6366f1', '#14b8a6'],
    industries: ['education', 'training', 'school', 'academy', 'courses', 'nursery'],
    features: ['b2c', 'services', 'recurring'],
    highlights: ['Enquiry → enrolment funnel', 'Course groups', 'Fees & balances', 'Lead source report'],
    modules: [
      core.accounts('Students / families', 'Student', [f('Date of birth', 'date', { key: 'dob' }), f('Guardian phone', 'phone', { key: 'guardian_phone' })]),
      core.contacts(),
      core.leads([f('Interested course', 'text', { key: 'course' })]),
      core.deals('Enrolments', 'Enrolment', [rel('Group', 'm_groups', { key: 'group' })], [
        st('Enquiry', 20, 'open', '#0ea5e9'),
        st('Placement test', 45, 'open', '#6366f1'),
        st('Offer sent', 70, 'open', '#f59e0b'),
        st('Enrolled', 100, 'won', '#10b981', ['amount']),
        st('Not joining', 0, 'lost', '#ef4444'),
      ], { account: 'Student' }),
      {
        role: 'custom', id: 'm_groups', name: 'Groups', singular: 'Group', icon: 'Users2', color: '#14b8a6',
        extra: [
          f('Course', 'text', { inList: true }),
          f('Starts', 'date', { inList: true }),
          f('Capacity', 'number', { inList: true }),
          f('Instructor', 'user', { inList: true }),
        ],
      },
      core.products('Courses & fees', 'Course'),
      core.invoices(),
      core.tasks(),
    ],
  },
  {
    id: 'construction',
    name: 'Construction & contracting',
    nameAr: 'المقاولات والإنشاءات',
    tagline: 'Tenders, projects by site, subcontractors, materials purchasing and progress billing.',
    icon: 'HardHat',
    gradient: ['#f97316', '#eab308'],
    industries: ['construction', 'contracting', 'fit-out', 'finishing', 'mep', 'infrastructure'],
    features: ['tenders', 'projects', 'purchasing', 'inventory', 'b2b'],
    highlights: ['Tender pipeline', 'Sites & progress %', 'Materials purchasing', 'Progress invoices'],
    modules: [
      core.accounts('Clients', 'Client'),
      core.contacts(),
      core.deals('Tenders', 'Tender', [f('Tender no.', 'text', { inList: true }), f('Bid bond', 'currency', { key: 'bid_bond' })]),
      {
        role: 'custom', id: 'm_sites', name: 'Sites', singular: 'Site', icon: 'Map', color: '#f97316',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Governorate', 'select', { options: GOVERNORATES, inList: true }),
          f('Contract value', 'currency', { key: 'contract_value', inList: true }),
          f('Progress', 'percent', { inList: true }),
          f('Site engineer', 'user', { key: 'engineer', inList: true }),
        ],
      },
      core.products('Materials & BOQ items', 'Item'),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      core.tasks(),
    ],
  },
  {
    id: 'blank',
    name: 'Start from the core',
    nameAr: 'ابدأ من الأساس',
    tagline: 'Customers, contacts, deals, products and invoices. Build the rest yourself.',
    icon: 'Sparkles',
    gradient: ['#334155', '#6366f1'],
    industries: [],
    features: [],
    highlights: ['Minimal, clean core', 'Add only what you need'],
    modules: [core.accounts(), core.contacts(), core.deals('Deals', 'Deal'), core.products(), core.invoices(), core.tasks()],
  },
]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[TEMPLATES.length - 1]
````

### `crm-builder/src/lib/types.ts`

````ts
import type { AppSchema } from './schema'
import type { Answers } from './recommend'

export type DocStatus = 'draft' | 'posted' | 'partial' | 'paid' | 'void' | 'sent' | 'accepted' | 'declined' | 'invoiced'

export interface Line {
  id: string
  product?: string
  description: string
  qty: number
  price: number
  discount: number
  vat: number
}

export interface Rec {
  id: string
  module: string
  number?: string
  createdAt: string
  updatedAt: string
  createdBy: string
  values: Record<string, unknown>
  stage?: string
  stageHistory?: { stage: string; at: string }[]
  status?: DocStatus
  lines?: Line[]
  postedAt?: string
  /** journal / stock rows created when this document was posted */
  links?: { source?: string }
}

export interface StockMove {
  id: string
  product: string
  qty: number
  cost: number
  doc: string
  ref: string
  date: string
}

export type AccountCode = '1100' | '1200' | '1300' | '1400' | '2100' | '2200' | '4000' | '5000' | '5100'

export const CHART: Record<AccountCode, { name: string; type: 'asset' | 'liability' | 'income' | 'expense' }> = {
  '1100': { name: 'Cash & bank', type: 'asset' },
  '1200': { name: 'Accounts receivable', type: 'asset' },
  '1300': { name: 'Inventory', type: 'asset' },
  '1400': { name: 'VAT input (recoverable)', type: 'asset' },
  '2100': { name: 'Accounts payable', type: 'liability' },
  '2200': { name: 'VAT output (payable)', type: 'liability' },
  '4000': { name: 'Sales revenue', type: 'income' },
  '5000': { name: 'Cost of goods sold', type: 'expense' },
  '5100': { name: 'Purchased services & expenses', type: 'expense' },
}

export interface JournalEntry {
  id: string
  date: string
  ref: string
  memo: string
  doc?: string
  lines: { account: AccountCode; debit: number; credit: number }[]
}

export interface Payment {
  id: string
  doc: string
  module: string
  amount: number
  date: string
  method: 'cash' | 'bank' | 'cheque' | 'instapay' | 'card'
  direction: 'in' | 'out'
  ref: string
}

export interface Note {
  id: string
  at: string
  message: string
  read: boolean
  role?: string
  /** addressed to one person (mentions, approvals) */
  user?: string
  record?: string
}

export interface Approval {
  id: string
  rule: string
  record: string
  module: string
  requestedBy: string
  at: string
  status: 'pending' | 'approved' | 'rejected'
  decidedBy?: string
  decidedAt?: string
  note?: string
}

export interface Comment {
  id: string
  record: string
  user: string
  at: string
  text: string
}

export interface SavedView {
  id: string
  module: string
  name: string
  user: string
  q: string
  stage: string
  sort: { key: string; dir: 1 | -1 }
  view: 'table' | 'board' | 'calendar'
}

export interface User {
  id: string
  name: string
  email: string
  roleId: string
  passwordHash?: string
  demo?: boolean
}

export interface WorkspaceData {
  records: Record<string, Rec[]>
  stock: StockMove[]
  journal: JournalEntry[]
  payments: Payment[]
  notes: Note[]
  sequences: Record<string, number>
  workflowRuns: Record<string, string>
  activity: { id: string; at: string; user: string; text: string; record?: string; module?: string }[]
  approvals?: Approval[]
  comments?: Comment[]
  views?: SavedView[]
}

export interface Workspace {
  id: string
  createdAt: string
  answers: Answers
  users: User[]
  draft: AppSchema | null
  published: AppSchema | null
  history: { version: number; at: string; note: string; schema: AppSchema }[]
  seedOnPublish?: boolean
  data: WorkspaceData
}

export const emptyData = (): WorkspaceData => ({ records: {}, stock: [], journal: [], payments: [], notes: [], sequences: {}, workflowRuns: {}, activity: [] })
````

### `crm-builder/src/lib/validate.ts`

````ts
// The guardrails. Every change in the builder is checked here so the published system always works:
// nothing points at a missing field, money adds up, pipelines can finish, and roles keep their behaviour.
import type { AppSchema, FieldDef, ModuleDef } from './schema'
import { GROUPABLE_TYPES, fieldByKey, isNumeric, moduleById } from './schema'
import { ROLES } from './roles'
import { formulaRefs } from './formula'

export type Tab = 'modules' | 'pipelines' | 'reports' | 'automations' | 'rules' | 'roles' | 'settings'

export interface Issue {
  level: 'error' | 'warning'
  message: string
  tab: Tab
  moduleId?: string
  fieldId?: string
  itemId?: string
}

export const PSEUDO_FIELDS: Record<string, { label: string; applies: (m: ModuleDef) => boolean; numeric?: boolean }> = {
  __stage: { label: 'Stage', applies: (m) => Boolean(m.stages) },
  __stagetype: { label: 'Stage type (open / won / lost)', applies: (m) => Boolean(m.stages) },
  __status: { label: 'Document status', applies: (m) => Boolean(m.lines) },
  __month: { label: 'Month created', applies: () => true },
  __owner: { label: 'Created by', applies: () => true },
}

export function fieldExists(m: ModuleDef, key: string) {
  if (key in PSEUDO_FIELDS) return PSEUDO_FIELDS[key].applies(m)
  return Boolean(fieldByKey(m, key))
}

/** Everything that would break if this field disappeared. */
export function fieldDependents(schema: AppSchema, mod: ModuleDef, key: string): string[] {
  const out: string[] = []
  const field = fieldByKey(mod, key)
  if (field?.system) out.push(`it is required for ${ROLES[mod.role].label} to work`)
  if (mod.titleField === key) out.push('it is the record title')
  for (const f of mod.fields) {
    if (f.type === 'formula' && f.formula) {
      try {
        if (formulaRefs(f.formula).includes(key)) out.push(`formula “${f.label}” uses it`)
      } catch {
        /* broken formulas are reported elsewhere */
      }
    }
  }
  for (const s of mod.stages ?? []) if (s.requires?.includes(key)) out.push(`stage “${s.name}” requires it`)
  for (const f of mod.fields) {
    if (f.showIf?.field === key && f.key !== key) out.push(`“${f.label}” is shown only when it has a value`)
    if (f.lookup?.via === key) out.push(`lookup “${f.label}” goes through it`)
  }
  for (const m of schema.modules) {
    for (const f of m.fields) {
      if (f.lookup && fieldByKey(m, f.lookup.via)?.target === mod.id && f.lookup.field === key) out.push(`lookup “${f.label}” in ${m.name} shows it`)
      if (f.rollup && f.rollup.module === mod.id && (f.rollup.via === key || f.rollup.field === key)) out.push(`rollup “${f.label}” in ${m.name} uses it`)
    }
  }
  for (const r of mod.rules ?? []) if (r.check.field === key || r.when.some((w) => w.field === key)) out.push(`validation rule “${r.message}” uses it`)
  for (const r of mod.scoring ?? []) if (r.condition.field === key) out.push('a scoring rule uses it')
  for (const a of schema.approvals ?? []) if (a.module === mod.id && a.conditions.some((c) => c.field === key)) out.push(`approval “${a.name}” uses it`)
  for (const r of schema.reports) {
    if (r.module !== mod.id) continue
    if (r.groupBy === key || r.measure.field === key || r.filters.some((x) => x.field === key)) out.push(`report “${r.name}” uses it`)
  }
  for (const w of schema.workflows) {
    if (w.module !== mod.id) continue
    const inActions = w.actions.some((a) => (a.type === 'set_field' && a.field === key) || ('title' in a && a.title.includes(`{${key}}`)) || ('message' in a && a.message.includes(`{${key}}`)))
    if (w.trigger.field === key || w.conditions.some((c) => c.field === key) || inActions) out.push(`automation “${w.name}” uses it`)
  }
  return out
}

export function moduleDependents(schema: AppSchema, mod: ModuleDef): string[] {
  const out: string[] = []
  for (const m of schema.modules) {
    if (m.id === mod.id) continue
    for (const f of m.fields) if (f.type === 'relation' && f.target === mod.id) out.push(`“${m.name}” links to it through “${f.label}”`)
    if (ROLES[m.role].needs?.includes(mod.role) && schema.modules.filter((x) => x.role === mod.role).length === 1) out.push(`“${m.name}” needs a ${ROLES[mod.role].label} module`)
  }
  for (const r of schema.reports) if (r.module === mod.id) out.push(`report “${r.name}”`)
  for (const w of schema.workflows) if (w.module === mod.id) out.push(`automation “${w.name}”`)
  for (const a of schema.approvals ?? []) if (a.module === mod.id) out.push(`approval “${a.name}”`)
  for (const m of schema.modules) for (const f of m.fields) if (f.rollup?.module === mod.id && m.id !== mod.id) out.push(`rollup “${f.label}” in ${m.name}`)
  return out
}

function checkField(schema: AppSchema, m: ModuleDef, f: FieldDef, issues: Issue[]) {
  const at = { tab: 'modules' as const, moduleId: m.id, fieldId: f.id }
  if (!f.label.trim()) issues.push({ level: 'error', message: `A field in “${m.name}” has no name`, ...at })
  if (!/^[a-z][a-z0-9_]*$/.test(f.key)) issues.push({ level: 'error', message: `“${f.label}” has an invalid internal key “${f.key}”`, ...at })
  if ((f.type === 'select' || f.type === 'multiselect')) {
    if (!f.options?.length) issues.push({ level: 'error', message: `Dropdown “${f.label}” in “${m.name}” has no options`, ...at })
    const values = f.options?.map((o) => o.value) ?? []
    if (new Set(values).size !== values.length) issues.push({ level: 'error', message: `Dropdown “${f.label}” has two options with the same name`, ...at })
    if (f.options?.some((o) => !o.label.trim())) issues.push({ level: 'error', message: `Dropdown “${f.label}” has an empty option`, ...at })
  }
  if (f.type === 'relation') {
    const target = f.target ? moduleById(schema, f.target) : undefined
    if (!target) issues.push({ level: 'error', message: `“${f.label}” in “${m.name}” links to a module that no longer exists`, ...at })
    const expected = ROLES[m.role].relations?.[f.key]
    if (target && expected && target.role !== expected) issues.push({ level: 'error', message: `“${f.label}” must link to ${ROLES[expected].label}`, ...at })
  }
  if (f.type === 'formula') {
    if (!f.formula?.trim()) issues.push({ level: 'error', message: `Formula “${f.label}” in “${m.name}” is empty`, ...at })
    else {
      try {
        for (const ref of formulaRefs(f.formula)) {
          const target = fieldByKey(m, ref)
          if (!target) issues.push({ level: 'error', message: `Formula “${f.label}” uses “${ref}”, which is not a field in ${m.name}`, ...at })
          else if (!isNumeric(target)) issues.push({ level: 'error', message: `Formula “${f.label}” uses “${target.label}”, which is not a number`, ...at })
          else if (target.key === f.key) issues.push({ level: 'error', message: `Formula “${f.label}” refers to itself`, ...at })
        }
      } catch (e) {
        issues.push({ level: 'error', message: `Formula “${f.label}”: ${(e as Error).message}`, ...at })
      }
    }
  }
  if (f.min !== undefined && f.max !== undefined && f.min > f.max) issues.push({ level: 'error', message: `“${f.label}”: minimum is bigger than maximum`, ...at })
  if (f.type === 'lookup') {
    const via = fieldByKey(m, f.lookup?.via)
    const target = via?.type === 'relation' ? moduleById(schema, via.target ?? '') : undefined
    if (!f.lookup || !via || via.type !== 'relation') issues.push({ level: 'error', message: `Lookup “${f.label}” in “${m.name}”: choose a link field to look through`, ...at })
    else if (!target || !fieldByKey(target, f.lookup.field)) issues.push({ level: 'error', message: `Lookup “${f.label}” shows a field that no longer exists`, ...at })
  }
  if (f.type === 'rollup') {
    const child = f.rollup ? moduleById(schema, f.rollup.module) : undefined
    const via = fieldByKey(child, f.rollup?.via)
    if (!f.rollup || !child) issues.push({ level: 'error', message: `Rollup “${f.label}” in “${m.name}”: choose which records to add up`, ...at })
    else if (!via || via.type !== 'relation' || via.target !== m.id) issues.push({ level: 'error', message: `Rollup “${f.label}”: “${child.name}” must link to ${m.name} through the chosen field`, ...at })
    else if (f.rollup.op !== 'count' && !isNumeric(fieldByKey(child, f.rollup.field))) issues.push({ level: 'error', message: `Rollup “${f.label}”: choose a number field to ${f.rollup.op}`, ...at })
  }
  if (f.showIf) {
    if (f.showIf.field === f.key) issues.push({ level: 'error', message: `“${f.label}” can’t depend on itself`, ...at })
    else if (!fieldByKey(m, f.showIf.field)) issues.push({ level: 'error', message: `“${f.label}” is shown based on a field that no longer exists`, ...at })
    if (f.system && f.required) issues.push({ level: 'error', message: `“${f.label}” is required by the system, so it must always be shown`, ...at })
  }
}

function formulaCycles(m: ModuleDef, issues: Issue[]) {
  const graph = new Map<string, string[]>()
  for (const f of m.fields) {
    if (f.type !== 'formula' || !f.formula) continue
    try {
      graph.set(f.key, formulaRefs(f.formula))
    } catch {
      /* reported elsewhere */
    }
  }
  const state = new Map<string, 1 | 2>()
  const visit = (k: string, path: string[]): boolean => {
    if (state.get(k) === 1) {
      issues.push({ level: 'error', message: `Formulas in “${m.name}” go round in a circle: ${[...path, k].join(' → ')}`, tab: 'modules', moduleId: m.id })
      return true
    }
    if (state.get(k) === 2) return false
    state.set(k, 1)
    for (const n of graph.get(k) ?? []) if (graph.has(n) && visit(n, [...path, k])) return true
    state.set(k, 2)
    return false
  }
  for (const k of graph.keys()) if (visit(k, [])) break
}

export function validate(schema: AppSchema): Issue[] {
  const issues: Issue[] = []
  const names = new Set<string>()

  if (!schema.company.name.trim()) issues.push({ level: 'error', message: 'Company name is missing', tab: 'settings' })
  if (!(schema.company.vatRate >= 0 && schema.company.vatRate <= 100)) issues.push({ level: 'error', message: 'VAT rate must be between 0 and 100', tab: 'settings' })
  if (schema.modules.some((m) => m.lines) && !schema.company.taxId.trim()) issues.push({ level: 'warning', message: 'Add your tax registration number so it prints on invoices (required for ETA e-invoicing in Egypt)', tab: 'settings' })

  if (!schema.modules.some((m) => m.role === 'accounts')) issues.push({ level: 'error', message: 'Every CRM needs a Customers module', tab: 'modules' })

  for (const m of schema.modules) {
    const info = ROLES[m.role]
    if (!m.name.trim()) issues.push({ level: 'error', message: 'A module has no name', tab: 'modules', moduleId: m.id })
    const lower = m.name.trim().toLowerCase()
    if (names.has(lower)) issues.push({ level: 'error', message: `Two modules are called “${m.name}”`, tab: 'modules', moduleId: m.id })
    names.add(lower)

    const keys = m.fields.map((f) => f.key)
    const dup = keys.find((k, i) => keys.indexOf(k) !== i)
    if (dup) issues.push({ level: 'error', message: `“${m.name}” has two fields with the key “${dup}”`, tab: 'modules', moduleId: m.id })
    for (const req of info.requiredKeys) {
      if (!keys.includes(req)) issues.push({ level: 'error', message: `“${m.name}” is missing its “${req}” field, which ${info.label} needs`, tab: 'modules', moduleId: m.id })
    }
    if (!fieldByKey(m, m.titleField)) issues.push({ level: 'error', message: `“${m.name}” has no title field`, tab: 'modules', moduleId: m.id })
    for (const need of info.needs ?? []) {
      if (!schema.modules.some((x) => x.role === need)) issues.push({ level: 'error', message: `“${m.name}” needs a ${ROLES[need].label} module`, tab: 'modules', moduleId: m.id })
    }
    if (m.fields.length > 60) issues.push({ level: 'warning', message: `“${m.name}” has ${m.fields.length} fields. Long forms slow your team down — consider a second module.`, tab: 'modules', moduleId: m.id })
    for (const f of m.fields) checkField(schema, m, f, issues)
    formulaCycles(m, issues)
    for (const r of m.rules ?? []) {
      const at = { tab: 'rules' as const, moduleId: m.id, itemId: r.id }
      if (!r.message.trim()) issues.push({ level: 'error', message: `A validation rule in “${m.name}” has no message`, ...at })
      for (const fl of [r.check, ...r.when]) if (!fieldByKey(m, fl.field)) issues.push({ level: 'error', message: `Validation rule “${r.message}” uses a field that no longer exists`, ...at })
    }
    for (const r of m.scoring ?? []) {
      if (!fieldExists(m, r.condition.field)) issues.push({ level: 'error', message: `A scoring rule in “${m.name}” uses a field that no longer exists`, tab: 'rules', moduleId: m.id, itemId: r.id })
      if (!Number.isFinite(r.points)) issues.push({ level: 'error', message: `A scoring rule in “${m.name}” needs points`, tab: 'rules', moduleId: m.id, itemId: r.id })
    }

    if (m.stages) {
      const at = { tab: 'pipelines' as const, moduleId: m.id }
      const won = m.stages.filter((s) => s.type === 'won')
      const lost = m.stages.filter((s) => s.type === 'lost')
      const open = m.stages.filter((s) => s.type === 'open')
      if (!open.length) issues.push({ level: 'error', message: `Pipeline “${m.name}” needs at least one open stage`, ...at })
      if (won.length !== 1) issues.push({ level: 'error', message: `Pipeline “${m.name}” needs exactly one Won / Done stage (has ${won.length})`, ...at })
      if (lost.length !== 1) issues.push({ level: 'error', message: `Pipeline “${m.name}” needs exactly one Lost / Cancelled stage (has ${lost.length})`, ...at })
      const firstClosed = m.stages.findIndex((s) => s.type !== 'open')
      if (firstClosed >= 0 && m.stages.slice(firstClosed).some((s) => s.type === 'open')) issues.push({ level: 'error', message: `Pipeline “${m.name}”: open stages must come before Won and Lost`, ...at })
      const stageNames = m.stages.map((s) => s.name.trim().toLowerCase())
      if (stageNames.some((n) => !n)) issues.push({ level: 'error', message: `Pipeline “${m.name}” has a stage without a name`, ...at })
      if (new Set(stageNames).size !== stageNames.length) issues.push({ level: 'error', message: `Pipeline “${m.name}” has two stages with the same name`, ...at })
      for (const s of m.stages) {
        if (s.probability < 0 || s.probability > 100) issues.push({ level: 'error', message: `Stage “${s.name}”: probability must be 0–100%`, ...at })
        if (s.type === 'won' && s.probability !== 100) issues.push({ level: 'warning', message: `Stage “${s.name}” is Won, so its probability should be 100%`, ...at })
        if (s.type === 'lost' && s.probability !== 0) issues.push({ level: 'warning', message: `Stage “${s.name}” is Lost, so its probability should be 0%`, ...at })
        for (const r of s.requires ?? []) if (!fieldByKey(m, r)) issues.push({ level: 'error', message: `Stage “${s.name}” requires a field that no longer exists (“${r}”)`, ...at })
      }
      for (let i = 1; i < open.length; i++) {
        if (open[i].probability < open[i - 1].probability) {
          issues.push({ level: 'warning', message: `Pipeline “${m.name}”: “${open[i].name}” has a lower probability than the stage before it, so the forecast may look odd`, ...at })
          break
        }
      }
    }
  }

  for (const r of schema.reports) {
    const at = { tab: 'reports' as const, itemId: r.id }
    const m = moduleById(schema, r.module)
    if (!m) {
      issues.push({ level: 'error', message: `Report “${r.name}” uses a module that no longer exists`, ...at })
      continue
    }
    if (!r.name.trim()) issues.push({ level: 'error', message: 'A report has no name', ...at })
    if (r.measure.op !== 'count') {
      const mf = r.measure.field ? fieldByKey(m, r.measure.field) : undefined
      if (!mf) issues.push({ level: 'error', message: `Report “${r.name}”: choose a number field to ${r.measure.op}`, ...at })
      else if (!isNumeric(mf)) issues.push({ level: 'error', message: `Report “${r.name}”: “${mf.label}” is not a number, so it can't be summed or averaged`, ...at })
    }
    if (r.chart !== 'kpi') {
      if (!r.groupBy) issues.push({ level: 'error', message: `Report “${r.name}”: drop a field into “Group by”`, ...at })
      else if (!fieldExists(m, r.groupBy)) issues.push({ level: 'error', message: `Report “${r.name}” groups by a field that no longer exists`, ...at })
      else {
        const g = fieldByKey(m, r.groupBy)
        if (g && !GROUPABLE_TYPES.includes(g.type)) issues.push({ level: 'warning', message: `Report “${r.name}” groups by “${g.label}”, which has many unique values`, ...at })
      }
      if (r.chart === 'funnel' && r.groupBy !== '__stage') issues.push({ level: 'error', message: `Report “${r.name}”: a funnel must be grouped by Stage`, ...at })
    }
    for (const fl of r.filters) if (!fieldExists(m, fl.field)) issues.push({ level: 'error', message: `Report “${r.name}” filters on a field that no longer exists`, ...at })
  }

  const tasks = schema.modules.find((m) => m.role === 'tasks')
  for (const w of schema.workflows) {
    const at = { tab: 'automations' as const, itemId: w.id }
    const m = moduleById(schema, w.module)
    if (!m) {
      issues.push({ level: 'error', message: `Automation “${w.name}” uses a module that no longer exists`, ...at })
      continue
    }
    if (!w.actions.length) issues.push({ level: w.enabled ? 'error' : 'warning', message: `Automation “${w.name}” does nothing — add an action`, ...at })
    if (w.trigger.type === 'stage_changed') {
      if (!m.stages) issues.push({ level: 'error', message: `Automation “${w.name}”: “${m.name}” has no pipeline`, ...at })
      else if (w.trigger.stage && !m.stages.some((s) => s.id === w.trigger.stage)) issues.push({ level: 'error', message: `Automation “${w.name}” waits for a stage that was removed`, ...at })
    }
    if (w.trigger.type === 'date_passed') {
      const df = w.trigger.field ? fieldByKey(m, w.trigger.field) : undefined
      if (!df || df.type !== 'date') issues.push({ level: 'error', message: `Automation “${w.name}”: choose a date field to watch`, ...at })
    }
    for (const c of w.conditions) if (!fieldExists(m, c.field)) issues.push({ level: 'error', message: `Automation “${w.name}” checks a field that no longer exists`, ...at })
    for (const a of w.actions) {
      if (a.type === 'create_task' && !tasks) issues.push({ level: 'error', message: `Automation “${w.name}” creates tasks, but there is no Tasks module`, ...at })
      if (a.type === 'create_task' && !a.title.trim()) issues.push({ level: 'error', message: `Automation “${w.name}”: the task needs a title`, ...at })
      if (a.type === 'set_field') {
        const target = fieldByKey(m, a.field)
        if (!target) issues.push({ level: 'error', message: `Automation “${w.name}” sets a field that no longer exists`, ...at })
        else if (target.readOnly) issues.push({ level: 'error', message: `Automation “${w.name}” can't change “${target.label}” — the system calculates it`, ...at })
        else if (w.trigger.type === 'updated') issues.push({ level: 'warning', message: `Automation “${w.name}” changes a record every time it is updated. It runs once per save, but check it does what you expect.`, ...at })
      }
      for (const text of ['title' in a ? a.title : '', 'message' in a ? a.message : '']) {
        for (const ref of text.match(/\{([a-z0-9_]+)\}/g) ?? []) {
          const key = ref.slice(1, -1)
          if (!fieldByKey(m, key)) issues.push({ level: 'error', message: `Automation “${w.name}” mentions {${key}}, which is not a field in ${m.name}`, ...at })
        }
      }
    }
  }

  for (const a of schema.approvals ?? []) {
    const at = { tab: 'rules' as const, itemId: a.id }
    const m = moduleById(schema, a.module)
    if (!m) {
      issues.push({ level: 'error', message: `Approval “${a.name}” uses a module that no longer exists`, ...at })
      continue
    }
    if (!a.name.trim()) issues.push({ level: 'error', message: 'An approval rule has no name', ...at })
    if (!schema.roles.some((r) => r.id === a.approverRole)) issues.push({ level: 'error', message: `Approval “${a.name}”: choose who approves`, ...at })
    if (a.action === 'post' && m.role !== 'invoices' && m.role !== 'purchases') issues.push({ level: 'error', message: `Approval “${a.name}”: only invoices and purchase bills are posted`, ...at })
    if (a.action === 'stage' && !m.stages?.some((s) => s.id === a.stage)) issues.push({ level: 'error', message: `Approval “${a.name}”: choose a stage of ${m.name}`, ...at })
    for (const c of a.conditions) if (!fieldExists(m, c.field)) issues.push({ level: 'error', message: `Approval “${a.name}” checks a field that no longer exists`, ...at })
  }

  const admins = schema.roles.filter((r) => r.admin)
  if (!admins.length) issues.push({ level: 'error', message: 'Keep at least one Admin role', tab: 'roles' })
  if (schema.modules.some((m) => m.lines) && !schema.roles.some((r) => r.finance)) issues.push({ level: 'warning', message: 'No role can post invoices except Admin. Give your finance team the “Post & collect” right.', tab: 'roles' })
  for (const r of schema.roles) if (!r.name.trim()) issues.push({ level: 'error', message: 'A role has no name', tab: 'roles', itemId: r.id })

  return issues
}

export function healthScore(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.length - errors
  return Math.max(0, 100 - errors * 15 - warnings * 4)
}
````

### `crm-builder/src/main.tsx`

````tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
````

### `crm-builder/src/pages/Auth.tsx`

````tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { register, signIn } from '../lib/store'

export default function Auth({ mode }: { mode: 'register' | 'signin' }) {
  const nav = useNavigate()
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (company.trim().length < 2) return setError('Enter your company name')
      if (name.trim().length < 2) return setError('Enter your name')
      if (password.length < 8) return setError('Use at least 8 characters for the password')
    }
    setBusy(true)
    try {
      if (mode === 'register') {
        await register(company, name, email, password)
        nav('/onboarding')
      } else {
        await signIn(email, password)
        nav('/app')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-art">
        <Link to="/"><Logo /></Link>
        <div>
          <h2>{mode === 'register' ? 'Your own CRM & ERP, shaped around how you work.' : 'Welcome back.'}</h2>
          <ul style={{ listStyle: 'none', padding: 0, lineHeight: 2.1, color: '#c7caf0' }}>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;A system suggested for your industry</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;Drag-and-drop fields, stages, reports and automations</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;Quotes, invoices, stock and payments that always add up</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;English & Arabic, EGP and VAT ready</li>
          </ul>
        </div>
        <span className="small" style={{ color: '#8a8dc0' }}>Made in Egypt for the world</span>
      </div>
      <div className="auth-form">
        <form onSubmit={submit}>
          <h1>{mode === 'register' ? 'Create your workspace' : 'Sign in'}</h1>
          <p className="muted" style={{ marginTop: 0 }}>{mode === 'register' ? 'Free to start. Takes about 5 minutes to get a working system.' : 'Use the e-mail and password you registered with.'}</p>
          {mode === 'register' && (
            <>
              <label className="field">Company name<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Nile Water Solutions" autoFocus /></label>
              <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mohamed Omar" /></label>
            </>
          )}
          <label className="field">Work e-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
          <label className="field">Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : ''} /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="glow big" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create workspace' : 'Sign in'}</button>
          <p className="small muted center">
            {mode === 'register' ? <>Already registered? <Link to="/signin">Sign in</Link></> : <>New here? <Link to="/register">Create a workspace</Link></>}
          </p>
          <p className="tiny muted center">This preview keeps your data in this browser only. Nothing is sent to a server.</p>
        </form>
      </div>
    </div>
  )
}
````

### `crm-builder/src/pages/Landing.tsx`

````tsx
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Boxes, Calculator, CheckCircle2, Globe, Languages, Lock, MousePointerClick, ShieldCheck, Sparkles, Workflow, Zap } from 'lucide-react'
import { TEMPLATES } from '../lib/templates'
import { Icon } from '../components/Icon'
import { useLang } from '../lib/i18n'
import { Logo } from '../components/Logo'

const BEST = [
  ['Custom modules & relations', 'Attio, Airtable'],
  ['Lookup & rollup fields', 'Airtable, Attio'],
  ['Conditional fields', 'Odoo Studio, Zoho layout rules'],
  ['Validation rules', 'Salesforce, Zoho'],
  ['Multi-step approvals', 'Odoo, ERPNext'],
  ['Stage gates & weighted forecast', 'Salesforce, HubSpot'],
  ['Deal rotting alerts', 'Pipedrive'],
  ['Lead scoring', 'HubSpot'],
  ['Board, table & calendar views + saved views', 'monday.com, Airtable'],
  ['Visual automations', 'HubSpot, Zapier'],
  ['CSV import with column matching', 'every leading CRM'],
  ['Stock, reorder alerts & receivables ageing', 'ERPNext, Odoo'],
]

const GUARDS = [
  { icon: Calculator, title: 'Accounting that always balances', text: 'Every posted invoice, bill and payment writes a double-entry journal. If debits don’t equal credits, nothing is saved.' },
  { icon: Boxes, title: 'Stock that matches reality', text: 'On-hand quantity and moving-average cost are calculated by the system, never typed in. Overselling is blocked.' },
  { icon: Lock, title: 'Locked when it matters', text: 'Posted documents can’t be edited or deleted — only voided with a full reversal, the way auditors expect.' },
  { icon: Workflow, title: 'Pipelines that can finish', text: 'Every pipeline needs open stages, one Won and one Lost. Stage gates make sure the right data is captured.' },
  { icon: ShieldCheck, title: 'No broken links', text: 'You can’t delete a field a report, formula or automation depends on. The builder tells you exactly what uses it.' },
  { icon: Zap, title: 'Automations that can’t loop', text: 'Triggers, conditions and actions are checked before publishing, and actions never re-trigger each other.' },
]

export default function Landing() {
  const { t, lang, setLang } = useLang()
  return (
    <div className="landing">
      <nav className="nav">
        <Logo />
        <div className="row">
          <button className="ghost" style={{ color: '#c7caf0' }} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Languages size={16} /> {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <Link to="/signin" className="btn secondary" style={{ background: 'transparent', color: '#fff', borderColor: '#ffffff33' }}>{t('signin')}</Link>
          <Link to="/register" className="btn glow">{t('start')}</Link>
        </div>
      </nav>

      <header className="hero">
        <div>
          <span className="pill" style={{ background: '#ffffff14', color: '#e0e2ff' }}><Sparkles size={14} /> {t('tagline')}</span>
          <h1 style={{ marginTop: 18 }}>
            {t('heroA')} <span className="grad">{t('heroB')}</span>
          </h1>
          <p className="lead">{t('heroLead')}</p>
          <div className="row">
            <Link to="/register" className="btn glow big">{t('start')} <ArrowRight size={18} className="flip" /></Link>
            <a href="#how" className="btn secondary big">See how it works</a>
          </div>
          <div className="trust">
            <span><CheckCircle2 size={16} /> CRM + sales + stock + invoicing</span>
            <span><Globe size={16} /> English & العربية, any currency</span>
            <span><ShieldCheck size={16} /> VAT-ready (Egypt 14% by default)</span>
          </div>
        </div>
        <HeroMock />
      </header>

      <section className="section" id="how">
        <h2 className="big">{t('howTitle')}</h2>
        <p className="sub">{t('howSub')}</p>
        <div className="steps">
          {(
            [
              ['s1', 's1d', '#6366f1'],
              ['s2', 's2d', '#a855f7'],
              ['s3', 's3d', '#ec4899'],
              ['s4', 's4d', '#06b6d4'],
              ['s5', 's5d', '#10b981'],
            ] as const
          ).map(([h, d, c], i) => (
            <div className="step-card" key={h}>
              <div className="n" style={{ background: c }}>{i + 1}</div>
              <h3>{t(h)}</h3>
              <p>{t(d)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="big">{t('tplTitle')}</h2>
        <p className="sub">{t('tplSub')}</p>
        <div className="tpl-grid">
          {TEMPLATES.map((tp) => (
            <div key={tp.id} className="tpl" style={{ background: `linear-gradient(135deg, ${tp.gradient[0]}, ${tp.gradient[1]})` }}>
              <Icon name={tp.icon} size={28} />
              <h3>{lang === 'ar' ? tp.nameAr : tp.name}</h3>
              <p>{tp.tagline}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="big">The best ideas from the world’s top systems, in one builder</h2>
        <p className="sub">Features you would normally buy from five different products, ready to switch on and shape around your business.</p>
        <div className="tpl-grid">
          {BEST.map(([f, from]) => (
            <div key={f} className="guard" style={{ padding: 18 }}>
              <h3 style={{ fontSize: '0.98rem' }}><CheckCircle2 size={18} color="#34d399" /> {f}</h3>
              <p className="small">Inspired by {from}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="big">{t('guardTitle')}</h2>
        <p className="sub">{t('guardSub')}</p>
        <div className="guard-grid">
          {GUARDS.map((g) => (
            <div className="guard" key={g.title}>
              <h3><g.icon size={20} color="#a5b4fc" /> {g.title}</h3>
              <p>{g.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="cta">
          <MousePointerClick size={36} />
          <h2>{t('ctaTitle')}</h2>
          <p style={{ opacity: 0.9, maxWidth: 560, margin: '0 auto 22px' }}>Register, answer a few questions, and get a working CRM + ERP you can reshape by dragging and dropping.</p>
          <Link to="/register" className="btn big" style={{ background: '#fff', color: '#4338ca' }}>{t('start')} <ArrowRight size={18} /></Link>
        </div>
      </section>
      <footer className="footer">© {new Date().getFullYear()} Bonyan · Made in Egypt for the world</footer>
    </div>
  )
}

function HeroMock() {
  const cols = [
    { name: 'Proposal', c: '#8b5cf6', items: ['Nile Valley – RO plant', 'Delta Foods – upgrade'] },
    { name: 'Negotiation', c: '#f59e0b', items: ['Cairo Care – ICU kit'] },
    { name: 'Won', c: '#10b981', items: ['Red Sea Resorts – AMC', 'Sinai Cement – pumps'] },
  ]
  return (
    <div className="mock" aria-hidden>
      <div className="mock-inner">
        <div className="mock-side">
          <span className="on"><BarChart3 size={12} /> Dashboard</span>
          <span>Customers</span>
          <span>Projects</span>
          <span>Site surveys</span>
          <span>Invoices</span>
          <span>Stock</span>
        </div>
        <div className="stack">
          <div className="row between">
            <b style={{ fontSize: '0.85rem' }}>Projects pipeline</b>
            <span className="pill green">EGP 4.2M open</span>
          </div>
          <div className="mock-cols">
            {cols.map((c) => (
              <div className="mock-col" key={c.name}>
                <b>{c.name}</b>
                {c.items.map((i) => <div key={i} className="mock-card" style={{ ['--c' as string]: c.c }}>{i}</div>)}
              </div>
            ))}
          </div>
          <svg viewBox="0 0 300 80" style={{ width: '100%', height: 90 }}>
            <defs><linearGradient id="hm" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#6366f1" stopOpacity=".5" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 60 L40 52 L80 56 L120 38 L160 42 L200 24 L240 30 L300 10 L300 80 L0 80Z" fill="url(#hm)" />
            <path d="M0 60 L40 52 L80 56 L120 38 L160 42 L200 24 L240 30 L300 10" fill="none" stroke="#6366f1" strokeWidth="3" />
          </svg>
        </div>
      </div>
      <div className="mock-float" style={{ top: -18, insetInlineEnd: 30 }}><CheckCircle2 size={16} color="#10b981" /> Health check: 100%</div>
      <div className="mock-float" style={{ bottom: -16, insetInlineStart: -10 }}><Zap size={16} color="#f59e0b" /> Task created: call new lead</div>
    </div>
  )
}
````

### `crm-builder/src/pages/Onboarding.tsx`

````tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Trash2, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { TEMPLATES } from '../lib/templates'
import { CHALLENGES, type TeamInput } from '../lib/packs'
import type { Answers } from '../lib/recommend'
import { currentWorkspace, update, useStore } from '../lib/store'
import { uid } from '../lib/schema'
import { useLang } from '../lib/i18n'

const STEPS = ['Industry', 'What you sell', 'Customers', 'Teams', 'Challenges']

const CHANNELS = [
  ['whatsapp', 'WhatsApp'], ['facebook', 'Facebook / Instagram'], ['website', 'Website'], ['field', 'Field sales reps'], ['exhibitions', 'Exhibitions'],
  ['referral', 'Referrals'], ['tenders', 'Tenders'], ['walkin', 'Walk-in / showroom'], ['phone', 'Phone calls'],
] as const

const TEAM_KINDS: [TeamInput['kind'], string][] = [
  ['management', 'Management'], ['sales', 'Sales'], ['operations', 'Operations / warehouse'], ['finance', 'Finance & accounting'], ['service', 'After-sales / service'], ['other', 'Other'],
]

export default function Onboarding() {
  const nav = useNavigate()
  const ws = useStore((s) => currentWorkspace(s))
  const { lang } = useLang()
  const [step, setStep] = useState(0)
  const [analysing, setAnalysing] = useState(false)
  const a = ws?.answers

  useEffect(() => {
    if (!analysing) return
    const t = setTimeout(() => nav('/suggest'), 2600)
    return () => clearTimeout(t)
  }, [analysing, nav])

  if (!ws || !a) return null
  const set = (patch: Partial<Answers>) => update((s) => Object.assign(s.workspaces[ws.id].answers, patch))
  const toggle = (key: 'customers' | 'channels' | 'challenges', v: string, max = 99) => {
    const cur = a[key]
    set({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= max ? cur : [...cur, v] } as Partial<Answers>)
  }
  const canNext = step === 0 ? Boolean(a.industry) && (a.industry !== 'other' || a.industryText.trim().length > 1) : step === 3 ? a.teams.length > 0 : true

  if (analysing) {
    const lines = [
      `Reading ${a.companyName}’s profile`,
      `Matching ${TEMPLATES.length} industry templates`,
      a.inventory ? 'Setting up stock and purchasing' : 'Setting up services billing',
      `Creating roles for ${a.teams.length} team${a.teams.length === 1 ? '' : 's'}`,
      `Adding fixes for ${a.challenges.length} challenge${a.challenges.length === 1 ? '' : 's'}`,
    ]
    return (
      <div className="wizard">
        <div className="analyse">
          <div>
            <div className="orb" />
            <h1>Designing your system…</h1>
            <ul style={{ padding: 0 }}>
              {lines.map((l, i) => (
                <li key={l} style={{ animationDelay: `${i * 0.45}s` }}><Check size={16} color="#10b981" /> {l}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard">
      <div className="wizard-top">
        <Logo />
        <div className="progress">{STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} title={s} />)}</div>
        <span className="muted small">Step {step + 1} of {STEPS.length}</span>
      </div>
      <div className="wizard-body" key={step}>
        {step === 0 && (
          <>
            <span className="pill">Welcome, {a.companyName}</span>
            <h1 style={{ marginTop: 10 }}>What does your company do?</h1>
            <p className="muted">We use this to suggest the right starting point. You can change everything later.</p>
            <div className="tiles">
              {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
                <button key={t.id} type="button" className={`tile ${a.industry === t.id ? 'on' : ''}`} onClick={() => set({ industry: t.id })}>
                  <span className="ic" style={{ background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` }}><Icon name={t.icon} size={22} /></span>
                  <b>{lang === 'ar' ? t.nameAr : t.name}</b>
                  <small>{t.tagline}</small>
                </button>
              ))}
              <button type="button" className={`tile ${a.industry === 'other' ? 'on' : ''}`} onClick={() => set({ industry: 'other' })}>
                <span className="ic" style={{ background: 'linear-gradient(135deg,#334155,#6366f1)' }}><Icon name="Sparkles" size={22} /></span>
                <b>Something else</b>
                <small>Describe it and we’ll find the closest match.</small>
              </button>
            </div>
            {a.industry === 'other' && (
              <label className="field" style={{ marginTop: 14 }}>Describe your industry<input autoFocus value={a.industryText} onChange={(e) => set({ industryText: e.target.value })} placeholder="e.g. solar panel installation, car rental, catering…" /></label>
            )}
            <div className="form-grid" style={{ marginTop: 22 }}>
              <label className="field">City<input value={a.city} onChange={(e) => set({ city: e.target.value })} /></label>
              <label className="field">Country<input value={a.country} onChange={(e) => set({ country: e.target.value })} /></label>
              <label className="field">Company size
                <select value={a.size} onChange={(e) => set({ size: e.target.value })}>
                  {['1-10', '11-50', '51-200', '201-500', '500+'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">Tax registration no. <span className="muted tiny">(optional, prints on invoices)</span><input value={a.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="123-456-789" /></label>
              <label className="field">Currency
                <select value={a.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">VAT rate %<input type="number" min={0} max={100} value={a.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) })} /></label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>What do you sell?</h1>
            <p className="muted">This decides whether you need stock, purchasing and cost tracking.</p>
            <p className="q">You sell…</p>
            <div className="seg">
              {(['products', 'services', 'both'] as const).map((v) => (
                <button key={v} type="button" className={a.sells === v ? 'on' : ''} onClick={() => set({ sells: v, inventory: v === 'services' ? false : a.inventory })}>
                  {v === 'products' ? 'Products' : v === 'services' ? 'Services' : 'Both'}
                </button>
              ))}
            </div>
            {a.sells !== 'services' && (
              <>
                <p className="q">Do you keep stock in a warehouse or shop?</p>
                <YesNo value={a.inventory} onChange={(v) => set({ inventory: v })} />
              </>
            )}
            <p className="q">Do you buy from suppliers and want to track what you owe them?</p>
            <YesNo value={a.purchasing} onChange={(v) => set({ purchasing: v })} />
            <p className="q">Your main products or services <span className="muted small">(one per line — we’ll add them to your catalogue)</span></p>
            <textarea rows={5} value={a.products} onChange={(e) => set({ products: e.target.value })} placeholder={'RO membrane 8"\nDosing pump\nAnnual maintenance visit'} />
          </>
        )}

        {step === 2 && (
          <>
            <h1>Who are your customers and how do you win them?</h1>
            <p className="q">Customers</p>
            <div className="chips">
              {[['b2b', 'Companies (B2B)'], ['b2c', 'Individuals (B2C)'], ['government', 'Government']].map(([v, l]) => (
                <button key={v} type="button" className={`chip ${a.customers.includes(v) ? 'on' : ''}`} onClick={() => toggle('customers', v)}>{l}</button>
              ))}
            </div>
            <p className="q">Where do your leads come from?</p>
            <div className="chips">
              {CHANNELS.map(([v, l]) => <button key={v} type="button" className={`chip ${a.channels.includes(v) ? 'on' : ''}`} onClick={() => toggle('channels', v)}>{l}</button>)}
            </div>
            <p className="q">How long does a typical sale take?</p>
            <div className="seg">
              {(['days', 'weeks', 'months'] as const).map((v) => <button key={v} type="button" className={a.salesCycle === v ? 'on' : ''} onClick={() => set({ salesCycle: v })}>A few {v}</button>)}
            </div>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div><p className="q">After-sales service, maintenance or support?</p><YesNo value={a.aftersales} onChange={(v) => set({ aftersales: v })} /></div>
              <div><p className="q">Recurring contracts, subscriptions or installments?</p><YesNo value={a.recurring} onChange={(v) => set({ recurring: v })} /></div>
              <div><p className="q">Do you deliver projects (installation, construction, consulting)?</p><YesNo value={a.projects} onChange={(v) => set({ projects: v })} /></div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Who will use the system?</h1>
            <p className="muted">Each team becomes a role with the right permissions. You can fine-tune access later.</p>
            <div className="stack" style={{ marginTop: 18 }}>
              {a.teams.map((t, i) => (
                <div className="team-row card" key={t.id} style={{ padding: 12 }}>
                  <input value={t.name} onChange={(e) => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Team name" />
                  <select value={t.kind} onChange={(e) => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, kind: e.target.value as TeamInput['kind'] } : x)) })}>
                    {TEAM_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div className="stepper">
                    <button type="button" onClick={() => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, size: Math.max(1, x.size - 1) } : x)) })}><Minus size={14} /></button>
                    <span>{t.size}</span>
                    <button type="button" onClick={() => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, size: x.size + 1 } : x)) })}><Plus size={14} /></button>
                  </div>
                  <button type="button" className="ghost icon" aria-label="Remove team" onClick={() => set({ teams: a.teams.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="chips" style={{ marginTop: 14 }}>
              {TEAM_KINDS.map(([kind, label]) => (
                <button key={kind} type="button" className="chip" onClick={() => set({ teams: [...a.teams, { id: uid('t'), name: label.split(' /')[0].split(' &')[0], size: 2, kind }] })}><Plus size={14} /> {label}</button>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>What slows your business down today?</h1>
            <p className="muted">Pick up to 5. We’ll add the reports and automations that fix them.</p>
            <div className="tiles">
              {CHALLENGES.map((c) => {
                const on = a.challenges.includes(c.id)
                return (
                  <button key={c.id} type="button" className={`tile ${on ? 'on' : ''}`} onClick={() => toggle('challenges', c.id, 5)}>
                    <span className="ic" style={{ background: on ? 'linear-gradient(135deg,#6366f1,#a855f7)' : '#cbd5e1' }}><Icon name={c.icon} size={20} /></span>
                    <b>{lang === 'ar' ? c.labelAr : c.label}</b>
                    <small>{on ? `✓ ${c.fix}` : c.fix}</small>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      <div className="wizard-foot">
        <button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button>
        {step < STEPS.length - 1 ? (
          <button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={16} /></button>
        ) : (
          <button className="glow" onClick={() => setAnalysing(true)}><Wand2 size={16} /> Suggest my system</button>
        )}
      </div>
    </div>
  )
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="seg">
      <button type="button" className={value ? 'on' : ''} onClick={() => onChange(true)}>Yes</button>
      <button type="button" className={!value ? 'on' : ''} onClick={() => onChange(false)}>No</button>
    </div>
  )
}
````

### `crm-builder/src/pages/Suggest.tsx`

````tsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Rocket, Sparkles, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { generateSchema, suggest } from '../lib/recommend'
import { CHALLENGES } from '../lib/packs'
import { currentWorkspace, update, useStore } from '../lib/store'
import { useLang } from '../lib/i18n'

export default function Suggest() {
  const nav = useNavigate()
  const ws = useStore((s) => currentWorkspace(s))
  const { lang } = useLang()
  const ranked = useMemo(() => (ws ? suggest(ws.answers) : []), [ws])
  const [chosen, setChosen] = useState(ranked[0]?.template.id)
  const [sample, setSample] = useState(true)
  const pick = ranked.find((r) => r.template.id === chosen) ?? ranked[0]
  const preview = useMemo(() => (ws && pick ? generateSchema(pick.template, ws.answers) : null), [ws, pick])
  if (!ws || !pick || !preview) return null
  const t = pick.template
  const fixes = CHALLENGES.filter((c) => ws.answers.challenges.includes(c.id))

  function build() {
    update((s) => {
      const w = s.workspaces[ws!.id]
      w.draft = preview
      w.seedOnPublish = sample
    })
    nav('/builder')
  }

  return (
    <div className="wizard">
      <div className="wizard-top">
        <Logo />
        <span className="pill"><Sparkles size={14} /> Your suggested system</span>
      </div>
      <div className="wizard-body">
        <h1>We recommend <span style={{ color: t.gradient[1] }}>{lang === 'ar' ? t.nameAr : t.name}</span></h1>
        <p className="muted">Built from your answers. Next you’ll shape it with drag and drop — nothing here is fixed.</p>
        <div className="suggest-grid">
          <div className="stack">
            <div className="best" style={{ background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` }}>
              <div className="score">
                <div className="ring" style={{ ['--p' as string]: pick.score }}><span>{pick.score}%</span></div>
                <div className="tiny" style={{ marginTop: 4, opacity: 0.85 }}>match</div>
              </div>
              <Icon name={t.icon} size={34} />
              <h2 style={{ marginTop: 10, maxWidth: '75%' }}>{t.name}</h2>
              <p style={{ opacity: 0.9, maxWidth: '75%' }}>{t.tagline}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', lineHeight: 1.9 }}>
                {pick.reasons.map((r) => <li key={r}><Check size={16} /> {r}</li>)}
              </ul>
              <b className="small">{preview.modules.length} modules ready</b>
              <div className="modchips">
                {preview.modules.map((m) => <span key={m.id}><Icon name={m.icon} size={14} /> {m.name}</span>)}
              </div>
            </div>
            <div className="card">
              <h2><Wand2 size={18} /> Tailored for {ws.answers.companyName}</h2>
              <div className="form-grid">
                <Stat n={preview.reports.length} label="dashboard reports" />
                <Stat n={preview.workflows.length} label="automations" />
                <Stat n={preview.roles.length} label="team roles" />
                <Stat n={preview.modules.reduce((s, m) => s + m.fields.length, 0)} label="fields" />
              </div>
              {fixes.length > 0 && (
                <>
                  <p className="q">Fixes for your challenges</p>
                  <ul className="stack" style={{ padding: 0, listStyle: 'none' }}>
                    {fixes.map((c) => (
                      <li key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
                        <Check size={16} color="#10b981" style={{ marginTop: 3 }} />
                        <span className="grow"><b>{c.label}</b><br /><span className="muted small">{c.fix}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          <div className="stack">
            <b>Other options</b>
            {ranked.map((r) => (
              <button key={r.template.id} type="button" className={`alt ${r.template.id === chosen ? 'on' : ''}`} onClick={() => setChosen(r.template.id)}>
                <span className="ic" style={{ background: `linear-gradient(135deg, ${r.template.gradient[0]}, ${r.template.gradient[1]})` }}><Icon name={r.template.icon} size={20} /></span>
                <span className="grow">
                  <b>{lang === 'ar' ? r.template.nameAr : r.template.name}</b>
                  <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${r.score}%` }} /></div>
                </span>
                <b className="small">{r.score}%</b>
              </button>
            ))}
            <label className="inline card" style={{ padding: 14 }}>
              <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
              <span><b>Fill with sample data</b><br /><span className="muted small">See dashboards and pipelines working right away. Remove it any time from Settings.</span></span>
            </label>
          </div>
        </div>
      </div>
      <div className="wizard-foot">
        <button className="secondary" onClick={() => nav('/onboarding')}><ArrowLeft size={16} /> Change answers</button>
        <button className="glow big" onClick={build}><Rocket size={18} /> Open the builder</button>
      </div>
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{n}</div>
      <div className="muted small">{label}</div>
    </div>
  )
}
````

### `crm-builder/src/styles.css`

````css
:root {
  --bg: #f5f6fb;
  --surface: #ffffff;
  --surface-2: #f8f9fd;
  --text: #0b1020;
  --text-2: #3b4256;
  --muted: #6b7280;
  --border: #e6e8f0;
  --border-strong: #cfd3e1;
  --primary: #5b5bf6;
  --primary-600: #4338ca;
  --primary-50: #eef0ff;
  --primary-100: #dfe3ff;
  --accent: #ec4899;
  --teal: #14b8a6;
  --danger: #dc2626;
  --success: #059669;
  --warning: #d97706;
  --radius: 14px;
  --shadow: 0 1px 2px rgb(16 24 40 / 0.05), 0 1px 3px rgb(16 24 40 / 0.06);
  --shadow-lg: 0 18px 50px -12px rgb(30 27 75 / 0.25);
  --hero: radial-gradient(1200px 600px at 10% -10%, #7c3aed55, transparent 60%), radial-gradient(900px 500px at 100% 0%, #06b6d455, transparent 55%), linear-gradient(160deg, #0b0b2b 0%, #141441 50%, #0f172a 100%);
  font-family: 'Inter', 'Cairo', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
[dir='rtl'] { font-family: 'Cairo', 'Inter', system-ui, sans-serif; }

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
h2 { font-size: 1.15rem; margin: 0 0 0.75rem; letter-spacing: -0.01em; }
h3 { font-size: 1rem; margin: 0 0 0.4rem; }
p { line-height: 1.55; }
a { color: var(--primary); text-decoration: none; }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.tiny { font-size: 0.75rem; }
.grow { flex: 1; min-width: 0; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.between { justify-content: space-between; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.center { text-align: center; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.num { text-align: end; font-variant-numeric: tabular-nums; }

/* ---------- controls ---------- */
input, select, textarea {
  width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 10px;
  background: var(--surface); color: var(--text); transition: border-color .15s, box-shadow .15s;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px var(--primary-100); }
input[type='checkbox'] { width: auto; accent-color: var(--primary); }
input[type='color'] { padding: 2px; height: 38px; width: 48px; }
textarea { resize: vertical; min-height: 80px; }
label.field { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: 0.88rem; color: var(--text-2); }
label.inline { display: flex; flex-direction: row; align-items: center; gap: 8px; font-weight: 500; }

button, .btn {
  font: inherit; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 16px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; white-space: nowrap;
  background: var(--primary); color: #fff; transition: transform .08s, background .15s, box-shadow .15s;
}
button:hover, .btn:hover { background: var(--primary-600); }
button:active { transform: translateY(1px); }
button:disabled { opacity: .5; cursor: not-allowed; }
button.secondary, .btn.secondary { background: var(--surface); color: var(--text); border-color: var(--border-strong); }
button.secondary:hover { background: var(--surface-2); }
button.ghost { background: transparent; color: var(--text-2); padding: 8px 10px; }
button.ghost:hover { background: var(--primary-50); color: var(--primary-600); }
button.danger { background: #fff; color: var(--danger); border-color: #fecaca; }
button.danger:hover { background: #fef2f2; }
button.success { background: var(--success); }
button.big, .btn.big { padding: 14px 24px; font-size: 1.05rem; border-radius: 12px; }
button.glow, .btn.glow { background: linear-gradient(135deg, #6366f1, #a855f7 50%, #ec4899); box-shadow: 0 10px 30px -8px #a855f7aa; }
button.glow:hover, .btn.glow:hover { filter: brightness(1.08); }
button.icon { padding: 7px; border-radius: 8px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; background: var(--primary-50); color: var(--primary-600); }
.pill.green { background: #ecfdf5; color: #047857; }
.pill.red { background: #fef2f2; color: #b91c1c; }
.pill.amber { background: #fffbeb; color: #b45309; }
.pill.gray { background: #f1f5f9; color: #475569; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-inline-end: 8px; flex-shrink: 0; }
.error-box { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 14px; border-radius: 10px; font-size: 0.9rem; }
.ok-box { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 10px 14px; border-radius: 10px; font-size: 0.9rem; }
.toast { position: fixed; inset-inline-end: 20px; bottom: 20px; z-index: 100; max-width: 420px; box-shadow: var(--shadow-lg); animation: rise .25s ease; }
@keyframes rise { from { transform: translateY(12px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes spin { to { transform: rotate(360deg) } }
@keyframes float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }

/* ---------- landing ---------- */
.landing { background: var(--hero); color: #e5e7ff; min-height: 100vh; overflow: hidden; }
.landing a { color: inherit; }
.nav { display: flex; align-items: center; justify-content: space-between; padding: 20px clamp(16px, 5vw, 64px); }
.logo { display: inline-flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.25rem; letter-spacing: -0.02em; color: inherit; }
.logo-mark { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: linear-gradient(135deg, #6366f1, #ec4899); color: #fff; box-shadow: 0 6px 20px -4px #a855f7; }
.hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 40px; align-items: center; padding: 40px clamp(16px, 5vw, 64px) 80px; max-width: 1320px; margin: 0 auto; }
.hero h1 { font-size: clamp(2.2rem, 5vw, 3.8rem); color: #fff; letter-spacing: -0.035em; line-height: 1.05; }
.hero h1 .grad { background: linear-gradient(90deg, #a5b4fc, #f0abfc, #67e8f9); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero p.lead { font-size: 1.15rem; color: #c7caf0; max-width: 560px; }
.hero .row { margin-top: 26px; }
.hero .btn.secondary { background: #ffffff12; color: #fff; border-color: #ffffff30; }
.trust { margin-top: 28px; display: flex; gap: 22px; flex-wrap: wrap; color: #a5a8d8; font-size: 0.88rem; }
.trust span { display: inline-flex; gap: 6px; align-items: center; }
.mock { position: relative; border-radius: 20px; background: #ffffff10; border: 1px solid #ffffff22; padding: 14px; backdrop-filter: blur(12px); box-shadow: 0 40px 80px -20px #000a; animation: float 7s ease-in-out infinite; }
.mock-inner { background: #fff; border-radius: 12px; color: var(--text); padding: 14px; display: grid; grid-template-columns: 120px 1fr; gap: 12px; min-height: 330px; }
.mock-side { display: flex; flex-direction: column; gap: 6px; }
.mock-side span { height: 26px; border-radius: 7px; background: #f1f2fb; display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 0.72rem; font-weight: 600; color: #4b5563; }
.mock-side span.on { background: var(--primary-50); color: var(--primary-600); }
.mock-cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.mock-col { background: #f7f8fc; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.mock-col b { font-size: 0.7rem; color: var(--muted); }
.mock-card { background: #fff; border-radius: 8px; padding: 8px; font-size: 0.72rem; box-shadow: var(--shadow); border-inline-start: 3px solid var(--c, #6366f1); }
.mock-float { position: absolute; background: #fff; color: var(--text); border-radius: 12px; padding: 10px 14px; box-shadow: var(--shadow-lg); font-size: 0.8rem; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.section { padding: 80px clamp(16px, 5vw, 64px); max-width: 1320px; margin: 0 auto; }
.section h2.big { font-size: clamp(1.7rem, 3.4vw, 2.6rem); color: #fff; text-align: center; letter-spacing: -0.03em; }
.section p.sub { text-align: center; color: #b4b7e6; max-width: 680px; margin: 0 auto 40px; }
.steps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
.step-card { background: #ffffff0d; border: 1px solid #ffffff1f; border-radius: 18px; padding: 20px; }
.step-card .n { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; font-weight: 800; color: #fff; margin-bottom: 12px; }
.step-card h3 { color: #fff; }
.step-card p { color: #b4b7e6; font-size: 0.9rem; margin: 0; }
.tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.tpl { border-radius: 18px; padding: 20px; color: #fff; position: relative; overflow: hidden; min-height: 150px; }
.tpl::after { content: ''; position: absolute; inset: auto -30px -40px auto; width: 140px; height: 140px; border-radius: 50%; background: #ffffff22; }
.tpl h3 { color: #fff; margin-top: 10px; }
.tpl p { margin: 0; opacity: .88; font-size: 0.88rem; }
.guard-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.guard { background: #ffffff0d; border: 1px solid #ffffff1f; border-radius: 18px; padding: 22px; }
.guard h3 { color: #fff; display: flex; gap: 10px; align-items: center; }
.guard p { color: #b4b7e6; margin: 0; font-size: 0.92rem; }
.cta { text-align: center; background: linear-gradient(135deg, #4f46e5, #a855f7 55%, #ec4899); border-radius: 28px; padding: 56px 24px; color: #fff; }
.cta h2 { font-size: clamp(1.6rem, 3vw, 2.4rem); }
.footer { text-align: center; color: #8a8dc0; padding: 30px; font-size: 0.85rem; }

/* ---------- auth & onboarding ---------- */
.auth { min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; }
.auth-art { background: var(--hero); color: #fff; padding: 48px; display: flex; flex-direction: column; justify-content: space-between; }
.auth-art h2 { font-size: 2rem; color: #fff; letter-spacing: -0.03em; }
.auth-form { display: grid; place-items: center; padding: 32px 16px; }
.auth-form form { width: min(420px, 100%); display: flex; flex-direction: column; gap: 14px; }

.wizard { min-height: 100vh; background: linear-gradient(180deg, #eef0ff 0%, var(--bg) 320px); }
.wizard-top { display: flex; align-items: center; justify-content: space-between; padding: 18px clamp(16px, 4vw, 40px); }
.progress { display: flex; gap: 6px; align-items: center; flex: 1; max-width: 640px; margin: 0 24px; }
.progress span { flex: 1; height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; }
.progress span.on { background: linear-gradient(90deg, #6366f1, #a855f7); }
.wizard-body { max-width: 980px; margin: 0 auto; padding: 16px clamp(16px, 4vw, 40px) 120px; animation: fade .3s ease; }
.wizard-body h1 { font-size: clamp(1.6rem, 3vw, 2.3rem); }
.wizard-foot { position: fixed; bottom: 0; inset-inline: 0; background: #ffffffe8; backdrop-filter: blur(8px); border-top: 1px solid var(--border); padding: 14px clamp(16px, 4vw, 40px); display: flex; justify-content: space-between; z-index: 5; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-top: 18px; }
.tile { background: var(--surface); border: 2px solid var(--border); border-radius: 16px; padding: 16px; cursor: pointer; text-align: start; color: var(--text); display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 8px; white-space: normal; transition: border-color .15s, transform .15s, box-shadow .15s; font-weight: 500; }
.tile:hover { background: var(--surface); border-color: var(--primary-100); transform: translateY(-2px); box-shadow: var(--shadow-lg); }
.tile.on { border-color: var(--primary); background: var(--primary-50); box-shadow: 0 0 0 4px var(--primary-100); }
.tile .ic { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: #fff; }
.tile b { font-size: 0.98rem; }
.tile small { color: var(--muted); font-weight: 400; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { white-space: normal; background: var(--surface); color: var(--text-2); border: 1.5px solid var(--border-strong); border-radius: 999px; padding: 8px 14px; font-weight: 600; font-size: 0.9rem; }
.chip:hover { background: var(--primary-50); color: var(--primary-600); }
.chip.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.q { margin: 26px 0 10px; font-weight: 700; color: var(--text); }
.seg { display: inline-flex; background: #eceef7; border-radius: 12px; padding: 4px; gap: 4px; flex-wrap: wrap; }
.seg button { background: transparent; color: var(--text-2); padding: 8px 14px; }
.seg button.on { background: #fff; color: var(--primary-600); box-shadow: var(--shadow); }
.team-row { display: grid; grid-template-columns: 1fr 180px 110px 40px; gap: 10px; align-items: center; }
.stepper { display: flex; align-items: center; border: 1px solid var(--border-strong); border-radius: 10px; overflow: hidden; }
.stepper button { border-radius: 0; padding: 8px 12px; background: var(--surface-2); color: var(--text); }
.stepper span { flex: 1; text-align: center; font-weight: 700; }
.analyse { min-height: 70vh; display: grid; place-items: center; text-align: center; }
.orb { width: 120px; height: 120px; border-radius: 50%; background: conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #06b6d4, #6366f1); animation: spin 2.4s linear infinite; display: grid; place-items: center; margin: 0 auto 28px; box-shadow: 0 0 60px #a855f788; }
.orb::after { content: ''; width: 92px; height: 92px; border-radius: 50%; background: var(--bg); }
.analyse li { list-style: none; padding: 6px 0; animation: fade .4s ease both; display: flex; gap: 8px; justify-content: center; align-items: center; }

.suggest-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; margin-top: 18px; }
.best { border-radius: 22px; padding: 26px; color: #fff; position: relative; overflow: hidden; }
.best h2 { color: #fff; font-size: 1.6rem; }
.best .score { position: absolute; top: 22px; inset-inline-end: 22px; text-align: center; }
.ring { --p: 80; width: 86px; height: 86px; border-radius: 50%; background: conic-gradient(#fff calc(var(--p) * 1%), #ffffff33 0); display: grid; place-items: center; }
.ring > span { width: 70px; height: 70px; border-radius: 50%; background: #0003; display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; }
.modchips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.modchips span { background: #ffffff22; padding: 5px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; display: inline-flex; gap: 6px; align-items: center; }
.alt { white-space: normal; justify-content: flex-start; display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 14px; border: 2px solid var(--border); background: var(--surface); cursor: pointer; color: var(--text); text-align: start; font-weight: 500; width: 100%; }
.alt:hover { background: var(--surface); border-color: var(--primary-100); }
.alt.on { border-color: var(--primary); background: var(--primary-50); }
.alt .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
.meter { height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; }
.meter > i { display: block; height: 100%; background: linear-gradient(90deg, #6366f1, #a855f7); }

/* ---------- builder ---------- */
.builder { display: grid; grid-template-rows: auto 1fr; grid-template-columns: minmax(0, 1fr); height: 100vh; }
.btop { display: flex; align-items: center; gap: 14px; padding: 10px 18px; background: #0f1035; color: #fff; }
.btop .logo { font-size: 1.05rem; }
.btabs { display: flex; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.btop > :not(.btabs) { flex-shrink: 0; }
.btabs button { background: transparent; color: #b9bbe6; padding: 8px 10px; font-weight: 600; font-size: 0.9rem; }
.btabs button:hover { background: #ffffff14; color: #fff; }
.btabs button.on { background: #ffffff1f; color: #fff; }
.btabs .count { background: #ef4444; color: #fff; border-radius: 999px; font-size: 0.7rem; padding: 0 6px; }
.health-btn { background: #ffffff14; color: #fff; border: 1px solid #ffffff22; }
.health-btn:hover { background: #ffffff22; }
.bbody { overflow: hidden; display: grid; }
.three { display: grid; grid-template-columns: 240px minmax(0, 1fr) 320px; height: 100%; overflow: hidden; }
.two { display: grid; grid-template-columns: 270px minmax(0, 1fr); height: 100%; overflow: hidden; }
.pane { overflow-y: auto; padding: 16px; }
.pane.side { background: var(--surface); border-inline-end: 1px solid var(--border); }
.pane.props { background: var(--surface); border-inline-start: 1px solid var(--border); }
.pane h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 18px 0 8px; }
.pane h3:first-child { margin-top: 0; }
.mod-item { white-space: normal; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; cursor: pointer; background: transparent; color: var(--text); font-weight: 600; width: 100%; justify-content: flex-start; }
.mod-item:hover { background: var(--surface-2); }
.mod-item.on { background: var(--primary-50); color: var(--primary-600); }
.mod-item .badge { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
.mod-item .err { margin-inline-start: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
.palette { display: flex; flex-wrap: wrap; gap: 6px; }
.palette-bar { position: sticky; top: -16px; z-index: 4; max-width: 820px; margin: -16px auto 16px; padding: 12px 14px; background: #ffffffee; backdrop-filter: blur(8px); border: 1px solid var(--border); border-top: none; border-radius: 0 0 16px 16px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 8px; }
.pal-item { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-radius: 10px; border: 1px dashed var(--border-strong); background: var(--surface-2); font-size: 0.8rem; font-weight: 600; cursor: grab; user-select: none; color: var(--text-2); touch-action: none; }
.pal-item:hover { border-color: var(--primary); color: var(--primary-600); background: var(--primary-50); }
.canvas { background-image: radial-gradient(#d9dcef 1px, transparent 1px); background-size: 18px 18px; }
.form-preview { max-width: 820px; margin: 0 auto; background: var(--surface); border-radius: 18px; box-shadow: var(--shadow-lg); border: 1px solid var(--border); overflow: hidden; }
.form-head { padding: 18px 22px; color: #fff; display: flex; align-items: center; gap: 12px; }
.form-head input { background: #ffffff26; border-color: #ffffff40; color: #fff; font-weight: 700; font-size: 1.1rem; max-width: 280px; }
.form-head input::placeholder { color: #ffffffaa; }
.drop-zone { padding: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; min-height: 200px; transition: background .15s; }
.drop-zone.over { background: var(--primary-50); }
.fcard { position: relative; border: 1.5px solid var(--border); border-radius: 12px; padding: 10px 12px 12px; background: var(--surface); cursor: pointer; transition: border-color .12s, box-shadow .12s; }
.fcard:hover { border-color: var(--primary-100); }
.fcard.sel { border-color: var(--primary); box-shadow: 0 0 0 4px var(--primary-100); }
.fcard.w2 { grid-column: span 2; }
.fcard.dragging { opacity: .4; }
.fcard .fl { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; font-weight: 700; color: var(--text-2); margin-bottom: 6px; }
.fcard .fake { height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); display: flex; align-items: center; padding: 0 10px; color: var(--muted); font-size: 0.82rem; gap: 6px; overflow: hidden; }
.fcard .grip { cursor: grab; color: var(--muted); touch-action: none; }
.fcard .tags { margin-inline-start: auto; display: flex; gap: 4px; }
.fcard .lock { color: var(--muted); }
.ghost-card { padding: 10px 14px; border-radius: 12px; background: #fff; border: 2px solid var(--primary); box-shadow: var(--shadow-lg); font-weight: 700; display: inline-flex; gap: 8px; align-items: center; }
.opt-row { display: grid; grid-template-columns: 28px 1fr 32px; gap: 6px; align-items: center; margin-bottom: 6px; }
.opt-row input[type='color'] { width: 28px; height: 28px; border: none; padding: 0; background: none; }
.props .field { margin-bottom: 12px; }
.props hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
.note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 10px 12px; font-size: 0.83rem; }
.info { background: var(--primary-50); border: 1px solid var(--primary-100); color: var(--primary-600); border-radius: 10px; padding: 10px 12px; font-size: 0.83rem; }

.stage-board { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 10px; }
.stage-card { width: 220px; flex-shrink: 0; background: var(--surface); border-radius: 14px; border: 1px solid var(--border); border-top: 5px solid var(--c); padding: 12px; box-shadow: var(--shadow); }
.stage-card .field { margin-top: 8px; }
.funnel-preview { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.funnel-preview .closed { display: flex; gap: 6px; width: 100%; margin-top: 6px; }
.funnel-preview .closed div { flex: 1; }
.funnel-preview div:not(.closed) { height: 30px; border-radius: 6px; color: #fff; font-size: 0.78rem; font-weight: 700; display: grid; place-items: center; }

.report-designer { display: grid; grid-template-columns: 260px 1fr; gap: 16px; }
.wells { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.well { border: 2px dashed var(--border-strong); border-radius: 12px; padding: 10px; min-height: 64px; background: var(--surface-2); transition: all .15s; }
.well.over { border-color: var(--primary); background: var(--primary-50); }
.well b { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 6px; }
.well .token { display: inline-flex; align-items: center; gap: 6px; background: var(--primary); color: #fff; border-radius: 8px; padding: 4px 8px; font-size: 0.82rem; font-weight: 600; margin: 2px; }
.well .token button { background: none; padding: 0; color: #fff; }
.chart-types { display: flex; gap: 6px; flex-wrap: wrap; }
.chart-types button { background: var(--surface); color: var(--text-2); border: 1.5px solid var(--border); padding: 8px 10px; }
.chart-types button.on { border-color: var(--primary); color: var(--primary-600); background: var(--primary-50); }

.flow { display: flex; flex-direction: column; align-items: stretch; gap: 0; max-width: 640px; }
.flow-node { border-radius: 14px; padding: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); border-inline-start: 5px solid var(--c); }
.flow-node .tag { font-size: 0.7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--c); }
.flow-line { width: 2px; height: 22px; background: var(--border-strong); margin-inline-start: 32px; }

.matrix { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.88rem; }
.matrix th, .matrix td { padding: 9px 10px; border-bottom: 1px solid var(--border); text-align: center; }
.matrix th:first-child, .matrix td:first-child { text-align: start; }
.matrix thead th { position: sticky; top: 0; background: var(--surface); font-size: 0.75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }

.health { position: fixed; inset-block: 0; inset-inline-end: 0; width: min(440px, 100%); background: var(--surface); z-index: 40; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; animation: fade .2s; }
.health-head { padding: 18px; display: flex; gap: 14px; align-items: center; border-bottom: 1px solid var(--border); }
.health-ring { --p: 100; --c: #10b981; width: 74px; height: 74px; border-radius: 50%; background: conic-gradient(var(--c) calc(var(--p) * 1%), var(--border) 0); display: grid; place-items: center; flex-shrink: 0; }
.health-ring span { width: 58px; height: 58px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-weight: 800; }
.issue { display: flex; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--border); cursor: pointer; background: none; color: var(--text); text-align: start; font-weight: 500; width: 100%; border-radius: 0; align-items: flex-start; justify-content: flex-start; white-space: normal; }
.issue:hover { background: var(--surface-2); }
.overlay { position: fixed; inset: 0; background: #0b102066; z-index: 30; animation: fade .2s; }
.modal { position: fixed; z-index: 50; inset: 0; display: grid; place-items: center; padding: 16px; }
.modal > .card { width: min(560px, 100%); max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow-lg); animation: rise .2s; }

/* ---------- workspace ---------- */
.app { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
.sidebar { background: #0f1035; color: #c9cbf0; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.sidebar .logo { color: #fff; margin: 4px 8px 16px; }
.sidebar a { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; color: #c9cbf0; font-weight: 600; font-size: 0.92rem; }
.sidebar a:hover { background: #ffffff12; color: #fff; }
.sidebar a.active { background: linear-gradient(90deg, #6366f1aa, #6366f122); color: #fff; }
.sidebar .sect { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .1em; color: #7d80b8; margin: 14px 10px 4px; }
.sidebar .badge { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; color: #fff; }
.sidebar .cnt { margin-inline-start: auto; font-size: 0.75rem; color: #8b8ec4; }
.main { min-width: 0; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 24px; background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
.page { padding: 22px 24px 60px; max-width: 1400px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.page-head h1 { display: flex; align-items: center; gap: 12px; margin: 0; }
.page-head .badge { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; }
.dash { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.dash .card.s2 { grid-column: span 2; }
.dash .card.s3 { grid-column: span 3; }
.dash .card h2 { font-size: 0.92rem; color: var(--text-2); display: flex; justify-content: space-between; }
.kpi { position: relative; min-height: 96px; }
.kpi-value { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; }
.kpi-sub { color: var(--muted); font-size: 0.85rem; }
.kpi-wave { position: absolute; inset: auto 0 -18px 0; width: 100%; height: 50px; }
.chart-svg { width: 100%; height: 220px; }
.chart-svg .grid { stroke: var(--border); }
.chart-svg .axis { font-size: 11px; fill: var(--muted); }
.chart-empty { color: var(--muted); padding: 30px 10px; text-align: center; font-size: 0.9rem; }
.hbars, .funnel { display: flex; flex-direction: column; gap: 8px; }
.hbar-row { display: grid; grid-template-columns: minmax(80px, 30%) 1fr auto; gap: 10px; align-items: center; font-size: 0.85rem; }
.hbar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
.hbar-track { height: 18px; border-radius: 6px; background: var(--surface-2); overflow: hidden; display: flex; }
.hbar-fill { height: 100%; border-radius: 6px; transition: width .4s; }
.hbar-value { font-weight: 700; text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 56px; }
.funnel .hbar-track { background: transparent; }
.pie { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: center; }
.pie-total { font-size: 20px; font-weight: 800; fill: var(--text); }
.pie-sub { font-size: 11px; fill: var(--muted); }
.legend { list-style: none; margin: 0; padding: 0; font-size: 0.84rem; display: flex; flex-direction: column; gap: 6px; min-width: 140px; }
.legend li { display: flex; align-items: center; }
.legend b { margin-inline-start: auto; padding-inline-start: 10px; }
.chart-table table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.chart-table td { padding: 7px 4px; border-bottom: 1px solid var(--border); }
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: auto; box-shadow: var(--shadow); }
table.data { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
table.data th { text-align: start; font-size: 0.74rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 11px 14px; border-bottom: 1px solid var(--border); background: var(--surface-2); cursor: pointer; white-space: nowrap; user-select: none; }
table.data td { padding: 11px 14px; border-bottom: 1px solid var(--border); white-space: nowrap; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
table.data tr:hover td { background: var(--primary-50); cursor: pointer; }
table.data tfoot td { font-weight: 800; background: var(--surface-2); }
.kanban { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px; align-items: flex-start; }
.kcol { width: 280px; flex-shrink: 0; background: #eceef7; border-radius: 14px; padding: 10px; transition: background .15s; }
.kcol.over { background: var(--primary-100); }
.kcol-head { display: flex; align-items: center; gap: 8px; padding: 4px 4px 10px; font-weight: 700; font-size: 0.9rem; }
.kcol-head .sum { margin-inline-start: auto; color: var(--muted); font-size: 0.78rem; font-weight: 600; }
.kcard { background: var(--surface); border-radius: 11px; padding: 11px 12px; margin-bottom: 8px; box-shadow: var(--shadow); border-inline-start: 4px solid var(--c); cursor: grab; touch-action: none; }
.kcard b { display: block; font-size: 0.9rem; margin-bottom: 4px; }
.kcard .meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.8rem; gap: 6px; }
.kcard.dragging { opacity: .4; }
.record-grid { display: grid; grid-template-columns: 1fr 340px; gap: 16px; align-items: start; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-grid .w2 { grid-column: span 2; }
.ro-value { padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px dashed var(--border-strong); font-weight: 600; }
.stage-path { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
.stage-path button { flex: 1; min-width: 110px; background: #eceef7; color: var(--text-2); border-radius: 8px; padding: 9px 10px; font-size: 0.84rem; clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%); }
.stage-path button.done { background: color-mix(in srgb, var(--c) 30%, white); color: var(--text); }
.stage-path button.cur { background: var(--c); color: #fff; }
.lines { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.lines th { text-align: start; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 8px 6px; border-bottom: 1px solid var(--border); }
.lines td { padding: 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.lines input, .lines select { padding: 7px 8px; }
.totals { margin-inline-start: auto; width: min(320px, 100%); display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin-top: 14px; font-variant-numeric: tabular-nums; }
.totals .grand { font-size: 1.2rem; font-weight: 800; border-top: 2px solid var(--text); padding-top: 6px; }
.timeline { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; }
.timeline li { padding: 8px 0 8px 16px; border-inline-start: 2px solid var(--border); position: relative; }
.timeline li::before { content: ''; position: absolute; inset-inline-start: -6px; top: 12px; width: 10px; height: 10px; border-radius: 50%; background: var(--primary); }
.empty { text-align: center; padding: 50px 20px; color: var(--muted); }
.empty .big-ic { width: 70px; height: 70px; border-radius: 20px; display: grid; place-items: center; margin: 0 auto 14px; color: #fff; }
.notif { position: absolute; top: 44px; inset-inline-end: 0; width: 340px; max-height: 420px; overflow-y: auto; z-index: 30; padding: 0; }
.notif div { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.86rem; }
.notif div.unread { background: var(--primary-50); }
.print-doc { background: #fff; max-width: 820px; margin: 0 auto; padding: 40px; border: 1px solid var(--border); border-radius: 12px; }
.tabs-inline { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.tabs-inline button { background: none; color: var(--muted); border-radius: 0; border-bottom: 2px solid transparent; padding: 10px 14px; }
.tabs-inline button.on { color: var(--primary-600); border-bottom-color: var(--primary); }

@media print {
  .sidebar, .topbar, .no-print { display: none !important; }
  .app { display: block; }
  .print-doc { border: none; }
}

@media (max-width: 1100px) {
  .hero { grid-template-columns: 1fr; }
  .steps { grid-template-columns: repeat(2, 1fr); }
  .guard-grid { grid-template-columns: 1fr; }
  .three { grid-template-columns: 220px 1fr; }
  .three .props { position: fixed; inset-inline-end: 0; top: 56px; bottom: 0; width: 330px; z-index: 20; box-shadow: var(--shadow-lg); }
  .dash { grid-template-columns: repeat(2, 1fr); }
  .record-grid { grid-template-columns: 1fr; }
  .suggest-grid { grid-template-columns: 1fr; }
  .report-designer { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .auth { grid-template-columns: 1fr; }
  .auth-art { display: none; }
  .app { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position: static; height: auto; flex-direction: row; overflow-x: auto; padding: 8px; }
  .sidebar a { white-space: nowrap; flex-shrink: 0; }
  .topbar { flex-wrap: wrap; padding: 10px 16px; gap: 8px; }
  .topbar > div:first-child { max-width: none !important; flex-basis: 100%; }
  .topbar select { max-width: 60vw; }
  .page-head h1 { font-size: 1.3rem; }
  .hbar-row { grid-template-columns: minmax(70px, 34%) 1fr auto; }
  .nav .btn.secondary, .nav button.ghost { display: none; }
  .hero { padding-top: 10px; }
  .kanban .kcol { width: 82vw; }
  .builder { height: auto; min-height: 100vh; }
  .btop { flex-wrap: wrap; }
  .btabs { flex-basis: 100%; order: 3; }
  .wizard-foot { gap: 8px; padding: 10px 12px; }
  .wizard-foot button { padding: 10px 12px; font-size: 0.92rem; }
  .progress { margin: 0 10px; }
  .sidebar .sect, .sidebar .logo { display: none; }
  .three, .two { grid-template-columns: 1fr; overflow-y: auto; }
  .three .props { position: static; width: auto; box-shadow: none; }
  .pane.side { border: none; }
  .drop-zone, .form-grid { grid-template-columns: 1fr; }
  .fcard.w2, .form-grid .w2 { grid-column: auto; }
  .dash { grid-template-columns: 1fr; }
  .dash .card.s2, .dash .card.s3 { grid-column: auto; }
  .steps { grid-template-columns: 1fr; }
  .team-row { grid-template-columns: 1fr 1fr; }
  .wells { grid-template-columns: 1fr; }
  .page { padding: 16px; }
  .mock-inner { grid-template-columns: 1fr; }
  .mock-side { display: none; }
}

/* calendar view */
.cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.cal-h { font-size: 0.72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); text-align: center; padding-bottom: 4px; }
.cal-d { min-height: 96px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 6px; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
.cal-d.today { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-100); }
.cal-n { font-size: 0.78rem; font-weight: 700; color: var(--text-2); }
.cal-ev { font-size: 0.72rem; background: #fff; border-inline-start: 3px solid; border-radius: 5px; padding: 2px 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; box-shadow: var(--shadow); }
.kcard.rotting { background: #fff7f7; }
@media (max-width: 760px) { .cal-d { min-height: 60px; } .cal-ev { display: none; } .cal-d:has(.cal-ev) .cal-n { color: var(--primary); text-decoration: underline; } }
````

### `crm-builder/src/workspace/Accounting.tsx`

````tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useApp } from './useApp'
import { ageing, canPost, money, round2, trialBalance } from '../lib/engine'
import { CHART } from '../lib/types'

export default function Accounting() {
  const { ws, schema, user } = useApp()
  const [tab, setTab] = useState<'tb' | 'ageing' | 'journal' | 'payments'>('tb')
  if (!canPost({ schema, user })) return <div className="page">Only Admin and finance roles can see accounting.</div>
  const cur = schema.company.currency
  const tb = trialBalance(ws)
  const dr = round2(tb.reduce((s, [, r]) => s + r.debit, 0))
  const cr = round2(tb.reduce((s, [, r]) => s + r.credit, 0))
  const bal = (code: keyof typeof CHART) => {
    const r = tb.find(([c]) => c === code)?.[1]
    if (!r) return 0
    const t = CHART[code].type
    return round2(t === 'asset' || t === 'expense' ? r.debit - r.credit : r.credit - r.debit)
  }
  const revenue = bal('4000')
  const cogs = bal('5000') + bal('5100')
  const vatDue = round2(bal('2200') - bal('1400'))
  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#0ea5e9' }}><Calculator size={20} /></span>Accounting</h1></div>
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="card"><h2>Revenue</h2><div className="kpi-value">{money(revenue, cur)}</div></div>
        <div className="card"><h2>Gross profit</h2><div className="kpi-value" style={{ color: revenue - cogs >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(revenue - cogs, cur)}</div><div className="kpi-sub">{revenue ? Math.round(((revenue - cogs) / revenue) * 100) : 0}% margin</div></div>
        <div className="card"><h2>Customers owe you</h2><div className="kpi-value">{money(bal('1200'), cur)}</div></div>
        <div className="card"><h2>VAT payable (output − input)</h2><div className="kpi-value">{money(vatDue, cur)}</div></div>
      </div>
      <div className={dr === cr ? 'ok-box row' : 'error-box row'} style={{ marginBottom: 14 }}>
        {dr === cr ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        {dr === cr ? `Books balance: total debits = total credits = ${money(dr, cur)} across ${ws.data.journal.length} journal entries.` : `Books do not balance (${dr} vs ${cr}). Contact support.`}
      </div>
      <div className="tabs-inline">
        <button className={tab === 'tb' ? 'on' : ''} onClick={() => setTab('tb')}>Trial balance</button>
        <button className={tab === 'ageing' ? 'on' : ''} onClick={() => setTab('ageing')}>Ageing</button>
        <button className={tab === 'journal' ? 'on' : ''} onClick={() => setTab('journal')}>Journal</button>
        <button className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>Payments</button>
      </div>
      {tab === 'tb' && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {tb.map(([code, r]) => <tr key={code}><td><span className="mono">{code}</span> {CHART[code].name}</td><td className="muted">{CHART[code].type}</td><td className="num">{money(r.debit, cur)}</td><td className="num">{money(r.credit, cur)}</td><td className="num"><b>{money(bal(code), cur)}</b></td></tr>)}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td className="num">{money(dr, cur)}</td><td className="num">{money(cr, cur)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      {tab === 'ageing' && (
        <div className="stack">
          {(['invoices', 'purchases'] as const).map((role) => {
            const rows = ageing(ws, schema, role)
            const sum = (k: 'current' | 'd30' | 'd60' | 'd90' | 'over90' | 'total') => round2(rows.reduce((s, r) => s + r[k], 0))
            return (
              <div key={role}>
                <h2>{role === 'invoices' ? 'Who owes us (receivables)' : 'Who we owe (payables)'}</h2>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>{role === 'invoices' ? 'Customer' : 'Supplier'}</th><th className="num">Not yet due</th><th className="num">1–30 days</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">90+ days</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={7} className="muted">Nothing outstanding.</td></tr>}
                      {rows.map((r) => (
                        <tr key={r.party}><td><Link to={`/app/r/${r.party}`}>{r.name}</Link></td><td className="num">{money(r.current, cur)}</td><td className="num">{money(r.d30, cur)}</td><td className="num" style={{ color: r.d60 ? 'var(--warning)' : undefined }}>{money(r.d60, cur)}</td><td className="num" style={{ color: r.d90 ? 'var(--danger)' : undefined }}>{money(r.d90, cur)}</td><td className="num" style={{ color: r.over90 ? 'var(--danger)' : undefined, fontWeight: r.over90 ? 800 : undefined }}>{money(r.over90, cur)}</td><td className="num"><b>{money(r.total, cur)}</b></td></tr>
                      ))}
                    </tbody>
                    {rows.length > 0 && <tfoot><tr><td>Total</td><td className="num">{money(sum('current'), cur)}</td><td className="num">{money(sum('d30'), cur)}</td><td className="num">{money(sum('d60'), cur)}</td><td className="num">{money(sum('d90'), cur)}</td><td className="num">{money(sum('over90'), cur)}</td><td className="num">{money(sum('total'), cur)}</td></tr></tfoot>}
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {tab === 'journal' && (
        <div className="stack">
          {ws.data.journal.slice(0, 60).map((j) => (
            <div className="card" key={j.id} style={{ padding: 12 }}>
              <div className="row between"><b className="mono">{j.ref}</b><span className="muted small">{j.date} · {j.memo} {j.doc && <Link to={`/app/r/${j.doc}`}>open</Link>}</span></div>
              <table className="lines" style={{ marginTop: 6 }}>
                <tbody>{j.lines.map((l, i) => <tr key={i}><td style={{ paddingInlineStart: l.credit ? 30 : 6 }}>{l.account} {CHART[l.account].name}</td><td className="num">{l.debit ? money(l.debit, cur) : ''}</td><td className="num">{l.credit ? money(l.credit, cur) : ''}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {tab === 'payments' && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Ref</th><th>Date</th><th>Direction</th><th>Method</th><th className="num">Amount</th></tr></thead>
            <tbody>{ws.data.payments.map((p) => <tr key={p.id}><td><Link className="mono" to={`/app/r/${p.doc}`}>{p.ref}</Link></td><td>{p.date}</td><td>{p.direction === 'in' ? <span className="pill green">received</span> : <span className="pill amber">paid out</span>}</td><td>{p.method}</td><td className="num">{money(p.amount, cur)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
````

### `crm-builder/src/workspace/Approvals.tsx`

````tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ClipboardCheck, X } from 'lucide-react'
import { useApp } from './useApp'
import { canApprove, decideApproval, findRecord, recordTitle } from '../lib/engine'
import { moduleById } from '../lib/schema'

export default function Approvals() {
  const { ws, schema, user, act } = useApp()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const all = ws.data.approvals ?? []
  const rule = (id: string) => (schema.approvals ?? []).find((r) => r.id === id)
  const name = (id?: string) => ws.users.find((u) => u.id === id)?.name ?? '—'
  const mine = all.filter((a) => a.status === 'pending' && rule(a.rule) && canApprove({ schema, user }, rule(a.rule)!))
  const requested = all.filter((a) => a.requestedBy === user.id)
  const done = all.filter((a) => a.status !== 'pending').slice(0, 30)

  const row = (a: (typeof all)[number], decide: boolean) => {
    const r = rule(a.rule)
    const rec = findRecord(ws, a.record)
    const mod = moduleById(schema, a.module)
    return (
      <div key={a.id} className="card row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <b>{r?.name ?? 'Approval'}</b> · <Link to={`/app/r/${a.record}`}>{mod?.singular} {recordTitle(ws, schema, rec)}</Link>
          {rec?.values.total !== undefined && <span className="pill gray" style={{ marginInlineStart: 8 }}>{schema.company.currency} {Number(rec.values.total).toLocaleString()}</span>}
          <div className="tiny muted">Requested by {name(a.requestedBy)} · {new Date(a.at).toLocaleString()}{a.decidedBy && ` · ${a.status} by ${name(a.decidedBy)}${a.note ? ` (“${a.note}”)` : ''}`}</div>
        </div>
        {decide ? (
          <>
            <input placeholder="Note (optional)" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} style={{ maxWidth: 220 }} />
            <button className="success" onClick={() => act((ctx) => { decideApproval(ctx, a.id, true, notes[a.id]); return true }, 'Approved')}><Check size={15} /> Approve</button>
            <button className="danger" onClick={() => act((ctx) => { decideApproval(ctx, a.id, false, notes[a.id]); return true }, 'Rejected')}><X size={15} /> Reject</button>
          </>
        ) : <span className={`pill ${a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`}>{a.status}</span>}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#10b981' }}><ClipboardCheck size={20} /></span>Approvals</h1></div>
      <h2>Waiting for you ({mine.length})</h2>
      {mine.length === 0 ? <p className="muted small">Nothing to approve. 🎉</p> : mine.map((a) => row(a, true))}
      <h2 style={{ marginTop: 22 }}>Your requests</h2>
      {requested.length === 0 ? <p className="muted small">You haven’t requested any approvals.</p> : requested.map((a) => row(a, false))}
      <h2 style={{ marginTop: 22 }}>Recent decisions</h2>
      {done.length === 0 ? <p className="muted small">No decisions yet.</p> : done.map((a) => row(a, false))}
    </div>
  )
}
````

### `crm-builder/src/workspace/Dashboard.tsx`

````tsx
import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, Sparkles, Wand2 } from 'lucide-react'
import { useApp } from './useApp'
import { Chart } from '../components/Chart'
import { runReport } from '../lib/reports'
import { can, list, matches, updateRecord } from '../lib/engine'
import { moduleById, moduleByRole } from '../lib/schema'

export default function Dashboard() {
  const { ws, user, schema, act } = useApp()
  const tasks = moduleByRole(schema, 'tasks')
  const myTasks = tasks ? list(ws, tasks.id).filter((t) => !t.values.done && t.values.assignee === user.id).sort((a, b) => String(a.values.due_date).localeCompare(String(b.values.due_date))).slice(0, 8) : []
  const today = new Date().toISOString().slice(0, 10)
  const reports = schema.reports.filter((r) => can({ schema, user }, r.module, 'view'))
  const hour = new Date().getHours()
  const role = schema.roles.find((r) => r.id === user.roleId)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good {hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]} 👋</h1>
          <p className="muted" style={{ margin: 0 }}>{schema.company.name} · {role?.name} · system v{schema.version}</p>
        </div>
        {role?.admin && <Link to="/builder" className="btn secondary"><Wand2 size={16} /> Customise dashboard</Link>}
      </div>

      {reports.length === 0 && (
        <div className="card empty">
          <div className="big-ic" style={{ background: 'linear-gradient(135deg,#6366f1,#ec4899)' }}><Sparkles size={30} /></div>
          <b>No reports for your role yet.</b>
        </div>
      )}
      <div className="dash">
        {reports.map((r) => {
          const mod = moduleById(schema, r.module)
          const res = runReport(ws, schema, r)
          const currency = r.measure.op !== 'count' && mod?.fields.find((f) => f.key === r.measure.field)?.type === 'currency'
          return (
            <div key={r.id} className={`card s${Math.min(r.size, 3)}`}>
              <h2>{r.name} <Link to={`/app/m/${r.module}`} className="tiny">{mod?.name} →</Link></h2>
              <Chart type={r.chart} result={res} color={r.color} prefix={currency ? `${schema.company.currency} ` : ''} />
            </div>
          )
        })}
        {tasks && (
          <div className="card s2">
            <h2>My tasks <Link to={`/app/m/${tasks.id}`} className="tiny">All tasks →</Link></h2>
            {myTasks.length === 0 && <p className="muted small">Nothing due. 🎉</p>}
            {myTasks.map((t) => {
              const overdue = String(t.values.due_date) < today
              return (
                <div key={t.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <button className="ghost icon" aria-label="Mark done" onClick={() => act((ctx) => {
                    updateRecord(ctx, list(ctx.ws, tasks.id).find((x) => x.id === t.id)!, { done: true })
                  }, 'Task done')}><CheckCircle2 size={18} /></button>
                  <Link to={`/app/r/${t.id}`} className="grow" style={{ color: 'var(--text)' }}>{String(t.values.title)}<br /><span className="tiny muted">{String(t.values.related ?? '')}</span></Link>
                  <span className={`pill ${overdue ? 'red' : 'gray'}`}><Clock size={12} /> {String(t.values.due_date)}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="card s2">
          <h2>Recent activity</h2>
          <ul className="timeline">
            {ws.data.activity.filter((a) => !a.module || can({ schema, user }, a.module, 'view')).slice(0, 8).map((a) => (
              <li key={a.id}><b>{a.user}</b> {a.record ? <Link to={`/app/r/${a.record}`}>{a.text}</Link> : a.text}<br /><span className="tiny muted">{new Date(a.at).toLocaleString()}</span></li>
            ))}
          </ul>
        </div>
      </div>
      {(() => {
        const deals = moduleByRole(schema, 'deals')
        if (!deals) return null
        const open = list(ws, deals.id).filter((d) => matches(schema, d, [{ field: '__stagetype', op: 'eq', value: 'open' }]))
        const weighted = open.reduce((s, d) => s + Number(d.values.amount ?? 0) * ((deals.stages?.find((x) => x.id === d.stage)?.probability ?? 0) / 100), 0)
        return <p className="muted small" style={{ marginTop: 16 }}>Weighted forecast: <b>{schema.company.currency} {Math.round(weighted).toLocaleString()}</b> across {open.length} open {deals.name.toLowerCase()} (amount × stage probability).</p>
      })()}
    </div>
  )
}
````

### `crm-builder/src/workspace/ImportModal.tsx`

````tsx
import { useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { useApp } from './useApp'
import { importRows, type ImportResult } from '../lib/engine'
import type { ModuleDef } from '../lib/schema'

/** Parses CSV exported from Excel or Google Sheets (quotes, commas or semicolons, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '')

export function ImportModal({ mod, onClose }: { mod: ModuleDef; onClose: () => void }) {
  const { act } = useApp()
  const [header, setHeader] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const fields = mod.fields.filter((f) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type))

  function load(file: File) {
    file.text().then((text) => {
      const all = parseCsv(text)
      const [h, ...body] = all
      setHeader(h ?? [])
      setRows(body)
      setResult(null)
      // Auto-match columns to fields by label or key.
      const m: Record<string, string> = {}
      for (const col of h ?? []) {
        const f = fields.find((x) => norm(x.label) === norm(col) || norm(x.key) === norm(col)) ?? fields.find((x) => norm(col).includes(norm(x.label)) || norm(x.label).includes(norm(col)))
        if (f && !Object.values(m).includes(f.key)) m[col] = f.key
      }
      setMapping(m)
    })
  }

  function template() {
    const csv = '﻿' + fields.map((f) => `"${f.label}"`).join(',') + '\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${mod.name} – import template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function run() {
    const objects = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
    const res = act((ctx) => importRows(ctx, mod.id, objects, mapping))
    if (res) setResult(res)
  }

  const missing = mod.fields.filter((f) => f.required && !f.readOnly && !f.showIf && !Object.values(mapping).includes(f.key))
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="card stack" style={{ width: 'min(760px, 100%)' }}>
          <div className="row between"><h2 style={{ margin: 0 }}><FileSpreadsheet size={18} /> Import {mod.name.toLowerCase()}</h2><button className="ghost icon" onClick={onClose}><X size={18} /></button></div>
          {!header.length && (
            <>
              <p className="muted small" style={{ margin: 0 }}>Upload a CSV from Excel or Google Sheets (File → Save as → CSV). The first row must be the column names. Each row is checked like a normal save: good rows are imported, and problem rows are listed so you can fix them.</p>
              <label className="btn big" style={{ cursor: 'pointer' }}><Upload size={18} /> Choose CSV file<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
              <button className="ghost" onClick={template}><Download size={15} /> Download an empty template</button>
            </>
          )}
          {header.length > 0 && !result && (
            <>
              <p className="small" style={{ margin: 0 }}><b>{rows.length}</b> rows found. Match each column to a field:</p>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="data">
                  <thead><tr><th>Column in your file</th><th>Example</th><th>Goes into</th></tr></thead>
                  <tbody>
                    {header.map((h, i) => (
                      <tr key={h + i} style={{ cursor: 'default' }}>
                        <td><b>{h}</b></td>
                        <td className="muted">{rows[0]?.[i] ?? ''}</td>
                        <td>
                          <select value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                            <option value="">— skip —</option>
                            {fields.map((f) => <option key={f.id} value={f.key} disabled={Object.entries(mapping).some(([c, k]) => k === f.key && c !== h)}>{f.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missing.length > 0 && <div className="note small">Required fields not matched: {missing.map((f) => f.label).join(', ')}. Rows without them will be skipped.</div>}
              <div className="row"><button className="secondary" onClick={() => setHeader([])}>Choose another file</button><button className="glow" onClick={run}><Upload size={16} /> Import {rows.length} rows</button></div>
            </>
          )}
          {result && (
            <>
              <div className="ok-box row"><CheckCircle2 size={18} /> {result.created} {mod.name.toLowerCase()} imported.</div>
              {result.errors.length > 0 && (
                <div className="error-box" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  <b>{result.errors.length} rows skipped:</b>
                  <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
                </div>
              )}
              <button onClick={onClose}>Done</button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
````

### `crm-builder/src/workspace/Inventory.tsx`

````tsx
import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes } from 'lucide-react'
import { useApp } from './useApp'
import { list, money, onHand, round2 } from '../lib/engine'
import { moduleByRole } from '../lib/schema'

export default function Inventory() {
  const { ws, schema } = useApp()
  const products = moduleByRole(schema, 'products')
  if (!products) return <div className="page">No products module.</div>
  const items = list(ws, products.id).filter((p) => p.values.track_stock)
  const cur = schema.company.currency
  const value = round2(items.reduce((s, p) => s + onHand(ws, p.id) * Number(p.values.cost ?? 0), 0))
  const low = items.filter((p) => p.values.reorder_level !== undefined && onHand(ws, p.id) <= Number(p.values.reorder_level))
  const moves = ws.data.stock.slice(0, 40)
  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#f59e0b' }}><Boxes size={20} /></span>Stock</h1></div>
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="card"><h2>Stock value (at average cost)</h2><div className="kpi-value">{money(value, cur)}</div></div>
        <div className="card"><h2>Tracked items</h2><div className="kpi-value">{items.length}</div></div>
        <div className="card"><h2>At or below reorder level</h2><div className="kpi-value" style={{ color: low.length ? 'var(--danger)' : 'var(--success)' }}>{low.length}</div></div>
        <div className="card"><h2>Movements</h2><div className="kpi-value">{ws.data.stock.length}</div></div>
      </div>
      <div className="info" style={{ marginBottom: 14 }}>Quantities and costs come only from posted purchase bills and invoices, so they always match your documents. To correct stock, post a bill or invoice — never type it in.</div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="data">
          <thead><tr><th>Item</th><th>SKU</th><th className="num">On hand</th><th className="num">Reorder at</th><th className="num">Avg cost</th><th className="num">Price</th><th className="num">Margin</th><th className="num">Value</th></tr></thead>
          <tbody>
            {items.map((p) => {
              const q = onHand(ws, p.id)
              const cost = Number(p.values.cost ?? 0)
              const price = Number(p.values.price ?? 0)
              const isLow = p.values.reorder_level !== undefined && q <= Number(p.values.reorder_level)
              return (
                <tr key={p.id}>
                  <td><Link to={`/app/r/${p.id}`}><b>{String(p.values.name)}</b></Link> {isLow && <span className="pill red tiny"><AlertTriangle size={11} /> reorder</span>}</td>
                  <td className="mono">{String(p.values.sku ?? '')}</td>
                  <td className="num"><b>{q}</b></td>
                  <td className="num">{String(p.values.reorder_level ?? '—')}</td>
                  <td className="num">{money(cost, cur)}</td>
                  <td className="num">{money(price, cur)}</td>
                  <td className="num">{price ? `${Math.round(((price - cost) / price) * 100)}%` : '—'}</td>
                  <td className="num">{money(q * cost, cur)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h2>Latest movements</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Date</th><th>Document</th><th>Item</th><th className="num">Qty</th><th className="num">Unit cost</th></tr></thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td>{m.date}</td>
                <td><Link to={`/app/r/${m.doc}`} className="mono">{m.ref}</Link></td>
                <td>{String(list(ws, products.id).find((p) => p.id === m.product)?.values.name ?? '')}</td>
                <td className="num" style={{ color: m.qty < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                <td className="num">{money(m.cost, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
````

### `crm-builder/src/workspace/ModuleView.tsx`

````tsx
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Bookmark, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Flame, Kanban, Plus, Table2, Upload } from 'lucide-react'
import { ImportModal } from './ImportModal'
import { useApp } from './useApp'
import { Icon } from '../components/Icon'
import { can, displayValue, fieldValue, list, moveStage, money, recordTitle, rotting, score } from '../lib/engine'
import { update } from '../lib/store'
import { uid } from '../lib/schema'
import type { FieldDef, ModuleDef } from '../lib/schema'
import { moduleById } from '../lib/schema'
import type { Rec, Workspace } from '../lib/types'
import type { AppSchema } from '../lib/schema'

const STATUS_PILL: Record<string, string> = { draft: 'gray', posted: '', partial: 'amber', paid: 'green', void: 'red', sent: '', accepted: 'green', declined: 'red', invoiced: 'green' }

export default function ModuleView() {
  const { moduleId } = useParams()
  const { ws, user, schema } = useApp()
  const mod = moduleById(schema, moduleId ?? '')
  if (!mod) return <div className="page">This module no longer exists.</div>
  if (!can({ schema, user }, mod.id, 'view')) return <div className="page">Your role can’t see {mod.name}.</div>
  return <View key={mod.id} mod={mod} ws={ws} schema={schema} />
}

function View({ mod, ws, schema }: { mod: ModuleDef; ws: Workspace; schema: AppSchema }) {
  const nav = useNavigate()
  const { user, act } = useApp()
  const [view, setView] = useState<'table' | 'board' | 'calendar'>(mod.stages ? 'board' : 'table')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: '__created', dir: -1 })
  const [stage, setStage] = useState('')
  const [importing, setImporting] = useState(false)
  const scored = (mod.scoring?.length ?? 0) > 0
  const dateField = mod.fields.find((f) => ['close_date', 'due_date', 'date', 'visit_date', 'survey_date'].includes(f.key)) ?? mod.fields.find((f) => f.type === 'date')
  const views = (ws.data.views ?? []).filter((v) => v.module === mod.id && v.user === user.id)
  function saveView() {
    const name = prompt('Name this view', stage ? 'My filtered view' : 'My view')
    if (!name) return
    update((s) => { (s.workspaces[ws.id].data.views ??= []).push({ id: uid('v'), module: mod.id, user: user.id, name, q, stage, sort, view }) })
  }
  const cols = mod.fields.filter((f) => f.inList).slice(0, 7)
  const all = list(ws, mod.id)
  const rows = all
    .filter((r) => !q || recordTitle(ws, schema, r).toLowerCase().includes(q.toLowerCase()) || cols.some((c) => displayValue(ws, schema, c, r.values[c.key]).toLowerCase().includes(q.toLowerCase())))
    .filter((r) => !stage || r.stage === stage || r.status === stage)
    .sort((a, b) => {
      const val = (r: Rec) => {
        if (sort.key === '__created') return r.createdAt
        if (sort.key === '__score') return score(ws, schema, r)
        const f = mod.fields.find((x) => x.key === sort.key)
        return ((f ? fieldValue(ws, schema, r, f) : r.values[sort.key]) as string | number | undefined) ?? ''
      }
      const av = val(a)
      const bv = val(b)
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir
    })

  function exportCsv() {
    const header = ['Title', ...(mod.stages ? ['Stage'] : []), ...(mod.lines ? ['Status'] : []), ...mod.fields.map((f) => f.label)]
    const lines = rows.map((r) => [recordTitle(ws, schema, r), ...(mod.stages ? [mod.stages.find((s) => s.id === r.stage)?.name ?? ''] : []), ...(mod.lines ? [r.status ?? ''] : []), ...mod.fields.map((f) => f.type === 'currency' || f.type === 'number' ? String(r.values[f.key] ?? '') : displayValue(ws, schema, f, r.values[f.key]))])
    const csv = [header, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${mod.name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="badge" style={{ background: mod.color }}><Icon name={mod.icon} size={20} /></span>{mod.name} <span className="pill gray">{all.length}</span></h1>
        <div className="row">
          <div className="seg">
            {mod.stages && <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}><Kanban size={15} /> Board</button>}
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Table2 size={15} /> Table</button>
            {dateField && <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}><CalendarDays size={15} /> Calendar</button>}
          </div>
          {can({ schema, user }, mod.id, 'create') && !mod.lines && <button className="secondary" onClick={() => setImporting(true)}><Upload size={15} /> Import</button>}
          <button className="secondary" onClick={exportCsv}><Download size={15} /> Export</button>
          {can({ schema, user }, mod.id, 'create') && <button onClick={() => nav(`/app/new/${mod.id}`)}><Plus size={16} /> New {mod.singular.toLowerCase()}</button>}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${mod.name.toLowerCase()}…`} style={{ maxWidth: 320 }} />
        {(mod.stages || mod.lines) && (
          <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{mod.stages ? 'All stages' : 'All statuses'}</option>
            {mod.stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            {mod.lines && (mod.role === 'quotes' ? ['draft', 'sent', 'accepted', 'declined', 'invoiced'] : ['draft', 'posted', 'partial', 'paid', 'void']).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="grow" />
        {views.length > 0 && (
          <select value="" onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (v) { setQ(v.q); setStage(v.stage); setSort(v.sort); setView(v.view === 'board' && !mod.stages ? 'table' : v.view) } }} style={{ width: 'auto' }}>
            <option value="">Saved views…</option>
            {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <button className="ghost" onClick={saveView} title="Save the current search, filter, sort and layout"><Bookmark size={15} /> Save view</button>
      </div>

      {all.length === 0 ? (
        <div className="card empty">
          <div className="big-ic" style={{ background: mod.color }}><Icon name={mod.icon} size={32} /></div>
          <b>No {mod.name.toLowerCase()} yet</b>
          <p className="small">Create the first one to get started.</p>
          {can({ schema, user }, mod.id, 'create') && <Link className="btn" to={`/app/new/${mod.id}`}><Plus size={16} /> New {mod.singular.toLowerCase()}</Link>}
        </div>
      ) : view === 'calendar' && dateField ? (
        <Calendar rows={rows} dateKey={dateField.key} ws={ws} schema={schema} color={mod.color} />
      ) : view === 'board' && mod.stages ? (
        <Board mod={mod} rows={rows} ws={ws} schema={schema} onMove={(id, st) => act((ctx) => moveStage(ctx, list(ctx.ws, mod.id).find((r) => r.id === id)!, st))} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th onClick={() => setSort({ key: mod.titleField, dir: sort.dir === 1 ? -1 : 1 })}>{mod.lines ? 'Number' : mod.fields.find((f) => f.key === mod.titleField)?.label}</th>
                {mod.stages && <th>Stage</th>}
                {mod.lines && <th>Status</th>}
                {scored && <th onClick={() => setSort({ key: '__score', dir: sort.key === '__score' && sort.dir === -1 ? 1 : -1 })}>Score{sort.key === '__score' ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>}
                {cols.filter((c) => c.key !== mod.titleField).map((c) => (
                  <th key={c.id} className={isNum(c) ? 'num' : ''} onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 1 ? -1 : 1 })}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => nav(`/app/r/${r.id}`)}>
                  <td><b>{mod.lines ? (r.number ?? 'Draft') : recordTitle(ws, schema, r)}</b></td>
                  {mod.stages && <td>{(() => { const s = mod.stages.find((x) => x.id === r.stage); return s ? <span className="pill" style={{ background: s.color + '22', color: s.color }}>{s.name}</span> : null })()}</td>}
                  {mod.lines && <td><span className={`pill ${STATUS_PILL[r.status ?? 'draft']}`}>{r.status}</span></td>}
                  {scored && <td><ScorePill n={score(ws, schema, r)} /></td>}
                  {cols.filter((c) => c.key !== mod.titleField).map((c) => <td key={c.id} className={isNum(c) ? 'num' : ''}><Cell field={c} rec={r} ws={ws} schema={schema} /></td>)}
                </tr>
              ))}
            </tbody>
            {cols.some((c) => c.type === 'currency') && (
              <tfoot>
                <tr>
                  <td>Total ({rows.length})</td>
                  {mod.stages && <td />}
                  {scored && <td />}
                  {mod.lines && <td />}
                  {cols.filter((c) => c.key !== mod.titleField).map((c) => <td key={c.id} className="num">{c.type === 'currency' ? money(rows.filter((r) => r.status !== 'void').reduce((s, r) => s + Number(fieldValue(ws, schema, r, c) ?? 0), 0), schema.company.currency) : ''}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {importing && <ImportModal mod={mod} onClose={() => setImporting(false)} />}
    </div>
  )
}

const isNum = (f: FieldDef) => ['number', 'currency', 'percent', 'formula'].includes(f.type)

function ScorePill({ n }: { n: number }) {
  const hot = n >= 40
  return <span className={`pill ${hot ? 'red' : n >= 20 ? 'amber' : 'gray'}`}><Flame size={12} /> {n}</span>
}

function Cell({ field, rec, ws, schema }: { field: FieldDef; rec: Rec; ws: Workspace; schema: AppSchema }) {
  const v = fieldValue(ws, schema, rec, field)
  if (field.type === 'select') {
    const o = field.options?.find((x) => x.value === v)
    return o ? <span className="pill" style={{ background: o.color + '22', color: o.color }}>{o.label}</span> : null
  }
  if (field.type === 'formula') return <>{v === undefined ? '' : Number(v).toLocaleString()}</>
  return <>{displayValue(ws, schema, field, v)}</>
}

function Board({ mod, rows, ws, schema, onMove }: { mod: ModuleDef; rows: Rec[]; ws: Workspace; schema: AppSchema; onMove: (id: string, stage: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const amountField = mod.fields.find((f) => f.type === 'currency')
  function onDragEnd(e: DragEndEvent) {
    if (e.over && e.active.data.current?.stage !== e.over.id) onMove(String(e.active.id), String(e.over.id))
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="kanban">
        {mod.stages!.map((s) => {
          const items = rows.filter((r) => r.stage === s.id)
          const sum = amountField ? items.reduce((t, r) => t + Number(r.values[amountField.key] ?? 0), 0) : 0
          return (
            <Column key={s.id} id={s.id}>
              <div className="kcol-head"><span className="dot" style={{ background: s.color }} />{s.name} <span className="pill gray tiny">{items.length}</span><span className="sum">{amountField ? money(sum, schema.company.currency).replace('.00', '') : `${s.probability}%`}</span></div>
              {items.map((r) => <Card key={r.id} rec={r} color={s.color} mod={mod} ws={ws} schema={schema} amountField={amountField} />)}
            </Column>
          )
        })}
      </div>
    </DndContext>
  )
}

function Column({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <div ref={setNodeRef} className={`kcol ${isOver ? 'over' : ''}`}>{children}</div>
}

function Card({ rec, color, mod, ws, schema, amountField }: { rec: Rec; color: string; mod: ModuleDef; ws: Workspace; schema: AppSchema; amountField?: FieldDef }) {
  const nav = useNavigate()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: rec.id, data: { stage: rec.stage } })
  const rot = rotting(schema, rec)
  const owner = mod.fields.find((f) => f.type === 'user')
  const rel = mod.fields.find((f) => f.type === 'relation')
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`kcard ${isDragging ? 'dragging' : ''} ${rot.rotting ? 'rotting' : ''}`} style={{ ['--c' as string]: rot.rotting ? '#ef4444' : color, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }} onClick={() => nav(`/app/r/${rec.id}`)}>
      <b>{recordTitle(ws, schema, rec)}</b>
      {(rot.rotting || (mod.scoring?.length ?? 0) > 0) && (
        <div className="row" style={{ gap: 4, margin: '2px 0 4px' }}>
          {(mod.scoring?.length ?? 0) > 0 && <ScorePill n={score(ws, schema, rec)} />}
          {rot.rotting && <span className="pill red tiny"><Clock size={11} /> idle {rot.days}d</span>}
        </div>
      )}
      {rel && <div className="tiny muted">{displayValue(ws, schema, rel, rec.values[rel.key])}</div>}
      <div className="meta">
        <span>{amountField ? displayValue(ws, schema, amountField, rec.values[amountField.key]) : ''}</span>
        <span>{owner ? displayValue(ws, schema, owner, rec.values[owner.key]) : ''}</span>
      </div>
    </div>
  )
}

function Calendar({ rows, dateKey, ws, schema, color }: { rows: Rec[]; dateKey: string; ws: Workspace; schema: AppSchema; color: string }) {
  const nav = useNavigate()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 1) % 7 // weeks start on Saturday (Egypt); Sunday-first locales still read fine
  const shift = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(t.toISOString().slice(0, 7)) }
  const byDay = new Map<number, Rec[]>()
  for (const r of rows) {
    const v = String(r.values[dateKey] ?? '')
    if (v.slice(0, 7) === month) byDay.set(Number(v.slice(8, 10)), [...(byDay.get(Number(v.slice(8, 10))) ?? []), r])
  }
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="ghost icon" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <b>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
        <button className="ghost icon" onClick={() => shift(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="cal">
        {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <div key={d} className="cal-h">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1
          const iso = `${month}-${String(d).padStart(2, '0')}`
          return (
            <div key={d} className={`cal-d ${iso === today ? 'today' : ''}`}>
              <span className="cal-n">{d}</span>
              {(byDay.get(d) ?? []).slice(0, 4).map((r) => <div key={r.id} className="cal-ev" style={{ borderColor: color }} onClick={() => nav(`/app/r/${r.id}`)}>{recordTitle(ws, schema, r)}</div>)}
              {(byDay.get(d)?.length ?? 0) > 4 && <span className="tiny muted">+{byDay.get(d)!.length - 4} more</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
````

### `crm-builder/src/workspace/RecordPage.tsx`

````tsx
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Banknote, CheckCircle2, Clock, FileCheck2, Flame, Lock, MessageSquare, Plus, Printer, Save, Send, ShieldAlert, Star, Trash2, UserPlus, X } from 'lucide-react'
import { useApp } from './useApp'
import { Icon } from '../components/Icon'
import {
  EngineError, can, canPost, convertLead, createRecord, deleteRecord, displayValue, findRecord, lineNet, lineTax, list, money, moveStage, onHand,
  postDocument, quoteToInvoice, recordTitle, registerPayment, setLines, totals, updateRecord, voidDocument, type Ctx,
  addComment, approvalNeeded, canApprove, fieldValue, isVisible, requestApproval, rotting, score,
} from '../lib/engine'
import type { FieldDef, ModuleDef } from '../lib/schema'
import { moduleById, moduleByRole, uid } from '../lib/schema'
import type { Line, Rec, Workspace } from '../lib/types'
import type { AppSchema } from '../lib/schema'

export default function RecordPage() {
  const { id, moduleId } = useParams()
  const { ws, schema } = useApp()
  const rec = id ? findRecord(ws, id) : undefined
  const mod = moduleById(schema, rec?.module ?? moduleId ?? '')
  if (!mod || (id && !rec)) return <div className="page">This record no longer exists. <Link to="/app">Back to dashboard</Link></div>
  return <Editor key={rec?.id ?? `new-${mod.id}`} mod={mod} rec={rec} ws={ws} schema={schema} />
}

function Editor({ mod, rec, ws, schema }: { mod: ModuleDef; rec?: Rec; ws: Workspace; schema: AppSchema }) {
  const nav = useNavigate()
  const { user, act } = useApp()
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(rec?.values ?? {}) }))
  const [lines, setLinesState] = useState<Line[]>(() => rec?.lines ?? [])
  const [paying, setPaying] = useState(false)
  const [printing, setPrinting] = useState(false)
  const isNew = !rec
  const docLocked = Boolean(mod.lines && rec && rec.status !== 'draft' && mod.role !== 'quotes') || Boolean(mod.role === 'quotes' && rec && rec.status === 'invoiced')
  const editable = !docLocked && can({ schema, user }, mod.id, isNew ? 'create' : 'edit')
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }))
  const dirty = isNew || JSON.stringify(values) !== JSON.stringify(rec?.values) || JSON.stringify(lines) !== JSON.stringify(rec?.lines ?? [])

  function save() {
    if (isNew) {
      const created = act((ctx) => createRecord(ctx, mod.id, values, { lines }), `${mod.singular} created`)
      if (created) nav(`/app/r/${created.id}`, { replace: true })
      return
    }
    act((ctx) => {
      const r = findRecord(ctx.ws, rec!.id)!
      updateRecord(ctx, r, values)
      if (mod.lines) setLines(ctx, r, lines)
    }, 'Saved')
  }

  const related = rec ? relatedRecords(ws, schema, rec) : []
  const history = rec ? ws.data.activity.filter((a) => a.record === rec.id).slice(0, 15) : []
  const payments = rec ? ws.data.payments.filter((p) => p.doc === rec.id) : []

  if (printing && rec) return <PrintView rec={rec} mod={mod} ws={ws} schema={schema} onClose={() => setPrinting(false)} />

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <button className="ghost icon" onClick={() => nav(`/app/m/${mod.id}`)} aria-label="Back"><ArrowLeft size={18} /></button>
          <span className="badge" style={{ background: mod.color }}><Icon name={mod.icon} size={20} /></span>
          {isNew ? `New ${mod.singular.toLowerCase()}` : recordTitle(ws, schema, rec)}
          {rec && (mod.scoring?.length ?? 0) > 0 && <span className="pill amber" title="Score from the scoring rules"><Flame size={13} /> {score(ws, schema, rec)}</span>}
          {rec && rotting(schema, rec).rotting && <span className="pill red" title="No progress for a while"><Clock size={13} /> idle {rotting(schema, rec).days} days</span>}
          {rec?.status && <span className={`pill ${rec.status === 'paid' ? 'green' : rec.status === 'void' ? 'red' : rec.status === 'partial' ? 'amber' : rec.status === 'draft' ? 'gray' : ''}`}>{rec.status}</span>}
        </h1>
        <div className="row">
          {mod.role === 'leads' && rec && rec.stage !== mod.stages?.find((s) => s.type === 'won')?.id && (
            <button className="success" onClick={() => { const d = act((ctx) => convertLead(ctx, findRecord(ctx.ws, rec.id)!), 'Lead converted: customer, contact and deal created'); if (d) nav(`/app/r/${d.id}`) }}><UserPlus size={16} /> Convert to customer</button>
          )}
          {mod.role === 'quotes' && rec && rec.status !== 'invoiced' && (
            <>
              {rec.status === 'draft' && <button className="secondary" onClick={() => act((ctx) => setQuoteStatus(ctx, rec.id, 'sent'), 'Marked as sent')}><Send size={15} /> Mark sent</button>}
              <button className="success" disabled={!rec.lines?.length} onClick={() => { const inv = act((ctx) => quoteToInvoice(ctx, findRecord(ctx.ws, rec.id)!), 'Invoice draft created from the quotation'); if (inv) nav(`/app/r/${inv.id}`) }}><FileCheck2 size={15} /> Accept & invoice</button>
              {rec.status !== 'declined' && <button className="secondary" onClick={() => act((ctx) => setQuoteStatus(ctx, rec.id, 'declined'), 'Marked as declined')}><X size={15} /> Declined</button>}
            </>
          )}
          {mod.lines && rec && rec.status === 'draft' && mod.role !== 'quotes' && canPost({ schema, user }) && (
            <button className="success" disabled={dirty} title={dirty ? 'Save first' : ''} onClick={() => act((ctx) => postDocument(ctx, findRecord(ctx.ws, rec.id)!), 'Posted. Stock and accounts are updated.')}><Lock size={15} /> Post</button>
          )}
          {mod.lines && rec && (rec.status === 'posted' || rec.status === 'partial') && canPost({ schema, user }) && (
            <button className="success" onClick={() => setPaying(true)}><Banknote size={15} /> Register payment</button>
          )}
          {mod.lines && rec && rec.status === 'posted' && canPost({ schema, user }) && (
            <button className="danger" onClick={() => confirm('Void this document? Stock and journal entries will be reversed. This can’t be undone.') && act((ctx) => voidDoc(ctx, rec.id), 'Voided and reversed')}><Ban size={15} /> Void</button>
          )}
          {mod.lines && rec && <button className="secondary" onClick={() => setPrinting(true)}><Printer size={15} /> Print</button>}
          {editable && <button onClick={save} disabled={!dirty}><Save size={16} /> {isNew ? 'Create' : 'Save'}</button>}
        </div>
      </div>

      {rec && <ApprovalBanner rec={rec} mod={mod} />}

      {mod.stages && rec && (
        <div className="stage-path">
          {mod.stages.map((s, i) => {
            const cur = mod.stages!.findIndex((x) => x.id === rec.stage)
            return (
              <button key={s.id} className={i === cur ? 'cur' : i < cur && s.type === 'open' ? 'done' : ''} style={{ ['--c' as string]: s.color }} onClick={() => act((ctx) => moveStage(ctx, findRecord(ctx.ws, rec.id)!, s.id), `Moved to ${s.name}`)} disabled={!can({ schema, user }, mod.id, 'edit')}>
                {s.name}
              </button>
            )
          })}
        </div>
      )}

      <div className="record-grid">
        <div className="stack">
          <div className="card">
            {docLocked && <div className="info" style={{ marginBottom: 12 }}><Lock size={13} /> {mod.role === 'quotes' ? 'This quotation was turned into an invoice.' : 'Posted documents are locked to keep your books correct. Void it and create a new one to make changes.'}</div>}
            <div className="form-grid">
              {mod.fields.filter((f) => !(mod.lines && ['subtotal', 'tax', 'total', 'paid', 'balance'].includes(f.key)) && isVisible(mod, f, values)).map((f) => (
                <div key={f.id} className={f.width === 2 || f.type === 'longtext' ? 'w2' : ''}>
                  <label className="field">
                    <span>{f.label}{f.required && !f.readOnly && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
                    <FieldInput field={f} value={(f.type === 'lookup' || f.type === 'rollup') ? (rec ? fieldValue(ws, schema, rec, f) : undefined) : values[f.key]} onChange={(v) => set(f.key, v)} disabled={!editable} ws={ws} schema={schema} />
                  </label>
                  {f.help && <span className="tiny muted">{f.help}</span>}
                </div>
              ))}
            </div>
          </div>
          {mod.lines && <LinesEditor mod={mod} lines={lines} onChange={setLinesState} disabled={!editable || (mod.role === 'quotes' && rec?.status !== 'draft' && rec?.status !== 'sent' && !isNew)} ws={ws} schema={schema} />}
          {payments.length > 0 && (
            <div className="card">
              <h2>Payments</h2>
              <table className="data"><tbody>{payments.map((p) => <tr key={p.id}><td className="mono">{p.ref}</td><td>{p.date}</td><td>{p.method}</td><td className="num">{money(p.amount, schema.company.currency)}</td></tr>)}</tbody></table>
            </div>
          )}
        </div>
        <div className="stack">
          {related.length > 0 && (
            <div className="card">
              <h2>Linked records</h2>
              {related.map(({ m, r }) => (
                <Link key={r.id} to={`/app/r/${r.id}`} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  <Icon name={m.icon} size={15} style={{ color: m.color }} /> <span className="grow small">{recordTitle(ws, schema, r)}</span> <span className="tiny muted">{m.singular}</span>
                </Link>
              ))}
            </div>
          )}
          {rec && <Comments rec={rec} />}
          {rec && (
            <div className="card">
              <h2>History</h2>
              <ul className="timeline">
                {history.map((a) => <li key={a.id}><b>{a.user}</b> {a.text}<br /><span className="tiny muted">{new Date(a.at).toLocaleString()}</span></li>)}
                <li>Created {new Date(rec.createdAt).toLocaleDateString()} by {ws.users.find((u) => u.id === rec.createdBy)?.name ?? '—'}</li>
              </ul>
            </div>
          )}
          {rec && can({ schema, user }, mod.id, 'delete') && (
            <button className="danger" onClick={() => confirm(`Delete this ${mod.singular.toLowerCase()}?`) && act((ctx) => { deleteRecord(ctx, findRecord(ctx.ws, rec.id)!); return true }, 'Deleted') && nav(`/app/m/${mod.id}`)}><Trash2 size={15} /> Delete</button>
          )}
        </div>
      </div>
      {paying && rec && <PaymentModal rec={rec} currency={schema.company.currency} onClose={() => setPaying(false)} onPay={(amount, date, method) => { if (act((ctx) => { registerPayment(ctx, findRecord(ctx.ws, rec.id)!, amount, date, method); return true }, 'Payment registered')) setPaying(false) }} />}
    </div>
  )
}

function voidDoc(ctx: Ctx, id: string) {
  const r = findRecord(ctx.ws, id)
  if (!r) throw new EngineError('Not found')
  voidDocument(ctx, r)
  return true
}

function setQuoteStatus(ctx: Ctx, id: string, status: 'sent' | 'declined') {
  const r = findRecord(ctx.ws, id)
  if (!r) throw new EngineError('Not found')
  if (!can(ctx, r.module, 'edit')) throw new EngineError('Your role can’t edit quotations')
  r.status = status
}

function relatedRecords(ws: Workspace, schema: AppSchema, rec: Rec) {
  const out: { m: ModuleDef; r: Rec }[] = []
  for (const m of schema.modules) {
    const rels = m.fields.filter((f) => f.type === 'relation' && f.target === rec.module)
    if (!rels.length) continue
    for (const r of list(ws, m.id)) if (rels.some((f) => r.values[f.key] === rec.id)) out.push({ m, r })
  }
  return out.slice(0, 20)
}

function FieldInput({ field, value, onChange, disabled, ws, schema }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; ws: Workspace; schema: AppSchema }) {
  if (field.readOnly || field.type === 'formula' || field.type === 'lookup' || field.type === 'rollup') {
    const shown = field.type === 'formula' ? (value === undefined || value === null ? '—' : Number(value).toLocaleString()) : displayValue(ws, schema, field, value) || (value === 0 ? '0' : '—')
    return <div className="ro-value">{shown}</div>
  }
  const str = value === undefined || value === null ? '' : String(value)
  switch (field.type) {
    case 'longtext':
      return <textarea value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir="auto" />
    case 'number':
    case 'currency':
    case 'percent':
      return <input type="number" step={field.type === 'number' ? 'any' : '0.01'} min={field.min} max={field.max} value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'rating':
      return (
        <div className="row" style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="ghost icon" disabled={disabled} onClick={() => onChange(n)}><Star size={20} fill={Number(value) >= n ? '#f59e0b' : 'none'} color="#f59e0b" /></button>)}
        </div>
      )
    case 'date':
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'checkbox':
      return <label className="inline"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> {field.label}</label>
    case 'select':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'multiselect': {
      const cur = (value as string[]) ?? []
      return (
        <div className="chips">
          {field.options?.map((o) => (
            <button key={o.value} type="button" disabled={disabled} className={`chip ${cur.includes(o.value) ? 'on' : ''}`} style={{ padding: '5px 11px' }} onClick={() => onChange(cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value])}>{o.label}</button>
          ))}
        </div>
      )
    }
    case 'relation': {
      const targets = list(ws, field.target ?? '')
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {targets.map((r) => <option key={r.id} value={r.id}>{recordTitle(ws, schema, r)}</option>)}
        </select>
      )
    }
    case 'user':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {ws.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )
    case 'email':
      return <input type="email" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'phone':
      return <input type="tel" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="+20 10 0000 0000" />
    case 'url':
      return <input type="url" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="https://" />
    default:
      return <input value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir="auto" />
  }
}

function LinesEditor({ mod, lines, onChange, disabled, ws, schema }: { mod: ModuleDef; lines: Line[]; onChange: (l: Line[]) => void; disabled: boolean; ws: Workspace; schema: AppSchema }) {
  const products = moduleByRole(schema, 'products')
  const items = products ? list(ws, products.id) : []
  const t = totals(lines)
  const cur = schema.company.currency
  const upd = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const pick = (i: number, pid: string) => {
    const p = items.find((x) => x.id === pid)
    if (!p) return upd(i, { product: undefined })
    const price = mod.role === 'purchases' ? Number(p.values.cost || p.values.price || 0) : Number(p.values.price ?? 0)
    upd(i, { product: p.id, description: String(p.values.name), price, vat: Number(p.values.vat_rate ?? schema.company.vatRate) })
  }
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Lines</h2>{!disabled && <button className="secondary" onClick={() => onChange([...lines, { id: uid('l'), description: '', qty: 1, price: 0, discount: 0, vat: schema.company.vatRate }])}><Plus size={15} /> Add line</button>}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lines">
          <thead><tr><th style={{ minWidth: 200 }}>Product / service</th><th>Qty</th><th>Unit price</th><th>Disc %</th><th>VAT %</th><th className="num">Net</th><th className="num">VAT</th><th /></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={8} className="muted small" style={{ padding: 16 }}>No lines yet. Add the products or services you are {mod.role === 'purchases' ? 'buying' : 'selling'}.</td></tr>}
            {lines.map((l, i) => {
              const p = items.find((x) => x.id === l.product)
              const stock = p?.values.track_stock ? onHand(ws, p.id) : undefined
              return (
                <tr key={l.id}>
                  <td>
                    <select value={l.product ?? ''} onChange={(e) => pick(i, e.target.value)} disabled={disabled}>
                      <option value="">— free text —</option>
                      {items.map((x) => <option key={x.id} value={x.id}>{String(x.values.name)} {x.values.sku ? `(${x.values.sku})` : ''}</option>)}
                    </select>
                    {!l.product && <input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} disabled={disabled} placeholder="Description" style={{ marginTop: 4 }} />}
                    {stock !== undefined && mod.role !== 'purchases' && <span className={`tiny ${stock < l.qty ? 'pill red' : 'muted'}`}>On hand: {stock}</span>}
                  </td>
                  <td><input type="number" min={0} step="any" value={l.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} disabled={disabled} style={{ width: 80 }} /></td>
                  <td><input type="number" min={0} step="0.01" value={l.price} onChange={(e) => upd(i, { price: Number(e.target.value) })} disabled={disabled} style={{ width: 110 }} /></td>
                  <td><input type="number" min={0} max={100} value={l.discount} onChange={(e) => upd(i, { discount: Number(e.target.value) })} disabled={disabled} style={{ width: 70 }} /></td>
                  <td><input type="number" min={0} max={100} value={l.vat} onChange={(e) => upd(i, { vat: Number(e.target.value) })} disabled={disabled} style={{ width: 70 }} /></td>
                  <td className="num">{lineNet(l).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="num">{lineTax(l).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>{!disabled && <button className="ghost icon" onClick={() => onChange(lines.filter((_, j) => j !== i))}><X size={14} /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="totals">
        <span>Subtotal</span><b className="num">{money(t.subtotal, cur)}</b>
        <span>VAT</span><b className="num">{money(t.tax, cur)}</b>
        <span className="grand">Total</span><span className="grand num">{money(t.total, cur)}</span>
      </div>
    </div>
  )
}

function PaymentModal({ rec, currency, onClose, onPay }: { rec: Rec; currency: string; onClose: () => void; onPay: (amount: number, date: string, method: 'cash' | 'bank' | 'cheque' | 'instapay' | 'card') => void }) {
  const [amount, setAmount] = useState(Number(rec.values.balance))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque' | 'instapay' | 'card'>('bank')
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="card stack">
          <h2><Banknote size={18} /> Register payment for {rec.number}</h2>
          <p className="muted small" style={{ margin: 0 }}>Balance due: <b>{money(Number(rec.values.balance), currency)}</b></p>
          <label className="field">Amount<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
          <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="seg">{(['bank', 'cash', 'instapay', 'cheque', 'card'] as const).map((m) => <button key={m} type="button" className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m === 'instapay' ? 'InstaPay' : m[0].toUpperCase() + m.slice(1)}</button>)}</div>
          <div className="row"><button className="secondary" onClick={onClose}>Cancel</button><button className="success" onClick={() => onPay(amount, date, method)}><CheckCircle2 size={16} /> Register</button></div>
        </div>
      </div>
    </>
  )
}

function PrintView({ rec, mod, ws, schema, onClose }: { rec: Rec; mod: ModuleDef; ws: Workspace; schema: AppSchema; onClose: () => void }) {
  const partyId = String(rec.values.customer ?? rec.values.supplier ?? '')
  const party = findRecord(ws, partyId)
  const t = totals(rec.lines ?? [])
  const cur = schema.company.currency
  const title = mod.role === 'invoices' ? 'Tax invoice' : mod.role === 'quotes' ? 'Quotation' : 'Purchase bill'
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={onClose}><ArrowLeft size={16} /> Back</button>
        <button onClick={() => window.print()}><Printer size={16} /> Print / save as PDF</button>
      </div>
      <div className="print-doc">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{schema.company.name}</h1>
            <div className="muted small">{schema.company.city}, {schema.company.country}</div>
            {schema.company.taxId && <div className="small">Tax registration no.: <b>{schema.company.taxId}</b></div>}
          </div>
          <div style={{ textAlign: 'end' }}>
            <h2 style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</h2>
            <div className="mono">{rec.number ?? 'DRAFT'}</div>
            <div className="small">Date: {String(rec.values.date ?? '')}</div>
            {rec.values.due_date ? <div className="small">Due: {String(rec.values.due_date)}</div> : null}
            {rec.values.valid_until ? <div className="small">Valid until: {String(rec.values.valid_until)}</div> : null}
          </div>
        </div>
        <div style={{ margin: '24px 0', padding: 14, background: 'var(--surface-2)', borderRadius: 10 }}>
          <div className="tiny muted">{mod.role === 'purchases' ? 'Supplier' : 'Bill to'}</div>
          <b>{recordTitle(ws, schema, party)}</b>
          {party?.values.tax_id ? <div className="small">Tax ID: {String(party.values.tax_id)}</div> : null}
        </div>
        <table className="lines">
          <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Disc.</th><th className="num">VAT</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {(rec.lines ?? []).map((l, i) => (
              <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{l.price.toFixed(2)}</td><td className="num">{l.discount}%</td><td className="num">{l.vat}%</td><td className="num">{lineNet(l).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <span>Subtotal</span><b className="num">{money(t.subtotal, cur)}</b>
          <span>VAT</span><b className="num">{money(t.tax, cur)}</b>
          <span className="grand">Total</span><span className="grand num">{money(t.total, cur)}</span>
          {mod.role !== 'quotes' && <><span>Paid</span><span className="num">{money(Number(rec.values.paid ?? 0), cur)}</span><span><b>Balance due</b></span><b className="num">{money(Number(rec.values.balance ?? t.total), cur)}</b></>}
        </div>
        {rec.status === 'void' && <h2 style={{ color: 'var(--danger)', textAlign: 'center', marginTop: 30 }}>VOID</h2>}
      </div>
    </div>
  )
}

function ApprovalBanner({ rec, mod }: { rec: Rec; mod: ModuleDef }) {
  const { ws, schema, user, act, ctx } = useApp()
  const rules = (schema.approvals ?? []).filter((r) => r.module === mod.id)
  if (!rules.length) return null
  type Item = { r: (typeof rules)[number]; state: 'approved' | 'self' | 'pending' | 'rejected' | 'needed'; by?: string }
  const items = rules.flatMap((r): Item[] => {
    if (r.action === 'post' && rec.status !== 'draft') return []
    const needed = approvalNeeded(ctx, rec, r.action, r.stage)
    if (needed?.id !== r.id) {
      const done = (ws.data.approvals ?? []).find((a) => a.rule === r.id && a.record === rec.id && a.status === 'approved')
      return done ? [{ r, state: 'approved', by: ws.users.find((u) => u.id === done.decidedBy)?.name }] : []
    }
    const pending = (ws.data.approvals ?? []).find((a) => a.rule === r.id && a.record === rec.id && a.status === 'pending')
    const rejected = (ws.data.approvals ?? []).find((a) => a.rule === r.id && a.record === rec.id && a.status === 'rejected')
    return [{ r, state: canApprove({ schema, user }, r) ? 'self' : pending ? 'pending' : rejected ? 'rejected' : 'needed' }]
  })
  if (!items.length) return null
  const roleName = (id: string) => schema.roles.find((x) => x.id === id)?.name ?? 'an approver'
  const what = (r: (typeof rules)[number]) => (r.action === 'post' ? 'posting' : `moving to “${mod.stages?.find((s) => s.id === r.stage)?.name}”`)
  return (
    <div className="stack" style={{ marginBottom: 14 }}>
      {items.map(({ r, state, by }) => (
        <div key={r.id} className={`row ${state === 'approved' ? 'ok-box' : state === 'rejected' ? 'error-box' : 'note'}`}>
          <ShieldAlert size={16} />
          <span className="grow">
            <b>{r.name}</b>:{' '}
            {state === 'approved' && `approved by ${by}.`}
            {state === 'self' && `${what(r)} normally needs approval from ${roleName(r.approverRole)}. You can do it yourself.`}
            {state === 'pending' && `waiting for ${roleName(r.approverRole)} to approve ${what(r)}.`}
            {state === 'rejected' && `rejected. Change the record and request approval again.`}
            {state === 'needed' && `${what(r)} needs approval from ${roleName(r.approverRole)}.`}
          </span>
          {(state === 'needed' || state === 'rejected') && <button className="secondary" onClick={() => act((c) => { requestApproval(c, findRecord(c.ws, rec.id)!, r.id); return true }, 'Approval requested')}><Send size={14} /> Request approval</button>}
        </div>
      ))}
    </div>
  )
}

function Comments({ rec }: { rec: Rec }) {
  const { ws, act } = useApp()
  const [text, setText] = useState('')
  const comments = (ws.data.comments ?? []).filter((c) => c.record === rec.id)
  const name = (id: string) => ws.users.find((u) => u.id === id)?.name ?? '—'
  return (
    <div className="card">
      <h2><MessageSquare size={17} /> Notes & comments</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note. Type @name to notify a colleague." dir="auto" style={{ minHeight: 64 }} />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="tiny muted">{ws.users.slice(0, 4).map((u) => `@${u.name.split(' ')[0]}`).join(' ')}</span>
        <button onClick={() => { if (act((c) => { addComment(c, findRecord(c.ws, rec.id)!, text); return true })) setText('') }} disabled={!text.trim()}><Send size={14} /> Add note</button>
      </div>
      <ul className="timeline" style={{ marginTop: 10 }}>
        {comments.map((c) => <li key={c.id}><b>{name(c.user)}</b> <span dir="auto">{c.text}</span><br /><span className="tiny muted">{new Date(c.at).toLocaleString()}</span></li>)}
      </ul>
    </div>
  )
}
````

### `crm-builder/src/workspace/Shell.tsx`

````tsx
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Boxes, Calculator, CheckCircle2, ClipboardCheck, Languages, LayoutDashboard, LogOut, Search, Users, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { showToast, useApp, useToast } from './useApp'
import { can, canApprove, canPost, list, recordTitle, runScheduled } from '../lib/engine'
import { signOut, switchUser, update } from '../lib/store'
import { useLang } from '../lib/i18n'

export default function Shell() {
  const { ws, user, schema, act } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const { lang, setLang } = useLang()
  const [bell, setBell] = useState(false)
  const [q, setQ] = useState('')
  const ran = useRef(false)
  const role = schema.roles.find((r) => r.id === user.roleId)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const n = act((ctx) => runScheduled(ctx))
    if (n) showToast({ kind: 'ok', text: `${n} date-based automation${n > 1 ? 's' : ''} ran (overdue items, reminders)` })
  }, [act])

  const visible = schema.modules.filter((m) => can({ schema, user }, m.id, 'view'))
  // Notes addressed to a person go only to them; notes for a role go to that role (and Admin); the rest go to everyone.
  const notes = ws.data.notes.filter((n) => (n.user ? n.user === user.id : !n.role || role?.admin || n.role === user.roleId || (n.role === 'finance' && role?.finance)))
  const toApprove = (ws.data.approvals ?? []).filter((a) => a.status === 'pending' && (() => { const r = (schema.approvals ?? []).find((x) => x.id === a.rule); return r ? canApprove({ schema, user }, r) : false })()).length
  const unread = notes.filter((n) => !n.read).length
  const results = q.trim().length > 1
    ? visible.flatMap((m) => list(ws, m.id).filter((r) => recordTitle(ws, schema, r).toLowerCase().includes(q.toLowerCase())).slice(0, 4).map((r) => ({ r, m }))).slice(0, 10)
    : []

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/app"><Logo /></Link>
        <NavLink to="/app" end><LayoutDashboard size={18} /> Dashboard</NavLink>
        <div className="sect">{schema.company.name}</div>
        {visible.map((m) => (
          <NavLink key={m.id} to={`/app/m/${m.id}`}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={14} /></span>
            {m.name}
            <span className="cnt">{list(ws, m.id).length || ''}</span>
          </NavLink>
        ))}
        <div className="sect">Operations</div>
        {schema.modules.some((m) => m.role === 'products') && <NavLink to="/app/inventory"><Boxes size={18} /> Stock</NavLink>}
        {canPost({ schema, user }) && <NavLink to="/app/accounting"><Calculator size={18} /> Accounting</NavLink>}
        {(schema.approvals?.length ?? 0) > 0 && <NavLink to="/app/approvals"><ClipboardCheck size={18} /> Approvals {toApprove > 0 && <span className="pill red tiny" style={{ marginInlineStart: 'auto' }}>{toApprove}</span>}</NavLink>}
        {role?.admin && <NavLink to="/app/team"><Users size={18} /> Team</NavLink>}
        {role?.admin && <NavLink to="/builder"><Wand2 size={18} /> Customise system</NavLink>}
      </aside>
      <div className="main">
        <div className="topbar no-print">
          <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers, deals, invoices…" style={{ paddingInlineStart: 36 }} />
            {results.length > 0 && (
              <div className="card notif" style={{ insetInlineStart: 0, width: '100%' }}>
                {results.map(({ r, m }) => (
                  <div key={r.id} style={{ cursor: 'pointer' }} onClick={() => { setQ(''); nav(`/app/r/${r.id}`) }}>
                    <Icon name={m.icon} size={14} style={{ color: m.color }} /> {recordTitle(ws, schema, r)} <span className="muted tiny">· {m.singular}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="grow" />
          <button className="ghost" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}><Languages size={16} /> {lang === 'en' ? 'ع' : 'EN'}</button>
          <div style={{ position: 'relative' }}>
            <button className="ghost" onClick={() => { setBell(!bell); if (!bell) { const ids = new Set(notes.map((n) => n.id)); update((s) => s.workspaces[ws.id].data.notes.forEach((n) => { if (ids.has(n.id)) n.read = true })) } }} aria-label="Notifications">
              <Bell size={18} />{unread > 0 && <span className="pill red tiny">{unread}</span>}
            </button>
            {bell && (
              <div className="card notif">
                {notes.length === 0 && <div className="muted">No notifications yet.</div>}
                {notes.slice(0, 30).map((n) => <div key={n.id} className={n.read ? '' : 'unread'} style={{ cursor: n.record ? 'pointer' : undefined }} onClick={() => { if (n.record) { setBell(false); nav(`/app/r/${n.record}`) } }}>{n.message}<br /><span className="tiny muted">{new Date(n.at).toLocaleString()}</span></div>)}
              </div>
            )}
          </div>
          <select value={user.id} onChange={(e) => switchUser(e.target.value)} style={{ width: 'auto' }} title="Switch user (try the system as each role)">
            {ws.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {schema.roles.find((r) => r.id === u.roleId)?.name ?? 'No role'}</option>)}
          </select>
          <button className="ghost" onClick={() => { signOut(); nav('/') }} aria-label="Sign out"><LogOut size={18} /></button>
        </div>
        <Outlet />
      </div>
      {toast && (
        <div className={`toast row ${toast.kind === 'ok' ? 'ok-box' : 'error-box'}`} onClick={() => showToast(null)}>
          {toast.kind === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} <span className="grow">{toast.text}</span>
        </div>
      )}
    </div>
  )
}
````

### `crm-builder/src/workspace/Team.tsx`

````tsx
import { useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { hash, update } from '../lib/store'
import { uid } from '../lib/schema'

export default function Team() {
  const { ws, schema, user } = useApp()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState(schema.roles.find((r) => !r.admin)?.id ?? 'role_admin')
  const isAdmin = schema.roles.find((r) => r.id === user.roleId)?.admin
  if (!isAdmin) return <div className="page">Only Admin can manage the team.</div>

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const lower = email.trim().toLowerCase()
    if (ws.users.some((u) => u.email === lower)) return showToast({ kind: 'error', text: 'Someone already uses this e-mail' })
    if (password.length < 8) return showToast({ kind: 'error', text: 'Password must be at least 8 characters' })
    const passwordHash = await hash(password)
    update((s) => s.workspaces[ws.id].users.push({ id: uid('u'), name: name.trim(), email: lower, roleId, passwordHash }))
    setName('')
    setEmail('')
    setPassword('')
    showToast({ kind: 'ok', text: `${name} can now sign in` })
  }
  const admins = ws.users.filter((u) => u.roleId === 'role_admin').length

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#6366f1' }}><Users size={20} /></span>Team</h1></div>
      <div className="record-grid">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th /></tr></thead>
            <tbody>
              {ws.users.map((u) => (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td><b>{u.name}</b> {u.demo && <span className="pill gray tiny">sample</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.roleId} disabled={u.roleId === 'role_admin' && admins === 1} onChange={(e) => update((s) => { s.workspaces[ws.id].users.find((x) => x.id === u.id)!.roleId = e.target.value })}>
                      {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>{u.id !== user.id && <button className="ghost icon" onClick={() => confirm(`Remove ${u.name}? Their records stay.`) && update((s) => { const w = s.workspaces[ws.id]; w.users = w.users.filter((x) => x.id !== u.id) })}><Trash2 size={15} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card stack" onSubmit={add}>
          <h2><UserPlus size={18} /> Add a team member</h2>
          <label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">E-mail<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">Temporary password<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="field">Role
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <button><UserPlus size={16} /> Add</button>
          <p className="tiny muted">In this browser preview, team members sign in on this device. Roles control what each person can see and do.</p>
        </form>
      </div>
    </div>
  )
}
````

### `crm-builder/src/workspace/useApp.ts`

````ts
import { useSyncExternalStore } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentUser, currentWorkspace, transact, useStore } from '../lib/store'
import type { User, Workspace } from '../lib/types'
import type { Ctx } from '../lib/engine'

type Toast = { kind: 'ok' | 'error'; text: string } | null
let toast: Toast = null
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(t: Toast) {
  toast = t
  subs.forEach((s) => s())
  clearTimeout(timer)
  if (t) timer = setTimeout(() => showToast(null), t.kind === 'error' ? 6000 : 3000)
}

export function useToast() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => toast,
  )
}

export function useApp() {
  const ws = useStore((s) => currentWorkspace(s)) as Workspace
  const user = useStore((s) => currentUser(s)) as User
  const schema = ws.published as AppSchema
  /** Run an engine action atomically. If it throws, nothing changes and the message is shown. */
  function act<T>(fn: (ctx: Ctx) => T, ok?: string): T | undefined {
    try {
      const out = transact((copy) => fn({ ws: copy, schema: copy.published!, user: copy.users.find((u) => u.id === user.id)! }))
      if (ok) showToast({ kind: 'ok', text: ok })
      return out
    } catch (e) {
      showToast({ kind: 'error', text: (e as Error).message })
      return undefined
    }
  }
  const ctx: Ctx = { ws, schema, user }
  return { ws, user, schema, act, ctx }
}
````

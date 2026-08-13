# Return Lifecycle States + Search UI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redefine `to_be_returned` as "bad condition, no return filed", add `return_filed`/`return_escalated` lifecycle states with case linkage, and ship six search/receiving UI improvements.

**Architecture:** A pure `evaluateUnitState()` function becomes the single source of truth for inventory-state transitions; both the post-sync updater and the Recompute button call a shared planner built on it. Escalated returns link to their `inr_cases` row via a new `returns.case_id` column. Reclassification of existing units runs dry-run-first with a snapshot table for rollback. Phase 2 layers UI features on top.

**Tech Stack:** Next.js 14 App Router + TypeScript + Prisma + PostgreSQL. No test framework — pure-logic tests are `scripts/test-*.ts` run via ts-node.

**Spec:** `docs/superpowers/specs/2026-08-13-return-lifecycle-and-search-ui-design.md`

## Global Constraints

- All work on branch `arbdesk-dev` in `/opt/retailarb-dev`; never edit staging/production checkouts.
- Test-run command for scripts: `npx ts-node --transpile-only -r tsconfig-paths/register -O '{"module":"commonjs","moduleResolution":"node"}' scripts/<file>.ts` (project tsconfig uses bundler resolution; ts-node needs these overrides).
- Conditions are loaded dynamically from DB (`/api/units/conditions`) — never hardcode condition lists in UI.
- Good conditions set (everywhere): `good, new, like_new, acceptable, excellent`. Fair-eligible bad condition: `damaged`.
- Resolved case statuses: `CLOSED`, `CS_CLOSED`, `PAID_OUT`. Unknown statuses = unresolved (conservative).
- Full verification before any completion claim: run the named test script AND `npx tsc --noEmit`; `npm run build` at phase ends.
- Commit after every task with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## Phase 1 — State machine + escalation

### Task 1: Schema — `returns.case_id` + snapshot table

**Files:**
- Modify: `prisma/schema.prisma` (returns model ~line 280; received_units comment ~line 216)

**Interfaces:**
- Produces: `returns.case_id String?`; model `inventory_state_snapshots { id, unit_id, inventory_state, batch_label, created_at }`.

- [ ] **Step 1: Edit schema.** In `model returns`, after `escalated Boolean @default(false)` add:

```prisma
  case_id           String?   // linked inr_cases.case_id when this return was escalated to a case
```

Update the received_units comment at ~line 216 to:

```prisma
  inventory_state    String @default("on_hand")  // on_hand, to_be_returned, return_filed, return_escalated, parts_repair, fair, returned, missing
```

Add at the end of the models section:

```prisma
model inventory_state_snapshots {
  id              String   @id @default(cuid())
  unit_id         String
  inventory_state String
  batch_label     String
  created_at      DateTime @default(now())

  @@index([batch_label])
}
```

- [ ] **Step 2: Create migration.** Run: `npx prisma migrate dev --name add_return_case_link_and_state_snapshots`. Expected: migration SQL contains only `ALTER TABLE "returns" ADD COLUMN "case_id" TEXT` and `CREATE TABLE "inventory_state_snapshots" ...` — verify nothing destructive, then confirm `npx prisma generate` succeeded.
- [ ] **Step 3: Verify.** `npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit** `prisma/schema.prisma` + new migration folder: `git commit -m "Add returns.case_id link and inventory_state_snapshots table"`.

### Task 2: Pure evaluator (TDD)

**Files:**
- Create: `src/lib/inventory-evaluator.ts`
- Test: `scripts/test-inventory-evaluator.ts`

**Interfaces:**
- Produces:

```ts
export type UnitForEval = { condition_status: string | null; inventory_state: string };
export type ReturnForEval = {
  ebay_state: string | null; ebay_status: string | null; escalated: boolean;
  return_shipped_date: Date | null; return_delivered_date: Date | null;
  creation_date: Date | null; case_id: string | null;
};
export type CaseForEval = { case_id: string | null; ebay_status: string | null };
export function evaluateUnitState(unit: UnitForEval, returns: ReturnForEval[], cases: CaseForEval[]): string | null
```

Returns the new state, or `null` for "no change". Callers pass all returns/cases for the unit's `(order_id, item_id)` pair.

- [ ] **Step 1: Write failing tests** (`scripts/test-inventory-evaluator.ts`, same harness style as `scripts/test-import-dedupe.ts`: `check(name, actual, expected)` comparing strings/null, exit 1 on failure):

```ts
import { evaluateUnitState } from "../src/lib/inventory-evaluator";

const bad = { condition_status: "cracked", inventory_state: "on_hand" };
const badTBR = { condition_status: "cracked", inventory_state: "to_be_returned" };
const damaged = { condition_status: "damaged", inventory_state: "return_filed" };
const good = { condition_status: "good", inventory_state: "to_be_returned" };
const goodOnHand = { condition_status: "good", inventory_state: "on_hand" };
const R = (o: Partial<ReturnForEval> = {}) => ({ ebay_state: null, ebay_status: null, escalated: false,
  return_shipped_date: null, return_delivered_date: null, creation_date: null, case_id: null, ...o });

// no return filed
check("bad condition, no return, on_hand -> to_be_returned", evaluateUnitState(bad, [], []), "to_be_returned");
check("bad condition, no return, already to_be_returned -> no change", evaluateUnitState(badTBR, [], []), null);
check("good condition, no return -> no change", evaluateUnitState(goodOnHand, [], []), null);
check("bad condition, no return, already returned -> no change", evaluateUnitState({ condition_status: "cracked", inventory_state: "returned" }, [], []), null);
// open return
check("open return -> return_filed (bad)", evaluateUnitState(badTBR, [R({ ebay_state: "RETURN_REQUESTED", ebay_status: "RETURN_REQUESTED" })], []), "return_filed");
check("open return -> return_filed (good)", evaluateUnitState(good, [R({ ebay_state: "ITEM_READY_TO_SHIP", ebay_status: "READY_FOR_SHIPPING" })], []), "return_filed");
// shipped back
check("shipped -> returned (bad)", evaluateUnitState(badTBR, [R({ return_shipped_date: new Date("2026-08-01") })], []), "returned");
check("shipped -> on_hand (good)", evaluateUnitState(good, [R({ return_delivered_date: new Date("2026-08-04") })], []), "on_hand");
// closed normally
check("closed -> parts_repair (bad, not damaged)", evaluateUnitState(badTBR, [R({ ebay_state: "CLOSED", ebay_status: "CLOSED" })], []), "parts_repair");
check("closed -> fair (damaged)", evaluateUnitState(damaged, [R({ ebay_state: "CLOSED", ebay_status: "CLOSED" })], []), "fair");
check("closed -> on_hand (good) [the stuck-unit bug]", evaluateUnitState(good, [R({ ebay_state: "REFUND_ISSUED", ebay_status: "REFUND_ISSUED" })], []), "on_hand");
// escalated
check("escalated, no case -> return_escalated", evaluateUnitState(good, [R({ ebay_state: "CLOSED", ebay_status: "ESCALATED", escalated: true })], []), "return_escalated");
check("escalated, open case -> return_escalated", evaluateUnitState(good, [R({ ebay_state: "CLOSED", ebay_status: "ESCALATED", escalated: true, case_id: "5371" })], [{ case_id: "5371", ebay_status: "OPEN" }]), "return_escalated");
check("escalated, unknown case status -> return_escalated", evaluateUnitState(good, [R({ escalated: true, ebay_status: "ESCALATED", case_id: "5371" })], [{ case_id: "5371", ebay_status: "SOMETHING_NEW" }]), "return_escalated");
check("escalated, resolved case -> on_hand (good)", evaluateUnitState(good, [R({ escalated: true, ebay_status: "ESCALATED", case_id: "5371" })], [{ case_id: "5371", ebay_status: "CS_CLOSED" }]), "on_hand");
check("escalated, resolved case -> parts_repair (bad)", evaluateUnitState(badTBR, [R({ escalated: true, ebay_status: "ESCALATED", case_id: "5371" })], [{ case_id: "5371", ebay_status: "PAID_OUT" }]), "parts_repair");
check("escalated by status only (flag false) -> return_escalated", evaluateUnitState(good, [R({ ebay_state: "CLOSED", ebay_status: "ESCALATED" })], []), "return_escalated");
// multiple returns: most recent creation_date wins
check("old closed + new open -> return_filed", evaluateUnitState(good,
  [R({ ebay_state: "CLOSED", ebay_status: "CLOSED", creation_date: new Date("2026-05-01") }),
   R({ ebay_state: "RETURN_REQUESTED", creation_date: new Date("2026-08-01") })], []), "return_filed");
check("null creation_date sorts oldest", evaluateUnitState(good,
  [R({ ebay_state: "RETURN_REQUESTED", creation_date: new Date("2026-08-01") }),
   R({ ebay_state: "CLOSED", ebay_status: "CLOSED", creation_date: null })], []), "return_filed");
```

- [ ] **Step 2: Run — expect module-not-found**, then create a stub returning `null` and re-run — expect the non-null assertions to FAIL.
- [ ] **Step 3: Implement:**

```ts
const GOOD_CONDITIONS = new Set(["good", "new", "like_new", "acceptable", "excellent"]);
const FAIR_CONDITIONS = new Set(["damaged"]);
const RESOLVED_CASE_STATUSES = new Set(["CLOSED", "CS_CLOSED", "PAID_OUT"]);

function isClosed(r: ReturnForEval): boolean {
  return r.ebay_state === "CLOSED" || r.ebay_status === "CLOSED" ||
    r.ebay_state === "REFUND_ISSUED" || r.ebay_state === "RETURN_CLOSED" ||
    r.ebay_status === "REFUND_ISSUED" || r.ebay_status === "LESS_THAN_A_FULL_REFUND_ISSUED";
}
function isEscalated(r: ReturnForEval): boolean {
  return r.escalated || r.ebay_status === "ESCALATED" || r.ebay_state === "ESCALATED" || r.ebay_state === "RETURN_ESCALATED";
}

export function evaluateUnitState(unit: UnitForEval, returns: ReturnForEval[], cases: CaseForEval[]): string | null {
  const isBad = !GOOD_CONDITIONS.has(unit.condition_status?.toLowerCase() ?? "");
  const closedOutcome = () => {
    if (!isBad) return "on_hand";
    return FAIR_CONDITIONS.has(unit.condition_status?.toLowerCase() ?? "") ? "fair" : "parts_repair";
  };

  if (returns.length === 0) {
    if (isBad && unit.inventory_state === "on_hand") return "to_be_returned";
    return null;
  }

  const ret = [...returns].sort((a, b) => (b.creation_date?.getTime() ?? 0) - (a.creation_date?.getTime() ?? 0))[0];

  if (ret.return_shipped_date || ret.return_delivered_date) return pick(isBad ? "returned" : "on_hand");
  if (isEscalated(ret)) {
    const linked = ret.case_id ? cases.find(c => c.case_id === ret.case_id) : undefined;
    if (linked && RESOLVED_CASE_STATUSES.has(linked.ebay_status ?? "")) return pick(closedOutcome());
    return pick("return_escalated");
  }
  if (isClosed(ret)) return pick(closedOutcome());
  return pick("return_filed");

  function pick(s: string): string | null { return s === unit.inventory_state ? null : s; }
}
```

- [ ] **Step 4: Run tests — all PASS.** Also `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** both files: `git commit -m "Add pure inventory-state evaluator with escalation lifecycle"`.

### Task 3: Rewire transitions onto the evaluator

**Files:**
- Modify: `src/lib/inventory-transitions.ts` (replace bodies of `updateInventoryStatesFromReturns` ~line 43 and `recomputeAllInventoryStates` ~line 131; delete local `isReturnClosed`, `CLOSED_STATES`, `FAIR_CONDITIONS`)
- Test: `scripts/test-transition-planner.ts` (read-only run against dev DB)

**Interfaces:**
- Consumes: `evaluateUnitState` from Task 2.
- Produces:

```ts
export type PlannedTransition = { unitId: string; orderId: string; itemId: string | null; from: string; to: string; reason: string };
export async function planInventoryTransitions(): Promise<PlannedTransition[]>   // computes, writes nothing
export async function applyInventoryTransitions(plan: PlannedTransition[]): Promise<number>
export async function updateInventoryStatesFromReturns(): Promise<void>          // = plan + apply (kept for sync route)
export async function recomputeAllInventoryStates(): Promise<{ returnPass: number; orphanPass: number }>  // = plan + apply, split counts kept for UI
```

- [ ] **Step 1: Implement `planInventoryTransitions`:**

```ts
export async function planInventoryTransitions(): Promise<PlannedTransition[]> {
  const plan: PlannedTransition[] = [];
  const returns = await prisma.returns.findMany({
    where: { order_id: { not: null } },
    select: { id: true, order_id: true, ebay_item_id: true, ebay_state: true, ebay_status: true,
      escalated: true, case_id: true, creation_date: true, return_shipped_date: true, return_delivered_date: true }
  });

  // Group returns by (order_id, ebay_item_id); never wildcard-match on null item id
  const groups = new Map<string, typeof returns>();
  for (const r of returns) {
    if (!r.ebay_item_id) { console.warn(`[Inventory Transition] Return ${r.id} has null ebay_item_id — skipped`); continue; }
    const key = `${r.order_id}::${r.ebay_item_id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const coveredUnitIds = new Set<string>();
  for (const [key, groupReturns] of groups) {
    const [orderId, itemId] = key.split("::");
    const units = await prisma.received_units.findMany({
      where: { order_id: orderId, item_id: itemId },
      select: { id: true, inventory_state: true, condition_status: true }
    });
    const cases = await prisma.inr_cases.findMany({
      where: { order_id: orderId, ebay_item_id: itemId, case_id: { not: null } },
      select: { case_id: true, ebay_status: true }
    });
    for (const unit of units) {
      coveredUnitIds.add(unit.id);
      const to = evaluateUnitState(unit, groupReturns, cases);
      if (to) plan.push({ unitId: unit.id, orderId, itemId, from: unit.inventory_state, to,
        reason: `return group (${groupReturns.length} return(s), ${cases.length} case(s))` });
    }
  }

  // Orphan pass: units with no return
  const orphans = await prisma.received_units.findMany({
    where: { inventory_state: "on_hand" },
    select: { id: true, order_id: true, item_id: true, inventory_state: true, condition_status: true }
  });
  for (const unit of orphans) {
    if (coveredUnitIds.has(unit.id)) continue;
    const to = evaluateUnitState(unit, [], []);
    if (to) plan.push({ unitId: unit.id, orderId: unit.order_id, itemId: unit.item_id, from: unit.inventory_state, to, reason: "bad condition, no return filed" });
  }
  return plan;
}

export async function applyInventoryTransitions(plan: PlannedTransition[]): Promise<number> {
  for (const t of plan) {
    await prisma.received_units.update({ where: { id: t.unitId }, data: { inventory_state: t.to } });
    console.log(`[Inventory Transition] ${t.unitId}: ${t.from} -> ${t.to} (${t.reason})`);
  }
  return plan.length;
}
```

`updateInventoryStatesFromReturns` = `await applyInventoryTransitions(await planInventoryTransitions())`. `recomputeAllInventoryStates` = same, returning `{ returnPass: plan.filter(t => t.reason.startsWith("return group")).length, orphanPass: plan.filter(t => t.reason.startsWith("bad condition")).length }` (after applying).
- [ ] **Step 2: Read-only planner check.** `scripts/test-transition-planner.ts` calls `planInventoryTransitions()` (no apply) against the dev DB and prints count by `from -> to`. Run it; expect counts consistent with the earlier diagnostic (≈38 `to_be_returned -> return_filed`, ≈9 good-condition closed → `on_hand`, escalated groups → `return_escalated`; exact numbers depend on dev DB age — sanity, not equality assertions).
- [ ] **Step 3: Evaluator tests still pass; `npx tsc --noEmit` clean.** (`updateInventoryStatesFromReturns` callers: `src/app/api/sync/returns/route.ts:173`; `recomputeAllInventoryStates` caller: grep `recomputeAllInventoryStates` and confirm signature still satisfied.)
- [ ] **Step 4: Commit**: `git commit -m "Route all inventory-state transitions through shared evaluator/planner"`.

### Task 4: Case→return linkage in sync

**Files:**
- Modify: `src/app/api/sync/returns/route.ts` — `upsertCase` (~line 554)

**Interfaces:**
- Produces: after every case upsert, matching escalated returns get `case_id` set.

- [ ] **Step 1: At the end of `upsertCase`** (after the existing update/create branches, before function exit), add:

```ts
  // Link this case to its originating escalated return (same order + item, not yet linked)
  if (resolvedOrderId && itemId) {
    await prisma.returns.updateMany({
      where: { order_id: resolvedOrderId, ebay_item_id: itemId, escalated: true, case_id: null },
      data: { case_id: caseId },
    });
  }
```

- [ ] **Step 2: `npx tsc --noEmit` clean; `npm run build` passes.**
- [ ] **Step 3: Commit**: `git commit -m "Link escalated returns to their cases during case sync"`.

### Task 5: Reclassification script (dry-run / apply / restore)

**Files:**
- Create: `scripts/reclassify-inventory-states.ts`

**Interfaces:**
- Consumes: `planInventoryTransitions`, `applyInventoryTransitions` (Task 3).
- CLI: no args = dry-run; `--apply` = snapshot + backfill + apply; `--restore <batch_label>` = restore snapshot.

- [ ] **Step 1: Implement:**

```ts
import { prisma } from "../src/lib/db";
import { planInventoryTransitions, applyInventoryTransitions } from "../src/lib/inventory-transitions";

async function backfillCaseLinks(dry: boolean): Promise<number> {
  const escalated = await prisma.returns.findMany({
    where: { escalated: true, case_id: null, order_id: { not: null }, ebay_item_id: { not: null } },
    select: { id: true, order_id: true, ebay_item_id: true, ebay_return_id: true }
  });
  let linked = 0;
  for (const r of escalated) {
    const cs = await prisma.inr_cases.findFirst({
      where: { order_id: r.order_id!, ebay_item_id: r.ebay_item_id!, case_id: { not: null } },
      select: { case_id: true, ebay_status: true }
    });
    if (!cs?.case_id) { console.log(`  return ${r.ebay_return_id}: NO matching case found`); continue; }
    console.log(`  return ${r.ebay_return_id} -> case ${cs.case_id} (${cs.ebay_status})`);
    if (!dry) await prisma.returns.update({ where: { id: r.id }, data: { case_id: cs.case_id } });
    linked++;
  }
  return linked;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--restore") {
    const batch = args[1];
    if (!batch) throw new Error("Usage: --restore <batch_label>");
    const rows = await prisma.inventory_state_snapshots.findMany({ where: { batch_label: batch } });
    if (rows.length === 0) throw new Error(`No snapshot rows for batch ${batch}`);
    for (const row of rows) {
      await prisma.received_units.update({ where: { id: row.unit_id }, data: { inventory_state: row.inventory_state } });
    }
    console.log(`Restored ${rows.length} unit states from batch ${batch}`);
    return;
  }

  const apply = args[0] === "--apply";
  console.log(`=== Case-link backfill (${apply ? "APPLY" : "dry-run"}) ===`);
  const linked = await backfillCaseLinks(!apply);
  console.log(`${linked} return->case link(s)\n=== State transitions (${apply ? "APPLY" : "dry-run"}) ===`);

  const plan = await planInventoryTransitions();
  const byPair = new Map<string, number>();
  for (const t of plan) {
    console.log(`  ${t.unitId} (order ${t.orderId}): ${t.from} -> ${t.to} — ${t.reason}`);
    byPair.set(`${t.from} -> ${t.to}`, (byPair.get(`${t.from} -> ${t.to}`) ?? 0) + 1);
  }
  console.log(`\nSummary (${plan.length} transitions):`);
  for (const [k, n] of byPair) console.log(`  ${k}: ${n}`);

  if (apply && plan.length > 0) {
    const batch = `reclassify-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
    await prisma.inventory_state_snapshots.createMany({
      data: plan.map(t => ({ unit_id: t.unitId, inventory_state: t.from, batch_label: batch }))
    });
    console.log(`\nSnapshot saved: batch_label=${batch} (${plan.length} rows). Restore with: --restore ${batch}`);
    await applyInventoryTransitions(plan);
    console.log("Applied.");
  } else if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to execute.");
  }
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Dry-run on dev DB.** Run the script with no args; review output — must list the backfill links (≈26) and transitions with per-pair summary; verify NOTHING was written (`SELECT count(*) FROM inventory_state_snapshots` via a quick prisma count in node — expect 0).
- [ ] **Step 3: Apply on dev.** Run with `--apply`; verify snapshot rows created and a re-run dry-run reports 0 transitions (converged). Then run `--restore <batch>` and confirm states revert; re-apply after verifying restore works.
- [ ] **Step 4: Commit**: `git commit -m "Add dry-run/apply/restore inventory reclassification script"`.

### Task 6: Escalation UI (order details + returns page)

**Files:**
- Modify: `src/app/orders/[orderId]/page.tsx` (badge logic ~line 328; returns card ~327-385; INR section ~390)
- Modify: `src/app/returns/page.tsx` (refund-mode classification ~lines 41-90; escalated detection ~line 57)

**Interfaces:**
- Consumes: `returns.case_id` (Task 1), linkage data (Tasks 4-5). Order page already loads `returns: true, inr_cases: true`.

- [ ] **Step 1: Order page badge.** Replace the badge computation inside `order.returns.map((ret) => { ... })`:

```tsx
const isEsc = ret.escalated || ret.ebay_status === "ESCALATED";
const linkedCase = isEsc ? order.inr_cases.find(c => c.case_id && c.case_id === ret.case_id) ?? null : null;
const caseResolved = linkedCase != null && ["CLOSED", "CS_CLOSED", "PAID_OUT"].includes(linkedCase.ebay_status ?? "");
const state = ret.ebay_state || ret.ebay_status || ret.status_scraped || "UNKNOWN";
const isClosed = !isEsc && (state === "CLOSED" || state === "REFUND_ISSUED" || state === "RETURN_CLOSED");
const badgeColor = isEsc
  ? (caseResolved ? "bg-green-900 text-green-300" : "bg-amber-900 text-amber-300")
  : isClosed ? "bg-green-900 text-green-300"
  : state === "RETURN_REQUESTED" || state === "RETURN_STARTED" ? "bg-yellow-900 text-yellow-300"
  : "bg-red-900 text-red-300";
const badgeText = isEsc ? "ESCALATED" : state.replace(/_/g, " ");
```

Use `badgeText` where `state.replace(/_/g, " ")` is rendered (both the `<a>` and `<span>` variants). Inside the return card, after the badge row, add:

```tsx
{isEsc && (
  <p className="mt-1 text-xs text-amber-300">
    Escalated → case {linkedCase ? `${linkedCase.case_id} · ${(linkedCase.ebay_status ?? "UNKNOWN").replace(/_/g, " ")}` : "not yet synced"}
    {linkedCase?.claim_amount != null && ` · $${Number(linkedCase.claim_amount).toFixed(2)}`}
  </p>
)}
```

(The `inr_cases` select on this page must include `case_id`, `ebay_status`, `claim_amount` — extend the include/select at the top of the file if it doesn't.)
- [ ] **Step 2: INR section filter.** Exclude return-escalation cases from the "INR Cases" list: `const linkedCaseIds = new Set(order.returns.map(r => r.case_id).filter(Boolean));` and render `order.inr_cases.filter(c => !(c.case_id && linkedCaseIds.has(c.case_id)))`. Section heading condition uses the filtered array's length.
- [ ] **Step 3: Returns page.** In the refund-mode classifier (`returns/page.tsx` ~41-90): the page's server query must include `case_id` on returns and fetch `inr_cases` rows with `case_id` in the returns' linked set (`select: { case_id: true, ebay_status: true, claim_amount: true }`). Replace the "escalated closed returns with no actual_refund → order remaining balance" branch: when the return has a linked resolved case with `claim_amount != null`, classify using `claim_amount` as the refund amount; when linked case is unresolved, classify as `"escalated"` (existing bucket); keep the order-balance fallback ONLY when no linked case exists (pre-linkage returns).
- [ ] **Step 4: `npx tsc --noEmit` clean, `npm run build` passes.** Manual check on dev site (port 3002): open an escalated order (e.g. `27-13903-31923`) — amber ESCALATED badge + case line render; the same case no longer appears under "INR Cases".
- [ ] **Step 5: Commit**: `git commit -m "Surface escalation status and linked case on order and returns pages"`.

### Task 7: State labels/colors + drop inventory-page workaround

**Files:**
- Modify: `src/app/inventory/page.tsx` (~474 exclusion; ~842-846 color map)
- Modify: `src/app/units/units-table.tsx`, `src/app/orders/search/order-search.tsx` (wherever `to_be_returned` has a label/color — locate with `grep -n "to_be_returned" <file>`)

**Interfaces:** display-only; colors: `return_filed` → `text-blue-400` / `bg-blue-900 text-blue-300`; `return_escalated` → `text-amber-400` / `bg-amber-900 text-amber-300` (match each file's existing pattern: `text-*` for inline text, `bg-*` for chips).

- [ ] **Step 1:** In each file found by the grep, add the two new states beside the existing `to_be_returned` entry, matching that file's structure (color map entry, label map entry, and — in units-table — the state filter dropdown options if states are enumerated there).
- [ ] **Step 2:** In `inventory/page.tsx` needs-return bucket (~474), change `if (needsReturnOrderIds.has(orderId) && !orderIdsWithReturns.has(orderId))` to `if (needsReturnOrderIds.has(orderId))` and update the comment: the state itself now excludes filed returns.
- [ ] **Step 3:** `npx tsc --noEmit` + `npm run build`; manual spot-check inventory page and units page on dev render the new states after Task 5's dev apply.
- [ ] **Step 4: Commit**: `git commit -m "Render return_filed/return_escalated states; drop redundant needs-return exclusion"`.

**Phase 1 gate:** deploy to dev (`./deploy.sh dev` — requires push; run by user if permission-blocked), run reclassify dry-run on dev, share the report with the user, apply on dev, manual smoke-test. Production apply happens only after staging validation, with the user's go-ahead.

---

## Phase 2 — UI features

### Task 8: Shared eBay link builders + direct search chips + remove Order details chip

**Files:**
- Create: `src/lib/ebay-links.ts`
- Modify: `src/app/orders/[orderId]/page.tsx` (~446-451), `src/app/api/orders/search/route.ts` (order_items select), `src/app/orders/search/order-search.tsx` (delete local `buildReturnUrl`/`buildInrUrl` ~198-212; chips at ~955-974, 1066-1085, 1188-1202, 1288-1301)
- Test: `scripts/test-ebay-links.ts`

**Interfaces:**
- Produces:

```ts
export type EbayLinkItem = { itemId: string; transactionId: string | null };
export function buildReturnUrl(orderId: string, item: EbayLinkItem | undefined): string
export function buildInrUrl(orderId: string, item: EbayLinkItem | undefined): string
```

- [ ] **Step 1: Failing test** (`scripts/test-ebay-links.ts`): with `{itemId: "318", transactionId: "77"}` expect `https://www.ebay.com/rtn/Return/ReturnViewSelectedItem?itemId=318&transactionId=77` and `https://www.ebay.com/ItemNotReceived/CreateRequest?itemId=318&transactionId=77`; with `transactionId: null` or `undefined` item expect `https://order.ebay.com/ord/show?orderId=07-1`. Run → module not found.
- [ ] **Step 2: Implement** (exact logic lifted from `orders/[orderId]/page.tsx:446-451`):

```ts
export function buildReturnUrl(orderId: string, item: EbayLinkItem | undefined): string {
  return item?.transactionId
    ? `https://www.ebay.com/rtn/Return/ReturnViewSelectedItem?itemId=${item.itemId}&transactionId=${item.transactionId}`
    : `https://order.ebay.com/ord/show?orderId=${orderId}`;
}
export function buildInrUrl(orderId: string, item: EbayLinkItem | undefined): string {
  return item?.transactionId
    ? `https://www.ebay.com/ItemNotReceived/CreateRequest?itemId=${item.itemId}&transactionId=${item.transactionId}`
    : `https://order.ebay.com/ord/show?orderId=${orderId}`;
}
```

Tests pass. Order page swaps its inline ternaries for these helpers (`{ itemId: item.item_id, transactionId: item.transaction_id }`).
- [ ] **Step 3: API.** Add `transaction_id: true` to the `order_items` select in `src/app/api/orders/search/route.ts` and map it into the items payload as `transactionId` (the client type at `order-search.tsx:22` already declares it).
- [ ] **Step 4: Search page.** Delete local builders; import from `@/lib/ebay-links`. Call sites become `buildReturnUrl(order.orderId, order.items[0])` / `buildInrUrl(...)`. In `ExpandedOrderDetail`, when `order.items.length > 1`, render per-item Return/INR link pairs (item title truncated to 45 chars, same classes as existing chips — mirror the order-page block at `orders/[orderId]/page.tsx:452-475`). Remove the two "Order details →" `<Link>` chips (~1188, ~1288).
- [ ] **Step 5:** `npx tsc --noEmit` + build; on dev, verify a search chip's href contains `transactionId=`. **Commit**: `git commit -m "Direct file-return/INR links on search page via shared ebay-links helper"`.

### Task 9: Pending + Late ship-status chips

**Files:**
- Modify: `src/app/orders/search/order-search.tsx` (`SHIP_STATUSES` ~157, `shipStatusColor` ~166, filter predicate ~518)

- [ ] **Step 1:** First verify derived values present: `SELECT DISTINCT derived_status FROM shipments` via a quick read-only prisma script or existing scripts. Add chips:

```ts
{ value: "late",    label: "Late" },
{ value: "pending", label: "Pending" },   // matches pending + pre_shipment
```

Colors: `late: "bg-amber-900 text-amber-300"`, `pending: "bg-sky-900 text-sky-300"`. In the ship-status matching code (~518), treat chip value `pending` as matching `derivedStatus === "pending" || derivedStatus === "pre_shipment"`.
- [ ] **Step 2:** Build + manual check chips filter correctly on dev. **Commit**: `git commit -m "Add Late and Pending shipment-status filter chips"`.

### Task 10: Is/is-not filtering (TDD on helper)

**Files:**
- Create: `src/lib/filter-negation.ts`
- Modify: `src/app/orders/search/order-search.tsx` (chip `onClick` togglers; URL serialize ~544 / parse ~459-474; match predicates ~505-530 and ship/order-status matching)
- Test: `scripts/test-filter-negation.ts`

**Interfaces:**
- Produces:

```ts
export type TriState = "off" | "include" | "exclude";
export function cycle(state: TriState): TriState                       // off -> include -> exclude -> off
export function encode(values: Map<string, TriState>): string[]        // include: "v", exclude: "!v", off omitted
export function decode(raw: string[], valid: Set<string>): Map<string, TriState>  // unprefixed = include (back-compat)
export function matches(candidates: string[], filter: Map<string, TriState>): boolean
// matches: true when (no includes OR candidates intersect includes) AND candidates intersect no excludes
```

- [ ] **Step 1: Failing tests:** `cycle("off")==="include"`, `cycle("exclude")==="off"`; `encode` of `{a: include, b: exclude, c: off}` → `["a","!b"]`; `decode(["a","!b","junk"], new Set(["a","b"]))` → a:include, b:exclude, junk dropped; `matches(["delivered"], {})===true`; `matches(["delivered"], {delivered: exclude})===false`; `matches(["late"], {delivered: include})===false`; `matches(["delivered","late"], {delivered: include, late: exclude})===false`; `matches(["delivered"], {delivered: include, late: exclude})===true`. Run → fail; implement the four small functions; run → pass.
- [ ] **Step 2: Wire into search page.** Chip groups (ship status, order status, case filters, condition group from Task 11) each hold `Map<string, TriState>` state. Chip click = `cycle`. Exclude rendering: `bg-red-950 border border-red-800 text-red-400 line-through`. URL params via `encode`/`decode` with each group's valid-value set (`VALID_SHIP_STATUSES` etc. — `!`-stripped value validated). Replace `filterShipStatus.includes(...)`-style predicates with `matches([derivedStatus], map)` — for the `pending` chip pass both `["pending","pre_shipment"]`-mapped candidates consistent with Task 9. Case filters: each order's matching filter-keys array (e.g. `["hasOpenReturn","anyRefund"]` computed from existing predicates) goes through `matches`.
- [ ] **Step 3:** Helper tests pass, tsc clean, build passes; manual: include+exclude combos on dev, saved-filter URLs from before still parse (no `!` = include).
- [ ] **Step 4: Commit**: `git commit -m "Add off/include/exclude cycling to search filter chips"`.

### Task 11: Condition filter group (search page)

**Files:**
- Modify: `src/app/orders/search/order-search.tsx` (new chip row after ship-status row ~1472; fetch conditions on mount)

**Interfaces:**
- Consumes: `GET /api/units/conditions` → `{ conditions: string[] }` (verify exact response key by reading the route before wiring); unit `condition_status` values already present in each order's `receivedUnits`; `matches` from Task 10.

- [ ] **Step 1:** Fetch conditions once on mount (same pattern as `units-table.tsx:535`). Render a "Unit condition" chip row using the Task 10 tri-state component. Predicate: candidates = `order.receivedUnits.map(u => u.conditionStatus)` (confirm payload field name at `route.ts:396-400` mapping) — `matches(candidates, conditionFilter)`; orders with zero units match only when the filter has no includes.
- [ ] **Step 2:** Persist in URL as `cond=good,!damaged` alongside other params (Task 10 encode/decode).
- [ ] **Step 3:** tsc + build + manual dev check ("condition is damaged", "condition is not good"). **Commit**: `git commit -m "Add unit-condition filter chips to search page"`.

### Task 12: Edit Condition in receiving log + evaluator hook on condition change

**Files:**
- Modify: `src/app/receiving/scan-list.tsx` (button next to Edit Product ~line 219; new inline editor state)
- Modify: `src/app/api/units/[unitId]/route.ts` (after condition update, re-evaluate state)

**Interfaces:**
- Consumes: `GET /api/units/conditions`, `PATCH /api/units/[unitId]` body `{ condition: string }`; `planInventoryTransitions` pattern from Task 3 — but scoped to one unit:

```ts
// added to src/lib/inventory-transitions.ts
export async function reevaluateUnit(unitId: string): Promise<string | null>  // evaluates one unit, applies if changed, returns new state or null
```

- [ ] **Step 1: Implement `reevaluateUnit`** in `inventory-transitions.ts`: load the unit (`order_id`, `item_id`, `inventory_state`, `condition_status`); load returns for `(order_id, ebay_item_id = item_id)` and linked cases exactly as in `planInventoryTransitions`; call `evaluateUnitState`; if non-null, update and return it. Add a check to `scripts/test-transition-planner.ts` invoking it read-only? No — it writes; instead verify via Step 4 manual test.
- [ ] **Step 2: PATCH hook.** In `src/app/api/units/[unitId]/route.ts`, after a successful update where `data.condition_status` was set, call `await reevaluateUnit(unitId)` and include the resulting state in the JSON response.
- [ ] **Step 3: Scan-list button.** Next to Edit Product: `Edit Condition` button (same classes, amber accents: `border-amber-800 text-amber-400 hover:bg-amber-900`). Clicking swaps the condition chip for a `<select>` populated from `/api/units/conditions` (fetched lazily on first open, cached in state) plus Save/Cancel; Save `PATCH`es `{ condition }` then refreshes the list the same way `handleEditProduct`'s save path does.
- [ ] **Step 4:** tsc + build; manual on dev: edit a unit bad→good, confirm chip updates AND (with no return filed) the unit's inventory state leaves `to_be_returned` (visible on units page). **Commit**: `git commit -m "Add edit-condition to receiving log; re-evaluate inventory state on condition change"`.

**Phase 2 gate:** `npm run build`, full manual pass on dev, then user-run `./deploy.sh dev`, staging, production per normal flow; production reclassify `--apply` only after the user reviews the production dry-run report.

---

## Self-review notes

- Spec coverage: state semantics (T2/T3), evaluator unification (T3), case linkage + backfill (T4/T5), dry-run/snapshot rollout (T5), escalation UI (T6), state rendering + workaround removal (T7), search links (T8), pending/late (T9), is-not (T10), order-details chip removal (T8), condition filter (T11), edit condition + evaluator hook (T12). Out-of-scope items (async sync, phantom lots) intentionally absent.
- Type consistency: `PlannedTransition`, `evaluateUnitState`, `TriState` helpers, `EbayLinkItem` used consistently across tasks.

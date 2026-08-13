# Return Lifecycle States + Search UI Enhancements — Design

Date: 2026-08-13
Status: Draft for review

## Background / Problems being fixed

1. **"Needs return" is wrong.** `inventory_state = to_be_returned` currently mixes two meanings: "bad condition, should file a return" AND "open return exists". The sync-time transition (`updateInventoryStatesFromReturns`) also fails to move good-condition units out of `to_be_returned` when their return closes (the Recompute button does this correctly — the two code paths diverge). Production evidence: of 124 needs-return units, 9 have CLOSED returns (all good-condition, 3 already refunded), 38 have open returns.
2. **Escalated returns are invisible.** An escalated return shows `ebay_state=CLOSED, ebay_status=ESCALATED`; the money and status move to a *case*. 26 such returns exist; their 26 cases are synced into `inr_cases` and displayed as "INR Cases", never linked back to the return. Order page shows a green "CLOSED" badge for them.
3. Assorted search-page UX gaps (see Phase 2).

**Out of scope (separate follow-up):** the sync-button Cloudflare timeout (async sync job); cleanup of the 10 phantom lot-unit orders.

## Phase 1 — Inventory state machine + escalation visibility

### New state semantics (received_units.inventory_state)

- `to_be_returned` — bad-condition unit, **no return filed**. Pure action item: "file a return".
- `return_filed` (NEW) — a return covering this unit exists and is open (not shipped back, not closed). Any condition.
- `return_escalated` (NEW) — the unit's return closed with `ebay_status=ESCALATED` and the linked case is unresolved. Case detail (status, payout) is *displayed*, not encoded as further unit states. Resolved case statuses: `CLOSED`, `CS_CLOSED`, `PAID_OUT`; all others = still escalated.
- `returned` / `on_hand` on ship-back (bad/good condition) — unchanged.
- Closed outcomes — unchanged from current Recompute logic: bad → `fair` (damaged) or `parts_repair`; good → `on_hand`. A resolved escalation case lands in these same outcomes.

Lifecycle:

```
to_be_returned ──file──> return_filed ──escalate──> return_escalated
      │                    │       │                      │ (case resolves)
      │                    │       └──ship back──> returned(bad) / on_hand(good)
      │                    └──closes normally──┐          │
      │                                        ▼          ▼
      │                          fair | parts_repair (bad) / on_hand (good)
      └── (stays until a return is filed or condition edited to good → on_hand)
```

### Single evaluator

One pure function in `src/lib/inventory-transitions.ts`:

```
evaluateUnitState(unit {condition_status, inventory_state},
                  returns[] for (order_id, item_id),
                  linkedCases[]) → newState | null
```

Both `updateInventoryStatesFromReturns` (post-sync) and `recomputeAllInventoryStates` (button) call it — divergence becomes impossible. Fixes included here:

- Good-condition units leave `to_be_returned`/`return_filed` when the return closes (→ `on_hand`).
- `ebay_item_id` null no longer wildcard-matches every unit in the order (skip transition, log a warning).
- Multiple returns for one (order, item): evaluate against the most recently created return, not last-writer-wins.

The evaluator is pure (no Prisma) → unit-tested TDD-style via `scripts/test-*.ts` convention.

### Return ↔ case linkage

- Additive nullable column `returns.case_id`.
- During case sync, when a case's (order_id, item_id) matches an escalated return, write `case_id` onto that return.
- One-time backfill for the existing 26 during rollout (same dry-run report).

### UI (Phase 1)

- Order details: escalated returns get an amber **ESCALATED** badge (not green CLOSED) + linked case status/payout ("Escalated → case CS_CLOSED · $42.10"). Return-escalation cases render inside the return card, not under "INR Cases".
- Returns page: escalated classification reads the linked case (drop the order-balance estimation heuristic).
- New state labels/colors everywhere states render (inventory page, units table, search): `return_filed` blue, `return_escalated` amber.
- Inventory page: remove the now-redundant manual exclusion in the needs-return bucket (`inventory/page.tsx:474`).
- Search API `needsReturn` flag: unchanged code — correct automatically under new semantics.

### Reclassification rollout (data safety)

1. Script prints every proposed transition (unit, old → new, reason) — **dry-run default, `--apply` to execute**.
2. On apply: snapshot all current `inventory_state` values into `inventory_state_snapshots` (unit_id, state, taken_at) first; one command restores.
3. Order: dev (full test on prod copy) → staging → production (deploy.sh auto-backup + nightly Drive backups behind it).
4. Only derived data (`received_units.inventory_state`) is ever written; schema change is additive (`returns.case_id`, snapshot table).

## Phase 2 — Search/receiving UI features (after Phase 1 lands)

1. **Direct File Return / File INR links (search page).** Extract the order-details page's working per-item URL construction (`orders/[orderId]/page.tsx:446-451`) into `src/lib/ebay-links.ts`; both pages import it. Add `transaction_id` to the search API's `order_items` select (root cause: search payload lacks it, so links currently fall back to the eBay order page). Search expanded rows render per-item links for multi-item orders, exactly like order details. Collapsed rows keep the single chip: for single-item orders it is the item's direct link; for multi-item orders it uses the first item's direct link (expanding the row exposes the per-item set).
2. **Pending + Late ship-status chips.** Add to `SHIP_STATUSES`; "Late" → `late`; "Pending" matches both `pending` and `pre_shipment` derived statuses (one user-facing concept). Colors: late amber, pending slate-blue.
3. **Is/is-not filtering.** Chip groups (ship status, order status, case filters, condition) cycle off → include → exclude; exclude renders red/struck-through. URL & saved-filter format: `!`-prefixed values (`shipStatus=delivered,!late`); parser treats unprefixed as include (existing saved filters unaffected). Matching: include-set OR within group as today; exclude-set removes matches; both may coexist.
4. **Remove "Order details →" chip** from search expanded rows (5 other routes to order details remain).
5. **Edit Condition button (receiving log).** In `scan-list.tsx` next to Edit Product; loads conditions from `/api/units/conditions` (dynamic, per project rule), saves via existing `PATCH /api/units/[unitId]`, then triggers re-evaluation of that unit's inventory state through the shared evaluator (dependency on Phase 1).
6. **Condition filter (search page).** New chip group from `/api/units/conditions`; matches orders having ≥1 unit with (or without, via is-not) the condition; client-side like existing case filters.

## Testing

- Evaluator: TDD unit tests (`scripts/test-inventory-evaluator.ts`) covering every lifecycle edge (open/closed/escalated/resolved-case/ship-back/multi-return/null-item-id).
- Reclassification: dry-run report reviewed on dev against prod-copy data; counts must reconcile with the diagnostic (9 stuck → on_hand, 38 open → return_filed, 26 escalated-linked, 77 unchanged).
- UI: build + manual pass on dev; link URLs spot-checked against order-details equivalents.

## Risks

- Manual inventory-state overrides (if any) surface as transitions in the dry-run report — reviewed before apply, restorable from snapshot.
- eBay case-status vocabulary may contain values beyond those observed; unknown statuses default to "unresolved" (conservative: keeps `return_escalated` visible rather than silently closing).

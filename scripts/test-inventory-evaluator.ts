import { evaluateUnitState, ReturnForEval } from "../src/lib/inventory-evaluator";

const bad = { condition_status: "cracked", inventory_state: "on_hand" };
const badTBR = { condition_status: "cracked", inventory_state: "to_be_returned" };
const damaged = { condition_status: "damaged", inventory_state: "return_filed" };
const good = { condition_status: "good", inventory_state: "to_be_returned" };
const goodOnHand = { condition_status: "good", inventory_state: "on_hand" };
const R = (o: Partial<ReturnForEval> = {}) => ({ ebay_state: null, ebay_status: null, escalated: false,
  return_shipped_date: null, return_delivered_date: null, creation_date: null, case_id: null, ...o });

let failed = 0;
function check(name: string, actual: string | null, expected: string | null) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}` + (ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
}

// no return filed
check("bad condition, no return, on_hand -> to_be_returned", evaluateUnitState(bad, [], []), "to_be_returned");
check("bad condition, no return, already to_be_returned -> no change", evaluateUnitState(badTBR, [], []), null);
check("good condition, no return -> no change", evaluateUnitState(goodOnHand, [], []), null);
check("good condition, no return, stuck at to_be_returned -> on_hand", evaluateUnitState({ condition_status: "good", inventory_state: "to_be_returned" }, [], []), "on_hand");
check("bad condition, no return, already returned -> no change", evaluateUnitState({ condition_status: "cracked", inventory_state: "returned" }, [], []), null);
// INR case present, no return — INR cases are NOT returns; unit never sits in needs-return
check("INR case, no return, damaged in to_be_returned -> fair", evaluateUnitState({ condition_status: "damaged", inventory_state: "to_be_returned" }, [], [{ case_id: "5555", ebay_status: "CLOSED" }]), "fair");
check("INR case, no return, cracked in to_be_returned -> parts_repair", evaluateUnitState(badTBR, [], [{ case_id: null, ebay_status: "OPEN" }]), "parts_repair");
check("INR case, no return, good in to_be_returned -> on_hand", evaluateUnitState(good, [], [{ case_id: "5555", ebay_status: "CS_CLOSED" }]), "on_hand");
check("INR case, no return, bad on_hand -> parts_repair (never to_be_returned)", evaluateUnitState(bad, [], [{ case_id: null, ebay_status: "OPEN" }]), "parts_repair");
check("INR case, no return, damaged already fair -> no change", evaluateUnitState({ condition_status: "damaged", inventory_state: "fair" }, [], [{ case_id: "5555", ebay_status: "CLOSED" }]), null);
check("INR case does not override open return lifecycle", evaluateUnitState(badTBR, [R({ ebay_state: "RETURN_REQUESTED" })], [{ case_id: null, ebay_status: "OPEN" }]), "return_filed");
// Order fully refunded, no return, no INR — nothing left to claim; never needs-return
check("full refund, no return, damaged in to_be_returned -> fair", evaluateUnitState({ condition_status: "damaged", inventory_state: "to_be_returned" }, [], [], true), "fair");
check("full refund, no return, cracked in to_be_returned -> parts_repair", evaluateUnitState(badTBR, [], [], true), "parts_repair");
check("full refund, no return, good in to_be_returned -> on_hand", evaluateUnitState(good, [], [], true), "on_hand");
check("full refund, no return, bad on_hand -> parts_repair (never flagged)", evaluateUnitState(bad, [], [], true), "parts_repair");
check("partial refund only (flag false) keeps orphan rule", evaluateUnitState(bad, [], [], false), "to_be_returned");
check("full refund does not override open return lifecycle", evaluateUnitState(badTBR, [R({ ebay_state: "RETURN_REQUESTED" })], [], true), "return_filed");
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

if (failed > 0) {
  console.log(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll tests passed");

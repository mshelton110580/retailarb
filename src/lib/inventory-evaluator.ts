export type UnitForEval = { condition_status: string | null; inventory_state: string };
export type ReturnForEval = {
  ebay_state: string | null; ebay_status: string | null; escalated: boolean;
  return_shipped_date: Date | null; return_delivered_date: Date | null;
  creation_date: Date | null; case_id: string | null;
};
export type CaseForEval = { case_id: string | null; ebay_status: string | null };

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
    // INR cases are not returns: a unit with an INR case (open or resolved) never
    // sits in needs-return. The item was kept; the INR page tracks the dispute.
    if (cases.length > 0) {
      if (unit.inventory_state === "to_be_returned" || unit.inventory_state === "on_hand") return pickNoReturn(closedOutcome());
      return null;
    }
    if (isBad && unit.inventory_state === "on_hand") return "to_be_returned";
    if (!isBad && unit.inventory_state === "to_be_returned") return "on_hand";
    return null;

    function pickNoReturn(s: string): string | null { return s === unit.inventory_state ? null : s; }
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

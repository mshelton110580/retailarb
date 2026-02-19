import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/units/bulk
 * Bulk update category, inventory_state, or condition_status on multiple units.
 *
 * Body: {
 *   unitIds: string[]
 *   updates: {
 *     categoryId?: string | null
 *     state?: "on_hand" | "to_be_returned" | "parts_repair" | "returned"
 *     condition?: string
 *   }
 * }
 */
export async function PATCH(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const { unitIds, updates } = body as {
    unitIds: string[];
    updates: {
      categoryId?: string | null;
      state?: string;
      condition?: string;
    };
  };

  if (!unitIds || unitIds.length === 0) {
    return NextResponse.json({ error: "unitIds required" }, { status: 400 });
  }

  const VALID_STATES = ["on_hand", "to_be_returned", "parts_repair", "returned"];

  const data: Record<string, any> = {};

  if ("categoryId" in updates) {
    if (updates.categoryId !== null && updates.categoryId !== undefined) {
      // Verify category exists
      const cat = await prisma.item_categories.findUnique({ where: { id: updates.categoryId } });
      if (!cat) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
    }
    data.category_id = updates.categoryId ?? null;
  }

  if (updates.state) {
    if (!VALID_STATES.includes(updates.state)) {
      return NextResponse.json({ error: `Invalid state. Must be one of: ${VALID_STATES.join(", ")}` }, { status: 400 });
    }
    data.inventory_state = updates.state;
  }

  if (updates.condition) {
    data.condition_status = updates.condition;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
  }

  const result = await prisma.received_units.updateMany({
    where: { id: { in: unitIds } },
    data
  });

  return NextResponse.json({
    ok: true,
    updated: result.count
  });
}

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import AdmZip from "adm-zip";

/**
 * POST /api/orders/import-ebay-export
 *
 * Accepts eBay order export CSV (the "Orders" export from My eBay or Seller Hub).
 * Parses each row and backfills `original_total` on orders where it is currently null.
 *
 * eBay export CSV has these relevant columns (header names vary slightly by region):
 *   - "Order number" / "Sales record number"  → order_id
 *   - "Order total" / "Total price"           → original_total
 *
 * The CSV is sent as `multipart/form-data` with field name "file",
 * OR as raw text/csv body,
 * OR as JSON { rows: [{ orderId, orderTotal }] } for programmatic use.
 *
 * Returns: { updated: number, skipped: number, notFound: number, errors: string[] }
 */

interface ExportRow {
  orderId: string;
  orderTotal: number;
}

/** Parse a raw CSV string into ExportRow[]. Handles quoted fields. */
function parseCsv(csvText: string): ExportRow[] {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  // Detect header row
  const headerLine = lines[0].replace(/^\uFEFF/, ""); // strip BOM
  const headers = splitCsvLine(headerLine).map((h) => h.trim().toLowerCase());

  // Find order ID column — eBay uses various names
  const orderIdCandidates = [
    "order number", "order id", "sales record number", "record number",
    "order#", "orderid", "ordernumber"
  ];
  const orderTotalCandidates = [
    "order total", "total price", "sale price", "total amount",
    "gross transaction value", "ordertotal", "total"
  ];

  const orderIdIdx = headers.findIndex((h) => orderIdCandidates.some((c) => h.includes(c)));
  const orderTotalIdx = headers.findIndex((h) => orderTotalCandidates.some((c) => h.includes(c)));

  if (orderIdIdx === -1 || orderTotalIdx === -1) {
    throw new Error(
      `Could not find required columns. ` +
      `Headers found: [${headers.slice(0, 10).join(", ")}]. ` +
      `Need: order ID (e.g. "Order number") and total (e.g. "Order total").`
    );
  }

  const rows: ExportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = splitCsvLine(line);
    const rawId = cols[orderIdIdx]?.trim().replace(/^["']|["']$/g, "") ?? "";
    const rawTotal = cols[orderTotalIdx]?.trim().replace(/^["']|["']$/g, "").replace(/[$,€£¥]/g, "") ?? "";

    if (!rawId || !rawTotal) continue;

    const total = parseFloat(rawTotal);
    if (isNaN(total) || total < 0) continue;

    rows.push({ orderId: rawId, orderTotal: total });
  }

  return rows;
}

/** Split a single CSV line respecting double-quoted fields */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let exportRows: ExportRow[] = [];
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      // Programmatic JSON: { rows: [{ orderId, orderTotal }] }
      const body = await req.json();
      if (!Array.isArray(body.rows)) {
        return NextResponse.json({ error: "Expected { rows: [{ orderId, orderTotal }] }" }, { status: 400 });
      }
      exportRows = body.rows
        .filter((r: any) => r.orderId && r.orderTotal != null)
        .map((r: any) => ({ orderId: String(r.orderId).trim(), orderTotal: Number(r.orderTotal) }))
        .filter((r: ExportRow) => !isNaN(r.orderTotal) && r.orderTotal >= 0);

    } else if (contentType.includes("multipart/form-data")) {
      // File upload — accepts .csv or .zip
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file uploaded (field name: 'file')" }, { status: 400 });
      }
      const uploadedFile = file as File;
      const isZip = uploadedFile.name.toLowerCase().endsWith(".zip") ||
                    uploadedFile.type === "application/zip" ||
                    uploadedFile.type === "application/x-zip-compressed";

      if (isZip) {
        // Extract first .csv file found inside the ZIP
        const arrayBuf = await uploadedFile.arrayBuffer();
        const zip = new AdmZip(Buffer.from(arrayBuf));
        const entries = zip.getEntries().filter(e => e.entryName.toLowerCase().endsWith(".csv"));
        if (entries.length === 0) {
          return NextResponse.json({ error: "No .csv file found inside the ZIP archive." }, { status: 400 });
        }
        // Use first CSV entry (eBay exports typically have one CSV)
        const csvText = entries[0].getData().toString("utf8");
        exportRows = parseCsv(csvText);
      } else {
        const text = await uploadedFile.text();
        exportRows = parseCsv(text);
      }

    } else {
      // Raw CSV body
      const text = await req.text();
      if (!text.trim()) {
        return NextResponse.json({ error: "Empty body" }, { status: 400 });
      }
      exportRows = parseCsv(text);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to parse input" }, { status: 400 });
  }

  if (exportRows.length === 0) {
    return NextResponse.json({ error: "No valid rows parsed from input" }, { status: 400 });
  }

  console.log(`[eBay Export Import] Processing ${exportRows.length} rows`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const row of exportRows) {
    try {
      // Only backfill if original_total is currently null
      const result = await prisma.orders.updateMany({
        where: {
          order_id: row.orderId,
          original_total: null
        },
        data: {
          original_total: row.orderTotal
        }
      });

      if (result.count > 0) {
        updated++;
        console.log(`[eBay Export Import] Updated order ${row.orderId} original_total = ${row.orderTotal}`);
      } else {
        // Check if order exists at all
        const exists = await prisma.orders.findUnique({
          where: { order_id: row.orderId },
          select: { original_total: true }
        });
        if (!exists) {
          notFound++;
        } else {
          // Already had original_total — don't overwrite
          skipped++;
        }
      }
    } catch (err: any) {
      errors.push(`Order ${row.orderId}: ${err.message}`);
    }
  }

  console.log(`[eBay Export Import] Done: updated=${updated}, skipped=${skipped}, notFound=${notFound}, errors=${errors.length}`);

  return NextResponse.json({
    ok: true,
    parsed: exportRows.length,
    updated,
    skipped,
    notFound,
    errors: errors.slice(0, 20) // cap at 20 for readability
  });
}

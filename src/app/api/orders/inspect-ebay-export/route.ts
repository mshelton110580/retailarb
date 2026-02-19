import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import AdmZip from "adm-zip";

/**
 * POST /api/orders/inspect-ebay-export
 *
 * Accepts the same file formats as import-ebay-export (.csv or .zip),
 * but does NOT touch the database. Returns:
 *   - All column headers found
 *   - Which columns were auto-detected for order_id and order_total (if any)
 *   - First 5 sample rows (raw values for every column)
 *   - Total row count
 *
 * Use this to verify the file structure before committing to a backfill.
 */

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

function inspectCsv(csvText: string) {
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 1) return { error: "File appears to be empty." };

  const headerLine = lines[0].replace(/^\uFEFF/, ""); // strip BOM
  const rawHeaders = splitCsvLine(headerLine).map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());

  // Candidate patterns for order ID and order total columns
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

  // Collect up to 5 sample rows as objects keyed by header name
  const sampleRows: Record<string, string>[] = [];
  let totalDataRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    totalDataRows++;

    if (sampleRows.length < 5) {
      const cols = splitCsvLine(line);
      const row: Record<string, string> = {};
      rawHeaders.forEach((h, idx) => {
        row[h] = cols[idx]?.trim() ?? "";
      });
      sampleRows.push(row);
    }
  }

  return {
    totalColumns: rawHeaders.length,
    totalDataRows,
    headers: rawHeaders,
    detectedOrderIdColumn: orderIdIdx >= 0 ? rawHeaders[orderIdIdx] : null,
    detectedOrderIdIndex: orderIdIdx >= 0 ? orderIdIdx : null,
    detectedOrderTotalColumn: orderTotalIdx >= 0 ? rawHeaders[orderTotalIdx] : null,
    detectedOrderTotalIndex: orderTotalIdx >= 0 ? orderTotalIdx : null,
    mappingReady: orderIdIdx >= 0 && orderTotalIdx >= 0,
    sampleRows,
  };
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  try {
    let csvText: string | null = null;
    let fileName: string | null = null;
    let zipEntries: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file uploaded (field name: 'file')" }, { status: 400 });
      }
      const uploadedFile = file as File;
      fileName = uploadedFile.name;

      const isZip = uploadedFile.name.toLowerCase().endsWith(".zip") ||
                    uploadedFile.type === "application/zip" ||
                    uploadedFile.type === "application/x-zip-compressed";

      if (isZip) {
        const arrayBuf = await uploadedFile.arrayBuffer();
        const zip = new AdmZip(Buffer.from(arrayBuf));
        const allEntries = zip.getEntries();
        zipEntries = allEntries.map(e => e.entryName);
        const csvEntry = allEntries.find(e => e.entryName.toLowerCase().endsWith(".csv"));
        if (!csvEntry) {
          return NextResponse.json({
            error: "No .csv file found inside the ZIP archive.",
            zipContents: zipEntries
          }, { status: 400 });
        }
        csvText = csvEntry.getData().toString("utf8");
        fileName = csvEntry.entryName;
      } else {
        csvText = await uploadedFile.text();
      }
    } else {
      const text = await req.text();
      if (!text.trim()) {
        return NextResponse.json({ error: "Empty body" }, { status: 400 });
      }
      csvText = text;
      fileName = "uploaded.csv";
    }

    const result = inspectCsv(csvText);
    return NextResponse.json({
      fileName,
      zipContents: zipEntries.length > 0 ? zipEntries : undefined,
      ...result,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to parse file" }, { status: 400 });
  }
}

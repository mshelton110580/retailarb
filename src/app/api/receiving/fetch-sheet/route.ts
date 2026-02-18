import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";

function extractSheetId(input: string): { spreadsheetId: string; gid: string } | null {
  try {
    const url = new URL(input.trim());
    // Extract spreadsheet ID from path like /spreadsheets/d/{ID}/...
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return null;
    const spreadsheetId = match[1];
    const gid = url.searchParams.get("gid") ?? "0";
    return { spreadsheetId, gid };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const auth = await requireRole(["ADMIN", "RECEIVER"]);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let url: string;
  try {
    const body = await req.json();
    url = body.url?.trim();
    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = extractSheetId(url);
  if (!parsed) {
    return NextResponse.json({ error: "Could not parse Google Sheets URL" }, { status: 400 });
  }

  const exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.spreadsheetId}/export?format=csv&gid=${parsed.gid}`;

  try {
    const res = await fetch(exportUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Google Sheets returned ${res.status} — make sure the sheet is set to "Anyone with the link can view"` },
        { status: 400 }
      );
    }
    const csv = await res.text();
    return NextResponse.json({ csv });
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to fetch sheet: ${err.message}` }, { status: 500 });
  }
}

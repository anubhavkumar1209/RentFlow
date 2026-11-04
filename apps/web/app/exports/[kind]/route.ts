import { periodOf, todayInIndia } from "@rentflow/core";
import { collectionSheet, ledgerSheet, tenantsSheet, toCsv, toXlsx } from "@rentflow/server";
import { NextResponse, type NextRequest } from "next/server";
import { asCurrentUser, requireOwnerActor } from "@/lib/session";

/** CSV / Excel downloads (M7). Owner only; data read under RLS. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const actor = await requireOwnerActor();
  const period = periodOf(todayInIndia());
  const today = todayInIndia();

  const csv = (body: string, name: string) =>
    new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${today}.csv"` } });

  switch (kind) {
    case "tenants.csv":
      return csv(toCsv(await asCurrentUser((tx) => tenantsSheet(tx, actor.orgId))), "tenants");
    case "collections.csv":
      return csv(toCsv(await asCurrentUser((tx) => collectionSheet(tx, actor.orgId, period))), "collections");
    case "ledger.csv": {
      const tenancy = request.nextUrl.searchParams.get("tenancy") ?? "";
      const sheet = await asCurrentUser((tx) => ledgerSheet(tx, actor.orgId, tenancy));
      if (!sheet) return new NextResponse("Not found", { status: 404 });
      return csv(toCsv(sheet), "ledger");
    }
    case "rentflow.xlsx": {
      const sheets = await asCurrentUser(async (tx) => [await collectionSheet(tx, actor.orgId, period), await tenantsSheet(tx, actor.orgId)]);
      const body = await toXlsx(sheets);
      return new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="rentflow-${today}.xlsx"`,
        },
      });
    }
    default:
      return new NextResponse("Not found", { status: 404 });
  }
}

import { ensureDatabase, getD1 } from "../../../db";
import { jsonError, requestJson } from "../../../lib/runtime";
import { requireAdminApi } from "../../../lib/admin";

type AccessPayload = { token?: string; memberId?: string; method?: "nfc" | "manual" | "reader" };

export async function POST(request: Request) {
  const denied = await requireAdminApi(); if (denied) return denied;
  await ensureDatabase();
  const body = await requestJson<AccessPayload>(request);
  const token = body.token?.replace(/^flexconnect:/, "").trim();
  if (!token && !body.memberId) return jsonError("An NFC token or member is required.");
  const member = body.memberId
    ? await getD1().prepare("SELECT m.*, p.name AS plan_name FROM members m LEFT JOIN plans p ON p.id=m.plan_id WHERE m.id=?").bind(body.memberId).first<Record<string, unknown>>()
    : await getD1().prepare("SELECT m.*, p.name AS plan_name FROM members m LEFT JOIN plans p ON p.id=m.plan_id WHERE m.nfc_token=?").bind(token).first<Record<string, unknown>>();
  if (!member) return jsonError("Credential not recognized.", 404);
  const denyPastDue = (await getD1().prepare("SELECT value FROM settings WHERE key='deny_past_due'").first<{ value: string }>())?.value !== "false";
  let reason = "";
  if (["paused", "canceled"].includes(String(member.status))) reason = `Membership is ${member.status}.`;
  if (member.status === "past_due" && denyPastDue) reason = "Membership payment is past due.";
  if (Number(member.balance_cents) > 0 && denyPastDue) reason = "Account has an outstanding balance.";
  const approved = !reason;
  const id = crypto.randomUUID();
  await getD1().prepare("INSERT INTO visits (id,member_id,method,result,denial_reason) VALUES (?,?,?,?,?)")
    .bind(id, member.id, body.method || "nfc", approved ? "approved" : "denied", reason || null).run();
  if (!approved) return Response.json({ approved, reason, member }, { status: 403 });
  await getD1().prepare("UPDATE members SET last_visit_at=CURRENT_TIMESTAMP WHERE id=?").bind(member.id).run();
  return Response.json({ approved, member, visitId: id });
}

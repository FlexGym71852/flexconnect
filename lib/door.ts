import { getD1 } from "../db";
import { runtimeValue } from "./runtime";

export async function operateDoor(action: "open" | "close", memberId: string | null = null) {
  const endpoint = await runtimeValue("DOOR_CONTROLLER_URL");
  const token = await runtimeValue("DOOR_CONTROLLER_TOKEN");
  const seconds = Number((await getD1().prepare("SELECT value FROM settings WHERE key = 'door_unlock_seconds'").first<{ value: string }>())?.value || 5);
  let result = endpoint ? "sent" : "simulated";

  if (endpoint) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, pulseSeconds: action === "open" ? seconds : 0, source: "flex-connect", memberId }),
    });
    if (!response.ok) result = "controller_error";
  }

  await getD1().prepare("INSERT INTO door_events (id,member_id,action,result) VALUES (?,?,?,?)")
    .bind(crypto.randomUUID(), memberId, action, result).run();
  return { action, result, pulseSeconds: action === "open" ? seconds : 0 };
}

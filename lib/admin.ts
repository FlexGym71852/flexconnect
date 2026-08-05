import { getChatGPTUser } from "../app/chatgpt-auth";
import { runtimeValue } from "./runtime";

export async function requireAdminApi() {
  if (process.env.NODE_ENV === "development") return null;
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Staff sign-in is required." }, { status: 401 });
  const adminEmail = (await runtimeValue("ADMIN_EMAIL")).toLowerCase();
  if (adminEmail && user.email.toLowerCase() !== adminEmail) return Response.json({ error: "This account is not an authorized Flex Connect administrator." }, { status: 403 });
  return null;
}

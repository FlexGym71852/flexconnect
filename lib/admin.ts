import { getChatGPTUser } from "../app/chatgpt-auth";
import { runtimeValue } from "./runtime";

function equalToken(left: string, right: string) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

export async function requireAdminApi(request?: Request) {
  if (process.env.NODE_ENV === "development") return null;
  const configuredToken = await runtimeValue("ADMIN_API_TOKEN");
  const suppliedToken = request?.headers.get("x-flex-admin-token") || "";
  if (configuredToken && equalToken(configuredToken, suppliedToken)) return null;
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Staff sign-in is required." }, { status: 401 });
  const adminEmail = (await runtimeValue("ADMIN_EMAIL")).toLowerCase();
  if (adminEmail && user.email.toLowerCase() !== adminEmail) return Response.json({ error: "This account is not an authorized Flex Connect administrator." }, { status: 403 });
  return null;
}

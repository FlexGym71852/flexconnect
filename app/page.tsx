import Dashboard from "./dashboard";
import { requireChatGPTUser } from "./chatgpt-auth";
import { runtimeValue } from "../lib/runtime";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (process.env.NODE_ENV !== "development") {
    const user = await requireChatGPTUser("/");
    const adminEmail = (await runtimeValue("ADMIN_EMAIL")).toLowerCase();
    if (adminEmail && user.email.toLowerCase() !== adminEmail) {
      return <main className="success-page"><div className="success-mark">×</div><p>FLEX CONNECT STAFF</p><h1>Access is restricted.</h1><p>This ChatGPT account is not listed as the Flex Connect administrator.</p></main>;
    }
  }
  return <Dashboard />;
}

import * as access from "../../access/route";
import * as bootstrap from "../../bootstrap/route";
import * as door from "../../door/route";
import * as members from "../../members/route";
import * as nfc from "../../nfc/route";
import * as plans from "../../plans/route";
import * as products from "../../products/route";
import * as publicPlans from "../../public/plans/route";
import * as sales from "../../sales/route";
import * as settings from "../../settings/route";
import * as stripeCheckout from "../../stripe/checkout/route";

type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", (request: Request) => Promise<Response>>>;

const routes: Record<string, RouteModule> = {
  access,
  bootstrap,
  door,
  members,
  nfc,
  plans,
  products,
  "public/plans": publicPlans,
  sales,
  settings,
  "stripe/checkout": stripeCheckout,
};

function cors(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", request.headers.get("origin") || "*");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, x-flex-admin-token");
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function dispatch(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204 }));
  const key = (await context.params).path.join("/");
  const route = routes[key];
  const handler = route?.[request.method as keyof RouteModule];
  if (!handler) return cors(request, Response.json({ error: "API route not found." }, { status: 404 }));
  try { return cors(request, await handler(request)); }
  catch (error) { return cors(request, Response.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 500 })); }
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;

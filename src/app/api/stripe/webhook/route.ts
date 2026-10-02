import { NextResponse } from "next/server";
import Stripe from "stripe";
import { handleWebhook } from "@/server/billing/stripe";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";

// Stripe calls this when a subscription starts, renews, fails or ends.
// Checked twice: here with Stripe's library, then again inside the
// database (which is what actually allows the change).
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return NextResponse.json({ error: "not configured" }, { status: 400 });
  try {
    await Stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  const result = await handleWebhook(payload, signature);
  if (result === "bad_signature" || result === "not_configured") {
    console.warn("[stripe] database rejected webhook:", result);
    return NextResponse.json({ error: result }, { status: 400 });
  }
  if (result === "unknown_org") console.warn("[stripe] webhook for an unknown organization");
  return NextResponse.json({ received: true, result });
}

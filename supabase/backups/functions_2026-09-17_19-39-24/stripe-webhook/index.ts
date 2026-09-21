// stripe-webhook Edge Function
// Assumes STRIPE_WEBHOOK_SECRET is set as an environment secret
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
function hexToUint8Array(hex) {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex");
  const arr = new Uint8Array(hex.length / 2);
  for(let i = 0; i < hex.length; i += 2){
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}
function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++)diff |= a[i] ^ b[i];
  return diff === 0;
}
function parseStripeSignatureHeader(header) {
  const parts = header.split(",");
  const map = {};
  for (const p of parts){
    const [k, v] = p.split("=");
    if (k && v) map[k] = v;
  }
  return map;
}
async function computeHmacSha256(secret, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req)=>{
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405
      });
    }
    const body = await req.text();
    const sigHeader = req.headers.get("stripe-signature");
    if (!sigHeader) {
      return new Response("Missing stripe-signature header", {
        status: 400
      });
    }
    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not set");
      return new Response("Server misconfiguration", {
        status: 500
      });
    }
    const parsed = parseStripeSignatureHeader(sigHeader);
    const timestamp = parsed["t"];
    const v1 = parsed["v1"];
    if (!timestamp || !v1) {
      return new Response("Invalid stripe-signature header", {
        status: 400
      });
    }
    const signedPayload = `${timestamp}.${body}`;
    const expectedSigHex = await computeHmacSha256(STRIPE_WEBHOOK_SECRET, signedPayload);
    const expected = hexToUint8Array(expectedSigHex);
    const actual = hexToUint8Array(v1);
    if (!safeCompare(expected, actual)) {
      return new Response("Invalid signature", {
        status: 400
      });
    }
    const tolSeconds = 300;
    const now = Math.floor(Date.now() / 1000);
    const tsNum = parseInt(timestamp, 10);
    if (Math.abs(now - tsNum) > tolSeconds) {
      return new Response("Timestamp outside the tolerance zone", {
        status: 400
      });
    }
    const evt = JSON.parse(body);
    switch(evt.type){
      case "payment_intent.succeeded":
        {
          const pi = evt.data.object;
          console.log("PaymentIntent succeeded:", pi.id);
          break;
        }
      case "invoice.payment_failed":
        {
          const invoice = evt.data.object;
          console.log("Invoice payment failed:", invoice.id);
          break;
        }
      case "checkout.session.completed":
        {
          const session = evt.data.object;
          console.log("Checkout session completed:", session.id);
          break;
        }
      default:
        console.log("Unhandled event type:", evt.type);
    }
    return new Response(JSON.stringify({
      received: true
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response("Internal error", {
      status: 500
    });
  }
});

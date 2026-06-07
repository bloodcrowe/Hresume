// ═══════════════════════════════════════════════════════════════════
// Howdy Resume — Stripe Webhook Handler
// Upload this file to GitHub as: api/webhook.js
//
// In Vercel → Settings → Environment Variables, add:
//   STRIPE_SECRET_KEY        = sk_live_...
//   STRIPE_WEBHOOK_SECRET    = whsec_... (from Stripe dashboard)
//
// In Stripe Dashboard → Developers → Webhooks:
//   Endpoint URL: https://howdyresume.vercel.app/api/webhook
//   Events to listen for: checkout.session.completed
// ═══════════════════════════════════════════════════════════════════

export const config = { api: { bodyParser: false } }; // Required for signature verification

async function getRawBody(req) {
  return new Promise((resolve, reject) => {A
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeSecretKey) {
    console.error('Missing STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY env vars');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  let event;
  try {
    const rawBody = await getRawBody(req);

    // Verify Stripe signature manually (no SDK needed)
    const crypto = await import('crypto');
    const [, timestamp] = sig.split(',').find(p => p.startsWith('t=')).split('=');
    const [, v1] = sig.split(',').find(p => p.startsWith('v1=')).split('=');
    const payload = `${timestamp}.${rawBody.toString()}`;
    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

    if (expected !== v1) {
      console.error('Webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    event = JSON.parse(rawBody.toString());
  } catch (err) {
    console.error('Webhook parse error:', err.message);
    return res.status(400).json({ error: 'Webhook error' });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const amountTotal = session.amount_total; // in cents

    // Determine plan based on amount
    // Pro = $7.99/mo = 799 cents, Agency = $19.99/mo = 1999 cents
    let plan = 'pro';
    if (amountTotal >= 1999) plan = 'agency';

    console.log(`✅ Payment confirmed: ${customerEmail} → ${plan} plan ($${amountTotal / 100})`);

    // Store in Vercel KV if you add it later, for now just log.
    // The client-side upgrade is handled via the success redirect URL.
  }

  res.status(200).json({ received: true });
}

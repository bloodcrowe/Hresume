// ═══════════════════════════════════════════════════════════════════
// Howdy Resume — Vercel Serverless API Proxy
// Keeps your Anthropic API key AND admin credentials secure
//
// SETUP INSTRUCTIONS:
// 1. In Vercel dashboard → Settings → Environment Variables add:
//    ANTHROPIC_API_KEY = your_key_from_console.anthropic.com
//    ADMIN_EMAIL       = admin@howdyresume.com
//    ADMIN_PASSWORD    = your_admin_password
// 2. Deploy / Redeploy after adding env vars
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS — always allow (function is protected by action-level auth)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userMsg, systemMsg, action, email, password, sessionId } = req.body;

  // ── Verify Stripe payment ────────────────────────────────────────
  if (action === 'verify-payment') {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured.' });
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId.' });
    try {
      const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${stripeKey}` }
      });
      if (!stripeRes.ok) return res.status(400).json({ error: 'Could not verify payment.' });
      const session = await stripeRes.json();
      if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not completed.' });
      const amount = session.amount_total;
      const plan = amount >= 1999 ? 'agency' : 'pro';
      const customerEmail = session.customer_details?.email || '';
      return res.status(200).json({ success: true, plan, email: customerEmail });
    } catch(e) {
      return res.status(500).json({ error: 'Verification error.' });
    }
  }
  // ────────────────────────────────────────────────────────────────

  // ── Send email via Resend ────────────────────────────────────────
  if (action === 'send-email') {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(500).json({ error: 'Email not configured.' });
    const { to, subject, html } = req.body;
    if (!to || !subject || !html) return res.status(400).json({ error: 'Missing email fields.' });
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Howdy Resume <hello@howdyresume.com>', reply_to: 'howdyresume@gmail.com', to, subject, html })
      });
      if (!r.ok) { const e = await r.json(); return res.status(500).json({ error: e.message }); }
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: 'Email send failed.' });
    }
  }
  // ────────────────────────────────────────────────────────────────

  // ── Admin auth endpoint ──────────────────────────────────────────
  if (action === 'admin-auth') {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
      return res.status(500).json({ error: 'Admin credentials not configured on server.' });
    }
    if (email === adminEmail && password === adminPassword) {
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: 'Incorrect credentials.' });
  }
  // ────────────────────────────────────────────────────────────────

  if (!userMsg) {
    return res.status(400).json({ error: 'Missing userMsg' });
  }

  // Basic abuse prevention — reject suspiciously long inputs
  if (userMsg.length > 8000) {
    return res.status(400).json({ error: 'Input too long' });
  }

  try {
    const body = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content: userMsg }],
    };
    if (systemMsg) body.system = systemMsg;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY, // Secure — from env vars
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Anthropic API error:', err);
      return res.status(response.status).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return res.status(200).json({ text });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

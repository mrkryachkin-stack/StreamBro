// StreamBro — Cloudflare Worker for email sending via MailChannels
// Deploy this to Cloudflare Workers at route: streambro.ru/api/send-mail
// MailChannels provides free email sending for Cloudflare Workers

export default {
  async fetch(request, env) {
    // Only allow POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Verify secret to prevent abuse
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${env.MAIL_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { to, subject, html } = body;
    if (!to || !subject || !html) {
      return new Response('Missing required fields: to, subject, html', { status: 400 });
    }

    // Send via MailChannels API
    const send_request = new Request('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
          },
        ],
        from: {
          email: env.FROM_EMAIL || 'noreply@streambro.ru',
          name: 'StreamBro',
        },
        subject: subject,
        content: [
          {
            type: 'text/html',
            value: html,
          },
        ],
      }),
    });

    try {
      const resp = await fetch(send_request);
      const text = await resp.text();

      if (resp.status >= 200 && resp.status < 300) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      } else {
        console.error('MailChannels error:', resp.status, text);
        return new Response(JSON.stringify({ error: text }), {
          status: resp.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    } catch (err) {
      console.error('MailChannels fetch error:', err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};

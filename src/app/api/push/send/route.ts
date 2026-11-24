import 'server-only';
import { createSign, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * مُرحِّل إشعارات Firebase Cloud Messaging (HTTP v1).
 * يستدعيه خادم قاعدة البيانات (pg_net) فقط، مع سر مشترك في الترويسة x-relay-secret.
 * مفتاح حساب الخدمة يبقى في متغير البيئة FIREBASE_SERVICE_ACCOUNT على الخادم ولا يصل للمتصفح أبدًا.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SA = { project_id: string; client_email: string; private_key: string };
let cached: { token: string; exp: number } | null = null;

function account(): SA | null {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;
    const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as SA;
    return sa.project_id && sa.client_email && sa.private_key ? { ...sa, private_key: sa.private_key.replace(/\\n/g, '\n') } : null;
  } catch { return null; }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(sa: SA) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64url(createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  if (!r.ok) throw new Error(`oauth ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

function authorized(req: Request) {
  const expected = process.env.PUSH_RELAY_SECRET ?? '';
  const got = req.headers.get('x-relay-secret') ?? '';
  if (expected.length < 32 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sa = account();
  if (!sa) return NextResponse.json({ sent: 0, invalid: [], error: 'FIREBASE_SERVICE_ACCOUNT غير مُعدّ' }, { status: 200 });

  let body: { tokens?: unknown; title?: unknown; body?: unknown; link?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const tokens = (Array.isArray(body.tokens) ? body.tokens : []).filter((t): t is string => typeof t === 'string' && /^[A-Za-z0-9_:\-.]{20,4096}$/.test(t)).slice(0, 20);
  const title = String(body.title ?? 'سوقي').slice(0, 120);
  const text = String(body.body ?? '').slice(0, 1000);
  const link = typeof body.link === 'string' && /^\/[^/]/.test(body.link) ? body.link.slice(0, 300) : '/account/notifications';
  if (!tokens.length) return NextResponse.json({ sent: 0, invalid: [] });

  const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
  let auth: string;
  try { auth = await accessToken(sa); } catch (e) { return NextResponse.json({ sent: 0, invalid: [], error: String(e) }, { status: 502 }); }

  const results = await Promise.all(tokens.map(async (token) => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token,
        notification: { title, body: text },
        data: { link, title, body: text },
        android: { priority: 'HIGH', notification: { sound: 'default', click_action: `${site}${link}` } },
        webpush: { headers: { Urgency: 'high' }, notification: { icon: `${site}/icon-192.png`, badge: `${site}/icon-192.png`, dir: 'rtl', lang: 'ar' }, fcm_options: { link: `${site}${link}` } },
      } }),
    }).catch(() => null);
    if (r?.ok) return { token, ok: true, invalid: false };
    const err = r ? await r.text().catch(() => '') : '';
    return { token, ok: false, invalid: !!r && (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(err)) };
  }));

  return NextResponse.json({
    sent: results.filter((x) => x.ok).length,
    invalid: results.filter((x) => x.invalid).map((x) => x.token),
  });
}

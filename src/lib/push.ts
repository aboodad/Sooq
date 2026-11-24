'use client';
import { getSupabase } from '@/lib/supabase/client';

export type FirebasePublic = { enabled: boolean; apiKey: string; authDomain: string; projectId: string; messagingSenderId: string; appId: string; vapidKey: string };

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function loadConfig(): Promise<FirebasePublic | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', 'public_firebase').maybeSingle();
  const c = data?.value as FirebasePublic | undefined;
  return c?.enabled && c.apiKey && c.projectId && c.messagingSenderId && c.appId && c.vapidKey ? c : null;
}

const TOKEN_KEY = 'sawqy-push-token';

/** يطلب الإذن ويسجّل الجهاز في FCM ثم يحفظ الرمز في حساب المستخدم */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) return { ok: false, message: 'هذا المتصفح لا يدعم إشعارات الجهاز' };
  const cfg = await loadConfig();
  if (!cfg) return { ok: false, message: 'إشعارات الجهاز غير مفعّلة حاليًا' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, message: 'لم يُمنح إذن الإشعارات. فعّله من إعدادات المتصفح' };
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await isSupported())) return { ok: false, message: 'هذا المتصفح لا يدعم Firebase Messaging' };
  const app = getApps()[0] ?? initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain || undefined, projectId: cfg.projectId, messagingSenderId: cfg.messagingSenderId, appId: cfg.appId });
  const token = await getToken(getMessaging(app), { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
  if (!token) return { ok: false, message: 'تعذّر الحصول على رمز الجهاز' };
  const ua = navigator.userAgent;
  const { error } = await getSupabase().rpc('register_push_token', { p_token: token, p_platform: /Android/i.test(ua) ? 'android' : /iPhone|iPad/i.test(ua) ? 'ios' : 'web', p_ua: ua.slice(0, 300) });
  if (error) return { ok: false, message: error.message };
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
  return { ok: true, message: 'تم تفعيل إشعارات الجهاز ✅' };
}

export async function disablePush() {
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (token) await getSupabase().rpc('unregister_push_token', { p_token: token });
  try {
    const { getApps } = await import('firebase/app');
    const { getMessaging, deleteToken } = await import('firebase/messaging');
    if (getApps()[0]) await deleteToken(getMessaging(getApps()[0]));
  } catch { /* ignore */ }
}

export function pushEnabledLocally() {
  try { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
}

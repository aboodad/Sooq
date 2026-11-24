'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, X } from 'lucide-react';
import { toast } from 'sonner';
import { enablePush, pushEnabledLocally, pushSupported } from '@/lib/push';
import { useSession } from '@/hooks/use-session';
import { getSupabase } from '@/lib/supabase/client';

const SNOOZE_KEY = 'sawqy-push-snooze';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // يعود الظهور بعد 3 أيام عند اختيار «لاحقًا»

function snoozed() {
  try { return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) || 0) < SNOOZE_MS; } catch { return false; }
}

/**
 * بطاقة تظهر عند فتح الموقع/التطبيق تطلب السماح بالإشعارات.
 * - تظهر فقط إن كان المتصفح يدعم الإشعارات، وFirebase مفعّل من الإدارة، والإذن لم يُحسم بعد.
 * - إن كان الإذن ممنوحًا مسبقًا والمستخدم مسجّل دون رمز محفوظ، يُسجَّل الجهاز بصمت.
 */
export function PushPrompt() {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !pushSupported()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const { data } = await getSupabase().from('app_settings').select('value').eq('key', 'public_firebase').maybeSingle();
      if (cancelled || !(data?.value as { enabled?: boolean } | undefined)?.enabled) return;
      const perm = Notification.permission;
      if (perm === 'granted') {
        // مزامنة صامتة: الإذن موجود لكن الجهاز غير مربوط بالحساب بعد (مثلًا بعد تسجيل الدخول)
        if (user && !pushEnabledLocally()) enablePush().catch(() => undefined);
        return;
      }
      if (perm === 'default' && !snoozed()) timer = setTimeout(() => !cancelled && setShow(true), 2500);
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [loading, user]);

  if (pathname?.startsWith('/auth')) return null;

  function later() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  }

  async function allow() {
    setBusy(true);
    try {
      if (!user) {
        // الزائر: نطلب الإذن الآن، ويُربط الجهاز تلقائيًا بعد تسجيل الدخول
        const perm = await Notification.requestPermission();
        if (perm === 'granted') toast.success('تم السماح بالإشعارات — سجّل الدخول لتصلك تحديثات طلباتك');
        else toast.error('لم يُمنح الإذن. يمكنك تفعيله لاحقًا من إعدادات المتصفح');
      } else {
        const r = await enablePush();
        (r.ok ? toast.success : toast.error)(r.message);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذّر التفعيل');
    }
    setBusy(false);
    setShow(false);
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="dialog"
          aria-labelledby="push-prompt-title"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="fixed inset-x-3 bottom-24 z-[60] mx-auto max-w-md md:bottom-6"
        >
          <div className="relative overflow-hidden rounded-3xl bg-white p-5 shadow-lift ring-1 ring-slate-200">
            <span className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-brand-50" />
            <button onClick={later} aria-label="إغلاق" className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
            <div className="relative flex items-start gap-4">
              <motion.span
                animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
                transition={{ duration: 1.2, delay: 0.4, repeat: Infinity, repeatDelay: 3 }}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-500 text-white shadow-glow"
              >
                <BellRing className="h-6 w-6" />
              </motion.span>
              <div className="min-w-0 flex-1 pl-6">
                <p id="push-prompt-title" className="font-bold">فعّل الإشعارات</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  تصلك تحديثات طلباتك والعروض الجديدة فورًا، حتى والتطبيق مغلق.
                </p>
              </div>
            </div>
            <div className="relative mt-4 flex gap-2">
              <button
                onClick={allow}
                disabled={busy}
                className="h-11 flex-1 rounded-2xl bg-brand-500 font-bold text-white transition hover:bg-brand-600 disabled:opacity-60"
              >
                {busy ? 'جارٍ التفعيل…' : 'السماح'}
              </button>
              <button onClick={later} className="h-11 rounded-2xl px-5 font-medium text-ink-soft ring-1 ring-slate-200 hover:bg-slate-50">
                لاحقًا
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { BellRing, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { disablePush, enablePush, pushEnabledLocally, pushSupported } from '@/lib/push';
import { usePublicSettings } from '@/hooks/use-settings';
import { getSupabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/** بطاقة تفعيل إشعارات الجهاز (Firebase). تختفي إن كانت القناة غير مفعّلة من الإدارة أو المتصفح لا يدعمها. */
export function PushToggle({ compact }: { compact?: boolean }) {
  const { ready } = usePublicSettings();
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ready || !pushSupported()) return;
    getSupabase().from('app_settings').select('value').eq('key', 'public_firebase').maybeSingle()
      .then(({ data }) => setAvailable(!!(data?.value as { enabled?: boolean } | undefined)?.enabled));
    setOn(pushEnabledLocally());
  }, [ready]);
  if (!available) return null;
  async function toggle() {
    setBusy(true);
    try {
      if (on) { await disablePush(); setOn(false); toast.success('أُوقفت إشعارات هذا الجهاز'); }
      else { const r = await enablePush(); setOn(r.ok); (r.ok ? toast.success : toast.error)(r.message); }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذّر التفعيل'); }
    setBusy(false);
  }
  return (
    <div className={compact ? 'flex items-center gap-2' : 'card flex flex-wrap items-center gap-3 p-4'}>
      {!compact && <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">{on ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}</span>}
      {!compact && <div className="min-w-0 flex-1"><p className="font-semibold">إشعارات الجهاز</p><p className="text-xs text-ink-muted">{on ? 'مفعّلة على هذا الجهاز — تصلك تحديثات الطلبات فورًا' : 'فعّلها لتصلك تحديثات الطلبات حتى والتطبيق مغلق'}</p></div>}
      <Button size="sm" variant={on ? 'outline' : 'primary'} loading={busy} onClick={toggle}>{on ? 'إيقاف' : 'تفعيل'}</Button>
    </div>
  );
}

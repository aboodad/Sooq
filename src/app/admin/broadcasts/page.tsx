'use client';
import { useEffect, useState } from 'react';
import { Megaphone, Search, Send, Store, User, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase/client';
import { useQuery } from '@/hooks/use-query';
import { formatDate } from '@/lib/format';
import { errorMessage, cn } from '@/lib/utils';
import { PageHeader } from '@/components/dashboard/shell';
import { Table, Td } from '@/components/dashboard/widgets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Textarea } from '@/components/ui/field';

type Audience = 'all' | 'customers' | 'merchants' | 'user' | 'store';
type Hit = { id: string; name: string; sub: string | null; is_merchant?: boolean; members?: number };
type Row = { id: number; audience: Audience; title: string; body: string | null; link: string | null; recipients: number; created_at: string };

const AUD: { v: Audience; l: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { v: 'all', l: 'الجميع', hint: 'كل العملاء والتجار', icon: Megaphone },
  { v: 'customers', l: 'العملاء', hint: 'كل من ليس تاجرًا', icon: Users },
  { v: 'merchants', l: 'التجار', hint: 'فرق المتاجر النشطة', icon: Store },
  { v: 'user', l: 'مستخدم واحد', hint: 'عميل أو تاجر محدد', icon: User },
  { v: 'store', l: 'متجر واحد', hint: 'كل فريق متجر محدد', icon: Store },
];
const AUD_LABEL = Object.fromEntries(AUD.map((a) => [a.v, a.l])) as Record<Audience, string>;
const LINKS = [
  { v: '', l: 'بدون رابط' }, { v: '/trending', l: 'الترندات' },
  { v: '/account/orders', l: 'طلباتي' }, { v: '/merchant', l: 'لوحة التاجر' }, { v: '/merchant/orders', l: 'طلبات المتجر' },
];

export default function BroadcastsAdmin() {
  const sb = getSupabase();
  const [aud, setAud] = useState<Audience>('all');
  const [target, setTarget] = useState<Hit | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const single = aud === 'user' || aud === 'store';

  const { data: history, reload } = useQuery(async () => {
    const { data, error } = await sb.from('broadcasts').select('id,audience,title,body,link,recipients,created_at').order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    return data as Row[];
  });

  // عدد المستلمين المتوقع
  useEffect(() => {
    setCount(null);
    if (single && !target) return;
    let off = false;
    sb.rpc('admin_broadcast_count', { p_audience: aud, p_user: aud === 'user' ? target?.id : null, p_store: aud === 'store' ? target?.id : null })
      .then(({ data }) => { if (!off) setCount(typeof data === 'number' ? data : null); });
    return () => { off = true; };
  }, [aud, target, single, sb]);

  // البحث عن مستخدم/متجر
  useEffect(() => {
    if (!single || target || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await sb.rpc('admin_broadcast_search', { p_kind: aud === 'store' ? 'store' : 'user', p_q: q });
      setHits((data as Hit[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, aud, single, target, sb]);

  function pickAudience(v: Audience) { setAud(v); setTarget(null); setQ(''); setHits([]); }

  async function send() {
    if (title.trim().length < 2) return toast.error('اكتب عنوانًا للإشعار');
    if (single && !target) return toast.error(aud === 'store' ? 'اختر المتجر' : 'اختر المستخدم');
    if (link && !/^\/[^/\\]/.test(link)) return toast.error('الرابط يجب أن يبدأ بـ /');
    const who = single ? target!.name : AUD_LABEL[aud];
    if (!single && !window.confirm(`سيُرسل الإشعار إلى ${count ?? ''} مستلم (${who}). متابعة؟`)) return;
    setBusy(true);
    try {
      const { data, error } = await sb.rpc('admin_broadcast', {
        p_audience: aud, p_title: title.trim(), p_body: body.trim() || null, p_link: link.trim() || null,
        p_user: aud === 'user' ? target?.id : null, p_store: aud === 'store' ? target?.id : null,
      });
      if (error) throw error;
      toast.success(`تم الإرسال إلى ${(data as { recipients: number }).recipients} مستلم ✅`);
      setTitle(''); setBody(''); setLink(''); reload();
    } catch (e) { toast.error(errorMessage(e)); }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الإشعارات الجماعية" subtitle="أرسل إشعارًا للعملاء أو التجار أو لمستخدم ومتجر محدد. يصل داخل المنصة، وعلى الجهاز لمن فعّل الإشعارات." />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card space-y-5 p-5">
          <div>
            <p className="mb-2 text-sm font-semibold">المستلمون</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {AUD.map((a) => (
                <button key={a.v} onClick={() => pickAudience(a.v)}
                  className={cn('rounded-2xl p-3 text-right ring-1 transition', aud === a.v ? 'bg-brand-50 ring-2 ring-brand-500' : 'ring-slate-200 hover:bg-slate-50')}>
                  <a.icon className={cn('h-5 w-5', aud === a.v ? 'text-brand-600' : 'text-ink-muted')} />
                  <p className="mt-2 text-sm font-bold">{a.l}</p>
                  <p className="text-[11px] text-ink-muted">{a.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {single && (
            <div className="relative">
              {target ? (
                <div className="flex items-center gap-3 rounded-2xl bg-brand-50 p-3">
                  {aud === 'store' ? <Store className="h-5 w-5 text-brand-600" /> : <User className="h-5 w-5 text-brand-600" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{target.name}</p>
                    <p className="truncate text-xs text-ink-muted" dir="ltr">{target.sub}</p>
                  </div>
                  <button onClick={() => { setTarget(null); setQ(''); }} aria-label="إزالة" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <>
                  <Field label={aud === 'store' ? 'ابحث عن المتجر (الاسم أو الرابط)' : 'ابحث عن المستخدم (الاسم، البريد، الجوال)'}>
                    <div className="relative">
                      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} className="pr-9" placeholder="اكتب حرفين على الأقل…" />
                    </div>
                  </Field>
                  {hits.length > 0 && (
                    <div className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-auto rounded-2xl bg-white p-1 shadow-lift ring-1 ring-slate-200">
                      {hits.map((h) => (
                        <button key={h.id} onClick={() => { setTarget(h); setHits([]); }} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-right hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{h.name}</p>
                            <p className="truncate text-xs text-ink-muted" dir="ltr">{h.sub}</p>
                          </div>
                          {aud === 'user' && <Badge tone={h.is_merchant ? 'blue' : 'gray'}>{h.is_merchant ? 'تاجر' : 'عميل'}</Badge>}
                          {aud === 'store' && <Badge tone="gray">{h.members ?? 0} عضو</Badge>}
                        </button>
                      ))}
                    </div>
                  )}
                  {q.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-xs text-ink-muted">لا نتائج حتى الآن</p>}
                </>
              )}
            </div>
          )}

          <Field label="العنوان" hint={`${title.length}/120`}>
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: خصومات نهاية الأسبوع 🔥" />
          </Field>
          <Field label="النص (اختياري)" hint={`${body.length}/1000`}>
            <Textarea value={body} maxLength={1000} rows={4} onChange={(e) => setBody(e.target.value)} placeholder="تفاصيل الإشعار…" />
          </Field>
          <Field label="عند الضغط يفتح (اختياري)" hint="رابط داخلي يبدأ بـ / مثل /p/اسم-المنتج">
            <div className="flex flex-wrap gap-2">
              {LINKS.map((l) => (
                <button key={l.v} onClick={() => setLink(l.v)} className={cn('rounded-full px-3 py-1.5 text-xs ring-1', link === l.v ? 'bg-ink text-white ring-ink' : 'ring-slate-200 hover:bg-slate-50')}>{l.l}</button>
              ))}
            </div>
            <Input className="mt-2" dir="ltr" value={link} maxLength={300} onChange={(e) => setLink(e.target.value)} placeholder="/c/electronics" />
          </Field>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button onClick={send} loading={busy} disabled={single && !target}><Send className="h-4 w-4" /> إرسال الإشعار</Button>
            <span className="text-sm text-ink-muted">{count === null ? (single && !target ? 'اختر المستلم' : '…') : `سيصل إلى ${count} مستلم`}</span>
          </div>
        </div>

        {/* معاينة */}
        <div className="space-y-3">
          <p className="text-sm font-semibold">معاينة على الجوال</p>
          <div className="rounded-[28px] bg-gradient-to-b from-slate-800 to-slate-900 p-4">
            <div className="flex items-start gap-3 rounded-2xl bg-white/95 p-3 shadow-lg">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-white"><Megaphone className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-[11px] text-ink-muted"><span>سوقي</span><span>الآن</span></div>
                <p className="truncate text-sm font-bold">{title || 'عنوان الإشعار'}</p>
                <p className="line-clamp-3 text-xs text-ink-soft">{body || 'نص الإشعار يظهر هنا'}</p>
              </div>
            </div>
          </div>
          <p className="text-xs leading-5 text-ink-muted">يُحفظ الإشعار في صندوق إشعارات المستخدم داخل المنصة دائمًا، ويصل كإشعار جهاز لمن سمح بالإشعارات.</p>
        </div>
      </div>

      <div>
        <p className="mb-2 font-semibold">آخر الإشعارات المرسلة</p>
        <Table head={['العنوان', 'المستلمون', 'العدد', 'الرابط', 'التاريخ']} empty={!history?.length}>
          {history?.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <Td><p className="font-semibold">{r.title}</p>{r.body && <p className="line-clamp-1 text-xs text-ink-muted">{r.body}</p>}</Td>
              <Td><Badge tone={r.audience === 'user' || r.audience === 'store' ? 'orange' : 'blue'}>{AUD_LABEL[r.audience]}</Badge></Td>
              <Td>{r.recipients}</Td>
              <Td dir="ltr" className="text-xs">{r.link ?? '—'}</Td>
              <Td className="text-xs">{formatDate(r.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

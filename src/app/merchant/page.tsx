'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Banknote, Boxes, Clock, Eye, Megaphone, MessageCircleQuestion, Package, PackageOpen, Plus, RotateCcw, ShoppingCart, Star, Timer, TrendingUp, Wallet, XCircle, PackageCheck } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { useMerchant } from '@/hooks/use-merchant';
import { useQuery } from '@/hooks/use-query';
import { formatNumber, formatPrice, timeAgo } from '@/lib/format';
import { SUB_STATUS } from '@/lib/status';
import { PageHeader } from '@/components/dashboard/shell';
import { AreaChart, Donut, Funnel, HBars, HoursChart, KpiCard, PeriodTabs, QuickActions } from '@/components/dashboard/charts';
import { StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { PushToggle } from '@/components/push-toggle';

type Pair = [number | null, number | null];
type O = {
  days: number; finance: boolean;
  store: { name: string; slug: string; status: string; rating: number; rating_count: number; commission_rate: number; rejection_reason: string | null };
  kpis: { revenue: Pair | null; net: Pair | null; orders: Pair; aov: Pair | null };
  cancel_rate: Pair; views: Pair; accept_minutes: number | null;
  series: { day: string; revenue: number; orders: number }[];
  status: Record<string, number>; hours: number[]; funnel: { view: number; cart: number; purchase: number };
  top_products: { name: string; qty: number; total: number | null }[]; ratings: number[];
  low_stock: { offer_id: string; name: string; variant: string; available: number }[];
  recent: { id: string; sub_no: string; status: string; subtotal: number; created_at: string }[];
  actions: Record<string, number | null>;
};

const STATUS_COLOR: Record<string, string> = {
  pending_merchant: '#FF7916', accepted: '#0EA5E9', preparing: '#7C3AED', ready: '#14B8A6', handed_over: '#0891B2', at_hub: '#6366F1',
  in_transit: '#2563EB', delivered: '#10B981', delivery_failed: '#DC2626', cancelled: '#94A3B8', return_in_progress: '#EC4899', returned: '#BE185D',
};

export default function MerchantHome() {
  const { store } = useMerchant();
  const [days, setDays] = useState(30);
  const { data: d, loading, error } = useQuery(async () => {
    if (!store) return null;
    const { data, error } = await getSupabase().rpc('merchant_overview', { p_store: store.id, p_days: days });
    if (error) throw error;
    return data as O;
  }, [store?.id, days]);

  if (error) return <p className="card p-6 text-red-600">{error}</p>;
  if (loading && !d) return <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (!d) return null;
  const a = d.actions; const k = d.kpis;
  const ratingTotal = d.ratings.reduce((s, n) => s + n, 0);
  const conv = d.views[0] ? ((k.orders[0] ?? 0) / Number(d.views[0])) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader title={`مرحبًا، ${d.store.name}`} subtitle={`أداء متجرك خلال آخر ${d.days} يومًا مقارنة بالفترة السابقة`}
        actions={<div className="flex flex-wrap gap-2"><PeriodTabs value={days} onChange={setDays} /><Link href="/merchant/products/new"><Button><Plus className="h-4 w-4" /> منتج جديد</Button></Link></div>} />

      {d.store.status !== 'active' && (
        <p className="rounded-2xl bg-orange-50 p-4 text-sm text-orange-800 ring-1 ring-orange-200">
          حالة المتجر: <b>{d.store.status === 'pending' ? 'بانتظار اعتماد الإدارة' : d.store.status}</b>{d.store.rejection_reason ? ` — ${d.store.rejection_reason}` : ''}
        </p>
      )}

      <PushToggle />

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink-soft">إجراءات سريعة</h2>
        <QuickActions items={[
          { href: '/merchant/orders', label: 'طلبات جديدة تنتظر القبول', icon: <ShoppingCart />, n: a.new, tone: 'red' },
          { href: '/merchant/orders', label: 'قيد التجهيز', icon: <PackageCheck />, n: a.preparing, tone: 'orange' },
          { href: '/merchant/batches', label: 'جاهزة / دفعات مفتوحة', icon: <PackageOpen />, n: (a.ready ?? 0) + (a.open_batches ?? 0), tone: 'orange' },
          { href: '/merchant/inventory', label: 'مخزون منخفض', icon: <AlertTriangle />, n: a.low_stock, tone: 'red' },
          { href: '/merchant/questions', label: 'أسئلة عملاء بلا إجابة', icon: <MessageCircleQuestion />, n: a.questions, tone: 'orange' },
          { href: '/merchant/returns', label: 'طلبات إرجاع', icon: <RotateCcw />, n: a.returns, tone: 'orange' },
          { href: '/merchant/products', label: 'منتجات قيد المراجعة', icon: <Package />, n: a.pending_review, tone: 'brand' },
          { href: '/merchant/products/new', label: 'إضافة منتج', icon: <Plus /> },
          { href: '/merchant/products/import', label: 'استيراد CSV', icon: <Boxes /> },
          { href: '/merchant/ads', label: 'روّج منتجًا', icon: <Megaphone /> },
          { href: '/merchant/stories', label: 'نشر استوري', icon: <Eye /> },
          { href: '/merchant/finance', label: a.unsettled != null ? `مستحق: ${formatPrice(a.unsettled)}` : 'المالية', icon: <Wallet /> },
        ]} />
      </section>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <KpiCard index={0} label="المبيعات" value={k.revenue ? formatPrice(k.revenue[0]) : '—'} pair={k.revenue} icon={<TrendingUp />} spark={d.finance ? d.series.map((s) => Number(s.revenue)) : undefined} />
        <KpiCard index={1} label="الطلبات" value={formatNumber(k.orders[0] ?? 0)} pair={k.orders} icon={<ShoppingCart />} color="#FF7916" spark={d.series.map((s) => Number(s.orders))} />
        <KpiCard index={2} label="صافي المستحق لك" value={k.net ? formatPrice(k.net[0]) : '—'} pair={k.net} icon={<Banknote />} color="#7C3AED" hint={`العمولة ${d.store.commission_rate}%`} />
        <KpiCard index={3} label="متوسط قيمة الطلب" value={k.aov ? formatPrice(k.aov[0]) : '—'} pair={k.aov} icon={<Wallet />} color="#0EA5E9" />
        <KpiCard index={4} label="مشاهدات المنتجات" value={formatNumber(d.views[0] ?? 0)} pair={d.views} icon={<Eye />} color="#14B8A6" />
        <KpiCard index={5} label="معدل التحويل" value={`${conv.toFixed(1)}%`} icon={<TrendingUp />} color="#10B981" />
        <KpiCard index={6} label="نسبة الإلغاء" value={`${d.cancel_rate[0] ?? 0}%`} pair={d.cancel_rate} icon={<XCircle />} color="#EF4444" invert />
        <KpiCard index={7} label="متوسط وقت القبول" value={d.accept_minutes != null ? `${d.accept_minutes} دقيقة` : '—'} icon={<Timer />} color="#F59E0B" />
      </div>

      <AreaChart title="المبيعات والطلبات اليومية" data={d.series}
        series={d.finance ? [{ key: 'revenue', label: 'المبيعات', color: '#079EA5', format: formatPrice }, { key: 'orders', label: 'الطلبات', color: '#FF7916' }]
          : [{ key: 'orders', label: 'الطلبات', color: '#FF7916' }]} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Donut title="حالات الطلبات" items={Object.entries(d.status).map(([s, v]) => ({ label: SUB_STATUS[s]?.label ?? s, value: v, color: STATUS_COLOR[s] }))} />
        <Funnel data={d.funnel} />
        <div className="card p-4 md:p-5">
          <h3 className="mb-3 flex items-center justify-between font-bold">التقييمات <span className="flex items-center gap-1 text-sm"><Star className="h-4 w-4 fill-amber-400 text-amber-400" />{Number(d.store.rating).toFixed(1)} <span className="text-xs font-normal text-ink-muted">({d.store.rating_count})</span></span></h3>
          <ul className="space-y-2">
            {[5, 4, 3, 2, 1].map((r) => {
              const n = d.ratings[r - 1] ?? 0;
              return (
                <li key={r} className="flex items-center gap-2 text-xs">
                  <span className="w-6">{r}★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${ratingTotal ? (n / ratingTotal) * 100 : 0}%` }} /></div>
                  <b className="w-8 text-left">{n}</b>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <HoursChart hours={d.hours} title="أوقات ذروة الطلبات" />
        <HBars title="الأكثر مبيعًا (كمية)" color="#10B981" items={d.top_products.map((p) => ({ label: p.name, value: Number(p.qty), sub: p.total != null ? formatPrice(p.total) : undefined }))} />
        <div className="card p-4 md:p-5">
          <h3 className="mb-3 flex items-center gap-2 font-bold"><AlertTriangle className="h-5 w-5 text-orange-500" /> قاربت على النفاد</h3>
          {d.low_stock.length ? (
            <ul className="space-y-2">{d.low_stock.map((l) => (
              <li key={l.offer_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span className="line-clamp-1">{l.name}{l.variant && l.variant !== 'افتراضي' ? ` — ${l.variant}` : ''}</span>
                <span className={l.available === 0 ? 'font-bold text-red-600' : 'font-bold text-orange-600'}>{l.available}</span>
              </li>))}
            </ul>
          ) : <p className="text-sm text-ink-muted">المخزون بحالة جيدة 👌</p>}
          <Link href="/merchant/inventory" className="mt-3 block text-sm font-semibold text-brand-600">إدارة المخزون ←</Link>
        </div>
      </div>

      <div className="card p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">أحدث الطلبات</h3><Link href="/merchant/orders" className="text-sm font-semibold text-brand-600">الكل ←</Link></div>
        {d.recent.length ? (
          <div className="divide-y divide-slate-100">{d.recent.map((r) => (
            <Link key={r.id} href={`/merchant/orders/${r.id}`} className="flex flex-wrap items-center gap-3 py-3 text-sm hover:bg-slate-50">
              <b dir="ltr">{r.sub_no}</b><StatusBadge map={SUB_STATUS} value={r.status} />
              <span className="mr-auto font-semibold">{formatPrice(r.subtotal)}</span><span className="flex items-center gap-1 text-xs text-ink-muted"><Clock className="h-3 w-3" />{timeAgo(r.created_at)}</span>
            </Link>))}
          </div>
        ) : <p className="text-sm text-ink-muted">لا طلبات بعد.</p>}
      </div>
    </div>
  );
}

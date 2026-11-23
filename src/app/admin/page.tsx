'use client';
import { useState } from 'react';
import { AlertTriangle, BadgeDollarSign, Banknote, Boxes, LifeBuoy, Megaphone, MessageCircleQuestion, PackageCheck, Percent, RotateCcw, Send, ShoppingCart, Store, Undo2, UserPlus, Users, XCircle, Activity } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { useQuery } from '@/hooks/use-query';
import { formatNumber, formatPrice } from '@/lib/format';
import { FULFILLMENT_LABEL, PAYMENT_CHANNEL, SUB_STATUS } from '@/lib/status';
import { PageHeader } from '@/components/dashboard/shell';
import { AreaChart, Donut, Funnel, HBars, HoursChart, KpiCard, PeriodTabs, QuickActions } from '@/components/dashboard/charts';
import { Skeleton } from '@/components/ui/misc';

type Pair = [number | null, number | null];
type O = {
  days: number;
  kpis: { gmv: Pair; orders: Pair; aov: Pair; customers: Pair };
  commission: Pair | null; new_users: Pair; cancel_rate: Pair;
  series: { day: string; gmv: number; orders: number; users: number }[];
  status: Record<string, number>; payments: { k: string; n: number; total: number }[]; fulfillment: Record<string, number>;
  categories: { name: string; total: number }[]; governorates: { name: string; total: number; n: number }[];
  hours: number[]; funnel: { view: number; cart: number; purchase: number };
  top_stores: { name: string; slug: string; total: number; n: number }[]; top_products: { name: string; qty: number; total: number }[];
  actions: Record<string, number>;
};

const STATUS_COLOR: Record<string, string> = {
  awaiting_payment: '#F59E0B', pending_merchant: '#FF7916', accepted: '#0EA5E9', preparing: '#7C3AED', ready: '#14B8A6', handed_over: '#0891B2',
  at_hub: '#6366F1', in_transit: '#2563EB', delivered: '#10B981', delivery_failed: '#DC2626', cancelled: '#94A3B8', return_in_progress: '#EC4899', returned: '#BE185D',
};

export default function AdminHome() {
  const [days, setDays] = useState(30);
  const { data: d, loading, error } = useQuery(async () => {
    const { data, error } = await getSupabase().rpc('admin_overview', { p_days: days });
    if (error) throw error;
    return data as O;
  }, [days]);

  if (error) return <p className="card p-6 text-red-600">{error}</p>;
  if (loading && !d) return <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (!d) return null;
  const a = d.actions;
  const sp = (k: 'gmv' | 'orders' | 'users') => d.series.map((s) => Number(s[k]));

  return (
    <div className="space-y-6">
      <PageHeader title="نظرة عامة" subtitle={`أداء المنصة خلال آخر ${d.days} يومًا مقارنة بالفترة السابقة`} actions={<PeriodTabs value={days} onChange={setDays} />} />

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink-soft">إجراءات سريعة</h2>
        <QuickActions items={[
          { href: '/admin/payments', label: 'مدفوعات بانتظار التأكيد', icon: <BadgeDollarSign />, n: a.pending_payments, tone: 'orange' },
          { href: '/admin/ops', label: 'طلبات متأخرة لدى التجار', icon: <AlertTriangle />, n: a.late, tone: 'red' },
          { href: '/admin/stores', label: 'متاجر بانتظار الاعتماد', icon: <Store />, n: a.stores_pending, tone: 'orange' },
          { href: '/admin/catalog', label: 'منتجات للمراجعة', icon: <PackageCheck />, n: a.products_pending, tone: 'orange' },
          { href: '/admin/orders', label: 'تعذّر التسليم', icon: <XCircle />, n: a.failed, tone: 'red' },
          { href: '/admin/orders', label: 'طلبات إرجاع', icon: <RotateCcw />, n: a.returns, tone: 'orange' },
          { href: '/admin/payments', label: 'مبالغ للاسترداد', icon: <Undo2 />, n: a.refunds, tone: 'red' },
          { href: '/admin/support', label: 'تذاكر دعم مفتوحة', icon: <LifeBuoy />, n: a.tickets, tone: 'orange' },
          { href: '/admin/ads', label: 'طلبات إعلان', icon: <Megaphone />, n: a.ads, tone: 'brand' },
          { href: '/admin/support', label: 'أسئلة بلا إجابة', icon: <MessageCircleQuestion />, n: a.questions, tone: 'brand' },
          { href: '/hub', label: 'دفعات بانتظار المركز', icon: <Boxes />, n: a.batches, tone: 'brand' },
          { href: '/admin/notifications', label: 'رسائل فشل إرسالها', icon: <Send />, n: a.outbox_failed, tone: 'red' },
        ]} />
      </section>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <KpiCard index={0} label="إجمالي المبيعات (GMV)" value={formatPrice(d.kpis.gmv[0])} pair={d.kpis.gmv} icon={<Banknote />} spark={sp('gmv')} />
        <KpiCard index={1} label="الطلبات" value={formatNumber(d.kpis.orders[0] ?? 0)} pair={d.kpis.orders} icon={<ShoppingCart />} color="#FF7916" spark={sp('orders')} />
        <KpiCard index={2} label="متوسط قيمة الطلب" value={formatPrice(d.kpis.aov[0])} pair={d.kpis.aov} icon={<Activity />} color="#7C3AED" />
        <KpiCard index={3} label="العمولات" value={d.commission ? formatPrice(d.commission[0]) : '—'} pair={d.commission} icon={<Percent />} color="#0EA5E9" />
        <KpiCard index={4} label="عملاء اشتروا" value={formatNumber(d.kpis.customers[0] ?? 0)} pair={d.kpis.customers} icon={<Users />} color="#10B981" />
        <KpiCard index={5} label="مستخدمون جدد" value={formatNumber(d.new_users[0] ?? 0)} pair={d.new_users} icon={<UserPlus />} color="#14B8A6" spark={sp('users')} />
        <KpiCard index={6} label="نسبة الإلغاء" value={`${d.cancel_rate[0] ?? 0}%`} pair={d.cancel_rate} icon={<XCircle />} color="#EF4444" invert />
        <KpiCard index={7} label="معدل التحويل" value={`${d.funnel.view ? ((d.funnel.purchase / d.funnel.view) * 100).toFixed(1) : 0}%`} icon={<Activity />} color="#F59E0B" hint={`${formatNumber(d.funnel.view)} مشاهدة`} />
      </div>

      <AreaChart title="المبيعات والطلبات اليومية" data={d.series}
        series={[{ key: 'gmv', label: 'المبيعات', color: '#079EA5', format: formatPrice }, { key: 'orders', label: 'الطلبات', color: '#FF7916' }]} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Donut title="حالات الشحنات" items={Object.entries(d.status).map(([k, v]) => ({ label: SUB_STATUS[k]?.label ?? k, value: v, color: STATUS_COLOR[k] }))} />
        <Donut title="طرق الدفع (قيمة)" format={formatPrice} center={formatNumber(d.payments.reduce((s, p) => s + p.n, 0))}
          items={d.payments.map((p) => ({ label: PAYMENT_CHANNEL[p.k] ?? p.k, value: Number(p.total) }))} />
        <Donut title="مسارات التوصيل" items={Object.entries(d.fulfillment).map(([k, v]) => ({ label: FULFILLMENT_LABEL[k] ?? k, value: v }))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <HBars title="المبيعات حسب القسم" format={formatPrice} items={d.categories.map((c) => ({ label: c.name, value: Number(c.total) }))} />
        <HBars title="المحافظات الأعلى طلبًا" format={formatPrice} color="#7C3AED" items={d.governorates.map((g) => ({ label: g.name, value: Number(g.total), sub: `${g.n} طلب` }))} />
        <Funnel data={d.funnel} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <HoursChart hours={d.hours} title="أوقات الذروة (عدد الطلبات بالساعة)" />
        <HBars title="أفضل المتاجر" format={formatPrice} color="#FF7916" items={d.top_stores.map((s) => ({ label: s.name, value: Number(s.total), sub: `${s.n} طلب` }))} />
        <HBars title="الأكثر مبيعًا" format={formatPrice} color="#10B981" items={d.top_products.map((p) => ({ label: p.name, value: Number(p.total), sub: `× ${p.qty}` }))} />
      </div>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDay, formatNumber } from '@/lib/format';

/** نسبة التغيّر بين الفترة الحالية والسابقة */
export function delta(pair?: [number | null, number | null] | null) {
  if (!pair) return null;
  const [c, p] = [Number(pair[0] ?? 0), Number(pair[1] ?? 0)];
  if (!p) return c ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}

export function KpiCard({ label, value, pair, icon, color = '#079EA5', spark, invert, hint, index = 0 }: {
  label: string; value: string | number; pair?: [number | null, number | null] | null; icon: React.ReactNode; color?: string;
  spark?: number[]; invert?: boolean; hint?: string; index?: number;
}) {
  const d = delta(pair);
  const good = d === null || d === 0 ? null : invert ? d < 0 : d > 0;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
      className="card relative overflow-hidden p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white [&>svg]:h-5 [&>svg]:w-5" style={{ background: color }}>{icon}</span>
        {d !== null && (
          <span className={cn('flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
            good === null ? 'bg-slate-100 text-ink-muted' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')} dir="ltr">
            {d > 0 ? <ArrowUpRight className="h-3 w-3" /> : d < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}{Math.abs(d)}%
          </span>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-soft">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tracking-tight md:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>}
      {spark && spark.length > 1 && <Sparkline data={spark} color={color} />}
    </motion.div>
  );
}

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1); const w = 100; const h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-7 w-full" aria-hidden>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** مخطط مساحي تفاعلي لسلسلتين (قيمة + عدد) مع مؤشر عند المرور */
export function AreaChart({ data, x = 'day', series, title, right }: {
  data: Record<string, number | string>[]; x?: string; title: string; right?: React.ReactNode;
  series: { key: string; label: string; color: string; format?: (n: number) => string }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600; const H = 200; const P = 6;
  const paths = useMemo(() => series.map((s) => {
    const vals = data.map((d) => Number(d[s.key]) || 0);
    const max = Math.max(...vals, 1);
    const pts = vals.map((v, i) => [P + (i / Math.max(data.length - 1, 1)) * (W - 2 * P), H - P - (v / max) * (H - 2 * P)] as const);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return { ...s, vals, pts, line, area: `${line} L${W - P},${H - P} L${P},${H - P} Z` };
  }), [data, series]);
  const total = (k: number) => paths[k].vals.reduce((a, b) => a + b, 0);
  const idx = hover ?? data.length - 1;

  return (
    <div className="card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold">{title}</h3>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            {paths.map((p, k) => (
              <span key={p.key} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                {p.label}: <b>{(p.format ?? formatNumber)(hover === null ? total(k) : p.vals[idx])}</b></span>
            ))}
          </div>
        </div>
        {right}
      </div>
      <div className="relative" dir="ltr" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full md:h-56"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)));
          }}>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke="#E8EEF0" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />)}
          {paths.map((p, k) => (
            <g key={p.key}>
              <motion.path d={p.area} fill={p.color} opacity={k ? 0.06 : 0.14} initial={{ opacity: 0 }} animate={{ opacity: k ? 0.06 : 0.14 }} />
              <motion.path d={p.line} fill="none" stroke={p.color} strokeWidth={k ? 1.6 : 2.4} strokeDasharray={k ? '5 4' : undefined}
                vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
            </g>
          ))}
          {hover !== null && paths[0]?.pts[idx] && <line x1={paths[0].pts[idx][0]} x2={paths[0].pts[idx][0]} y1={0} y2={H} stroke="#94A3B8" vectorEffect="non-scaling-stroke" />}
          {hover !== null && paths.map((p) => p.pts[idx] && <circle key={p.key} cx={p.pts[idx][0]} cy={p.pts[idx][1]} r={4} fill="#fff" stroke={p.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {hover !== null && data[idx] && (
          <span className="pointer-events-none absolute top-0 rounded-lg bg-ink px-2 py-1 text-[10px] text-white"
            style={{ left: `${(idx / Math.max(data.length - 1, 1)) * 100}%`, transform: 'translateX(-50%)' }}>{formatDay(String(data[idx][x]))}</span>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-muted" dir="ltr">
        <span>{data[0] ? formatDay(String(data[0][x])) : ''}</span>
        {data.length > 2 && <span>{formatDay(String(data[Math.floor(data.length / 2)][x]))}</span>}
        <span>{data.at(-1) ? formatDay(String(data.at(-1)![x])) : ''}</span>
      </div>
    </div>
  );
}

const PALETTE = ['#079EA5', '#FF7916', '#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#64748B', '#EF4444', '#14B8A6'];

/** مخطط دائري مجوّف مع مفتاح */
export function Donut({ title, items, format = formatNumber, center }: {
  title: string; items: { label: string; value: number; color?: string }[]; format?: (n: number) => string; center?: string;
}) {
  const list = items.filter((i) => i.value > 0);
  const sum = list.reduce((a, b) => a + b.value, 0);
  const R = 42; const C = 2 * Math.PI * R; let acc = 0;
  return (
    <div className="card p-4 md:p-5">
      <h3 className="mb-3 font-bold">{title}</h3>
      {sum === 0 ? <p className="py-8 text-center text-sm text-ink-muted">لا توجد بيانات في هذه الفترة</p> : (
        <div className="flex items-center gap-4">
          <div className="relative h-32 w-32 shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx={50} cy={50} r={R} fill="none" stroke="#F1F5F9" strokeWidth={12} />
              {list.map((it, i) => {
                const len = (it.value / sum) * C; const off = acc; acc += len;
                return <motion.circle key={it.label} cx={50} cy={50} r={R} fill="none" stroke={it.color ?? PALETTE[i % PALETTE.length]} strokeWidth={12}
                  strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.08 }} />;
              })}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center"><div><b className="block text-lg">{center ?? formatNumber(sum)}</b><span className="text-[10px] text-ink-muted">الإجمالي</span></div></div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
            {list.map((it, i) => (
              <li key={it.label} className="flex items-center gap-2">
                <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color ?? PALETTE[i % PALETTE.length] }} />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <b>{format(it.value)}</b><span className="w-9 text-left text-ink-muted">{Math.round((it.value / sum) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** أشرطة أفقية مرتبة */
export function HBars({ title, items, format = formatNumber, color = '#079EA5', action }: {
  title: string; items: { label: string; value: number; sub?: string }[]; format?: (n: number) => string; color?: string; action?: React.ReactNode;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="card p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">{title}</h3>{action}</div>
      {!items.length ? <p className="py-6 text-center text-sm text-ink-muted">لا توجد بيانات</p> : (
        <ul className="space-y-3">
          {items.map((it, i) => (
            <li key={it.label + i} className="text-sm">
              <div className="mb-1 flex justify-between gap-2"><span className="truncate">{it.label}{it.sub && <span className="mr-1 text-[11px] text-ink-muted">{it.sub}</span>}</span><b className="shrink-0">{format(it.value)}</b></div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(it.value / max) * 100}%` }} transition={{ delay: i * 0.05 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** توزيع الطلبات على ساعات اليوم */
export function HoursChart({ hours, title = 'أوقات الذروة' }: { hours: number[]; title?: string }) {
  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(Math.max(...hours));
  return (
    <div className="card p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">{title}</h3>
        {hours.some(Boolean) && <span className="text-xs text-ink-muted">الذروة: <b className="text-ink">{peak}:00</b></span>}</div>
      <div className="flex h-28 items-end gap-[3px]" dir="ltr">
        {hours.map((v, h) => (
          <div key={h} className="group relative flex h-full flex-1 flex-col justify-end">
            <span className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-white opacity-0 group-hover:opacity-100">{h}:00 · {v}</span>
            <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max((v / max) * 100, 3)}%` }} transition={{ delay: h * 0.015 }}
              className="rounded-t" style={{ background: h === peak && v ? '#FF7916' : `rgba(7,158,165,${0.25 + (v / max) * 0.75})` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-muted" dir="ltr"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
    </div>
  );
}

/** قمع التحويل: مشاهدة ← سلة ← شراء */
export function Funnel({ data }: { data: { view: number; cart: number; purchase: number } }) {
  const steps = [{ l: 'مشاهدات المنتجات', v: data.view, c: '#0EA5E9' }, { l: 'إضافات للسلة', v: data.cart, c: '#7C3AED' }, { l: 'عمليات شراء', v: data.purchase, c: '#10B981' }];
  const max = Math.max(data.view, 1);
  return (
    <div className="card p-4 md:p-5">
      <h3 className="mb-3 font-bold">قمع التحويل</h3>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.l}>
            <div className="mb-1 flex justify-between text-xs"><span>{s.l}</span><b>{formatNumber(s.v)}{i > 0 && steps[i - 1].v > 0 && <span className="mr-1 font-normal text-ink-muted">({Math.round((s.v / steps[i - 1].v) * 100)}%)</span>}</b></div>
            <motion.div className="mx-auto h-7 rounded-lg" style={{ background: s.c }} initial={{ width: 0 }} animate={{ width: `${Math.max((s.v / max) * 100, 6)}%` }} transition={{ delay: i * 0.1 }} />
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-ink-muted">معدل التحويل الكلي <b className="text-ink">{data.view ? ((data.purchase / data.view) * 100).toFixed(1) : 0}%</b></p>
    </div>
  );
}

/** شبكة الإجراءات السريعة مع عدّادات */
export function QuickActions({ items }: { items: { href: string; label: string; icon: React.ReactNode; n?: number | null; tone?: 'red' | 'orange' | 'brand' }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((a) => {
        const hot = (a.n ?? 0) > 0;
        return (
          <Link key={a.href + a.label} href={a.href}
            className={cn('card group flex flex-col gap-2 p-3 transition hover:-translate-y-0.5 hover:shadow-lift', hot && a.tone === 'red' && 'ring-2 ring-red-200', hot && a.tone === 'orange' && 'ring-2 ring-orange-200')}>
            <div className="flex items-center justify-between">
              <span className={cn('grid h-9 w-9 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]',
                hot ? (a.tone === 'red' ? 'bg-red-50 text-red-600' : a.tone === 'orange' ? 'bg-orange-50 text-orange-600' : 'bg-brand-50 text-brand-600') : 'bg-slate-100 text-ink-soft')}>{a.icon}</span>
              {a.n != null && <b className={cn('text-lg', hot && a.tone === 'red' ? 'text-red-600' : hot && a.tone === 'orange' ? 'text-orange-600' : '')}>{formatNumber(a.n)}</b>}
            </div>
            <span className="text-xs font-semibold leading-5 group-hover:text-brand-700">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function PeriodTabs({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex rounded-xl bg-white p-1 ring-1 ring-slate-200">
      {[7, 30, 90].map((d) => (
        <button key={d} onClick={() => onChange(d)} className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold transition', value === d ? 'bg-ink text-white' : 'text-ink-soft')}>
          {d === 7 ? '7 أيام' : d === 30 ? '30 يومًا' : '90 يومًا'}
        </button>
      ))}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Flame, Search, TrendingUp } from 'lucide-react';
import { getPublicSupabase } from '@/lib/supabase/server';
import { searchProducts } from '@/lib/api/catalog';
import { formatNumber, formatPrice } from '@/lib/format';
import type { ProductCardData } from '@/lib/types';
import { ProductImage } from '@/components/shop/product-image';
import { ProductCard } from '@/components/shop/product-card';
import { cn } from '@/lib/utils';

export const revalidate = 300;
export const metadata: Metadata = { title: 'الترندات — الأكثر رواجًا الآن', description: 'المنتجات الأكثر مشاهدة وطلبًا على سوقي الآن' };

type T = ProductCardData & { rank: number; views: number; sold: number; growth: number | null; is_new: boolean };
type Data = { products: T[]; searches: { q: string; n: number }[]; categories: { slug: string; name: string; score: number }[] };

const PERIODS = [{ d: 1, l: 'اليوم' }, { d: 7, l: 'هذا الأسبوع' }, { d: 30, l: 'هذا الشهر' }];

export default async function TrendingPage({ searchParams }: { searchParams: Promise<{ d?: string; cat?: string }> }) {
  const sp = await searchParams;
  const days = [1, 7, 30].includes(Number(sp.d)) ? Number(sp.d) : 7;
  const cat = sp.cat && /^[a-z0-9-]{1,60}$/.test(sp.cat) ? sp.cat : null;
  const sb = getPublicSupabase();
  let data: Data = { products: [], searches: [], categories: [] };
  const { data: r, error } = await sb.rpc('get_trending', { p_days: days, p_category: cat, p_limit: 30 });
  if (!error && r) data = r as Data;
  // احتياطي: عند قلة البيانات نعرض الأكثر رواجًا حسب ترتيب البحث
  if (data.products.length < 4) {
    const fb = await searchProducts(sb, { sort: 'trending', category: cat ?? undefined, limit: 24 }).catch(() => ({ items: [] as ProductCardData[] }));
    const seen = new Set(data.products.map((p) => p.id));
    data.products = [...data.products, ...fb.items.filter((p) => !seen.has(p.id)).map((p, i) => ({ ...p, rank: data.products.length + i + 1, views: 0, sold: 0, growth: null, is_new: false }))];
  }
  const top = data.products.slice(0, 3);
  const rest = data.products.slice(3);
  const href = (q: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const d = q.d ?? days; if (d !== 7) u.set('d', String(d));
    const c = q.cat === undefined ? cat : q.cat; if (c) u.set('cat', String(c));
    const s = u.toString(); return `/trending${s ? `?${s}` : ''}`;
  };

  return (
    <div className="container space-y-6 pb-12 pt-4 md:space-y-8 md:pt-6">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-accent-500 via-[#FF5A3C] to-[#E11D48] p-6 text-white shadow-lift md:p-8">
        <Flame className="absolute -bottom-6 -left-6 h-40 w-40 opacity-15" />
        <p className="flex items-center gap-2 text-sm font-semibold text-white/85"><TrendingUp className="h-4 w-4" /> يتحدّث عنه الجميع</p>
        <h1 className="mt-1 text-3xl font-extrabold md:text-4xl">الترندات 🔥</h1>
        <p className="mt-1 max-w-md text-sm text-white/85">المنتجات الأكثر مشاهدة وإضافة للسلة وشراءً على سوقي، تتحدث تلقائيًا كل بضع دقائق.</p>
        <div className="mt-5 flex w-fit gap-1 rounded-2xl bg-white/15 p-1 backdrop-blur">
          {PERIODS.map((p) => (
            <Link key={p.d} href={href({ d: p.d })} className={cn('rounded-xl px-4 py-2 text-sm font-semibold transition', days === p.d ? 'bg-white text-accent-600' : 'text-white hover:bg-white/10')}>{p.l}</Link>
          ))}
        </div>
      </section>

      {data.categories.length > 0 && (
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          <Link href={href({ cat: null })} className={cn('shrink-0 rounded-full px-4 py-2 text-sm font-semibold ring-1', !cat ? 'bg-ink text-white ring-ink' : 'bg-white ring-line')}>الكل</Link>
          {data.categories.map((c) => (
            <Link key={c.slug} href={href({ cat: c.slug })} className={cn('shrink-0 rounded-full px-4 py-2 text-sm font-semibold ring-1', cat === c.slug ? 'bg-ink text-white ring-ink' : 'bg-white ring-line')}>{c.name}</Link>
          ))}
        </div>
      )}

      {top.length > 0 && (
        <section className="grid gap-3 md:grid-cols-3">
          {top.map((p) => (
            <Link key={p.id} href={`/p/${p.slug}`} className="group relative flex items-center gap-4 overflow-hidden rounded-[24px] border border-line bg-white p-3 transition hover:shadow-lift md:flex-col md:items-stretch md:p-4">
              <span className={cn('absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full text-sm font-black text-white shadow',
                p.rank === 1 ? 'bg-gradient-to-br from-amber-300 to-amber-500' : p.rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500' : 'bg-gradient-to-br from-orange-300 to-orange-600')}>{p.rank}</span>
              <div className="relative aspect-square w-28 shrink-0 overflow-hidden rounded-2xl bg-mist md:w-full">
                <ProductImage src={p.image} alt={p.name} sizes="(max-width:768px) 112px, 33vw" className="transition-transform duration-500 group-hover:scale-105" />
              </div>
              <div className="min-w-0 flex-1">
                <Badge p={p} />
                <p className="mt-1 line-clamp-2 font-semibold">{p.name}</p>
                <p className="mt-1 text-lg font-extrabold">{formatPrice(p.price)}{p.original_price && <span className="mr-2 text-xs font-normal text-ink-muted line-through">{formatPrice(p.original_price)}</span>}</p>
                {(p.views > 0 || p.sold > 0) && <p className="text-[11px] text-ink-muted">{p.views ? `${formatNumber(p.views)} مشاهدة` : ''}{p.sold ? ` · ${formatNumber(p.sold)} طلب` : ''}</p>}
              </div>
            </Link>
          ))}
        </section>
      )}

      {data.searches.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Search className="h-5 w-5 text-brand-500" /> الأكثر بحثًا</h2>
          <div className="flex flex-wrap gap-2">
            {data.searches.map((s, i) => (
              <Link key={s.q} href={`/search?q=${encodeURIComponent(s.q)}`} className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm ring-1 ring-line hover:ring-brand-300">
                <span className="text-xs font-bold text-accent-500">#{i + 1}</span>{s.q}
              </Link>
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold md:text-xl">قائمة الترند</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {rest.map((p) => (
              <div key={p.id} className="relative">
                <span className="absolute left-2 top-2 z-10 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-white">#{p.rank}</span>
                <ProductCard p={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {!data.products.length && <p className="py-16 text-center text-ink-muted">لا توجد ترندات في هذه الفترة بعد.</p>}
    </div>
  );
}

function Badge({ p }: { p: T }) {
  if (p.is_new && p.views > 0) return <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">✨ صاعد جديد</span>;
  if (p.growth && p.growth > 0) return <span className="inline-flex rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700" dir="ltr">🔥 +{p.growth}%</span>;
  return <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">الأكثر رواجًا</span>;
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Select } from '../Select';

/** Category tabs and a person picker; both live in the URL so filters are shareable. */
export function ActivityFilters({
  categories,
  cat,
  who,
  people,
}: {
  categories: { id: string; label: string }[];
  cat: string;
  who: string;
  people: { value: string; label: string }[];
}) {
  const router = useRouter();
  const href = (c: string, w: string) => {
    const qs = new URLSearchParams({ ...(c ? { cat: c } : {}), ...(w ? { who: w } : {}) });
    const s = qs.toString();
    return s ? `/admin/activity?${s}` : '/admin/activity';
  };
  return (
    <div className="adm-toolbar adm-toolbar--activity">
      <nav className="adm-tabs adm-tabs--scroll" aria-label="Filter by kind">
        {categories.map((c) => (
          <Link
            key={c.id || 'all'}
            href={href(c.id, who)}
            aria-current={cat === c.id ? 'page' : undefined}
          >
            {c.label}
          </Link>
        ))}
      </nav>
      <div className="adm-who">
        <Select
          label="Person"
          value={who}
          onChange={(v) => router.push(href(cat, v))}
          options={[{ value: '', label: 'Everyone' }, ...people]}
        />
      </div>
    </div>
  );
}

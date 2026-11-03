'use client';

import { api } from '@/lib/api';
import { ActionForm, Field, Panel } from './kit';

const base = (p: string) => `/admin/properties/${p}`;

export function AddFloor({
  propertyId,
  buildingId,
  nextLevel,
}: {
  propertyId: string;
  buildingId: string;
  nextLevel: number;
}) {
  return (
    <Panel label="Add floor" title="Add a floor" tone="quiet">
      {(close) => (
        <ActionForm
          cta="Add floor"
          done={close}
          submit={(f) =>
            api(`${base(propertyId)}/buildings/${buildingId}/floors`, {
              method: 'POST',
              body: { label: String(f.get('label') ?? '').trim(), level: Number(f.get('level')) },
            })
          }
        >
          <Field label="Name" hint="As residents say it, e.g. Fourth floor.">
            <input name="label" required maxLength={40} autoComplete="off" />
          </Field>
          <Field label="Level" hint="Used to order floors: ground is 0, first is 1.">
            <input
              name="level"
              type="number"
              required
              defaultValue={nextLevel}
              min={-5}
              max={200}
            />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

export function AddRooms({
  propertyId,
  floorId,
  floorLabel,
}: {
  propertyId: string;
  floorId: string;
  floorLabel: string;
}) {
  return (
    <Panel
      label="Add rooms"
      title={`Add rooms to ${floorLabel}`}
      lede="Type one room, a list (32, 33, 34) or a range (32-40)."
      tone="quiet"
    >
      {(close) => (
        <ActionForm
          cta="Add rooms"
          busyCta="Adding…"
          done={close}
          submit={async (f) => {
            const labels = expandLabels(String(f.get('labels') ?? ''));
            if (!labels.length) throw new Error('Enter at least one room.');
            for (const label of labels)
              await api(`${base(propertyId)}/floors/${floorId}/rooms`, {
                method: 'POST',
                body: { label },
              });
          }}
        >
          <Field label="Rooms">
            <input name="labels" required autoComplete="off" placeholder="e.g. 32-40" />
          </Field>
        </ActionForm>
      )}
    </Panel>
  );
}

/** "32-35, 40" → ["32","33","34","35","40"]; plain labels pass through. */
export function expandLabels(input: string): string[] {
  const out: string[] = [];
  for (const part of input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (b < a || b - a > 200) throw new Error(`“${part}” isn’t a sensible range.`);
      for (let i = a; i <= b; i++) out.push(String(i));
    } else out.push(part.slice(0, 40));
  }
  return [...new Set(out)];
}

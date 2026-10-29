import { PageHead } from '@/components/ui';
import { getProperty } from '@/lib/property';
import { site } from '@/lib/site';

export const metadata = { title: 'Property and coverage', alternates: { canonical: '/coverage' } };

export default async function Coverage() {
  const property = await getProperty();
  return (
    <div className="container prose">
      <PageHead
        eyebrow={property?.name ?? 'The property'}
        title="Property and coverage"
        lede="What to expect from the Wi-Fi where you live."
      />
      <h2>Where it works</h2>
      <p>
        The Wi-Fi is available inside {property?.name ?? 'the property'} through access points
        installed by the property. Signal strength varies between rooms and floors, and some spots
        may be weak or unavailable.
      </p>
      {site.coverageNotes ? (
        <p>{site.coverageNotes}</p>
      ) : (
        <p>Ask the property office about coverage in your room before buying a long plan.</p>
      )}
      <h2>How fast it is</h2>
      <p>
        The internet connection is provided by satellite and shared by everyone at the property.
        Speeds change with how many people are online, the weather and your distance from the
        nearest access point. We don&apos;t promise any particular speed or uninterrupted service.
        Plans may cap speeds so that everyone gets a fair share.
      </p>
      <h2>Outages</h2>
      <ul>
        <li>Power cuts and satellite outages can interrupt service.</li>
        <li>
          Time-based plans keep counting during outages. If an outage is long, contact support: the
          property may extend your plan.
        </li>
        <li>
          Report problems from the <a href="/contact">help page</a> or your account.
        </li>
      </ul>
      <h2>Security and privacy</h2>
      <p>
        Your voucher code is the key to your access: keep it private. Use secure (https) websites
        for anything sensitive. No public Wi-Fi network is perfectly secure.
      </p>
    </div>
  );
}

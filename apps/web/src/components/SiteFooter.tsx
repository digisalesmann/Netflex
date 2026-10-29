import Link from 'next/link';

export function SiteFooter({
  brand,
  propertyName,
  supportPhone,
  supportEmail,
}: {
  brand: string;
  propertyName: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
}) {
  return (
    <footer className="site-footer">
      <div className="container grid grid--3">
        <div>
          <p>
            <strong>{brand}</strong>
            {propertyName ? <> · Wi-Fi at {propertyName}</> : null}
          </p>
          <p>Internet access via satellite. Speeds and availability vary and are not guaranteed.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="footer-links">
            <li>
              <Link href="/legal/terms">Terms of service</Link>
            </li>
            <li>
              <Link href="/legal/privacy">Privacy policy</Link>
            </li>
            <li>
              <Link href="/legal/refunds">Refunds and cancellations</Link>
            </li>
            <li>
              <Link href="/contact">Contact and support</Link>
            </li>
          </ul>
        </nav>
        <div>
          <p>
            Help:{' '}
            {supportPhone ? (
              <a href={`tel:${supportPhone}`}>{supportPhone}</a>
            ) : (
              'ask at the property office'
            )}
            {supportEmail ? (
              <>
                <br />
                <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </footer>
  );
}

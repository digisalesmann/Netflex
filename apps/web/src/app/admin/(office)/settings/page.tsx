import { ROLE_NAMES } from '@netflex/domain/dist/permissions.js';
import { ChangePassword, LodgeDetails } from '@/components/admin/SettingsForms';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { site } from '@/lib/site';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const me = await requireStaff('/admin/settings');
  const { property } = await currentProperty();
  const canEdit = property ? allowed(me, 'settings.manage', property.id) : false;

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property?.name ?? 'Office'}</p>
        <h1 className="adm-head__title">Settings</h1>
        <p className="adm-head__lede">Your lodge&apos;s details and your own sign-in.</p>
      </header>

      <div className="adm-grid">
        {property ? (
          <section aria-labelledby="lodge-title">
            <h2 id="lodge-title" className="adm-h2">
              Lodge details
            </h2>
            <LodgeDetails
              propertyId={property.id}
              name={property.name}
              supportPhone={property.supportPhone ?? null}
              supportEmail={property.supportEmail ?? null}
              canEdit={canEdit}
            />
            <dl className="adm-facts adm-facts--quiet">
              <dt>Web address</dt>
              <dd>{new URL(site.siteUrl).host}</dd>
              <dt>Time zone</dt>
              <dd>{property.timeZone.replace('_', ' ')}</dd>
              <dt>Currency</dt>
              <dd>{property.currency === 'NGN' ? 'Naira (₦)' : property.currency}</dd>
            </dl>
          </section>
        ) : null}

        <section aria-labelledby="me-title">
          <h2 id="me-title" className="adm-h2">
            Your sign-in
          </h2>
          <dl className="adm-facts">
            <dt>Name</dt>
            <dd>{me.user.displayName}</dd>
            <dt>Email</dt>
            <dd>{me.user.email}</dd>
            <dt>Role</dt>
            <dd>{[...new Set(me.grants.map((g) => ROLE_NAMES[g.role]))].join(', ')}</dd>
            <dt>Two-step</dt>
            <dd>{me.user.mfaEnabled ? 'On, with your authenticator app' : 'Not set up'}</dd>
          </dl>
          <div className="adm-after">
            <ChangePassword />
          </div>
          <p className="adm-sub adm-after">
            Lost your phone? Ask another owner to reset your sign-in from Staff.
          </p>
        </section>
      </div>
    </>
  );
}

import { ROLE_NAMES } from '@netflex/domain/dist/permissions.js';
import Link from 'next/link';
import {
  ChangePassword,
  Devices,
  LodgeProfile,
  type SessionRow,
} from '@/components/admin/SettingsForms';
import { allowed, currentProperty, requireStaff } from '@/lib/admin';
import { initials } from '@/lib/admin-staff';
import { serverApi } from '@/lib/server-api';
import { site } from '@/lib/site';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const me = await requireStaff('/admin/settings');
  const { property, all } = await currentProperty();
  const canEdit = property ? allowed(me, 'settings.manage', property.id) : false;
  const sessions = (await serverApi<SessionRow[]>('/me/sessions', { auth: true })).data ?? [];
  const roles = [
    ...new Set(
      me.grants.map((g) =>
        g.propertyId
          ? `${ROLE_NAMES[g.role]} · ${all.find((p) => p.id === g.propertyId)?.name ?? 'another lodge'}`
          : `${ROLE_NAMES[g.role]} · all lodges`,
      ),
    ),
  ];

  return (
    <>
      <header className="adm-head">
        <p className="adm-head__eyebrow">{property?.name ?? 'Office'}</p>
        <h1 className="adm-head__title">Settings</h1>
        <p className="adm-head__lede">Your lodge&apos;s public details, and your own account.</p>
      </header>

      <nav className="adm-tabs adm-tabs--scroll adm-subnav" aria-label="Settings sections">
        {property ? <a href="#lodge">Lodge</a> : null}
        <a href="#profile">Profile</a>
        <a href="#security">Security</a>
        <a href="#devices">Devices</a>
      </nav>

      {property ? (
        <>
          <section id="lodge" className="adm-setting" aria-labelledby="lodge-title">
            <div className="adm-setting__about">
              <h2 id="lodge-title" className="adm-h2">
                Lodge profile
              </h2>
              <p>
                Shown on the website, the Wi-Fi sign-in page, receipts and emails.
                {canEdit ? '' : ' Only managers and owners can change it.'}
              </p>
            </div>
            <div className="adm-setting__body adm-setting__body--wide">
              <LodgeProfile
                propertyId={property.id}
                name={property.name}
                supportPhone={property.supportPhone ?? null}
                supportEmail={property.supportEmail ?? null}
                canEdit={canEdit}
              />
            </div>
          </section>

          <section className="adm-setting" aria-labelledby="place-title">
            <div className="adm-setting__about">
              <h2 id="place-title" className="adm-h2">
                Location and money
              </h2>
              <p>Set when the lodge was created. Ask Netflex support to change them.</p>
            </div>
            <div className="adm-setting__body">
              <dl className="adm-facts">
                <dt>Web address</dt>
                <dd>{new URL(site.siteUrl).host}</dd>
                <dt>Time zone</dt>
                <dd>{property.timeZone.replace('_', ' ')} (West Africa Time)</dd>
                <dt>Currency</dt>
                <dd>{property.currency === 'NGN' ? 'Naira (₦)' : property.currency}</dd>
                <dt>Payments</dt>
                <dd>Paystack</dd>
              </dl>
            </div>
          </section>
        </>
      ) : null}

      <section id="profile" className="adm-setting" aria-labelledby="me-title">
        <div className="adm-setting__about">
          <h2 id="me-title" className="adm-h2">
            Your profile
          </h2>
          <p>How you appear in the activity log and to other staff.</p>
        </div>
        <div className="adm-setting__body">
          <div className="adm-me-card">
            <span className="adm-member__avatar" aria-hidden="true">
              {initials(me.user.displayName)}
            </span>
            <span className="adm-member__text">
              <strong>{me.user.displayName}</strong>
              <span>{me.user.email}</span>
            </span>
          </div>
          <dl className="adm-facts adm-after">
            <dt>Access</dt>
            <dd>
              {roles.map((r) => (
                <span key={r} className="adm-facts__line">
                  {r}
                </span>
              ))}
            </dd>
          </dl>
          <p className="adm-sub adm-after">
            To change your name or role, ask an owner (Staff →{' '}
            <Link href={`/admin/staff/${me.user.id}`}>your page</Link>).
          </p>
        </div>
      </section>

      <section id="security" className="adm-setting" aria-labelledby="sec-title">
        <div className="adm-setting__about">
          <h2 id="sec-title" className="adm-h2">
            Security
          </h2>
          <p>Your password and the code from your authenticator app protect the office.</p>
        </div>
        <div className="adm-setting__body">
          <dl className="adm-facts">
            <dt>Password</dt>
            <dd>
              <ChangePassword />
            </dd>
            <dt>Two-step</dt>
            <dd>
              {me.user.mfaEnabled ? (
                <span className="adm-tag" data-tone="ok">
                  On, with your authenticator app
                </span>
              ) : (
                <span className="adm-tag" data-tone="warn">
                  Not set up
                </span>
              )}
            </dd>
          </dl>
          <p className="adm-sub adm-after">
            New phone or lost it? Ask another owner to reset your sign-in; you&apos;ll scan a new
            code.
          </p>
        </div>
      </section>

      <section id="devices" className="adm-setting" aria-labelledby="dev-title">
        <div className="adm-setting__about">
          <h2 id="dev-title" className="adm-h2">
            Where you&apos;re signed in
          </h2>
          <p>Sign out any device you don&apos;t recognise or no longer use.</p>
        </div>
        <div className="adm-setting__body">
          <Devices sessions={sessions} />
        </div>
      </section>
    </>
  );
}

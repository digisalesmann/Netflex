import { Settings } from '@/components/account/Settings';
import { requireTenant } from '@/lib/account';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const me = await requireTenant('/account/settings');
  const [prefs, sessions] = await Promise.all([
    serverApi<{
      preferences: { sms: never; email: never };
      channelsAvailable: { sms: boolean; email: boolean };
    }>('/me/preferences', { auth: true }),
    serverApi<
      {
        id: string;
        createdAt: string;
        lastSeenAt: string;
        userAgent: string | null;
        current: boolean;
      }[]
    >('/me/sessions', { auth: true }),
  ]);
  return (
    <>
      <header className="acct-page-head">
        <h1 className="acct-hello__title">Settings</h1>
        <p className="acct-hello__where">Your profile, messages, devices and data.</p>
      </header>
      <Settings
        name={me.user.displayName}
        email={me.user.email}
        prefs={
          prefs.data ?? {
            preferences: {
              sms: { expiryReminders: false, receipts: false, outageNotices: false },
              email: { expiryReminders: true, receipts: true, outageNotices: true },
            } as never,
            channelsAvailable: { sms: false, email: false },
          }
        }
        sessions={sessions.data ?? []}
      />
    </>
  );
}

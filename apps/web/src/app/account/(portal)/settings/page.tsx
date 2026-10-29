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
      <h1>Settings</h1>
      <Settings
        name={me.user.displayName}
        prefs={
          prefs.data ?? {
            preferences: {
              sms: { expiryReminders: true, receipts: true, outageNotices: true },
              email: { expiryReminders: false, receipts: false, outageNotices: false },
            } as never,
            channelsAvailable: { sms: false, email: false },
          }
        }
        sessions={sessions.data ?? []}
      />
    </>
  );
}

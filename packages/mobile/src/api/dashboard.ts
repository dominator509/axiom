import { getCrashReports, getDigests, getOrgSettings, getUiLocale } from './endpoints';

/** Load independent panels without discarding successful responses. Role checks
 * here avoid unavailable controls; the API remains the authorization boundary. */
export async function loadDashboard(role: string | null) {
  const [settings, digests, crashReports, uiLocale] = await Promise.allSettled([
    role === 'owner' ? getOrgSettings() : Promise.resolve(null),
    getDigests(),
    getCrashReports(),
    getUiLocale(),
  ]);
  const errors = [settings, digests, crashReports, uiLocale]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
  return {
    settings: settings.status === 'fulfilled' ? settings.value : null,
    digests: digests.status === 'fulfilled' ? digests.value.data : null,
    crashReports: crashReports.status === 'fulfilled' ? crashReports.value.data : null,
    uiLocale: uiLocale.status === 'fulfilled' ? uiLocale.value : null,
    error: errors.length ? [...new Set(errors)].join('\n') : null,
  };
}

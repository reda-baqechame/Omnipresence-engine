/**
 * Discover GBP account + location after OAuth for auto-publishing.
 */
export async function discoverGbpAccountLocation(accessToken: string): Promise<{
  accountId?: string;
  locationId?: string;
  locationName?: string;
}> {
  try {
    const accountsRes = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!accountsRes.ok) return {};
    const accountsData = (await accountsRes.json()) as {
      accounts?: Array<{ name: string }>;
    };
    const accountName = accountsData.accounts?.[0]?.name;
    if (!accountName) return {};

    const accountId = accountName.replace("accounts/", "");
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!locRes.ok) return { accountId };
    const locData = (await locRes.json()) as {
      locations?: Array<{ name: string; title?: string }>;
    };
    const location = locData.locations?.[0];
    if (!location?.name) return { accountId };

    const locationId = location.name.split("/").pop();
    return { accountId, locationId, locationName: location.title };
  } catch {
    return {};
  }
}

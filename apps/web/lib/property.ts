import { cookies } from "next/headers";

/** The property switcher's choice ("All properties" when unset). */
export const PROPERTY_COOKIE = "rf_property";

/** The selected property, if it's still one this person can see; otherwise null (= all). */
export async function selectedPropertyId(visibleIds: string[]): Promise<string | null> {
  const value = (await cookies()).get(PROPERTY_COOKIE)?.value;
  return value && visibleIds.includes(value) ? value : null;
}

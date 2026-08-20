/**
 * Tenant-claim validation (Section 3): an authenticated identity is only
 * accepted if its `tid` claim matches the single configured tenant.
 * Extracted as a pure function so it can be unit tested without invoking
 * Auth.js/NextAuth at all.
 */
export function isTenantClaimValid(
  tid: string | null | undefined,
  expectedTenantId: string,
): boolean {
  if (!expectedTenantId) return false;
  if (!tid) return false;
  return tid === expectedTenantId;
}

import { describe, expect, it } from "vitest";
import { isTenantClaimValid } from "./tenant-validation";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("isTenantClaimValid", () => {
  it("accepts a claim that matches the configured tenant", () => {
    expect(isTenantClaimValid(TENANT, TENANT)).toBe(true);
  });

  it("rejects a claim from a different tenant", () => {
    expect(isTenantClaimValid("22222222-2222-2222-2222-222222222222", TENANT)).toBe(
      false,
    );
  });

  it("rejects a missing tid claim", () => {
    expect(isTenantClaimValid(undefined, TENANT)).toBe(false);
    expect(isTenantClaimValid(null, TENANT)).toBe(false);
    expect(isTenantClaimValid("", TENANT)).toBe(false);
  });

  it("rejects when no tenant is configured, even if the claim is empty too", () => {
    expect(isTenantClaimValid("", "")).toBe(false);
    expect(isTenantClaimValid(TENANT, "")).toBe(false);
  });

  it("never accepts common/organizations/consumers style values", () => {
    for (const value of ["common", "organizations", "consumers"]) {
      expect(isTenantClaimValid(value, TENANT)).toBe(false);
    }
  });
});

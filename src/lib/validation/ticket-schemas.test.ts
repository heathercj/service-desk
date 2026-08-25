import { expect } from "vitest";
import { feature, rule, scenario } from "@/test/bdd";
import { DEPARTMENT_KEYS, parseDepartmentKey } from "./ticket-schemas";

/**
 * `parseDepartmentKey` guards the one place a department key arrives as
 * untrusted text: the `/queue/[departmentKey]` URL segment. Prisma throws
 * PrismaClientValidationError -- not a miss -- when an enum column is
 * queried with a value outside the enum, so passing the raw segment through
 * turns a mistyped URL into a 500 and the "Something went wrong" boundary,
 * where the page's own "Department not found" notice was intended.
 */
feature("Department key from an untrusted URL segment", () => {
  scenario.each(DEPARTMENT_KEYS)("%s is a real department key", async (key, s) => {
    const parsed = await s.when("the segment is parsed", () => parseDepartmentKey(key));
    await s.then("it comes back as itself", () => expect(parsed).toBe(key));
  });

  rule("Anything that is not exactly a key is rejected, not queried", () => {
    scenario.each([
      "technology_support",
      "Technology Support",
      "TECHNOLOGY_SUPPORT ",
      "TECHNOLOGY-SUPPORT",
      "nope",
      "",
      "__proto__",
    ])("%s is refused", async (raw, s) => {
      const parsed = await s.when("the segment is parsed", () => parseDepartmentKey(raw));
      await s.then("nothing reaches the database", () => expect(parsed).toBeNull());
    });
  });
});

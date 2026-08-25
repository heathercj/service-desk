/**
 * Behaviour of the audit's file classification -- which source files it holds
 * to the "every feature ships with its tests" bar in the first place.
 *
 * The count in the summary is only as honest as this list. Scaffolding that
 * nobody intends to unit test, counted as a gap, makes the number look worse
 * than the repo is and puts the same question in front of a reader on every
 * run; silently dropping it makes the number look better than it is. So the
 * rule is that non-feature files are excluded from the score AND named in
 * the report, and these scenarios pin both halves of that down.
 */
import { expect } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { classifySourceFiles } from "./tdd-audit";

feature("Deciding which files the TDD audit scores", () => {
  scenario("Services, route handlers and components are features", async (s) => {
    const classified = await s.given("a source tree with one of each", () =>
      classifySourceFiles([
        "src/lib/tickets/ticket-service.ts",
        "src/app/api/tickets/route.ts",
        "src/components/tickets/ticket-card.tsx",
      ]),
    );

    await s.then("all three are held to the coverage bar", () => {
      expect(classified.features.map((f) => f.relPath)).toEqual([
        "src/lib/tickets/ticket-service.ts",
        "src/app/api/tickets/route.ts",
        "src/components/tickets/ticket-card.tsx",
      ]);
    });

    await s.and("each is filed under its own category", () => {
      expect(classified.features.map((f) => f.category)).toEqual([
        "lib",
        "api-route",
        "component",
      ]);
    });
  });

  scenario("The simulated agents are scaffolding, not a feature", async (s) => {
    const classified = await s.given("a source tree including src/lib/simulation", () =>
      classifySourceFiles([
        "src/lib/tickets/ticket-service.ts",
        "src/lib/simulation/agent-personas.ts",
        "src/lib/simulation/response-engine.ts",
      ]),
    );

    await s.then("the simulation files are not counted as gaps", () => {
      expect(classified.features.map((f) => f.relPath)).toEqual([
        "src/lib/tickets/ticket-service.ts",
      ]);
    });

    await s.and("they are still named in the report rather than hidden", () => {
      expect(classified.notScored).toEqual([
        "src/lib/simulation/agent-personas.ts",
        "src/lib/simulation/response-engine.ts",
      ]);
    });
  });

  scenario("Test files are never features in their own right", async (s) => {
    const classified = await s.given("a service beside its unit and integration tests", () =>
      classifySourceFiles([
        "src/lib/tickets/ticket-service.ts",
        "src/lib/tickets/ticket-service.test.ts",
        "src/lib/tickets/ticket-service.integration.test.ts",
      ]),
    );

    await s.then("only the service is scored", () => {
      expect(classified.features.map((f) => f.relPath)).toEqual([
        "src/lib/tickets/ticket-service.ts",
      ]);
    });

    await s.and("the tests are not listed as unscored scaffolding either", () => {
      expect(classified.notScored).toEqual([]);
    });
  });

  scenario("Next's framework entry points are reported separately", async (s) => {
    const classified = await s.given("a route group with a page and a layout", () =>
      classifySourceFiles([
        "src/app/(portal)/page.tsx",
        "src/app/(portal)/layout.tsx",
        "src/app/api/health/route.ts",
      ]),
    );

    await s.then("only the route handler is scored", () => {
      expect(classified.features.map((f) => f.relPath)).toEqual([
        "src/app/api/health/route.ts",
      ]);
    });

    await s.and("the page and layout are counted as framework entry points", () => {
      expect(classified.frameworkEntryPoints).toEqual([
        "src/app/(portal)/page.tsx",
        "src/app/(portal)/layout.tsx",
      ]);
    });

    await s.and("they are not double-counted as scaffolding", () => {
      expect(classified.notScored).toEqual([]);
    });
  });

  scenario("A non-route file under src/app/api is not scored", async (s) => {
    const classified = await s.given("a helper sitting beside a route handler", () =>
      classifySourceFiles([
        "src/app/api/tickets/route.ts",
        "src/app/api/tickets/serialize.ts",
      ]),
    );

    await s.then("only the route handler is held to the bar", () => {
      expect(classified.features.map((f) => f.relPath)).toEqual([
        "src/app/api/tickets/route.ts",
      ]);
    });
  });
});

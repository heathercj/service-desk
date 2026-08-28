/**
 * Behaviour of the department picker in the new-draft-article form: it
 * must offer real department names (from the database), not raw keys --
 * this is also what makes a newly created department usable as a KB
 * authoring target the moment it's created.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { KnowledgeOutcomePanel } from "./knowledge-outcome-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

const DEPARTMENTS = [
  { key: "TECHNOLOGY_SUPPORT", name: "Technology Support" },
  { key: "TRAINING", name: "Training" },
];

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Draft-article department picker", () => {
  scenario("It offers each department by its display name, not its key", async (s) => {
    await s.given("a similarity check has already run, with no matches", async () => {
      fetchMock.mockResolvedValueOnce({ json: async () => ({ results: [] }) });
      render(
        <KnowledgeOutcomePanel
          ticketId="ticket-1"
          ticketSubject="VPN will not connect"
          ticketDescription="Details about the VPN issue."
          departmentKey="TECHNOLOGY_SUPPORT"
          canRecordException={false}
          departments={DEPARTMENTS}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /run knowledge similarity check/i }),
      );
      await userEvent.click(screen.getByRole("button", { name: /create a new draft/i }));
    });

    await s.then("the department picker shows real names", () => {
      expect(
        screen.getByRole("option", { name: "Technology Support" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Training" })).toBeInTheDocument();
    });
  });
});

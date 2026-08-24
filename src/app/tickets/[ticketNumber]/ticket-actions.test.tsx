/**
 * Behaviour of the mis-route transfer flow in `TicketActions`: an agent
 * moves a ticket to another department and, optionally, straight to a
 * specific person there, with a mandatory reason.
 *
 * jsdom 25 does not implement <dialog>'s modal methods (see
 * confirm-dialog.test.tsx), so showModal/close are stubbed the same way.
 * `fetch` and `next/navigation`'s `useRouter` are stubbed so this describes
 * the component's own behaviour -- what it posts and to whom -- not the
 * route or service underneath.
 */
import { beforeAll, beforeEach, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { TicketActions } from "./ticket-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

const DEPARTMENT_AGENTS = {
  TECHNOLOGY_SUPPORT: [{ id: "tech-agent-1", displayName: "Tess Tech" }],
  TRAINING: [{ id: "training-agent-1", displayName: "Tom Trainer" }],
};

const BASE_TICKET = {
  id: "ticket-1",
  ticketNumber: "SD-000001",
  status: "IN_PROGRESS",
  version: 2,
  departmentKey: "TECHNOLOGY_SUPPORT",
};

function renderActions(overrides: { roles: string[]; isAssignee: boolean }) {
  return render(
    <TicketActions
      ticket={BASE_TICKET}
      roles={overrides.roles}
      isAssignee={overrides.isAssignee}
      allowedNextStatuses={[]}
      knowledgeLinks={[]}
      departmentAgents={DEPARTMENT_AGENTS}
    />,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

feature("Mis-route transfer", () => {
  scenario(
    "A department agent who does not own the ticket cannot transfer it",
    async (s) => {
      await s.given("an agent from the department, but not the assignee", () =>
        renderActions({ roles: ["DEPARTMENT_AGENT"], isAssignee: false }),
      );

      await s.then("no transfer control is offered", () => {
        expect(
          screen.queryByRole("button", { name: "Transfer department" }),
        ).not.toBeInTheDocument();
      });
    },
  );

  scenario(
    "The ticket's current assignee can transfer it, even as a plain agent",
    async (s) => {
      await s.given("a department agent who is the ticket's current assignee", () =>
        renderActions({ roles: ["DEPARTMENT_AGENT"], isAssignee: true }),
      );

      await s.then("a transfer control is offered", () => {
        expect(
          screen.getByRole("button", { name: "Transfer department" }),
        ).toBeInTheDocument();
      });
    },
  );

  scenario("Transferring to a named agent sends their id along", async (s) => {
    await s.given("the ticket's assignee viewing the transfer form", () =>
      renderActions({ roles: ["DEPARTMENT_AGENT"], isAssignee: true }),
    );

    await s.and("they pick the destination department", () =>
      userEvent.selectOptions(screen.getByLabelText("New department"), "TRAINING"),
    );

    await s.and("they pick a specific new owner there", () =>
      userEvent.selectOptions(screen.getByLabelText("New assignee"), "training-agent-1"),
    );

    await s.and("they enter the required reason", () =>
      userEvent.type(
        screen.getByLabelText("Transfer reason"),
        "Wrong department -- this is a training question.",
      ),
    );

    await s.when("they open and confirm the transfer", async () => {
      await userEvent.click(screen.getByRole("button", { name: "Transfer department" }));
      await userEvent.click(screen.getByRole("button", { name: "Transfer" }));
    });

    await s.then("the request names the new department and the new owner", () => {
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({
        departmentKey: "TRAINING",
        newAssigneeId: "training-agent-1",
        reason: "Wrong department -- this is a training question.",
      });
    });
  });

  scenario("Leaving the new owner unset omits it from the request", async (s) => {
    await s.given("the ticket's assignee viewing the transfer form", () =>
      renderActions({ roles: ["DEPARTMENT_AGENT"], isAssignee: true }),
    );

    await s.and("they pick the destination department but no specific owner", () =>
      userEvent.selectOptions(screen.getByLabelText("New department"), "TRAINING"),
    );

    await s.and("they enter the required reason", () =>
      userEvent.type(screen.getByLabelText("Transfer reason"), "Wrong queue."),
    );

    await s.when("they open and confirm the transfer", async () => {
      await userEvent.click(screen.getByRole("button", { name: "Transfer department" }));
      await userEvent.click(screen.getByRole("button", { name: "Transfer" }));
    });

    await s.then("no newAssigneeId is sent", () => {
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).not.toHaveProperty("newAssigneeId");
    });
  });
});

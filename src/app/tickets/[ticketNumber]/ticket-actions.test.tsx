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

const DEPARTMENTS = [
  { key: "TECHNOLOGY_SUPPORT", name: "Technology Support" },
  { key: "TRAINING", name: "Training" },
];

const BASE_TICKET = {
  id: "ticket-1",
  ticketNumber: "SD-000001",
  status: "IN_PROGRESS",
  version: 2,
  departmentKey: "TECHNOLOGY_SUPPORT",
};

function renderActions(overrides: {
  roles: string[];
  isAssignee: boolean;
  status?: string;
}) {
  return render(
    <TicketActions
      ticket={{ ...BASE_TICKET, status: overrides.status ?? BASE_TICKET.status }}
      roles={overrides.roles}
      isAssignee={overrides.isAssignee}
      allowedNextStatuses={[]}
      knowledgeLinks={[]}
      departmentAgents={DEPARTMENT_AGENTS}
      departments={DEPARTMENTS}
    />,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

feature("Department pickers show real department names, not raw keys", () => {
  scenario(
    "The confirm-triage department picker reads from real departments",
    async (s) => {
      await s.given("a triage agent viewing a ticket awaiting triage", () =>
        renderActions({
          roles: ["TRIAGE_AGENT"],
          isAssignee: false,
          status: "SUBMITTED",
        }),
      );

      await s.then("the picker offers each department by its display name", () => {
        expect(
          screen.getByRole("option", { name: "Technology Support" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Training" })).toBeInTheDocument();
      });
    },
  );

  scenario("The transfer department picker reads from real departments", async (s) => {
    await s.given("the ticket's assignee viewing the transfer form", async () => {
      renderActions({ roles: ["DEPARTMENT_AGENT"], isAssignee: true });
      await userEvent.click(screen.getByRole("button", { name: "Transfer department" }));
    });

    await s.then("the picker offers each department by its display name", () => {
      expect(
        screen.getByRole("option", { name: "Technology Support" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Training" })).toBeInTheDocument();
    });
  });
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
    "Triage does not see the transfer control while a ticket still awaits triage",
    async (s) => {
      // Confirm triage & route already IS the department-routing tool at
      // this stage; showing the mis-route transfer flow alongside it is
      // just a second, redundant way to do the same thing before the
      // ticket has even entered the normal lifecycle once.
      await s.given("a triage agent viewing a ticket awaiting triage", () =>
        renderActions({
          roles: ["TRIAGE_AGENT"],
          isAssignee: false,
          status: "SUBMITTED",
        }),
      );

      await s.then("the confirm-triage panel is offered", () => {
        expect(
          screen.getByRole("heading", { name: /confirm triage/i }),
        ).toBeInTheDocument();
      });

      await s.and("no separate transfer control is offered", () => {
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

  scenario(
    "The transfer control carries the anchor Henry's tour points at",
    async (s) => {
      // The guided tour addresses the UI through data-tour attributes rather
      // than button text, so renaming this button is safe but dropping the
      // attribute would leave the tour's work-misroute card pointing at
      // nothing, live, in front of a room.
      await s.given("the ticket's assignee viewing their actions", () =>
        renderActions({ roles: ["DEPARTMENT_AGENT"], isAssignee: true }),
      );

      await s.then("the tour can find the transfer control", () => {
        expect(
          screen.getByRole("button", { name: "Transfer department" }),
        ).toHaveAttribute("data-tour", "transfer-open");
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

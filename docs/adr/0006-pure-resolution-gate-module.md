# ADR 0006: Resolution gate as a pure, database-free module

## Status

Accepted

## Context

Section 11.3 defines a multi-condition gate that must hold before a ticket
can become `Resolved`: summary + steps entered, a _current_ knowledge
similarity check, and a valid, _current_ knowledge outcome. "Current" is a
staleness question (has the ticket's resolution been edited since the last
check/outcome?), which is easy to get subtly wrong if it's buried inside a
large transactional service function.

## Decision

`src/lib/knowledge/resolution-gate.ts` exports one pure function,
`evaluateResolutionGate(facts) -> { ok, blockingReasons }`, that takes
plain booleans/values and returns every blocking reason at once (not just
the first). `ticket-service.ts` is responsible for gathering those facts
(comparing `Ticket.resolutionEnteredAt` against `lastKnowledgeCheckAt` and
the latest `TicketKnowledgeLink.createdAt`) and calling the gate; the gate
itself never touches Prisma.

## Consequences

- The gate's rules are directly unit tested (`resolution-gate.test.ts`)
  without needing a database or transaction.
- Staleness tracking is centralized in two timestamp comparisons rather
  than scattered status checks, making "was this outcome recorded before or
  after the resolution was last edited" answerable in one place.
- `resolveTicket()` and `retryResolutionAfterKnowledgeOutcome()` in
  `ticket-service.ts` both call the same gate function, so a ticket can only
  ever reach `Resolved` through one code path with one set of rules.

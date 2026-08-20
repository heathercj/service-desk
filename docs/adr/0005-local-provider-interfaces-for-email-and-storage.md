# ADR 0005: Provider interfaces for email and object storage, local implementations only

## Status

Accepted

## Context

Section 9 requires an `EmailProvider` abstraction with a
`ConsoleEmailProvider` for local development and a documented future
Graph/ACS provider. Section 14 requires an `ObjectStorageProvider`
abstraction with a `LocalObjectStorageProvider` and a documented future
Azure Blob Storage provider. Neither should fake a capability the prototype
doesn't actually have (no faking real delivery, no faking real malware
scanning).

## Decision

`EmailProvider` (`src/lib/email/provider.ts`) has one implementation,
`ConsoleEmailProvider`, which persists an `OutboundEmail` row with
`status: CAPTURED_DEV` and never claims delivery. `ObjectStorageProvider`
(`src/lib/storage/object-storage.ts`) has one implementation,
`LocalObjectStorageProvider`, storing files outside `public/` with
randomized keys, downloadable only through an authorized, opaque API route.
A `MalwareScanProvider` (`src/lib/storage/malware-scan.ts`) exists for the
same reason: a real interface, an explicitly-labelled heuristic prototype
implementation.

## Consequences

- Nothing in this prototype can send real email or store files anywhere but
  local disk -- by design, so no one mistakes prototype behavior for
  production behavior.
- Swapping in Microsoft Graph mail, Azure Blob Storage, or a real AV engine
  means writing one new class implementing the existing interface; no
  caller changes.
- Every attachment sits `PENDING` until the (heuristic) scan completes and
  is never downloadable before it's `CLEAN` -- this contract holds
  regardless of which scan implementation is behind it.

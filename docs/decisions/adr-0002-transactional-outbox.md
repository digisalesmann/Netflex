# ADR-0002: Transactional outbox for all side effects

- Status: Accepted (Phase 0)
- Date: 2026-10-28

## Context

Spec §13.3 and §23 require that a crash between a DB commit and a queue enqueue cannot lose work (e.g. paid but never provisioned).

## Decision

Business transactions insert `OutboxEvent(id uuid, type, payload jsonb, aggregateId, createdAt, dispatchedAt null, attempts)` in the same transaction. The worker relays undispatched rows using `FOR UPDATE SKIP LOCKED`, enqueues BullMQ jobs with `jobId = outboxEvent.id` (BullMQ dedupes on job ID), then sets `dispatchedAt`. Handlers are idempotent against domain state (e.g. "payment already SUCCEEDED → no-op"). Redis is transport only.

## Consequences

- At-least-once delivery with idempotent consumers ⇒ effectively-once business effects.
- Losing Redis loses no business state.
  − Small relay latency (poll interval ~1s); outbox table needs a retention/cleanup job.

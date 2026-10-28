# ADR-0001: Modular monolith + worker in an npm workspaces monorepo

- Status: Accepted (Phase 0)
- Date: 2026-10-28

## Context

Greenfield repo; one property at launch; spec §6 and §3.17 prefer boring infrastructure and npm workspaces. Three deployables share schema, types, validation, and design tokens.

## Decision

One repo with npm workspaces: `apps/web` (Next.js), `apps/api` (NestJS), `apps/worker` (NestJS app context + BullMQ), and `packages/{config,domain,database,shared-types,validation,payments,network,ui}`. API and worker are separate processes with independent scaling. No microservices.

## Consequences

- Shared types and one migration history; simple CI.
- Worker crash doesn't take the API down, and vice versa.
  − Need TypeScript project references and careful package boundaries (domain must not import Nest/Prisma).

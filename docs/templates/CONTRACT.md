---
type: contract
provider: api
consumers: [web]
---
# Catalog GraphQL

<!-- Template: copy to docs/contracts/<name>.md. A contract describes an interface one repository
     offers and others rely on: operations, types, errors, versioning. It is a living document:
     it describes what main offers today. Cite the code on both sides with backticked paths
     (`pnpm check` requires at least one per repository), link it from "How the repositories
     interact" in docs/ARCHITECTURE.md, and list it in a spec's "Documentation impact" whenever
     work changes it. A breaking change needs an ADR. -->

The API serves catalogue data to the web app over GraphQL at `/graphql`. The web app never calls the database or other services directly.

## Operations

| Operation | Purpose | Defined in | Used by |
|---|---|---|---|
| `perfume(id: ID!): PerfumeDetails` | One perfume's detail page | `repos/api/src/catalog/perfume.resolver.ts::PerfumeResolver` | `repos/web/src/services/catalog.client.ts::getPerfume` |
| `perfumes(ids: [ID!]!): [PerfumeComparison!]!` | Several perfumes for comparison, up to 50 ids, input order, unknown ids skipped | same resolver | `repos/web/src/services/catalog.client.ts::getPerfumes` |

## Types

The web app's copies of the result types live in `repos/web/src/types/catalog.types.ts`; they must match `repos/api/src/catalog/perfume.types.ts`. Dates travel as ISO-8601 strings.

## Errors

- An unknown id in `perfume(id)` returns a `NOT_FOUND` error; the web app renders its 404 page.
- More than 50 ids in `perfumes(ids)` returns `BAD_USER_INPUT`.

## Compatibility

Fields are only added, never removed or retyped, without an ADR and a coordinated release of both repositories.

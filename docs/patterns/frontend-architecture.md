---
type: pattern
---
# Frontend architecture

How a React web frontend is organised, which code may import which, and where its data, validation and types come from.

## When it applies

- Applies: React applications on Next.js App Router, Vite single-page apps, and React Router (formerly Remix) framework mode.
- Does not apply: server-rendered HTML with htmx ([hypermedia BFF](hypermedia-bff.md)); component libraries, which follow only the `src/ui/` and `src/lib/` rules.

## Rules

### Structure

1. Organise by feature: `src/domains/<feature>/` holds that feature's components, hooks, queries, schemas and adapters; no top-level `src/components/`, `src/hooks/`, `src/utils/` or `src/services/` — because type buckets scatter one feature across the tree and grow without an owner. [check: test: those folders do not exist]
2. Cross-cutting infrastructure (API clients, session, analytics, feature flags, error reporting) lives in `src/infrastructure/` ([house conventions](house-conventions.md) rule 26) and never imports `src/domains/` or `src/ui/` — because infrastructure that knows features creates cycles. [check: dependency-cruiser: `src/infrastructure` may not import `src/domains` or `src/ui`]
3. `src/ui/` holds domain-free primitives and imports only `src/lib/` and styles — because a button that imports a domain type can't be reused or tested alone. [check: dependency-cruiser: `src/ui` may import only `src/lib` and style files]
4. `src/lib/` is pure functions with no React state, no I/O and no imports from the rest of `src/` — because the leaf everyone uses must not depend on anyone. [check: dependency-cruiser: `src/lib` imports nothing outside itself]
5. Routes (`src/app/`) import features' public entries, `src/infrastructure/`, `src/ui/` and `src/lib/`; they compose and pass data, they don't implement features — because route files are where feature logic goes to hide.
6. A feature imports another only through its public entry (`src/domains/<other>/index.ts`), which names its exports explicitly and never mixes server-only and client modules — because deep imports couple features, and broad barrels defeat tree-shaking and drag server code into client bundles. [check: dependency-cruiser: imports into another feature must target its `index.ts`] [check: Biome: `noReExportAll`]
7. `src/generated/` is written only by codegen and regenerated in CI — because hand edits vanish on the next run and hide contract drift. [check: test: regenerate and fail on `git diff --exit-code`]
8. Imports that cross a top-level folder use the `@/` alias, and there are no cycles — because aliased paths keep boundary rules simple and greppable. [check: dependency-cruiser: no relative import leaves its top-level folder] [check: dependency-cruiser: no-circular]

### Data and types

9. Fetch request-time data on the server (server component, route loader) and pass it down; client code revalidates and mutates but never discovers data on mount — because `useEffect` fetches cause waterfalls, loading flashes and duplicate requests.
10. Parse every external response at the module that fetched it, so interior code uses typed values — because backend drift should fail at one boundary with a clear error, not as `undefined` deep in a render.
11. One source per response shape: for your own APIs, use types generated from the contract (and a schema generated from the same contract if you parse at runtime); hand-written schemas only for third-party or untyped responses — because a generated type plus a hand-written schema for the same response drift apart.
12. Adapters map wire shapes to view models, and components accept view models only — because an API rename otherwise ripples into dozens of components.
13. User input is never trusted interior data: route handlers, actions and loaders validate it ([forms](forms.md)) — because they are public endpoints ([authentication and authorization](authentication-and-authorization.md) rule 18) whatever page renders them.
14. Modules that hold secrets or reach data directly start with `import 'server-only'` — because a client import then fails the build instead of shipping a secret. [check: test: the production build fails when a client component imports a `server-only` module]
15. Build test fixtures through the same parser as real responses — because hand-built fixtures drift from the shape production sends. [check: test: fixtures are created by parsing]

### Composition and errors

16. Shared layouts take slots (`children`, named element props), not `config` or `variant` objects that branch inside — because each new case adds a branch to a component everyone must retest.
17. Client boundaries sit as low in the tree as possible; app-wide providers live in one client `providers` module rendered by a server root layout — because a client root makes the whole shell client-rendered and blocks server-only features.
18. Only error boundaries (root and one per feature) and server handlers report to the error tracker, under house conventions rule 4 ([observability](observability.md)); components render failure states and never report — because reporting at every layer files one failure many times.
19. Server fetches propagate `x-correlation-id` (house conventions rule 21), and the error UI shows it — because support can then find the logs from a screenshot.

## Example

The root layout stays a server component; only the providers module is a client boundary.

```tsx
// src/app/providers.tsx
'use client';
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// src/app/layout.tsx (no 'use client': it can export metadata, and pages stay server components)
export const metadata = { title: 'Orders' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>;
}
```

Adding `'use client'` to the layout is the tempting fix when a provider needs it; it breaks `metadata` and moves the shell to the client.

## Signs of legacy

- Top-level `src/components/`, `src/hooks/`, `src/utils/` or `src/services/`.
- `useEffect(() => { fetch(` or a request library call inside `useEffect`.
- `'use client'` at the top of a `layout.tsx`.
- Imports like `@/domains/<other>/components/…`; `export * from` in feature entries.
- `await res.json() as SomeType`; hand-written `interface …Response` next to generated types.
- Edited files under `src/generated/`.
- Components with `config` or `variant` props that switch layout.
- `process.env` secrets read in a module without `import 'server-only'`.

## Notes

### Next.js App Router

- `error.tsx` must be a client component; `global-error.tsx` covers errors in the root layout.
- Use `notFound()` and `redirect()` from `next/navigation` in server components.
- Set data caching explicitly per call, as [caching](caching.md) describes for Next.js.
- Public `NEXT_PUBLIC_` variables follow [configuration and secrets](configuration-and-secrets.md).
- Server actions and route handlers follow [authentication and authorization](authentication-and-authorization.md) rule 18.
- Pages Router apps can adopt the folder and import rules before the routing migration.

### Vite SPA (React)

- Without a server, start fetches in router loaders or prefetches and cache them with a query library keyed by route parameters, to avoid waterfalls.
- Public `VITE_` variables follow [configuration and secrets](configuration-and-secrets.md); when one build serves many environments, fetch a runtime config file instead.
- Prefer a BFF with cookie sessions over tokens held in the browser.
- Split code per route with `React.lazy`; `src/app/` holds the route definitions.

### React Router framework mode (Remix)

- `loader` is where server-first data lives; `action` handles mutations under [authentication and authorization](authentication-and-authorization.md) rule 18.
- Name server-only modules `*.server.ts` so the bundler keeps them out of client builds.
- Return validation failures from actions as data with status 400, in the shape of house conventions rule 5, and render them from the action data.
- Route modules stay thin: they call feature queries and adapters.

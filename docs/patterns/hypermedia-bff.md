---
type: pattern
---
# Hypermedia BFF

Server-rendered HTML applications whose browser interactivity is htmx fragment swaps, served by a backend-for-frontend over an API or application services.

## When it applies

- Applies: internal tools, back offices and content-heavy apps rendered with a template engine (or server JSX) on Express, Fastify or Hono, enhanced with htmx.
- Does not apply: apps that need rich client state, offline use or client-side routing ([frontend architecture](frontend-architecture.md)).

## Rules

### Shape

1. The BFF is a thin transport ([API transport](api-transport.md)): routes call an API client or the application service, build a view context and render; no business rules, no database driver — because a second home for rules drifts from the first. [check: dependency-cruiser: route modules may not import database drivers or repositories]
2. Templates are pure presentation: they receive a fully computed context and never fetch or call async helpers, and every template global and filter is a pure function — because I/O in templates hides N+1 calls and fails mid-render. [check: test: each template renders from a fixture context with the network disabled]
3. One URL serves both forms: the full document normally, and only the target fragment when `HX-Request: true`, unless `HX-Boosted` or `HX-History-Restore-Request` is also set. These responses send `Vary: HX-Request` — because caches and history restores otherwise serve a bare fragment as a page. [check: test: the same URL with and without `HX-Request` returns fragment and page, both with `Vary`]
4. A fragment is the same partial the full page includes, never a second copy of the markup — because duplicated markup diverges on the first change.
5. View state (filters, sort, page cursor) lives in the query string and is pushed with `hx-push-url` — because a reload or a shared link must reproduce the view.
6. Upstream calls go through one typed client under `infrastructure/` that follows [outbound calls](outbound-calls.md) — because ad hoc fetches in routes forget timeouts.
7. Forms that create or change state carry the idempotency key of [forms](forms.md) rule 10 in a hidden field, and the route forwards it upstream as `Idempotency-Key` — because htmx retries and double clicks otherwise create duplicates.

### Security

8. Every non-GET request, htmx requests included, passes the CSRF check of [authentication and authorization](authentication-and-authorization.md) rule 5: a verified `Origin`, or a token sent through `hx-headers` on `<body>` or an `htmx:configRequest` listener — because htmx requests send cookies like any form post. [check: test: an htmx POST with a foreign `Origin` or no token answers 403]
9. `GET` never changes state, even behind `hx-get` — because GETs skip CSRF checks and get prefetched.
10. Redirect to a return path (`?next=`) only when it is a same-origin relative path (one leading `/`, not `//` or `/\`); otherwise go home — because an unchecked return path is an open redirect. [check: test: `//evil.example`, `/\evil.example` and absolute URLs redirect home]
11. Send a Content Security Policy with a per-request nonce on every `<script>`; no inline event handlers; set `htmx.config.allowEval = false` — because swapped fragments are an HTML injection surface and a nonce-based CSP limits the damage.
12. Templates autoescape, and user data is never marked safe — because a fragment swapped into the DOM executes whatever markup it contains.

### Errors

13. htmx doesn't swap 4xx or 5xx responses by default; configure it deliberately (`responseHandling` in htmx 2, or an `htmx:beforeSwap` handler) so a 400 swaps the re-rendered form and other failures swap an error fragment into a known target — because otherwise a failed request leaves the page silently unchanged.
14. The error middleware answers htmx requests with an error fragment and other requests with a full error page, keeping the status and showing the `correlationId` — because a full page swapped into a table row breaks the layout.
15. A validation failure answers 400 with the form re-rendered, per house conventions rule 5 ([house conventions](house-conventions.md)): submitted values kept except secrets, accessible errors per [forms](forms.md) — because the form itself is where the user fixes the input.
16. Network failures produce no response: handle `htmx:sendError` on the client with a static, pre-rendered message — because no server fragment can arrive.
17. An expired session on an htmx request answers with `HX-Redirect` to the login page (with a validated return path) — because a login page swapped into a fragment is unusable.

### Client code

18. No client router and no client store; small scripts (or Alpine) hold only local UI state such as open/closed, never fetch, and carry the CSP nonce — because two copies of server state disagree.

## Example

The route where a missing `Vary` header or history-restore check serves a fragment as a whole page.

```ts
app.get('/orders', async (req, res) => {
  const page = await ordersApi.list(req.session.caller, parseOrderQuery(req.query));
  const fragmentOnly =
    req.get('HX-Request') === 'true' &&
    req.get('HX-Boosted') !== 'true' &&
    req.get('HX-History-Restore-Request') !== 'true';
  res.vary('HX-Request');
  res.render(fragmentOnly ? 'orders/_rows.njk' : 'orders/index.njk', { page });
});
```

## Signs of legacy

- Templates calling async filters or globals that fetch.
- `hx-post`, `hx-put` or `hx-delete` with no CSRF header configured.
- `res.redirect(req.query.next` without validation.
- Routes that branch on `HX-Request` without `Vary`.
- Separate `/partials/…` URLs duplicating page routes.
- `hx-on` attributes or inline `onclick` handlers.
- `| safe` applied to user-provided values.
- Routes returning `res.json(` for hand-written client scripts.
- Database driver imports in the BFF.

## Notes

### Express and Nunjucks

- `nunjucks.configure(dir, { autoescape: true, express: app })`; add `throwOnUndefined: true` in development and tests to catch missing context keys.
- Generate the nonce in middleware into `res.locals`; helmet's CSP directives accept a function that returns `'nonce-…'`.
- `csurf` is deprecated; use a maintained synchronizer or double-submit implementation.
- Express 5 forwards rejected async handlers to the error middleware; Express 4 needs a wrapper.
- Export a context type per template and render through a typed helper; templates aren't type-checked, so test them with fixtures.

### htmx

- htmx 2 `responseHandling` is an ordered list of `{ code, swap, error }` entries; add one that swaps `400` without treating it as an error.
- `HX-Retarget` and `HX-Reswap` response headers send an error fragment to a different target.
- `hx-swap-oob` updates extra regions (flash messages, counters) from one response; it is a response attribute, not an error mechanism.
- `HX-Redirect` for full navigations, `HX-Refresh: true` to reload, `HX-Location` for a client-side navigation.
- Under a strict CSP also set `includeIndicatorStyles: false` and `inlineScriptNonce`; keep `selfRequestsOnly` on (the htmx 2 default).
- Pin htmx through the bundler or a vendored copy, not an unpinned CDN link.

### Alpine (optional)

- The standard build evaluates expressions with `new Function` and needs `'unsafe-eval'`; under a strict CSP use the CSP build, which allows only registered data and simple expressions.
- Keep Alpine components outside swap targets, or initialise them in the fragment, because a swap replaces their state.
- Local UI state only; server data stays in the HTML.

### Hono and Fastify

- Fastify: `@fastify/view` for templates, `@fastify/csrf-protection`, `@fastify/helmet`; set `Vary` with `reply.header`.
- Hono: `hono/jsx` gives type-checked views; `hono/csrf` checks `Origin`; `hono/secure-headers` supports CSP nonces.
- Hono's `Origin` check satisfies [authentication and authorization](authentication-and-authorization.md) rule 5 together with `SameSite` cookies.

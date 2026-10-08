---
type: pattern
---
# Authentication and authorization

How users and services prove who they are, and how every operation decides whether that caller may perform it.

## When it applies

- Applies: every entry point (HTTP, GraphQL, server actions, WebSockets, webhooks) and every call between services.
- Does not apply: nothing is exempt; public endpoints are explicitly marked public rather than left unchecked.

## Rules

### Authentication

1. Verify every credential at the edge (gateway authorizer, middleware or guard): signature, issuer, audience, expiry, and an allowlist of algorithms — because a decoded but unverified token is a header the attacker writes. [check: test: expired, wrong-issuer, wrong-audience and unsigned tokens answer 401]
2. Browsers hold sessions or tokens only in `HttpOnly; Secure; SameSite=Lax` cookies, never in `localStorage` or URLs — because any XSS reads storage, and URLs land in logs and `Referer` headers.
3. Access tokens live minutes; refresh tokens rotate on every use, and reuse of an old refresh token revokes its whole family — because a stolen long-lived token works until it expires.
4. Issue a new session id at login and privilege change; logout and permission changes revoke server-side state — because a session id fixed before login, or a token that outlives its rights, is a takeover.
5. Every cookie-authenticated request that changes state passes a CSRF check, either a synchronizer or double-submit token or a verified `Origin` header matching the app's own origin, on top of `SameSite` cookies; `GET` never changes state, and bearer-token APIs need no CSRF token — because browsers attach cookies to cross-site requests, and a state-changing GET skips every check. [check: test: a cookie-authenticated POST without a valid token or with a foreign `Origin` answers 403]
6. Answer 401 (with `WWW-Authenticate` for bearer APIs) when the credential is missing, invalid or expired, and 403 when the caller is known but not allowed; answer 404 instead of 403 when existence itself is private — because clients refresh on 401 and give up on 403, and mixing them causes refresh loops.

### Identity propagation

7. The edge puts the verified identity (subject, the caller's scope, permissions) on the request context, and handlers pass it explicitly to application calls — because identity read from body, query, path or client-settable headers (`x-user-id`, `x-tenant-id`) is attacker input ([multi-tenancy](multi-tenancy.md)). [check: test: a request carrying a forged identity header acts as the token's subject]
8. A gateway-injected identity header is trusted only when the service is unreachable except through that gateway and the gateway strips client-supplied copies — because otherwise anyone can send the header directly.
9. Services authenticate each other with workload identity (IAM roles with SigV4, mTLS, or OAuth2 client credentials with short-lived, per-audience tokens), never shared static keys or "inside the network" — because a network position is not an identity, and a shared key cannot be revoked for one caller.
10. A service acting for a user carries the user's identity as well as its own, and authorizes against the user — because the service's broad permissions otherwise apply to any user's request (the confused deputy).

### Authorization

11. Deny by default: every route, resolver, action and subscription requires an authenticated caller unless explicitly marked public — because a new endpoint someone forgot to decorate otherwise ships open. [check: test: enumerate registered routes; each has a guard or a public marker]
12. Check coarse access at the edge and the specific operation again in the application service — because the application service is also reached by workers, other transports and future endpoints.
13. Every object addressed by an id from the request is loaded within the caller's scope or checked against the caller before it is returned or changed — because insecure direct object references are the most common API vulnerability. [check: test: caller A requesting caller B's object gets 404]
14. Decisions live in one policy module keyed by action (`order:refund`), not as role comparisons scattered across handlers — because scattered `role === 'admin'` checks cannot be audited or changed safely.
15. Sensitive fields on wire models (email, cost, internal notes) are gated by the same policy — because GraphQL and generic serializers expose every field the type declares.
16. Privileged actions (role changes, impersonation, refunds, exports, deletions) write an append-only audit record (actor, action, target, outcome, time, `correlationId`) kept apart from application logs and retained per [data lifecycle](data-lifecycle.md) — because after an incident you must answer "who did this", and application logs are sampled and rotated.
17. Support impersonation is explicit, time-boxed, visible to the user where appropriate, and audited with both identities — because silent impersonation is indistinguishable from account takeover.

### Public handlers

18. Server actions, route handlers and framework actions are public POST endpoints whatever page renders them: each one authenticates, authorizes and validates its own input ([forms](forms.md)) — because anyone can call them directly, and a hidden button is not an access check. [check: test: calling the action without a session, or as another caller, is rejected]

## Example

The object-level check, which handlers skip when the id comes from the URL.

```ts
async refundOrder(caller: Caller, orderId: string): Promise<Refund> {
  // Scoped load: another caller's id behaves exactly like a missing one.
  const order = await this.orders.findById(caller.scope, orderId);
  if (!order) throw new OrderNotFoundError(orderId);
  if (!policy.can(caller, 'order:refund', order)) throw new OrderRefundForbiddenError(orderId);
  return this.refunds.issue(caller, order);
}
```

## Signs of legacy

- `jwt.decode(` used for decisions; verification without `algorithms`, `audience` or `issuer`; `ignoreExpiration`.
- `localStorage.setItem('token'`; tokens in query strings.
- `req.headers['x-user-id']`, `req.body.userId` or `args.ownerId` treated as identity.
- `if (user.role === 'admin')` inside controllers or components.
- `findById(req.params.id)` with no caller or scope argument.
- One shared `API_KEY` environment variable used between internal services.
- Access tokens with `expiresIn` of days; no refresh rotation.
- `'use server'` functions with no session lookup.

## Notes

### OIDC and OAuth2 providers

- Authorization code flow with PKCE for browsers and mobile; never the implicit or password grants.
- ID tokens are for login; APIs accept access tokens whose audience is that API.
- Cache the JWKS and refetch on an unknown `kid`, with a rate limit on refetches.
- Map provider groups and claims to application permissions in one place.
- Cognito access tokens have no `aud` claim: check `client_id` and `token_use` instead (`aws-jwt-verify` does this).
- Machine clients use the client-credentials grant with per-service scopes.

### NestJS

- Register the auth guard globally (`APP_GUARD`) and mark public routes with a metadata decorator, so new routes are protected by default.
- Read the caller through a parameter decorator over `request.user`, never `@Body()`.
- For GraphQL, guards read the request via `GqlExecutionContext.create(context).getContext().req`.
- Guards throw `UnauthorizedException` and `ForbiddenException`; the error translator keeps them as 4xx.

### Next.js

- Middleware is a redirect convenience, not the security check: authorize again in every route handler, server action and data-access function.
- Keep data-access functions in modules that start with `import 'server-only'` and take the session as an argument.
- Server actions compare `Origin` with `Host`, which satisfies rule 5; cookie-authenticated route handlers need their own check.
- Session cookies: `httpOnly`, `secure`, `sameSite: 'lax'`.

### API Gateway authorizers

- HTTP API JWT authorizers check issuer and audience; the backend still authorizes per object.
- Authorizer results are cached: revocation lags by the cache TTL, and a cached Lambda-authorizer policy is reused for other routes with the same token, so grant every resource the token may call or narrow the cache key.
- Read identity from `requestContext.authorizer`, never from a header fallback.

### AWS IAM and SigV4 between services

- One role per service (task role, Lambda execution role), least privilege, no long-lived access keys.
- Sign calls to IAM-authorized endpoints (API Gateway `AWS_IAM`, Lambda function URLs) with the SDK's SigV4 signer.
- The receiver identifies the caller by the role ARN in the request context and authorizes on it.
- Cross-account access uses role assumption scoped by a trust policy, and an external id for third parties.

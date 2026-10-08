---
type: pattern
---
# Forms

How every form that submits user input is defined, validated on both sides, made accessible and submitted, on any rendering stack.

## When it applies

- Applies: client-rendered React forms, Next.js server actions, and plain HTML forms re-rendered by the server.
- Does not apply: display-only views; forms that post straight to a third-party hosted page (record that trust boundary in the repository map). A lone search box still has its query parameters validated server-side ([API transport](api-transport.md)).

## Rules

### One schema

1. Each form has one schema module defining fields, constraints and messages; types are inferred from it, `z.input` for form values and `z.output` for the parsed command — because a hand-written interface drifts, and defaults or transforms make input and output types differ. [check: tsc: no hand-written interface duplicates a schema's fields]
2. Client and server import the same schema module; the server extends it with checks only it can run (uniqueness, permissions, stock) and never keeps a copy — because two copies drift and the server copy is the one that matters.
3. The server validates every submission, in route handlers, server actions and controllers alike; server actions are public endpoints per [authentication and authorization](authentication-and-authorization.md) rule 18 — because client validation is a convenience anyone can bypass. [check: test: posting an invalid payload straight to the endpoint answers 400 `validation-failed`]
4. Async refinements live only in the server extension, which is parsed with `safeParseAsync` — because a synchronous parse throws when it meets an async refinement, and a client schema that calls the network on every keystroke invites account enumeration.
5. A body that isn't valid JSON or form data answers 400 `validation-failed`, never 500 — because `request.json()` throws on malformed input and an unhandled throw becomes a reported incident.
6. Server failures use the shapes of [house conventions](house-conventions.md) rule 5 (a server action returns exactly `{ ok: false, code: "validation-failed", issues, values }`), and the client puts each issue on its field by its dot-joined `path`, sending unknown paths to the form summary — because a generic toast hides what to fix.

### Accessibility

7. Every field has a visible `<label>`; an invalid field gets `aria-invalid="true"` and `aria-describedby` pointing at its error, with ids from `useId` or a per-instance prefix — because hard-coded ids collide when a form renders twice, and screen readers then announce the wrong error. [check: test: axe reports no violations in the error state; the field's accessible description is its error]
8. A failed submit moves focus to an error summary at the top that links to each invalid field — because a keyboard or screen-reader user otherwise doesn't learn the submit failed.
9. Validate on submit, then on change; don't disable the submit button to signal invalid input — because a disabled button hides why nothing happens.

### Submission

10. Disable submit while a request is pending, and give every form that creates or changes state an idempotency key generated when the form is rendered: HTML forms and server actions carry it in a hidden field, which the BFF or action forwards as `Idempotency-Key` ([HTTP idempotency and rate limits](http-idempotency-and-rate-limits.md); creates per house conventions rule 9), and client-rendered forms send the same per-render key as the header — because double clicks and retries create duplicates, and a key minted per click deduplicates nothing. [check: test: submitting the same rendered form twice creates one record]
11. Show success only after the server confirms anything irreversible or costly (payment, sign-up, order, deletion, message sent); optimistic updates are for reversible, low-stakes actions (like, favourite, reorder) and always roll back with a visible error on rejection — because an optimistic "order placed" the server then rejected is a broken promise.
12. Expected failures render inline; unexpected ones show a generic message with the `correlationId`; reporting follows house conventions rule 4 ([errors](errors.md)) — because a user who quotes the id lets support find the log line.
13. Log a submission as form name and outcome only, never its values, within house conventions rule 25 ([observability](observability.md)) — because forms carry passwords, addresses and payment data, and error reporters capture whatever the log call is given.
14. Secrets are never echoed back: after a failed submit, password and one-time-code fields are empty, and they carry the right `autocomplete` (`current-password`, `new-password`, `one-time-code`) — because re-rendered secrets end up in HTML caches and history.
15. Each repository has one form stack; a legacy stack remains only in forms not yet migrated, and a feature may contain both while it migrates — because "never mix" makes a new form in a legacy feature impossible. [check: dependency-cruiser: the legacy form library is importable only from an allowlist of existing files]

## Example

The server side of a submission, where malformed bodies and async checks usually turn into 500s.

```ts
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: 'validation-failed', issues: [{ path: '', code: 'invalid-json', message: 'Body is not valid JSON' }] },
      { status: 400 },
    );
  }
  const parsed = await signUpServerSchema.safeParseAsync(body); // includes the async uniqueness check
  if (!parsed.success) {
    return Response.json({ code: 'validation-failed', issues: toIssues(parsed.error) }, { status: 400 });
  }
  return Response.json(await accounts.signUp(parsed.data), { status: 201 });
}
```

`toIssues` joins each Zod issue's `path` array with dots and maps its code, so the client can place it on the field.

## Signs of legacy

- One `useState` per field plus a hand-written `validate()`.
- `alert(` or `toast.error(` used for field errors.
- `await request.json()` outside a `try`, or with no schema parse after it.
- `.safeParse(` on a schema containing `refine(async`.
- Hard-coded ids such as `id="email-error"`.
- `interface …FormValues` written beside a schema.
- A server action with no schema parse; `console.log(values)` or form data spread into a log call.

## Notes

### React Hook Form and Zod 4

- `zodResolver` from `@hookform/resolvers` 5 infers input and output types from the schema; when annotating `useForm`, use `z.input` for field values and `z.output` for the submit handler.
- Put server issues on fields with `setError(path, { type: 'server', message })`, and unknown paths on `setError('root.server', …)`.
- The default `mode: 'onSubmit'` and `reValidateMode: 'onChange'` already match rule 9 of this pattern.
- Zod 4: use top-level formats (`z.email()`, `z.url()`); `z.string().email()` is deprecated. Pass messages through the `error` parameter.
- Give every field a `defaultValue` so inputs never switch between controlled and uncontrolled.

### Next.js server actions and useActionState

- Every action authenticates, authorizes and calls `safeParseAsync` itself ([authentication and authorization](authentication-and-authorization.md) rule 18).
- Return validation failures as `{ ok: false, code: "validation-failed", issues, values }` and other expected failures as `{ ok: false, code, message }`; throw only unexpected failures, which `error.tsx` catches.
- `const [state, formAction, isPending] = useActionState(action, initialState)`; `<form action={formAction}>` works before hydration.
- React resets uncontrolled fields after a form action, so return the submitted values (minus secrets) and feed them back as `defaultValue`.
- `FormData` omits unchecked checkboxes and repeats multi-value fields: read them with `getAll` and let the schema coerce (`z.coerce`, checkbox to boolean).

### Plain HTML forms with server re-render

- On failure, re-render the form with status 400, the submitted values (minus secrets) and accessible errors; on success, redirect with 303 (Post/Redirect/Get) so a refresh doesn't resubmit.
- Cookie sessions need CSRF protection per [authentication and authorization](authentication-and-authorization.md) rule 5, usually a token in a hidden field next to the idempotency key.
- Native constraints (`required`, `type="email"`, `maxlength`) are the client layer; the server schema stays authoritative.
- Use `novalidate` when you render your own accessible errors, so browser bubbles don't duplicate them.
- htmx-enhanced forms follow [hypermedia BFF](hypermedia-bff.md).

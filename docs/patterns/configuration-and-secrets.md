---
type: pattern
---
# Configuration and secrets

How a process gets its settings and credentials: loaded once at boot, validated into one typed object, secrets fetched by name from a store, and none of it ever reaching source, bundles or logs.

## When it applies

- Applies: every deployable process (servers, workers, functions, scheduled jobs) and the server side of web frameworks.
- Does not apply: build-time tooling configuration (linters, bundlers) and per-request feature flags, which are data with their own service.

## Rules

### Loading

1. Read configuration in one module at boot: merge environment variables and fetched secrets, validate them with a schema into one frozen typed object, and pass that object to the rest of the code; nothing else reads `process.env` — because scattered reads fail one at a time in production, long after the deploy looked healthy. [check: Biome: rule banning `process.env` access, overridden to allow the config module]
2. A missing or invalid value (configuration or secret) makes the process log the failing key names and issue codes, never the values, and exit non-zero before it binds a port or consumes a queue — because a missing name is a deployment bug that no retry fixes, and a failed boot is caught by the deploy instead of by users. [check: test: loading with a key removed exits non-zero and prints the key name but not other values]
3. A secret store that is unreachable at boot is retried with backoff for a bounded time (for example 5 attempts within 30 seconds), then the process exits non-zero — because a store blip should not fail a deploy, and an endless retry hides a broken permission.
4. Validate formats in the schema at boot (URL shape, minimum key length, enum values, numeric ranges), not where the value is used — because a malformed key found mid-request fails a customer, not the deploy.
5. Configuration is immutable after boot; a changed value takes effect through a restart (a rolling deploy), unless rule 11 applies — because values that change under a running process make two instances behave differently with no record of why.

### Secrets

6. Source code, images, infrastructure state, CI logs and committed files hold secret names, never values; the values live only in a secret store — because anything committed or baked into an artifact is copied everywhere the artifact goes. [check: gitleaks: scan every push and pull request]
7. Name secrets `/<service>/<env>/<key>` and give every environment its own value; production never shares a value with another environment — because a leaked development credential must not open production, and path prefixes are what access policies scope by.
8. The application's access to the store is read-only and limited to its own prefix; code depends on a `get(names)` interface, never on writing, listing or rotating — because a compromised process should not be able to read other services' secrets or change its own.
9. Prefer fetching secrets from the store at boot over injecting their values into environment variables through infrastructure code — because injected values show up in function and task definitions, consoles and infrastructure state to anyone who can read those.
10. Commit `.env.example` with every key the schema expects and only non-secret development defaults; `.env` files are gitignored — because the example is the documentation of what the process needs, and a committed `.env` is how values leak. [check: test: the schema's keys equal the keys in `.env.example`]

### Rotation and exposure

11. Rotation happens in the store, never in the application; the previous value stays valid until every instance has restarted, and only secrets that rotate automatically (dynamic database credentials, short-lived tokens) are re-read in-process with a cache lifetime shorter than that overlap — because rotating a value that running instances still use causes an outage.
12. Variables with a framework's public prefix (`NEXT_PUBLIC_` in Next.js, `VITE_` in Vite) are public: they are inlined into client bundles, so no secret ever gets that prefix, and nothing else reaches the browser — because everything in a bundle is readable by anyone who loads the page. [check: gitleaks: scan the built client assets in CI]
13. The config object never prints its secret fields (redacting `toJSON` and inspect output), the loader never logs values, and the logger's redaction is the backstop ([observability](observability.md)) — because a config dumped in a debug line or an error context is the most common leak.
14. Tests build the typed config object directly with fake values; they never read a real store or depend on the developer's environment — because tests that pass only on one machine, or that touch production secrets, are worse than none.

## Example

Loading and failing correctly: names and issue codes only, exit before serving.

```ts
import { z } from 'zod';

const Config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.url(),
  JWT_SIGNING_KEY: z.string().min(32),
});
export type Config = Readonly<z.infer<typeof Config>>;

export function parseConfig(source: Record<string, string | undefined>): Config {
  const parsed = Config.safeParse(source);
  if (!parsed.success) {
    // Never print `source` or the parsed input: they hold the secret values.
    for (const issue of parsed.error.issues) {
      process.stderr.write(`invalid config ${issue.path.join('.')}: ${issue.code}\n`);
    }
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

// main.ts: secrets fetched by name (with bounded retry), then validated with the rest.
const config = parseConfig({ ...process.env, ...(await fetchSecrets(secretNames)) });
```

The usual mistakes are logging the whole environment when validation fails, and validating lazily after the server is already listening.

## Signs of legacy

- `process.env.` outside the config module; `process.env.X || 'default'` for credentials.
- A committed `.env`, or `.env.example` containing real-looking values.
- Secret-store SDK clients created in services or handlers instead of the boot loader.
- Infrastructure code that writes secret values into environment variables in plain text.
- The same secret name or value shared by all environments.
- `logger.info(config)` or `console.log(process.env)`.

## Notes

### AWS Secrets Manager

- Fetch at boot with `GetSecretValue`, or `BatchGetSecretValue` for several secrets in one call.
- Managed rotation keeps `AWSCURRENT` and `AWSPREVIOUS` versions; with the alternating-users strategy the old credential stays valid during the overlap of rule 11.
- In Lambda, the AWS Parameters and Secrets Lambda Extension caches values with a TTL, which makes it suitable for the in-process re-read case.
- Grant `secretsmanager:GetSecretValue` on the service's own name prefix only.

### SSM Parameter Store

- Store secrets as `SecureString` (KMS-encrypted) and read them with `WithDecryption`; non-secret settings can be `String` parameters.
- Hierarchical names match rule 7; `GetParametersByPath` loads one service and environment in one call.
- Standard parameters have no per-parameter charge, but they are size-limited and have no built-in rotation; use Secrets Manager for credentials that rotate.

### SST v3

- Declare `new sst.Secret("StripeKey")`, set it per stage with `sst secret set StripeKey <value> --stage production`, and link it to the `sst.aws.Function` or `sst.aws.Service` that needs it.
- Read it in code with `Resource.StripeKey.value` (from `sst`), inside the config module like any other source.
- Values are stored per stage, encrypted in the SST state bucket in S3; a stage without a value (and no placeholder) fails the deploy, which is the boot-time failure of rule 2 moved earlier.

### HashiCorp Vault

- Authenticate with a platform identity (Kubernetes, AWS IAM, AppRole), never a long-lived static token in the environment.
- Use KV version 2 for static secrets (versioned, so rollback is possible).
- Dynamic database credentials have leases: renew them in-process or let Vault Agent render them to a file, which is the re-read case in rule 11.

### Local development

- Load `.env` with `node --env-file=.env` (Node 20.6 and later) or the framework's own loader; never commit it.
- In Next.js, the `create-next-app` template gitignores `.env*.local` files, and `NEXT_PUBLIC_` values are inlined at build time, so they cannot differ between environments when one build is promoted; read per-environment values on the server at runtime instead.

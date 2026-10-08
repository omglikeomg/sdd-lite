---
type: pattern
---
# Delivery pipeline

How code goes from a pull request to production: CI, versioning, promotion, infrastructure as code, migrations and rollback.

## When it applies

- Applies: every repository that builds, deploys or provisions anything, on any CI system and any infrastructure tool.
- Does not apply: libraries that only publish packages, beyond the merge gate, rule 5 and the credentials and supply-chain rules.

## Rules

### Merge gate

1. CI runs lint, type check, tests and build from a frozen lockfile on every pull request, and the CI jobs hold no deploy credentials — because a pull request job that can deploy lets unreviewed code reach an environment. [check: zizmor: no `id-token: write` or environment on `pull_request` workflows] [check: review: required status checks cover lint, types, tests and build]
2. Pull requests from forks get no secrets and never run under `pull_request_target` with a checkout of their code — because that combination hands repository secrets to a stranger's script. [check: zizmor: dangerous triggers]
3. Use a merge queue (or "require branches up to date") instead of re-running the full CI on main — because duplicate CI on main costs twice and still lets an untested combination merge.

### Versions and promotion

4. Build once per commit and promote the same artifact (image digest, bundle checksum) from staging to production; never rebuild for production — because a rebuild is a different artifact from the one you tested.
5. Versions and tags are created only by automation, are immutable, and map to one commit; every running service reports its version and commit — because a moved tag or an unknown build makes incidents unanswerable. [check: review: a tag ruleset restricts creating, moving and deleting `v*` tags to the release automation]
6. Merge to main deploys to staging automatically; production deploys only on an explicit promotion of a version already deployed to staging, through a protected environment with required reviewers — because the approval belongs to the platform, not to a script anyone can edit.
7. Serialise deploys per environment with a concurrency lock and never cancel a deploy in progress — because two concurrent applies, or one killed halfway, corrupt infrastructure state.

### Credentials and supply chain

8. Authenticate to clouds with OIDC, one role per environment, with trust scoped to repository, environment and ref; no long-lived cloud keys in CI — because a leaked static key works from anywhere until someone notices. [check: gitleaks: no cloud access keys in the repository] [check: review: CI secrets hold no cloud keys]
9. Pin third-party actions and CI includes to a full commit SHA and let a bot propose updates — because a tag can be repointed to malicious code after you reviewed it. [check: zizmor: unpinned uses]
10. Declare token permissions per workflow, read-only by default, granting write scopes only to the job that needs them — because the default token is broader than any single job needs.
11. Pass secrets and untrusted event fields to scripts through environment variables, never by interpolating them into the script text; never print them — because interpolation turns a branch name or PR title into shell code. [check: zizmor: template injection]

### Deploy, verify, roll back

12. Run migrations as their own gated pipeline step before the new code takes traffic, following [schema migrations](schema-migrations.md) (expand now, contract in a later release) — because old code, still running or rolled back to, must work against the new schema.
13. Every deploy ends with an automated smoke check that asserts the deployed version or commit, not just a 200 — because a green health check from the previous version proves nothing.
14. Roll back by redeploying a known-good artifact through the same pipeline, and only when the current schema is compatible with it; otherwise roll forward — because rolling code back onto a contracted schema turns an incident into data loss.
15. Give every job a hard timeout and never auto-retry a failed deploy; a human reads the failure first — because re-applying a broken change repeats the damage and hides the cause.
16. Stateful production resources (databases, buckets, queues with data) are retained on removal and protected from deletion; ephemeral stages are fully removable — because a stage removal or a refactor that renames a resource otherwise deletes production data.
17. One infrastructure tool owns each resource; no console changes, and a diff or plan is reviewed before apply — because two owners or manual edits produce drift that the next apply silently reverts.
18. Give each pull request a preview environment built by the same infrastructure code, with synthetic data, no production secrets, and automatic teardown on close plus a TTL — because shared staging serialises the team, and forgotten previews leak cost and data.
19. Separate deploy from release with feature flags for risky behaviour: every flag has an owner, a safe default when the flag service is down, and a removal date — because a deploy that also releases cannot be undone without a rollback, and permanent flags become untested branches.

## Example

The production job that is easy to get wrong: protected environment, lock, scoped OIDC, pinned actions, no interpolation in the script.

```yaml
on:
  release:
    types: [published]
permissions:
  contents: read
concurrency:
  group: deploy-production
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production        # required reviewers; OIDC trust is scoped to this environment
    timeout-minutes: 30
    permissions:
      contents: read
      id-token: write              # only this job may request cloud credentials
    steps:
      - uses: aws-actions/configure-aws-credentials@<commit-sha> # v4
        with:
          role-to-assume: ${{ vars.PRODUCTION_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - run: ./scripts/promote.sh "$VERSION"   # deploys the artifact built for this version
        env:
          VERSION: ${{ github.event.release.tag_name }}
```

Writing `run: ./scripts/promote.sh ${{ github.event.release.tag_name }}` instead would execute whatever the release name contains.

## Signs of legacy

- `AWS_ACCESS_KEY_ID` or cloud keys in CI secrets; no `permissions:` block; `uses: …@v4` or `@main`.
- No `concurrency:` or `environment:` on deploy jobs; deploy jobs triggered by `pull_request` or `pull_request_target`.
- `${{ github.event.` inside `run:` blocks.
- Production deploys from laptops (`terraform apply`, `cdk deploy`, `kubectl apply` in personal scripts) or a `workflow_dispatch` anyone can run.
- Rebuilding images in the production job; images deployed by mutable tag (`:latest`).
- Migrations run at application boot; down migrations used as the rollback plan.
- Production resources without deletion protection; `removal: 'remove'` for every stage.

## Notes

### GitHub Actions

- Use environments with required reviewers and deployment tag rules; the OIDC `sub` claim then carries `environment:<name>`, which the cloud role's trust policy should match.
- Releases and tags created with the default `GITHUB_TOKEN` do not trigger other workflows; use a GitHub App token or deploy in the same workflow.
- Required checks must also run on the `merge_group` event or the merge queue stalls; run actionlint and zizmor on workflow changes, and let Dependabot or Renovate update pinned SHAs.

### GitLab CI

- Use `id_tokens:` with an explicit `aud` for OIDC to clouds; no CI/CD variables holding cloud keys.
- `resource_group: production` serialises deploys per environment.
- Protected environments with deployment approvals gate production; protected and masked variables are visible only to protected refs.
- Pin `include:` templates to a commit SHA.

### SST v3

- Set `removal: input?.stage === "production" ? "retain" : "remove"` and `protect` for production stages in `app()`; resources are declared in `run()`.
- Deploy with `sst deploy --stage <stage>`; review `sst diff --stage <stage>` before production; a preview is a `pr-<number>` stage removed with `sst remove`.
- SST v3 runs on Pulumi, not CloudFormation: a failed deploy leaves partial changes and does not roll back on its own; fix forward or redeploy the previous version.
- Secrets are set per stage and linked to the resource that reads them; the rest is in [configuration and secrets](configuration-and-secrets.md).
- SST builds during deploy; build-once promotion means a prebuilt image or bundle passed to the deploy, or a pinned commit and lockfile as the promoted unit.

### Terraform and OpenTofu

- Remote state with locking, one state per environment; commit `.terraform.lock.hcl`; plan on the pull request, save it with `-out`, and apply exactly that plan after review.
- `prevent_destroy` on stateful resources; a scheduled `plan -detailed-exitcode` detects drift; no `-target` in pipelines.

### AWS CDK

- `cdk diff` on the pull request; deploy only from the pipeline after review.
- `RemovalPolicy.RETAIN` and `terminationProtection: true` for production stateful stacks; commit `cdk.context.json`.
- CloudFormation does roll back failed updates; a stack stuck in `UPDATE_ROLLBACK_FAILED` needs a manual continue-rollback.

### Pulumi

- `pulumi preview` on the pull request, `pulumi up` on promotion; stack per environment.
- `protect: true` and `retainOnDelete` on stateful resources; secrets encrypted in stack config.

### Containers versus Lambda

- Lambda for spiky, short, stateless work; containers (ECS, Kubernetes) for long-running workers, steady traffic and connection-heavy services.
- Tag images with the commit, deploy by digest, scan them, and run as non-root.
- ECS: enable the deployment circuit breaker with rollback, and gate rollout on health checks; in SST that is `sst.aws.Service` in an `sst.aws.Cluster`.
- Kubernetes: readiness probes gate traffic; a GitOps controller (Argo CD, Flux) is the only writer to the cluster.
- Lambda: publish versions behind an alias and shift traffic gradually with alarms that stop the shift.

### Feature flags

- Use a vendor-neutral client interface (OpenFeature); evaluate security- or money-related flags on the server.
- Kill switches for risky dependencies are permanent and documented; release flags are removed after rollout.
- Never put a schema change behind a flag; flags gate behaviour, migrations gate shape.

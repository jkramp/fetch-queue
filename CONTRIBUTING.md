# Contributing to fetch-queue

Changes should keep queue behavior predictable and the package free of runtime
dependencies. Include a regression test when fixing scheduling, retry, cancellation,
or option-handling behavior. Documentation changes should describe the actual
release they apply to.

## Set up a checkout

Use Node 24 for development. `.nvmrc` selects that release line if you use nvm.
The supported runtime minimum is Node 22.13.0. CI also checks Node 26.

```sh
git clone https://github.com/jkramp/fetch-queue.git
cd fetch-queue
npm ci
npm run check
```

There is no build step. `index.js` is both the source and the published runtime.
`index.d.ts` declares the public API. Keep them consistent.

## Commands

| Command                 | Purpose                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `npm test`              | Run unit and native HTTP integration tests with Node's test runner                               |
| `npm run test:coverage` | Report runtime coverage; tests do not call external services                                     |
| `npm run test:types`    | Compile positive and negative TypeScript consumer examples                                       |
| `npm run test:package`  | Pack, install, and exercise the package in a temporary project; check NodeNext and bundler types |
| `npm run lint`          | Run ESLint across JavaScript source, tests, and scripts                                          |
| `npm run format`        | Apply Prettier formatting                                                                        |
| `npm run format:check`  | Check formatting without modifying files                                                         |
| `npm run test:docs`     | Check local documentation links and JavaScript example syntax                                    |
| `npm run example`       | Run a local batch-and-retry example                                                              |
| `npm run check`         | Run the required checks and the example                                                          |

`npm run test:package` uses npm's CLI path supplied by the npm script. Run it
through npm rather than invoking its script directly. It removes its temporary
tarball and consumer directory after success or failure.

## Making a pull request

1. Update your local `main` and create a branch named for its purpose, such as
   `fix/retry-cancellation` or `docs/configuration`.
2. Reproduce the problem. For runtime bugs, write a regression test that fails
   before the fix and passes afterward.
3. Make a focused change and update the API reference or migration notes if
   callers will observe different behavior.
4. Run `npm run check` and `git diff --check`. Review `git diff` for unrelated
   edits, generated files, and sensitive data.
5. Commit with a message that describes the change, push the branch, and open a
   PR against `main`. Explain the problem, the resulting behavior, compatibility
   implications, and the checks you ran.
6. Review the diff and GitHub Actions results. Resolve review findings before
   merging. A green CI result supports review; it does not replace reading the change.

For a normal independent branch:

```sh
git switch main
git pull --ff-only
git switch -c fix/retry-cancellation
# Make and check the change.
git add index.js test/queue.test.js
git commit -m "Fix retry cancellation"
git push -u origin fix/retry-cancellation
gh pr create --base main
```

Configure Git's name/email and authenticate `gh` with your own GitHub account.
Do not commit credentials, `.env` files, registry tokens, or temporary diagnostics.
Ask before introducing a runtime dependency. Development dependencies belong in
`devDependencies` and the lockfile.

## Reviewing stacked PRs

A dependent PR can target another feature branch while its prerequisite is open.
This keeps each diff focused. Merge the earliest prerequisite first.

Before merging the next PR, change its base to `main` using GitHub's **Edit** control
beside the PR title. Then check **Files changed** and rerun checks if needed. GitHub
may retarget it automatically when the previous branch is deleted, but verify the
base rather than relying on that behavior.

For example, runtime fixes can precede package/CI work and project documentation.
Each dependent PR description should identify its prerequisite.

A merge commit preserves ancestry and is the easiest option while these PRs are
stacked. Squash or rebase merging rewrites that ancestry, so later branches may
need rebasing to remove commits already incorporated into `main`. Once a PR is
independent, squash merging is a reasonable way to keep a focused main history.
Delete a branch only after its work is merged and dependent PRs are accounted for.

## Test and review expectations

Scheduling tests should assert both request results and queue status. Await every
request and shutdown promise. Include cases with a waiting retry, an active
request, and repeated shutdown calls; a test that only awaits `killQueue` can miss
orphaned requests.

Use native Fetch objects and a loopback HTTP server when behavior depends on
response streams, headers, or abort signals. Do not add a global rejection handler
that hides unhandled promises. Keep test fixtures free of real credentials.

The queue counts fetch calls until headers arrive, so tests for body consumption
must assert that behavior explicitly. Retry policy tests should measure actual
fetch calls rather than just the reported attempt count.

For browser-facing changes, check an ES module import, an HTTP retry, and caller
cancellation while reading a response body in the browsers you intend to support.
Browser checks are currently separate from CI; the review record names what was
actually tested.

## Releases

CI validates PRs and never publishes to npm. `prepublishOnly` runs the complete
check command if a maintainer invokes `npm publish`.

1. Review compatibility changes and choose a semantic version. Changes that break
   backward compatibility require a major release.
2. Update `package.json`, the lockfile, the changelog, and any release-specific README
   notices in a release PR. Run `npm run check` and review `npm pack --dry-run`.
3. Merge the release PR and confirm CI on the release commit.
4. An authorized maintainer publishes from that clean commit and creates the
   matching Git tag and GitHub release.

Use npm's current authentication and publishing requirements. Keep credentials in
the operator's environment or approved secret store, never in the repository.

Security reports go through the [private reporting process](./SECURITY.md).

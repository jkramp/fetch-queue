# Repository review

Reviewed on September 12, 2026, starting from `main` commit `c78a53b`.
The review covered every tracked source/documentation file, the open refactor,
the console-cleanup contribution, the documentation issue, and npm packaging.
The published 1.0.3 runtime matches that baseline after normalizing line endings.

The work was reviewed and merged through [runtime PR #4](https://github.com/jkramp/fetch-queue/pull/4),
[package/CI PR #5](https://github.com/jkramp/fetch-queue/pull/5), and
[documentation PR #6](https://github.com/jkramp/fetch-queue/pull/6).
Release changes and migration instructions are recorded in the [changelog](../CHANGELOG.md).

## Behavior findings

| Priority | Finding                                                                        | Resolution and evidence                                                                |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| High     | Idle/missing shutdowns and overlapping kills could remain pending              | Lifecycle tests await every shutdown caller and cover missing queues                   |
| High     | Retry timers were not tracked; forced shutdown could orphan request promises   | Retry waits are tracked separately and their request promises settle during shutdown   |
| High     | Failed active work could restart after shutdown                                | Tests reject an active fetch during shutdown and assert there is no second fetch       |
| High     | Caller signals could bypass forced cancellation, and caller aborts could retry | Native signal composition and queued/waiting/active cancellation tests                 |
| High     | Response-body cancellation could disconnect after headers arrived              | Native HTTP tests abort body reads after both HTTP 200 and 503 headers                 |
| High     | Synchronous fetch errors could strand slots or overflow the scheduler stack    | Completion cleanup and a drain guard; 15,000-request backlog regression                |
| Medium   | `retries: 0` made no request; reported attempts were incorrect                 | Zero now makes one attempt and failures report actual fetch counts                     |
| Medium   | HTTP retry configuration was ignored or matched incorrectly                    | Tests cover list positions, status families, unlisted errors, and final failure bodies |
| Medium   | Native Headers/FormData/signals could be damaged by configuration cloning      | Options preserve platform objects and copy headers deliberately                        |
| Medium   | Prototype-property names collided with the queue registry                      | Map-backed registry; constructor and prototype-name tests                              |
| Medium   | Invalid configuration could hang queues                                        | Configuration and input validation before scheduling                                   |
| Medium   | Streaming uploads cannot be replayed safely                                    | Streams are attempted once; declarations include Node's duplex option                  |

The first regression run against the baseline failed four of five tests: idle
shutdown, zero attempts, retry status, and selective HTTP retry. Subsequent review
found response-body cancellation and the large synchronous-failure backlog case;
each was reproduced before fixing it.

Bulk shutdown previously shifted the queued array once per canceled request.
A local 50,000-request benchmark took about 580 ms before clearing the array once,
and 4 ms afterward. All requests settled in both runs. These timings describe this
machine and workload, not a cross-platform performance guarantee.

## Standards and maintenance findings

The original repository supplied no project-specific coding standards. The
review therefore treated design smells as judgment calls and concentrated on
observable failures rather than stylistic rewrites.

| Finding                                                | Resolution                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| No test runner or CI                                   | Node tests and an Actions matrix for Node 22/24/26 on Linux, Node 24 on Windows/macOS     |
| Repeated scheduler cleanup across error paths          | Centralized settlement and a `finally` path for active slot cleanup                       |
| Ambiguous ES module metadata and missing declarations  | Explicit exports and checked TypeScript declarations                                      |
| No verification of what npm consumers actually install | Pack/install/runtime/type checks in a temporary consumer, with a published-file allowlist |
| No consistent development checks                       | ESLint, Prettier, editor settings, lockfile, and a single check command                   |
| Windows checkout/launcher differences                  | LF Git attributes and CLI execution through Node; dedicated Windows CI                    |
| Missing or invalid README examples and links           | Rewritten README/API guide, JavaScript syntax checks, and local-link checks               |
| Unclear retry values reported in issue #1              | Defaults and allowed values tables, explicit total-attempt examples, and migration notes  |
| Console noise reported in PR #2                        | Silent default behavior and debug-count tests, with contributor credit retained           |
| No private security-reporting route                    | SECURITY.md and enabled GitHub private vulnerability reporting                            |

## Validation

- 34 runtime tests cover queue scheduling, retry status, cancellation, option
  merging, native HTTP responses, and a 15,000-request backlog.
- CI runs lint, formatting, TypeScript checks, runtime tests, package installation,
  and coverage. The documentation branch also runs its local example and docs checks.
- Package declarations are checked under both NodeNext and bundler resolution,
  including positive and negative TypeScript examples.
- `npm audit` reported no known vulnerabilities in the installed dependency tree.
  The library has no runtime dependencies.
- Browser smoke checks passed in Chromium 151 and Firefox 141, covering ES module
  imports, HTTP retries, native Request input, response-body cancellation, and shutdown.
- The local batch example verifies its results and ends with zero queue counts.
- Git whitespace checks and scans of the new source, documentation, branch names,
  and commit metadata are part of the final review.

## Remaining boundaries

This is an in-memory queue. It has no persistence, request-per-second rate limit,
queue-size cap, automatic timeout, or Retry-After/backoff policy. Applications that
need those controls must provide them or choose a queue with those capabilities.

Concurrency ends at response headers. Shutdown does not own response bodies
already returned to callers, and an abort-ignoring custom fetch can delay shutdown.
These behaviors are documented in the [API reference](./api.md).

Safari/WebKit and mobile devices were not tested. Browser checks are separate from
CI. These checks cover the reviewed implementation; the changelog records subsequent releases.

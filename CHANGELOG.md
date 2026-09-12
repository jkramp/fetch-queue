# Changelog

## Unreleased

### Compatibility changes

- Require Node.js 22.13.0 or later and explicitly declare ES modules.
- Honor `retryOn` for HTTP failures instead of retrying every non-OK response.
- Reject invalid configuration and inputs with `TypeError`.
- Merge headers by name, normalize the `baseUrl` slash boundary, and bypass the
  prefix for absolute URLs and native URL/Request inputs.
- Do not retry caller cancellation or streaming request bodies.

These changes should ship in a major release. See the [migration guide](./docs/migration.md).

### Fixed

- Resolve shutdowns for idle, missing, and repeatedly stopped queues.
- Settle queued and retrying requests during shutdown and clear retry timers.
- Prevent failed active requests from restarting after shutdown.
- Abort active requests during forced shutdown even with a caller signal.
- Preserve caller cancellation while reading returned response bodies.
- Make one request with `retries: 0` and report actual attempt counts.
- Release concurrency after synchronous fetch exceptions without overflowing the
  stack when a large backlog fails.
- Track retry waits in queue status and cancel discarded HTTP response bodies.
- Support queue names that match JavaScript object prototype properties.
- Preserve native Headers, FormData, and AbortSignal values in configuration.
- Remove unconditional console output and avoid request data in debug logs.
- Correct introductory examples, the license link, and the packaged README logo.

### Added

- Isolated queue registries through `createFetchQueue`.
- Native URL and Request inputs, validated configuration, and TypeScript declarations.
- Optional forced destruction and a switch to disable debugging.
- Runtime and HTTP integration tests, installed-package tests, linting, formatting,
  and GitHub Actions across supported Node versions and desktop operating systems.
- API and migration references, a local example, contributor guidance, private
  vulnerability reporting, and an evidence-based review record.

## 1.0.x

The npm registry publishes 1.0.3, while the repository baseline contains version
1.0.2 metadata. The published 1.0.3 runtime matches the baseline after normalizing
line endings. Configurable HTTP retry status codes are present in both.
This review does not assign new historical release dates.

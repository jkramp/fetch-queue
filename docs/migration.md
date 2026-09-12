# Migrating from 1.0.x

These changes are unreleased. npm currently publishes version `1.0.3`. The repository retains its historical
`1.0.2` metadata until the maintainer prepares a release. The published 1.0.3
runtime matches the review baseline after line endings are normalized. Because runtime requirements and observable retry
behavior change, publish them as a major release rather than replacing an existing 1.0.x version.
No npm package is published by CI.

## Runtime and imports

The package explicitly declares ES modules and requires Node.js 22.13.0 or later.
Older Node releases are outside the supported range. Modern browsers need the web
APIs listed in the [README](../README.md#runtime-support).

Keep using the default or named imports:

```js
import fetchQueue, { createQueue } from 'fetch-queue'
```

The existing `fetch-queue/index.js` path remains available. New TypeScript
declarations work with NodeNext and bundler resolution. Other internal package
paths are no longer public exports.

## Retry counts and HTTP failures

The historical `retries` option counted total attempts, despite its name. That
meaning remains. Its broken zero-value behavior is corrected:

| Configuration                     | 1.0.x behavior                                              | New behavior                                    |
| --------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `retries: 0`                      | Rejects before making a request                             | Makes one attempt                               |
| `retries: 1`                      | Makes one attempt                                           | Makes one attempt                               |
| `retries: 3`                      | Makes at most three attempts                                | Makes at most three attempts                    |
| `retryOn: [503]` with an HTTP 404 | Retries despite the configuration                           | Rejects after the first attempt                 |
| Exhausted attempts                | Adds a final wait and reports an incorrect `attempts` field | Rejects immediately with the actual fetch count |

All final non-OK HTTP responses still reject. Successful HTTP responses resolve.
Network exceptions still retry, except cancellation. To disable all retries, use
`retries: 0` or `1`; `retryOn: []` disables only HTTP retries.

Review writes before enabling retries. A timed-out request may already have changed
server state. Use one attempt or a server-supported idempotency key. Stream bodies
are attempted once because they cannot be replayed.

The unreleased refactor that preceded this review was never part of the published
API. Its proposed `retryBackoff` and `rejectOnHttpError` options are not included.
The current behavior is fully specified in the [API reference](./api.md).

## Configuration and request options

Invalid concurrency, retry counts, delays, status patterns, names, and argument
types now fail with `TypeError`, instead of hanging or silently falling back.

Headers merge by name across defaults and per-call options. Previously, providing
per-call headers replaced the entire defaults object. If you relied on that to
remove a default header, create a separate queue with the intended defaults.
Bodies and native objects are preserved rather than serialized.

The `baseUrl` boundary normalizes a single trailing or leading slash. Extra slashes
remain unchanged. Absolute strings and native `URL` and
`Request` inputs bypass the prefix. This can change a request that previously
relied on literal string concatenation. See [URL handling](./api.md#fetchqueue).

## Cancellation and queue lifetime

Idle or missing queue shutdowns now resolve. Repeated shutdown calls all settle.
Queued and retrying requests reject when stopping, and an active failure cannot
restart the queue. Forced shutdown also aborts active fetches, including ones that
use a caller-supplied signal.

The queue's shutdown rejection remains the string `'Queue Killed'`. Caller
cancellation now rejects with the signal's reason, commonly an `AbortError`, and
is not retried. Final HTTP/fetch failures retain the object shape
`{ url, fetchOptions, attempts, error }`; `attempts` is now numeric and accurate.
The `fetchOptions` field now contains merged defaults and a native `Headers` object,
instead of the original per-call options. Use `headers.get(name)` rather than plain
property access. Default credentials may now be present in this field, so do not
log or serialize the complete failure object.

`killQueue` leaves a queue reusable. `destroyQueue` removes its configuration.
Destroying the default queue recreates it. Both operations accept an optional
`force` argument and count active fetches only until headers arrive or fetch rejects.
Use caller signals to cancel response bodies already returned by the queue.

If a custom fetch implementation ignores abort signals, a forced shutdown waits
until that fetch settles. No automatic timeout is added.

## Debug output

Unconditional console logs are removed. Debugging remains opt-in through
`debugQueue()` and can now be disabled with `debugQueue(false)`. Output contains
counts and lifecycle events, with no request data.

## Adopting the release

1. Upgrade the runtime and confirm the app resolves ES modules.
2. Check retry counts, HTTP status handling, write idempotency, and default headers.
3. Handle both queue shutdown and caller-abort rejection values.
4. Run the app's own integration tests, including reads of response bodies.
5. Upgrade the package when the maintainer publishes the new major version.

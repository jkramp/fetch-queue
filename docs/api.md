# API reference

This reference describes version 2.0.0. See the [migration guide](./migration.md)
for behavior that differs from version 1.0.x.

## Exports

```js
import fetchQueue, {
  createFetchQueue,
  createQueue,
  checkQueue,
  killQueue,
  destroyQueue,
  debugQueue,
} from 'fetch-queue'
```

The default export and named `fetchQueue` export are the same function. The named
functions share one registry containing a queue named `'default'`. Each
`createFetchQueue()` call returns its own registry and the same six operations.
Instances do not share concurrency limits, configuration, or debug settings.

All queue names must be non-empty strings. Names such as `'constructor'` and
`'__proto__'` are valid. Inspecting, stopping, or destroying a missing queue does
not create it. Fetching through a missing name creates it with the instance defaults.

## `createFetchQueue(config = {})`

Return an object with `fetchQueue`, `createQueue`, `checkQueue`, `killQueue`,
`destroyQueue`, and `debugQueue`. The supplied configuration applies to its default
queue and supplies defaults for later named queues.

Prefer an isolated instance when separate clients need different credentials or
limits. For a server serving multiple users, scope instances so a shared registry
does not mix users' request defaults.

## `createQueue(queueName = 'default', config = {})`

Create a named queue. Returns `undefined` on success. If the name already exists,
returns `{ error: 'Queue exists. Cannot create a new one' }` and preserves its
configuration. Invalid new configuration throws `TypeError`.

The default queue already exists. To configure it, use `createFetchQueue(config)`.
To replace a named queue's configuration, await `destroyQueue(name)` and create it again.

| Configuration  | Accepted values                                                                     | Default                            |
| -------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `concurrent`   | Positive safe integer                                                               | `3`                                |
| `retries`      | Non-negative safe integer. Counts total fetch attempts. `0` and `1` both allow one. | `3`                                |
| `retryDelay`   | Finite number of seconds, `0` to `2147483.647` inclusive                            | `10`                               |
| `retryOn`      | Array of integer HTTP statuses from `100` to `599`, or `'1xx'` through `'5xx'`      | `[408, 409, 418, 425, 429, '5xx']` |
| `baseUrl`      | String                                                                              | `''`                               |
| `fetchOptions` | Native request options object                                                       | `{}`                               |

Only non-OK responses are eligible for HTTP retries, even if a successful status
appears in `retryOn`. An empty list disables HTTP retries, but fetch exceptions
still retry within the attempt limit. Use `retries: 0` or `1` to disable all retries.

The delay limit avoids timer overflow. Delays are approximate minimum waits, since
other work on the event loop and the queue's concurrency limit can postpone a retry.
The delay is fixed. There is no exponential backoff, jitter, or `Retry-After` handling.

## fetchQueue

`fetchQueue(url, fetchOptions = {}, queueName = 'default')`

Return a `Promise<Response>` for an enqueued request. `url` accepts a non-empty
string, a native `URL`, or a native `Request`. `fetchOptions.queueName`, when
present, overrides the third argument and is removed before calling native fetch.
Invalid arguments reject the returned promise with `TypeError`.

For relative string inputs, `baseUrl` and the input join at a slash boundary.
A single trailing or leading slash is normalized; extra slashes remain unchanged. With base `https://example.com/api`, both `'items'` and `'/items'` produce
`https://example.com/api/items`. This is path-prefix joining, not the root-relative
behavior of `new URL('/items', base)`. Absolute strings, protocol-relative strings,
`URL` objects, and `Request` objects bypass the prefix. Relative URLs require a
browser origin or an absolute `baseUrl` when using Node.

Queue defaults and per-call fetch options merge shallowly, except headers. Headers
merge case-insensitively, in this order: queue defaults, any `Request` headers,
then per-call headers. `new Headers()`, header objects, and header tuples are
accepted. A per-call header replaces the corresponding default; passing an empty
header set does not remove existing defaults.

The merged options are passed as native fetch's second argument. As with
`fetch(request, init)`, these options override the `Request` object's corresponding
properties. A signal supplied in per-call options overrides the queue's default
signal. If neither is supplied, the `Request` signal is used. Explicit `signal: null`
disables a default or `Request` signal.

Headers and retry lists are copied. Bodies and other platform objects retain their
identity. Treat a body as owned by its request once enqueued; changing or consuming
it while it waits can change the eventual fetch.

### Retry behavior

New work enters the queue in FIFO order. A failed request waiting on a timer does
not occupy a concurrency slot. When its timer fires, it joins the back of the queue.
Completion order can differ from enqueue order.

A successful response resolves immediately. A non-OK response retries only if its
status matches `retryOn`. A fetch exception retries unless it is an abort. Once
attempts are exhausted, the request rejects without an extra delay. Discarded
intermediate response bodies are canceled to release their HTTP resources. The
final error response body remains available to the caller.

A network failure does not prove the server did no work. Retries can duplicate
POSTs, payments, or other writes. Choose one attempt for operations that are not
safe to repeat, or implement idempotency on the server.

Streaming bodies cannot be replayed and are attempted once. This includes a
`ReadableStream` in `fetchOptions.body` and a `Request` object that has a body,
even when that `Request` was constructed from a string. For a replayable string
body, pass the string directly as `fetchOptions.body`.

Node stream uploads can supply `duplex: 'half'`. Runtime-specific fetch extensions
are forwarded, but only the standard web options and this duplex field are included
in the declarations. There is no automatic request timeout. Use an abort signal,
for example `AbortSignal.timeout(5000)` on runtimes that support it.

### Errors

There are four rejection forms:

| Cause                                                     | Rejection value                          |
| --------------------------------------------------------- | ---------------------------------------- |
| Final HTTP failure or fetch exception                     | `{ url, fetchOptions, attempts, error }` |
| Invalid arguments or configuration created during enqueue | `TypeError`                              |
| Caller cancellation or native `AbortError`                | The abort reason or native abort error   |
| Queue shutdown cancellation                               | The string `'Queue Killed'`              |

`url` is the original input. `fetchOptions` contains merged options. `attempts` is
the number of fetch calls actually started, and `error` contains the final
`Response` or value thrown by fetch. This object is not an `Error` instance.
Custom abort reasons may be any JavaScript value.

```js
try {
  const response = await client.fetchQueue('/items')
  const items = await response.json()
  console.log(items)
} catch (error) {
  if (error === 'Queue Killed' || error?.name === 'AbortError') {
    // Expected cancellation.
  } else if (error?.error instanceof Response) {
    console.error('HTTP status:', error.error.status)
    // Read or cancel the final response body when it is no longer needed.
    await error.error.body?.cancel()
  } else {
    console.error('Request failed after attempts:', error?.attempts)
  }
}
```

Do not log the entire rejection object if request URLs, bodies, or headers contain
credentials or personal data. Errors while reading `response.json()` or another
body method are outside the queue and do not trigger retries.

## `checkQueue(queueName = 'default')`

Return a snapshot. A missing queue reports zero counts and `killed: false`.

| Field       | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `queueName` | Requested name                                                    |
| `queued`    | Requests waiting for an active slot                               |
| `pending`   | Requests waiting for a retry timer                                |
| `running`   | Active fetch calls awaiting response headers or rejection         |
| `total`     | `queued + pending + running`                                      |
| `killed`    | Whether a stop or destroy is currently waiting for active fetches |

`total: 0` does not mean all response bodies have been consumed. Status is a
snapshot, not an event subscription or a promise that the queue is drained.

## Queue lifecycle

### `killQueue(queueName = 'default', force = false)`

Reject queued and retrying requests with `'Queue Killed'`, clear their timers, and
wait for active fetch calls. New requests reject with the same value while the stop
is in progress. Successful active fetches may resolve; a failed active fetch cannot
schedule another retry. Repeated calls all settle when the active work finishes.

With `force: true`, also reject active request promises and abort their native
fetch signals. A later forced stop can upgrade an existing graceful stop. The
caller's own controller is not aborted. The stop promise waits for the underlying
fetch calls to settle so concurrency counts remain accurate.

The queue remains configured and becomes reusable when shutdown finishes. Stopping
an idle or missing queue resolves immediately. `killed` becomes false after stopping;
it is not a persistent disabled state.

### `destroyQueue(queueName = 'default', force = false)`

Perform the same shutdown, then remove the queue and its configuration. Repeated
calls are safe. Destroying `'default'` creates a fresh default queue with the
instance's original defaults. Await destruction before intentionally reusing the name.

### Limits of shutdown

Concurrency and shutdown cover the fetch call through response headers, not body
consumption. A response already returned to a caller is outside queue shutdown.
The caller's abort signal stays connected to that response body and can cancel it.

A custom fetch implementation must honor `AbortSignal` and eventually settle.
If it ignores cancellation and never settles, even a forced stop must wait for it.
The queue does not pretend such a request has released its active slot.

## `debugQueue(enabled = true)`

Enable or disable `console.debug` messages for the instance. Messages contain
request-start/request-finish events and queue counts. URLs, headers, bodies,
responses, and queue names are omitted. Logging is disabled by default.

## TypeScript

Declarations ship with the package. The web Fetch types require the `DOM` library
in `tsconfig.json`, alongside an appropriate ECMAScript library. Consumer checks
cover both `NodeNext` and `Bundler` module resolution.

Exported types are `QueueConfig`, `QueueRequestInit`, `FetchQueueOptions`,
`QueueStatus`, `QueueError`, `FetchQueueInstance`, and `HttpStatusFamily`.

```ts
import { createFetchQueue, type QueueConfig } from 'fetch-queue'

const config: QueueConfig = { concurrent: 2, retryOn: [429, '5xx'] }
const client = createFetchQueue(config)
const response: Response = await client.fetchQueue('https://example.com')
```

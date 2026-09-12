![fetch-queue logo](./logo.svg)

# fetch-queue

Limit concurrent Fetch requests, retry selected HTTP failures, and cancel queued work.
`fetch-queue` is an ES module with no runtime dependencies. Use a shared queue across
an application, or create isolated queues for separate clients.

> Version 2 requires Node.js 22.13.0 or later and changes some request behavior.
> Upgrading from 1.0.x? Read the [migration guide](./docs/migration.md) for retry,
> header, URL, configuration, and cancellation changes.

## Quick start

Install the published package:

```sh
npm install fetch-queue
```

To run the local example from a checkout, use `npm ci` followed by `npm run example`.
The example starts a local HTTP server, runs a batch with one retry, and shuts down.
It does not call an external service.

The API returns a `Promise<Response>`:

```js
import fetchQueue from 'fetch-queue'

const response = await fetchQueue('https://api.example.com/items')
const items = await response.json()
```

Replace the example URL with your API endpoint. Unlike native `fetch`, a final
non-OK HTTP response rejects the promise. See [error handling](./docs/api.md#errors).

## Queue a batch

```js
import { createFetchQueue } from 'fetch-queue'

const client = createFetchQueue({
  concurrent: 2,
  retries: 3,
  retryDelay: 0.5,
  baseUrl: 'https://api.example.com',
  fetchOptions: { headers: { accept: 'application/json' } },
})

const results = await Promise.allSettled(
  ['/items/1', '/items/2', '/items/3'].map(async (path) => {
    const response = await client.fetchQueue(path)
    return response.json()
  }),
)

for (const result of results) {
  if (result.status === 'fulfilled') console.log(result.value)
  else console.error('Request failed')
}
```

A concurrency slot lasts until `fetch` returns response headers or rejects.
Reading the response body happens outside that limit. Retry waits also release
the slot, so another request can start.

## Configuration

Pass these options to `createFetchQueue(config)` or `createQueue(name, config)`.

| Option         | Default                            | Meaning                                                                                                                     |
| -------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `concurrent`   | `3`                                | Maximum active fetch calls. Must be a positive integer.                                                                     |
| `retries`      | `3`                                | Total attempts, including the first request. Both `0` and `1` mean one attempt. Must be a non-negative integer.             |
| `retryDelay`   | `10`                               | Fixed delay in seconds between attempts. Accepts fractions from `0` through `2147483.647`.                                  |
| `retryOn`      | `[408, 409, 418, 425, 429, '5xx']` | HTTP failures that may retry. Use status numbers or families such as `'5xx'`. Network failures also retry.                  |
| `baseUrl`      | `''`                               | Prefix for relative string inputs. Absolute URLs, `URL`, and `Request` objects bypass it.                                   |
| `fetchOptions` | `{}`                               | Native fetch defaults, including headers and an optional signal. Per-call options override defaults. Headers merge by name. |

The `retries` name is retained for compatibility with 1.0.x, where it counted total
attempts. Set it to `0` or `1` for one request, `2` for at most two requests, and `3`
for at most three requests. Invalid configuration throws `TypeError` when creating
a queue.

Retries can repeat writes. For requests with side effects, use one attempt unless
your server makes repeated requests safe, for example through an idempotency key.
Streaming request bodies, including a `Request` with a body, are attempted once.

## Cancellation and shutdown

```js
import { createFetchQueue } from 'fetch-queue'

const client = createFetchQueue()
const controller = new AbortController()
const request = client.fetchQueue('https://api.example.com/items', {
  signal: controller.signal,
})

controller.abort()

try {
  await request
} catch (error) {
  if (error?.name !== 'AbortError') throw error
}

await client.destroyQueue()
```

`killQueue(name)` rejects queued and retrying requests and waits for active fetches.
`killQueue(name, true)` also aborts active fetches. The queue can be used again when
the call resolves. `destroyQueue(name, force)` also removes its configuration.
Shutdown cancellation rejects with the legacy value `'Queue Killed'`.

Caller signals also cancel a returned response body while it is being read.
Queue shutdown does not affect response bodies whose fetch calls have already
finished. See the [lifecycle reference](./docs/api.md#queue-lifecycle) for details.

## Runtime support

Version 2 targets Node.js 22.13.0 or later and modern browsers with
`fetch`, `Headers`, `Request`, `URL`, `AbortController`, `AbortSignal.any`, and
`AbortSignal.prototype.throwIfAborted`. It includes TypeScript declarations and
requires no build step. Browser projects normally resolve the npm import through
a bundler; native browser modules need a URL or an import map.

CI checks Node 22, 24, and 26 on Linux, plus Node 24 on Windows and macOS. Runtime
support and release policies are described in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Documentation and development

- [API reference](./docs/api.md): exports, options, errors, status, and lifecycle behavior.
- [Migration guide](./docs/migration.md): changes from 1.0.x and release compatibility.
- [Changelog](./CHANGELOG.md): release history, fixes, and additions.
- [Contributing](./CONTRIBUTING.md): local checks, tests, and the pull request workflow.
- [Review record](./docs/review.md): findings, fixes, and validation from this review.
- [Security policy](./SECURITY.md): private vulnerability reporting.

```sh
npm ci
npm run check
npm run test:coverage
npm run example
```

## License and credits

Licensed under [GNU GPL version 3](./LICENSE). Copyright 2021 Jeff Kramp.
Logo by Dan Hetteix, from [The Noun Project](https://thenounproject.com/term/tissue-box/29225/).

Thanks to Tom De Smet for reporting the retry documentation gap and submitting
the console-output cleanup in [#2](https://github.com/jkramp/fetch-queue/pull/2).

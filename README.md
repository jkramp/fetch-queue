![Alt text](./logo.svg)

# fetch-queue
A simple queue system for fetch requests

See https://github.com/jkramp/fetch-queue for complete documentation.

## TL;DR?

1. Import and use just as you would with fetch
2. Profit!

_NOTE: This assumes fetch is globally available (Node >= 18)_

## Yet another queue tool?
There are a lot of queuing tools out there. This one is specific to fetch and built to be a drop in replacement for fetch.


## Basic Usage

Import and call in place of fetch. This can be called in multiple parts of an application or in a batch using Promise.all or Promise.allSettled

```javascript
    import fetchQueue from 'fetch-queue'

    Promise.allSettled([
        fetchQueue('https://example.com/endpoint1',{
                method: 'POST',
                body: JSON.stringify({test:123})
            }).then(resp=>resp.json()),
        fetchQueue('https://example.com/endpoint2',{
                method: 'POST',
                body: JSON.stringify({test:123})
            }).then(resp=>resp.json()),
        fetchQueue('https://example.com/endpoint3',{
                method: 'POST',
                body: JSON.stringify({test:123})
            }).then(resp=>resp.json())
    ])
    .then(resp=>{
        console.log('DONE', resp)
    }).catch(error=>{
        console.log(error)
    })
```

## Advanced Usage

```javascript

    import {
        debugQueue,
        createQueue,
        fetchQueue,
        checkQueue,
        killQueue,
        destroyQueue,
     } from 'fetch-queue'

    // enable debugging to the console
    debugQueue()

    // create a custom queue
    createQueue('mySpecialQueue', {
        concurrent: 3, // how many fetch requests the queue will process at any given time
        retries: 3,  // how many retries will occur on a failed request
        retryDelay: 10, // how many seconds between retries (approx)
        retryBackoff: 'fixed', // 'fixed' or 'exponential' - see Retry Backoff section
        fetchOptions: {
            headers: {
                Authorization: 'bearer 123456'
            }
        }, // preset fetch options to be included with each request
        baseUrl: 'https://example.com/', // prefix urls with this string
        retryOn: [408, 409, 418, 425, 429, '5xx'], // http response codes that the queue should retry
        rejectOnHttpError: false, // see Deprecations section below
    })

    // add item to a custom queue
    fetchQueue('endpoint1',{
            method: 'POST',
            body: JSON.stringify({test:123})
        }, 'mySpecialQueue')
        .then(resp=>resp.json())
        .then(resp=>{
            console.log('DONE', resp)
        }).catch(error=>{
            console.log(error)
        })

    // check the status of a queue
    let result = checkQueue('mySpecialQueue')

    // kill a queue
    killQueue('mySpecialQueue').then(()=>{
        console.log('Queue is dead')
    })

    // force kill - also aborts in-flight requests
    killQueue('mySpecialQueue', true).then(()=>{
        console.log('Queue is dead, all requests aborted')
    })

    destroyQueue('mySpecialQueue').then(()=>{
        console.log('Queue no longer exists')
    })
```

## Isolated Instances

If you need multiple independent queue systems (e.g. in tests or separate parts of an app), use `createFetchQueue` to get an isolated instance with its own state:

```javascript
    import { createFetchQueue } from 'fetch-queue'

    const api = createFetchQueue({
        baseUrl: 'https://api.example.com',
        concurrent: 5,
    })

    api.fetchQueue('/users').then(resp => resp.json())
    api.checkQueue()
    api.killQueue()
```

Each instance has its own `fetchQueue`, `createQueue`, `checkQueue`, `killQueue`, `destroyQueue`, and `debugQueue` functions. The global exports still work exactly as before and share a single default instance.

## Retry Backoff

By default, retries use a fixed delay (`retryDelay` seconds between each attempt). You can switch to exponential backoff, which doubles the delay after each failed attempt:

```javascript
    createQueue('backoff-queue', {
        retryDelay: 1,
        retryBackoff: 'exponential', // 1s, 2s, 4s, 8s, ...
        retries: 5,
    })
```

| Attempt | `'fixed'` (default) | `'exponential'` |
|---------|-------------------|-----------------|
| 1st retry | 1s | 1s |
| 2nd retry | 1s | 2s |
| 3rd retry | 1s | 4s |
| 4th retry | 1s | 8s |

## TypeScript

This package ships with TypeScript declarations. Types are available for all config options, queue status, and error objects:

```typescript
    import fetchQueue, { createQueue, type QueueConfig, type QueueStatus } from 'fetch-queue'
```

---

## What's new in v1.1

### Bug fixes

- **Retry matching fixed** - The first two status codes in `retryOn` were silently ignored due to an `indexOf > 1` bug (should have been `> -1`). All codes in `retryOn` now work correctly.
- **Attempt count fixed** - When a request exhausted all retries, the rejection error's `attempts` field contained the error object instead of the actual attempt count. It now correctly reports the number of attempts made.
- **Retry timeout tracking fixed** - Retry wait timers were not being tracked properly, which meant `killQueue` with `force=true` could not clear them. This now works as expected.
- **baseUrl joining fixed** - `baseUrl` and the request path are now joined with proper slash handling. Previously, `baseUrl: 'https://api.example.com'` + `'users'` would produce `https://api.example.comusers`.
- **Debug logging cleaned up** - Stray `console.log` calls in the retry error path have been removed. Use `debugQueue()` to enable logging.

### New features

- **Exponential backoff** - Set `retryBackoff: 'exponential'` to double the delay between each retry attempt.
- **Isolated instances** - `createFetchQueue()` returns a fully independent queue system with its own state.
- **AbortController support** - Each request gets an AbortController. Use `killQueue(name, true)` to abort in-flight requests. If you pass your own `signal` in fetch options, it will not be overridden.
- **TypeScript declarations** - Full `.d.ts` file included for IDE autocomplete and type checking.
- **Input validation** - `fetchQueue()` now rejects with a `TypeError` if the URL is missing or not a string.

---

## Deprecations

The following behaviors are kept for backwards compatibility but are **deprecated and will be removed in the next major version**:

### Kill rejection format

When a queue is killed, pending tasks are currently rejected with a plain string:

```javascript
    // current (deprecated)
    fetchQueue('/test').catch(err => {
        err === 'Queue Killed' // true
    })
```

In a future major version, this will change to a structured error object matching the same shape as other rejections (`{ url, fetchOptions, attempts, error }`). If you currently check `err === 'Queue Killed'`, plan to update your code.

### Retry-all behavior

By default, **all** non-2xx responses are retried, regardless of whether the status code is in `retryOn`. This is the legacy behavior. In a future major version, only status codes listed in `retryOn` will be retried, and other HTTP errors will reject immediately.

To opt in to the new behavior now, set `rejectOnHttpError: true`:

```javascript
    createQueue('strict', {
        retryOn: [429, '5xx'],
        rejectOnHttpError: true, // 404, 403, etc. reject immediately instead of retrying
    })
```

We recommend setting `rejectOnHttpError: true` in new code to avoid unnecessary retries on errors like 404 or 403 that will never succeed.

---

## License

fetch-queue is licensed under the GPLv3.
See [License.txt](./License.txt)

---

Copyright (C) 2021 Jeff Kramp
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

---

Logo by Dan Hetteix

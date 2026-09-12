import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createFetchQueue } from '../index.js'

const originalFetch = globalThis.fetch
const fresh = async () => ({ ...createFetchQueue(), createFetchQueue })
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}
const bounded = (promise, timeout = 500) => {
    let timer
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error('Queue did not settle')),
                timeout,
            )
        }),
    ]).finally(() => clearTimeout(timer))
}
afterEach(() => {
    globalThis.fetch = originalFetch
})

test('stopping idle and missing queues resolves', async () => {
    const queue = await fresh()
    await bounded(queue.killQueue())
    await bounded(queue.killQueue('missing'))
    assert.equal(queue.checkQueue().total, 0)
})

test('zero retries still performs one request', async () => {
    const queue = await fresh()
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        return new Response('ok')
    }
    queue.createQueue('once', { retries: 0 })
    assert.equal(
        await (
            await queue.fetchQueue('https://example.test', {}, 'once')
        ).text(),
        'ok',
    )
    assert.equal(calls, 1)
})

test('retry waits are counted and stopping settles the waiting request', async () => {
    const queue = await fresh()
    globalThis.fetch = async () => {
        throw new TypeError('offline')
    }
    queue.createQueue('retry', { retryDelay: 0.05 })
    const result = queue
        .fetchQueue('https://example.test', {}, 'retry')
        .catch((error) => error)
    await tick()
    assert.equal(queue.checkQueue('retry').pending, 1)
    await bounded(queue.killQueue('retry', true))
    assert.equal(await bounded(result), 'Queue Killed')
    assert.equal(queue.checkQueue('retry').total, 0)
})

test('only configured HTTP failures retry and attempts is numeric', async () => {
    const queue = await fresh()
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        return new Response('missing', { status: 404 })
    }
    queue.createQueue('http', { retries: 3, retryDelay: 0, retryOn: [503] })
    await assert.rejects(
        queue.fetchQueue('https://example.test', {}, 'http'),
        (error) => {
            assert.equal(error.attempts, 1)
            assert.equal(error.error.status, 404)
            return true
        },
    )
    assert.equal(calls, 1)
})

test('concurrency is bounded and queued work starts in FIFO order', async () => {
    const queue = await fresh()
    queue.createQueue('fifo', { concurrent: 2 })
    const requests = []
    globalThis.fetch = (url) => {
        const request = deferred()
        requests.push({ url, ...request })
        return request.promise
    }
    const results = Array.from({ length: 5 }, (_, n) =>
        queue.fetchQueue(`${n}`, {}, 'fifo'),
    )
    assert.deepEqual(
        requests.map((request) => request.url),
        ['0', '1'],
    )
    assert.equal(queue.checkQueue('fifo').queued, 3)
    requests[1].resolve(new Response('1'))
    await tick()
    assert.deepEqual(
        requests.map((request) => request.url),
        ['0', '1', '2'],
    )
    requests[0].resolve(new Response('0'))
    await tick()
    requests[2].resolve(new Response('2'))
    await tick()
    requests[3].resolve(new Response('3'))
    requests[4].resolve(new Response('4'))
    await Promise.all(results)
    assert.equal(queue.checkQueue('fifo').total, 0)
})

test('concurrent stops settle and a failed active request never restarts', async () => {
    const queue = await fresh()
    queue.createQueue('stop', { concurrent: 1, retryDelay: 0 })
    const active = deferred()
    let calls = 0
    globalThis.fetch = () => {
        calls++
        return active.promise
    }
    const first = queue.fetchQueue('active', {}, 'stop').catch((error) => error)
    const waiting = queue
        .fetchQueue('waiting', {}, 'stop')
        .catch((error) => error)
    const stops = [queue.killQueue('stop'), queue.killQueue('stop')]
    assert.equal(queue.checkQueue('stop').killed, true)
    assert.equal(
        await queue.fetchQueue('late', {}, 'stop').catch((error) => error),
        'Queue Killed',
    )
    active.reject(new TypeError('offline'))
    await bounded(Promise.all(stops))
    assert.deepEqual(await Promise.all([first, waiting]), [
        'Queue Killed',
        'Queue Killed',
    ])
    await tick()
    assert.equal(calls, 1)
    assert.equal(queue.checkQueue('stop').total, 0)
})

test('graceful stop lets a successful active request finish and queue can be reused', async () => {
    const queue = await fresh()
    const active = deferred()
    globalThis.fetch = () => active.promise
    const request = queue.fetchQueue('active')
    const stopped = queue.killQueue()
    active.resolve(new Response('done'))
    await stopped
    assert.equal(await (await request).text(), 'done')
    globalThis.fetch = async () => new Response('again')
    assert.equal(await (await queue.fetchQueue('next')).text(), 'again')
})

test('force stop aborts active fetch even with a caller signal', async () => {
    const queue = await fresh()
    const caller = new AbortController()
    let fetchSignal
    globalThis.fetch = (_, { signal }) =>
        new Promise((_, reject) => {
            fetchSignal = signal
            signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
            })
        })
    const request = queue
        .fetchQueue('active', { signal: caller.signal })
        .catch((error) => error)
    await bounded(queue.killQueue('default', true))
    assert.equal(await request, 'Queue Killed')
    assert.equal(fetchSignal.aborted, true)
    assert.equal(caller.signal.aborted, false)
    assert.equal(queue.checkQueue().total, 0)
})

test('a graceful stop can be upgraded to a forced destroy', async () => {
    const queue = await fresh()
    queue.createQueue('temporary')
    globalThis.fetch = (_, { signal }) =>
        new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
            })
        })
    const request = queue
        .fetchQueue('active', {}, 'temporary')
        .catch((error) => error)
    await bounded(
        Promise.all([
            queue.killQueue('temporary'),
            queue.destroyQueue('temporary', true),
        ]),
    )
    assert.equal(await request, 'Queue Killed')
    assert.equal(queue.createQueue('temporary'), undefined)
})

test('caller abort cancels queued work without making a fetch', async () => {
    const queue = await fresh()
    queue.createQueue('abort', { concurrent: 1 })
    const active = deferred()
    let calls = 0
    globalThis.fetch = () => {
        calls++
        return active.promise
    }
    const first = queue.fetchQueue('first', {}, 'abort')
    const controller = new AbortController()
    const reason = new Error('no longer needed')
    const second = queue
        .fetchQueue('second', { signal: controller.signal }, 'abort')
        .catch((error) => error)
    controller.abort(reason)
    assert.equal(await second, reason)
    assert.equal(queue.checkQueue('abort').queued, 0)
    active.resolve(new Response())
    await first
    assert.equal(calls, 1)
})

test('caller abort cancels a retry wait and is never retried', async () => {
    const queue = await fresh()
    queue.createQueue('abort', { retryDelay: 0.05 })
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        throw new TypeError('offline')
    }
    const controller = new AbortController()
    const request = queue
        .fetchQueue('first', { signal: controller.signal }, 'abort')
        .catch((error) => error)
    await tick()
    assert.equal(queue.checkQueue('abort').pending, 1)
    controller.abort()
    assert.equal((await request).name, 'AbortError')
    assert.equal(queue.checkQueue('abort').total, 0)
    assert.equal(calls, 1)
})

test('caller abort keeps a running slot occupied until fetch settles', async () => {
    const queue = await fresh()
    queue.createQueue('abort', { concurrent: 1 })
    const active = deferred()
    let calls = 0
    globalThis.fetch = () => {
        calls++
        return active.promise
    }
    const controller = new AbortController()
    const request = queue
        .fetchQueue('first', { signal: controller.signal }, 'abort')
        .catch((error) => error)
    const second = queue.fetchQueue('second', {}, 'abort')
    controller.abort()
    assert.equal((await request).name, 'AbortError')
    assert.equal(queue.checkQueue('abort').running, 1)
    assert.equal(calls, 1)
    globalThis.fetch = async () => {
        calls++
        return new Response()
    }
    active.reject(controller.signal.reason)
    await second
    assert.equal(calls, 2)
})

test('already aborted signals do not call fetch', async () => {
    const queue = await fresh()
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        return new Response()
    }
    const reason = new Error('cancelled')
    await assert.rejects(
        queue.fetchQueue('unused', { signal: AbortSignal.abort(reason) }),
        (error) => error === reason,
    )
    assert.equal(calls, 0)
    assert.equal(queue.checkQueue().total, 0)
})

test('synchronous failures release slots and report actual attempts', async () => {
    const queue = await fresh()
    queue.createQueue('sync', { concurrent: 1, retries: 2, retryDelay: 0 })
    let calls = 0
    const reason = new TypeError('fetch implementation threw')
    globalThis.fetch = () => {
        calls++
        throw reason
    }
    const results = await bounded(
        Promise.allSettled([
            queue.fetchQueue('first', {}, 'sync'),
            queue.fetchQueue('second', {}, 'sync'),
        ]),
    )
    for (const result of results) {
        assert.equal(result.status, 'rejected')
        assert.equal(result.reason.attempts, 2)
        assert.equal(result.reason.error, reason)
    }
    assert.equal(calls, 4)
    assert.equal(queue.checkQueue('sync').total, 0)
})

test('AbortError from fetch is not retried', async () => {
    const queue = await fresh()
    const reason = new DOMException('cancelled', 'AbortError')
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        throw reason
    }
    await assert.rejects(
        queue.fetchQueue('aborted'),
        (error) => error === reason,
    )
    assert.equal(calls, 1)
})

test('retry matches the first entry, the second entry, and status families', async () => {
    const queue = await fresh()
    for (const status of [408, 429, 502]) {
        queue.createQueue(`http-${status}`, {
            retryOn: [408, 429, '5xx'],
            retryDelay: 0,
        })
        let calls = 0
        let cancelled = false
        globalThis.fetch = async () => {
            calls++
            return calls === 1
                ? new Response(
                      new ReadableStream({
                          cancel() {
                              cancelled = true
                          },
                      }),
                      { status },
                  )
                : new Response('ok')
        }
        assert.equal(
            await (
                await queue.fetchQueue('retry', {}, `http-${status}`)
            ).text(),
            'ok',
        )
        assert.equal(calls, 2)
        assert.equal(cancelled, true)
    }
})

test('final HTTP error body is readable and there is no final retry delay', async () => {
    const queue = await fresh()
    queue.createQueue('final', { retries: 1, retryDelay: 100 })
    globalThis.fetch = async () => new Response('unavailable', { status: 503 })
    await assert.rejects(
        bounded(queue.fetchQueue('failure', {}, 'final')),
        (asyncError) => {
            assert.equal(asyncError.attempts, 1)
            assert.equal(asyncError.error.bodyUsed, false)
            return true
        },
    )
    const error = await queue
        .fetchQueue('failure', {}, 'final')
        .catch((error) => error)
    assert.equal(await error.error.text(), 'unavailable')
    assert.equal(queue.checkQueue('final').pending, 0)
})

test('retry delay releases concurrency for fresh work', async () => {
    const queue = await fresh()
    queue.createQueue('delay', { concurrent: 1, retries: 2, retryDelay: 0.01 })
    const calls = []
    globalThis.fetch = async (url) => {
        calls.push(url)
        return new Response('ok', { status: calls.length === 1 ? 503 : 200 })
    }
    await Promise.all([
        queue.fetchQueue('retry', {}, 'delay'),
        queue.fetchQueue('fresh', {}, 'delay'),
    ])
    assert.deepEqual(calls, ['retry', 'fresh', 'retry'])
})

test('queue names cannot collide with object prototype properties', async () => {
    const queue = await fresh()
    globalThis.fetch = async () => new Response()
    for (const name of ['constructor', '__proto__', 'toString']) {
        assert.equal(queue.createQueue(name), undefined)
        await queue.fetchQueue('valid', {}, name)
        await queue.destroyQueue(name)
    }
})

test('destroy is idempotent and recreates default configuration', async () => {
    const { createFetchQueue } = await fresh()
    const queue = createFetchQueue({ concurrent: 1, retries: 1 })
    await queue.destroyQueue('missing')
    await Promise.all([queue.destroyQueue(), queue.destroyQueue()])
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        throw new Error('failed')
    }
    await queue.fetchQueue('retry').catch(() => {})
    assert.equal(calls, 1)
    assert.equal(queue.checkQueue().total, 0)
})

test('isolated instances do not share queues or mutable config', async () => {
    const { createFetchQueue } = await fresh()
    const headers = new Headers({ 'x-default': 'original' })
    const retryOn = [503]
    const first = createFetchQueue({
        fetchOptions: { headers },
        retryOn,
        retries: 1,
    })
    const second = createFetchQueue()
    first.createQueue('private')
    assert.equal(second.createQueue('private'), undefined)
    headers.set('x-default', 'changed')
    retryOn.push(404)
    globalThis.fetch = async (_, options) => {
        assert.equal(options.headers.get('x-default'), 'original')
        return new Response()
    }
    await first.fetchQueue('valid')
})

test('Headers, FormData, signals, and per-request queue selection survive option merging', async () => {
    const { createFetchQueue } = await fresh()
    const controller = new AbortController()
    const body = new FormData()
    body.set('name', 'value')
    const queue = createFetchQueue({
        fetchOptions: {
            headers: new Headers({ 'x-default': 'yes', 'x-shared': 'default' }),
            signal: controller.signal,
        },
    })
    queue.createQueue('selected', { baseUrl: 'https://example.test/api/' })
    globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://example.test/api/item')
        assert.equal(options.body, body)
        assert.equal(options.headers.get('x-default'), 'yes')
        assert.equal(options.headers.get('x-shared'), 'request')
        assert.equal('queueName' in options, false)
        return new Response()
    }
    await queue.fetchQueue('/item', {
        queueName: 'selected',
        headers: [['X-Shared', 'request']],
        method: 'POST',
        body,
    })
})

test('URL and Request inputs are accepted and absolute URLs bypass baseUrl', async () => {
    const { createFetchQueue } = await fresh()
    const queue = createFetchQueue({ baseUrl: 'https://example.test/api' })
    const url = new URL('https://other.test/path')
    const request = new Request(url, { headers: { 'x-request': 'yes' } })
    const seen = []
    globalThis.fetch = async (input, options) => {
        seen.push(input)
        if (input === request)
            assert.equal(options.headers.get('x-request'), 'yes')
        return new Response()
    }
    for (const input of [
        url,
        request,
        'https://other.test/absolute',
        '/relative',
    ])
        await queue.fetchQueue(input)
    assert.deepEqual(seen, [
        url,
        request,
        'https://other.test/absolute',
        'https://example.test/api/relative',
    ])
})

test('a Request signal is respected', async () => {
    const queue = await fresh()
    const controller = new AbortController()
    const request = new Request('https://example.test', {
        signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(
        queue.fetchQueue(request),
        (error) => error.name === 'AbortError',
    )
})

test('streaming bodies are attempted once even for retryable responses', async () => {
    const { createFetchQueue } = await fresh()
    const queue = createFetchQueue({ retryDelay: 0 })
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        return new Response('', { status: 503 })
    }
    const body = new ReadableStream()
    await assert.rejects(
        queue.fetchQueue('https://example.test', {
            method: 'POST',
            body,
            duplex: 'half',
        }),
    )
    const request = new Request('https://example.test', {
        method: 'POST',
        body: 'payload',
    })
    await assert.rejects(queue.fetchQueue(request))
    assert.equal(calls, 2)
})

test('invalid configuration and inputs fail without wedging queues', async () => {
    const queue = await fresh()
    for (const config of [
        null,
        [],
        { concurrent: 0 },
        { concurrent: -1 },
        { concurrent: 1.5 },
        { retries: -1 },
        { retries: Infinity },
        { retryDelay: NaN },
        { retryDelay: -1 },
        { retryDelay: 2147484 },
        { baseUrl: null },
        { retryOn: [600] },
        { retryOn: ['all'] },
        { retryOn: null },
        { fetchOptions: null },
    ]) {
        assert.throws(() => queue.createQueue('invalid', config), TypeError)
    }
    for (const input of ['', null, 42, {}])
        await assert.rejects(queue.fetchQueue(input), TypeError)
    await assert.rejects(queue.fetchQueue('valid', null), TypeError)
    await assert.rejects(queue.fetchQueue('valid', { signal: {} }), TypeError)
    await assert.rejects(
        queue.fetchQueue('valid', {
            signal: { aborted: false, addEventListener() {} },
        }),
        TypeError,
    )
    await assert.rejects(queue.fetchQueue('valid', {}, ''), TypeError)
    await assert.rejects(queue.killQueue(''), TypeError)
    assert.throws(() => queue.checkQueue(null), TypeError)
    assert.equal(queue.checkQueue().total, 0)
})

test('duplicate queue creation preserves the original configuration', async () => {
    const queue = await fresh()
    queue.createQueue('existing', { retries: 1 })
    assert.deepEqual(queue.createQueue('existing', { retries: 5 }), {
        error: 'Queue exists. Cannot create a new one',
    })
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        throw new Error('failed')
    }
    await queue.fetchQueue('failure', {}, 'existing').catch(() => {})
    assert.equal(calls, 1)
})

test('debugging is opt-in, reversible, and omits request data', async (t) => {
    const queue = await fresh()
    const logs = []
    t.mock.method(console, 'debug', (...args) => logs.push(args))
    const normalLogs = t.mock.method(console, 'log', () => {})
    globalThis.fetch = async () => new Response()
    await queue.fetchQueue('https://example.test/?token=private')
    assert.equal(logs.length, 0)
    queue.debugQueue()
    await queue.fetchQueue('https://example.test/?token=private', {
        headers: { authorization: 'private' },
    })
    assert.ok(logs.length > 0)
    assert.equal(JSON.stringify(logs).includes('private'), false)
    queue.debugQueue(false)
    const count = logs.length
    await queue.fetchQueue('valid')
    assert.equal(logs.length, count)
    assert.equal(normalLogs.mock.callCount(), 0)
})

test('a large backlog settles when fetch starts throwing synchronously', async () => {
    const queue = createFetchQueue({ concurrent: 1, retries: 0 })
    const first = deferred()
    globalThis.fetch = () => first.promise
    const requests = Array.from({ length: 15000 }, () =>
        queue.fetchQueue('backlog'),
    )
    const results = Promise.allSettled(requests)
    globalThis.fetch = () => {
        throw new TypeError('failed synchronously')
    }
    first.resolve(new Response())
    const settled = await bounded(results, 5000)
    assert.equal(
        settled.filter((result) => result.status === 'rejected').length,
        14999,
    )
    assert.equal(queue.checkQueue().total, 0)
})

test('shared default and named exports refer to the same queue', async () => {
    const shared = await import('../index.js')
    assert.equal(shared.default, shared.fetchQueue)
    globalThis.fetch = async () => new Response('shared')
    assert.equal(await (await shared.default('shared')).text(), 'shared')
    await shared.destroyQueue()
})

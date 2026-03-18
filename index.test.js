import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Suppress unhandled rejection warnings from orphaned promises after module reset
const rejectionHandler = () => {}

describe('fetch-queue', () => {
    let fetchQueue, createQueue, checkQueue, killQueue, destroyQueue, debugQueue, createFetchQueue

    beforeEach(async () => {
        vi.resetModules()
        vi.useFakeTimers()
        globalThis.fetch = vi.fn()
        process.on('unhandledRejection', rejectionHandler)
        const mod = await import('./index.js')
        fetchQueue = mod.fetchQueue
        createQueue = mod.createQueue
        checkQueue = mod.checkQueue
        killQueue = mod.killQueue
        destroyQueue = mod.destroyQueue
        debugQueue = mod.debugQueue
        createFetchQueue = mod.createFetchQueue
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        process.removeListener('unhandledRejection', rejectionHandler)
    })

    const mockResponse = (status = 200, body = 'ok') => {
        return new Response(body, { status })
    }

    const flushPromises = () => vi.advanceTimersByTimeAsync(0)

    describe('fetchQueue', () => {
        it('resolves with Response on success', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            const promise = fetchQueue('https://example.com/api')
            await flushPromises()

            const result = await promise
            expect(result).toBe(resp)
            expect(globalThis.fetch).toHaveBeenCalledOnce()
        })

        it('rejects with TypeError for empty url', async () => {
            await expect(fetchQueue('')).rejects.toThrow('url must be a non-empty string')
        })

        it('rejects with TypeError for non-string url', async () => {
            await expect(fetchQueue(123)).rejects.toThrow('url must be a non-empty string')
        })

        it('passes fetch options to fetch', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            const options = { method: 'POST', body: 'data' }
            const promise = fetchQueue('https://example.com/api', options)
            await flushPromises()
            await promise

            const [, calledOptions] = globalThis.fetch.mock.calls[0]
            expect(calledOptions.method).toBe('POST')
            expect(calledOptions.body).toBe('data')
        })

        it('accepts queueName as third argument', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            const promise = fetchQueue('https://example.com/api', {}, 'custom')
            await flushPromises()
            await promise

            const status = checkQueue('custom')
            expect(status.queueName).toBe('custom')
        })

        it('accepts queueName inside fetchOptions', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            const promise = fetchQueue('https://example.com/api', { queueName: 'from-opts' })
            await flushPromises()
            await promise

            const status = checkQueue('from-opts')
            expect(status.queueName).toBe('from-opts')
        })

        it('auto-creates queue if it does not exist', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            const promise = fetchQueue('https://example.com', {}, 'new-queue')
            await flushPromises()
            await promise

            const status = checkQueue('new-queue')
            expect(status.queueName).toBe('new-queue')
        })

        it('respects concurrency limit', async () => {
            createQueue('limited', { concurrent: 1 })

            let resolvers = []
            globalThis.fetch.mockImplementation(() => new Promise(resolve => {
                resolvers.push(resolve)
            }))

            fetchQueue('https://example.com/1', {}, 'limited')
            fetchQueue('https://example.com/2', {}, 'limited')
            await flushPromises()

            // Only 1 should be running with concurrent=1
            expect(globalThis.fetch).toHaveBeenCalledTimes(1)

            const status = checkQueue('limited')
            expect(status.running).toBe(1)
            expect(status.queued).toBe(1)

            // Resolve first, second should start
            resolvers[0](mockResponse(200))
            await flushPromises()

            expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        })

        it('merges queue-level fetchOptions with per-request fetchOptions', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            createQueue('headers-queue', {
                fetchOptions: { headers: { 'Authorization': 'Bearer token' } }
            })
            const promise = fetchQueue('https://example.com', { method: 'POST' }, 'headers-queue')
            await flushPromises()
            await promise

            const [, calledOptions] = globalThis.fetch.mock.calls[0]
            expect(calledOptions.headers.Authorization).toBe('Bearer token')
            expect(calledOptions.method).toBe('POST')
        })

        it('correctly joins baseUrl with url', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            createQueue('base-q', { baseUrl: 'https://api.example.com' })
            const promise = fetchQueue('/users', {}, 'base-q')
            await flushPromises()
            await promise

            expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.example.com/users')
        })

        it('handles baseUrl with trailing slash', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            createQueue('base-slash', { baseUrl: 'https://api.example.com/' })
            const promise = fetchQueue('/users', {}, 'base-slash')
            await flushPromises()
            await promise

            expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.example.com/users')
        })

        it('handles baseUrl and url without slashes', async () => {
            const resp = mockResponse(200)
            globalThis.fetch.mockResolvedValue(resp)

            createQueue('no-slash', { baseUrl: 'https://api.example.com' })
            const promise = fetchQueue('users', {}, 'no-slash')
            await flushPromises()
            await promise

            expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.example.com/users')
        })
    })

    describe('retry logic', () => {
        it('retries on status codes in retryOn list', async () => {
            const retryResp = mockResponse(429)
            const okResp = mockResponse(200)
            globalThis.fetch
                .mockResolvedValueOnce(retryResp)
                .mockResolvedValueOnce(okResp)

            const promise = fetchQueue('https://example.com')
            await flushPromises()

            // Advance past retry delay (10s default)
            await vi.advanceTimersByTimeAsync(11000)

            const result = await promise
            expect(result).toBe(okResp)
            expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        })

        it('retries on 5xx pattern match', async () => {
            const retryResp = mockResponse(503)
            const okResp = mockResponse(200)
            globalThis.fetch
                .mockResolvedValueOnce(retryResp)
                .mockResolvedValueOnce(okResp)

            const promise = fetchQueue('https://example.com')
            await flushPromises()
            await vi.advanceTimersByTimeAsync(11000)

            const result = await promise
            expect(result).toBe(okResp)
            expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        })

        it('does NOT retry on non-retryable error codes', async () => {
            const resp = mockResponse(404)
            globalThis.fetch.mockResolvedValue(resp)

            const promise = fetchQueue('https://example.com', {})
            await flushPromises()

            await expect(promise).rejects.toEqual(expect.objectContaining({
                url: 'https://example.com',
                attempts: 1,
                error: resp
            }))
            expect(globalThis.fetch).toHaveBeenCalledTimes(1)
        })

        it('rejects after exhausting retries with correct attempts count', async () => {
            // retries=2 means: attempt 1 (fetch), attempt 2 (fetch), attempt 3 (> retries, reject)
            // So 2 actual fetches, rejected with attempts=3
            createQueue('retry-test', { retries: 2, retryDelay: 1 })

            const retryResp = mockResponse(500)
            globalThis.fetch.mockResolvedValue(retryResp)

            const promise = fetchQueue('https://example.com', {}, 'retry-test')

            // Advance through all retry attempts
            for (let i = 0; i < 5; i++) {
                await flushPromises()
                await vi.advanceTimersByTimeAsync(2000)
            }

            await expect(promise).rejects.toEqual(expect.objectContaining({
                url: 'https://example.com',
                attempts: 3,
            }))
            expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        })

        it('retries on network errors (fetch throws)', async () => {
            const error = new Error('Network error')
            const okResp = mockResponse(200)
            globalThis.fetch
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce(okResp)

            const promise = fetchQueue('https://example.com')
            await flushPromises()
            await vi.advanceTimersByTimeAsync(11000)

            const result = await promise
            expect(result).toBe(okResp)
            expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        })

        it('uses exponential backoff when configured', async () => {
            createQueue('exp-backoff', { retryDelay: 1, retryBackoff: 'exponential', retries: 4 })

            const retryResp = mockResponse(500)
            const okResp = mockResponse(200)

            // First 2 calls fail, third succeeds
            globalThis.fetch
                .mockResolvedValueOnce(retryResp)
                .mockResolvedValueOnce(retryResp)
                .mockResolvedValueOnce(okResp)

            const promise = fetchQueue('https://example.com', {}, 'exp-backoff')

            // First attempt happens immediately
            await flushPromises()
            expect(globalThis.fetch).toHaveBeenCalledTimes(1)

            // First retry: delay = 1 * 2^0 = 1s
            await vi.advanceTimersByTimeAsync(1500)
            await flushPromises()
            expect(globalThis.fetch).toHaveBeenCalledTimes(2)

            // Second retry: delay = 1 * 2^1 = 2s
            await vi.advanceTimersByTimeAsync(2500)
            await flushPromises()
            expect(globalThis.fetch).toHaveBeenCalledTimes(3)

            const result = await promise
            expect(result).toBe(okResp)
        })
    })

    describe('createQueue', () => {
        it('creates a new queue with custom config', () => {
            const result = createQueue('custom', { concurrent: 5 })
            expect(result).toBeUndefined()

            const status = checkQueue('custom')
            expect(status.queueName).toBe('custom')
            expect(status.total).toBe(0)
        })

        it('returns error object if queue already exists', () => {
            createQueue('dup')
            const result = createQueue('dup')
            expect(result).toEqual({ error: 'Queue exists. Cannot create a new one' })
        })

        it('returns error when trying to create default queue (already exists)', () => {
            const result = createQueue('default')
            expect(result).toEqual({ error: 'Queue exists. Cannot create a new one' })
        })
    })

    describe('checkQueue', () => {
        it('returns correct status shape', () => {
            const status = checkQueue()
            expect(status).toEqual({
                queueName: 'default',
                queued: 0,
                pending: 0,
                running: 0,
                total: 0,
                killed: false,
            })
        })

        it('tracks running count accurately', async () => {
            let resolver
            globalThis.fetch.mockImplementation(() => new Promise(resolve => {
                resolver = resolve
            }))

            fetchQueue('https://example.com')
            await flushPromises()

            const status = checkQueue()
            expect(status.running).toBe(1)

            resolver(mockResponse(200))
            await flushPromises()

            const statusAfter = checkQueue()
            expect(statusAfter.running).toBe(0)
        })
    })

    describe('killQueue', () => {
        it('rejects all pending tasks with QueueError shape', async () => {
            createQueue('kill-test', { concurrent: 1 })

            let resolver
            globalThis.fetch.mockImplementation(() => new Promise(resolve => {
                resolver = resolve
            }))

            // First task occupies the slot
            fetchQueue('https://example.com/1', {}, 'kill-test').catch(() => {})
            // Second task queued
            const task2 = fetchQueue('https://example.com/2', {}, 'kill-test')
            await flushPromises()

            // killQueue triggers processQueue, which rejects queued tasks immediately
            const killPromise = killQueue('kill-test')
            await flushPromises()

            // Second task should be rejected with QueueError shape
            await expect(task2).rejects.toEqual(expect.objectContaining({
                url: 'https://example.com/2',
                error: 'Queue Killed',
                attempts: 0
            }))

            // Complete the running task so kill resolves
            resolver(mockResponse(200))
            await flushPromises()
            await killPromise
        })

        it('resolves when all in-flight tasks complete', async () => {
            let resolver
            globalThis.fetch.mockImplementation(() => new Promise(resolve => {
                resolver = resolve
            }))

            fetchQueue('https://example.com').catch(() => {})
            await flushPromises()

            let killResolved = false
            const killPromise = killQueue().then(() => { killResolved = true })
            await flushPromises()

            expect(killResolved).toBe(false)

            resolver(mockResponse(200))
            await flushPromises()
            await killPromise

            expect(killResolved).toBe(true)
        })

        it('force kill clears retry timeouts', async () => {
            createQueue('force-test', { retryDelay: 100, retries: 5 })
            const retryResp = mockResponse(500)
            globalThis.fetch.mockResolvedValue(retryResp)

            fetchQueue('https://example.com', {}, 'force-test').catch(() => {})
            await flushPromises()

            // Let the catch handler fire and start the retry wait
            await vi.advanceTimersByTimeAsync(10)

            // Force kill: clears timeouts and aborts controllers
            const killPromise = killQueue('force-test', true)
            await flushPromises()

            // Advance past any remaining timers
            await vi.advanceTimersByTimeAsync(200000)
            await flushPromises()

            await killPromise
        })
    })

    describe('destroyQueue', () => {
        it('removes the queue after killing it', async () => {
            createQueue('temp')

            const destroyPromise = destroyQueue('temp')
            await flushPromises()
            await destroyPromise

            // Queue should be gone — checkQueue returns 0s for missing queues
            const status = checkQueue('temp')
            expect(status.total).toBe(0)
        })

        it('recreates default queue if default is destroyed', async () => {
            const destroyPromise = destroyQueue('default')
            await flushPromises()
            await destroyPromise

            // Default queue should exist again
            const status = checkQueue('default')
            expect(status.queueName).toBe('default')
            expect(status.total).toBe(0)
        })
    })

    describe('debugQueue', () => {
        it('enables console.log output', async () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
            debugQueue()

            globalThis.fetch.mockResolvedValue(mockResponse(200))
            const promise = fetchQueue('https://example.com')
            await flushPromises()
            await promise

            expect(consoleSpy).toHaveBeenCalled()
        })
    })

    describe('error consistency', () => {
        it('all rejections produce QueueError-shaped objects', async () => {
            const errorResp = mockResponse(404)
            globalThis.fetch.mockResolvedValue(errorResp)

            try {
                await fetchQueue('https://example.com')
                expect.unreachable('Should have rejected')
            } catch (err) {
                expect(err).toHaveProperty('url', 'https://example.com')
                expect(err).toHaveProperty('attempts', 1)
                expect(err).toHaveProperty('error', errorResp)
                expect(err).toHaveProperty('fetchOptions')
            }
        })

        it('queue killed rejections have QueueError shape', async () => {
            createQueue('kill-err-test', { concurrent: 1 })

            let resolver
            globalThis.fetch.mockImplementation(() => new Promise(resolve => {
                resolver = resolve
            }))

            fetchQueue('https://example.com/1', {}, 'kill-err-test').catch(() => {})
            const task2 = fetchQueue('https://example.com/2', {}, 'kill-err-test')
            await flushPromises()

            killQueue('kill-err-test')
            await flushPromises()

            await expect(task2).rejects.toEqual(
                expect.objectContaining({
                    url: 'https://example.com/2',
                    attempts: 0,
                    error: 'Queue Killed'
                })
            )

            resolver(mockResponse(200))
            await flushPromises()
        })
    })

    describe('createFetchQueue (factory pattern)', () => {
        it('creates an isolated instance', async () => {
            const instance = createFetchQueue()
            globalThis.fetch.mockResolvedValue(mockResponse(200))

            const promise = instance.fetchQueue('https://example.com')
            await flushPromises()
            await promise

            // Instance's default queue is independent from global
            const globalStatus = checkQueue()
            const instanceStatus = instance.checkQueue()

            // Both have default queue but they are separate
            expect(globalStatus.queueName).toBe('default')
            expect(instanceStatus.queueName).toBe('default')
        })

        it('accepts instance-level config defaults', async () => {
            const instance = createFetchQueue({ concurrent: 1 })
            let resolvers = []
            globalThis.fetch.mockImplementation(() => new Promise(resolve => {
                resolvers.push(resolve)
            }))

            instance.fetchQueue('https://example.com/1')
            instance.fetchQueue('https://example.com/2')
            await flushPromises()

            // Only 1 concurrent since instance default is 1
            expect(globalThis.fetch).toHaveBeenCalledTimes(1)
        })

        it('instances do not share state', async () => {
            const instance1 = createFetchQueue()
            const instance2 = createFetchQueue()

            instance1.createQueue('only-in-1')

            // instance2 should NOT have 'only-in-1'
            const status = instance2.checkQueue('only-in-1')
            expect(status.total).toBe(0)
        })
    })

    describe('AbortController support', () => {
        it('passes signal to fetch', async () => {
            globalThis.fetch.mockResolvedValue(mockResponse(200))

            const promise = fetchQueue('https://example.com')
            await flushPromises()
            await promise

            const [, calledOptions] = globalThis.fetch.mock.calls[0]
            expect(calledOptions.signal).toBeInstanceOf(AbortSignal)
        })

        it('does not override user-provided signal', async () => {
            const userController = new AbortController()
            globalThis.fetch.mockResolvedValue(mockResponse(200))

            const promise = fetchQueue('https://example.com', { signal: userController.signal })
            await flushPromises()
            await promise

            const [, calledOptions] = globalThis.fetch.mock.calls[0]
            expect(calledOptions.signal).toBe(userController.signal)
        })
    })

    describe('default export', () => {
        it('default export is fetchQueue function', async () => {
            vi.resetModules()
            const mod = await import('./index.js')
            expect(mod.default).toBe(mod.fetchQueue)
        })
    })
})

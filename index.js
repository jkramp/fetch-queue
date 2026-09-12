const defaults = {
    concurrent: 3,
    retries: 3,
    retryDelay: 10,
    fetchOptions: {},
    baseUrl: '',
    retryOn: [408, 409, 418, 425, 429, '5xx'],
}

function validateName(name) {
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('queueName must be a non-empty string')
    }
}

function mergeOptions(...sources) {
    const options = Object.assign({}, ...sources)
    const headers = new Headers()
    for (const source of sources) {
        new Headers(source?.headers).forEach((value, name) =>
            headers.set(name, value),
        )
    }
    options.headers = headers
    delete options.queueName
    return options
}

function configure(base, overrides) {
    if (
        !overrides ||
        typeof overrides !== 'object' ||
        Array.isArray(overrides)
    ) {
        throw new TypeError('config must be an object')
    }
    const config = { ...base, ...overrides }
    if (!Number.isSafeInteger(config.concurrent) || config.concurrent < 1) {
        throw new TypeError('concurrent must be a positive integer')
    }
    if (!Number.isSafeInteger(config.retries) || config.retries < 0) {
        throw new TypeError('retries must be a non-negative integer')
    }
    if (
        !Number.isFinite(config.retryDelay) ||
        config.retryDelay < 0 ||
        config.retryDelay > 2147483.647
    ) {
        throw new TypeError(
            'retryDelay must be between 0 and 2147483.647 seconds',
        )
    }
    if (typeof config.baseUrl !== 'string') {
        throw new TypeError('baseUrl must be a string')
    }
    if (
        !Array.isArray(config.retryOn) ||
        !config.retryOn.every(
            (status) =>
                (Number.isInteger(status) && status >= 100 && status <= 599) ||
                (typeof status === 'string' && /^[1-5]xx$/.test(status)),
        )
    ) {
        throw new TypeError(
            'retryOn must contain HTTP status numbers or patterns such as 5xx',
        )
    }
    if (
        !config.fetchOptions ||
        typeof config.fetchOptions !== 'object' ||
        Array.isArray(config.fetchOptions)
    ) {
        throw new TypeError('fetchOptions must be an object')
    }
    config.retryOn = [...config.retryOn]
    config.fetchOptions = mergeOptions(
        base.fetchOptions,
        overrides.fetchOptions,
    )
    return config
}

function requestInput(input, baseUrl) {
    if (input instanceof Request || input instanceof URL) return input
    if (typeof input !== 'string' || input.length === 0) {
        throw new TypeError('url must be a non-empty string, URL, or Request')
    }
    if (!baseUrl || /^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith('//'))
        return input
    return `${baseUrl.replace(/\/$/, '')}/${input.replace(/^\//, '')}`
}

// Discard intermediate responses so retries do not keep HTTP connections occupied.
function discard(response) {
    if (response.body && !response.body.locked) {
        void response.body.cancel().catch(() => {})
    }
}

/** Create an independent set of named queues, with its own default configuration. */
export function createFetchQueue(config = {}) {
    const instanceDefaults = configure(defaults, config)
    const queues = new Map()
    let debug = false

    function log(event, queue) {
        if (debug) {
            console.debug('[fetch-queue]', event, {
                queued: queue.tasks.length,
                pending: queue.pending.size,
                running: queue.running.size,
            })
        }
    }

    /** Create a queue. An existing queue returns an error object without changing it. */
    function createQueue(queueName = 'default', overrides = {}) {
        validateName(queueName)
        if (queues.has(queueName))
            return { error: 'Queue exists. Cannot create a new one' }
        queues.set(queueName, {
            name: queueName,
            config: configure(instanceDefaults, overrides),
            tasks: [],
            pending: new Map(),
            running: new Set(),
            stopping: null,
            destroying: false,
            draining: false,
        })
    }

    /** Return queued, retrying, and active request counts without creating a queue. */
    function checkQueue(queueName = 'default') {
        validateName(queueName)
        const queue = queues.get(queueName)
        const queued = queue?.tasks.length ?? 0
        const pending = queue?.pending.size ?? 0
        const running = queue?.running.size ?? 0
        return {
            queueName,
            queued,
            pending,
            running,
            total: queued + pending + running,
            killed: Boolean(queue?.stopping),
        }
    }

    function settle(task, value, failed = false) {
        if (task.settled) return
        task.settled = true
        task.signal?.removeEventListener('abort', task.onAbort)
        if (failed) task.reject(value)
        else task.resolve(value)
    }

    function failure(task, error) {
        return {
            url: task.url,
            fetchOptions: task.options,
            attempts: task.attempts,
            error,
        }
    }

    function finishStop(queue) {
        if (!queue.stopping || queue.running.size !== 0) return
        const { resolve } = queue.stopping
        if (queue.destroying) {
            queues.delete(queue.name)
            if (queue.name === 'default') createQueue()
        }
        queue.stopping = null
        resolve()
    }

    function cancelWaiting(queue, task, reason) {
        const index = queue.tasks.indexOf(task)
        if (index !== -1) queue.tasks.splice(index, 1)
        if (queue.pending.has(task)) {
            clearTimeout(queue.pending.get(task))
            queue.pending.delete(task)
        }
        settle(task, reason, true)
    }

    function drain(queue) {
        if (queue.stopping) {
            finishStop(queue)
            return
        }
        // A synchronous fetch failure can call drain again before this loop advances.
        if (queue.draining) return
        queue.draining = true
        try {
            while (
                !queue.stopping &&
                queue.tasks.length &&
                queue.running.size < queue.config.concurrent
            ) {
                const task = queue.tasks.shift()
                queue.running.add(task)
                void run(queue, task)
            }
        } finally {
            queue.draining = false
        }
    }

    function retry(queue, task, error, retryable) {
        if (task.settled) return
        if (queue.stopping) {
            settle(task, 'Queue Killed', true)
        } else if (
            retryable &&
            task.replayable &&
            task.attempts < Math.max(1, queue.config.retries)
        ) {
            const timer = setTimeout(() => {
                queue.pending.delete(task)
                queue.tasks.push(task)
                drain(queue)
            }, queue.config.retryDelay * 1000)
            queue.pending.set(task, timer)
        } else {
            settle(task, failure(task, error), true)
        }
    }

    async function run(queue, task) {
        task.attempts++
        log('request started', queue)
        try {
            const response = await globalThis.fetch(task.input, {
                ...task.options,
                signal: task.fetchSignal,
            })
            if (task.settled) {
                discard(response)
            } else if (response.ok) {
                settle(task, response)
            } else {
                const retryable =
                    queue.config.retryOn.includes(response.status) ||
                    queue.config.retryOn.includes(
                        `${Math.floor(response.status / 100)}xx`,
                    )
                retry(queue, task, response, retryable)
                if (!task.settled || queue.stopping) discard(response)
            }
        } catch (error) {
            if (task.fetchSignal.aborted || error?.name === 'AbortError') {
                settle(task, task.fetchSignal.reason ?? error, true)
            } else {
                retry(queue, task, error, true)
            }
        } finally {
            queue.running.delete(task)
            log('request finished', queue)
            drain(queue)
        }
    }

    /** Enqueue a fetch. Requests share the selected queue's concurrency limit. */
    function fetchQueue(url, fetchOptions = {}, queueName = 'default') {
        return new Promise((resolve, reject) => {
            if (
                !fetchOptions ||
                typeof fetchOptions !== 'object' ||
                Array.isArray(fetchOptions)
            ) {
                throw new TypeError('fetchOptions must be an object')
            }
            queueName = fetchOptions.queueName ?? queueName
            validateName(queueName)
            if (!queues.has(queueName)) createQueue(queueName)
            const queue = queues.get(queueName)
            if (queue.stopping) {
                reject('Queue Killed')
                return
            }
            const input = requestInput(url, queue.config.baseUrl)
            const options = mergeOptions(
                queue.config.fetchOptions,
                input instanceof Request ? { headers: input.headers } : {},
                fetchOptions,
            )
            const signal =
                options.signal === undefined && input instanceof Request
                    ? input.signal
                    : options.signal
            if (
                signal != null &&
                (typeof signal.addEventListener !== 'function' ||
                    typeof signal.aborted !== 'boolean')
            ) {
                throw new TypeError('signal must be an AbortSignal')
            }
            const controller = new AbortController()
            // Native composition also keeps caller cancellation connected to returned response bodies.
            const fetchSignal =
                signal == null
                    ? controller.signal
                    : AbortSignal.any([controller.signal, signal])
            const body =
                options.body ?? (input instanceof Request ? input.body : null)
            const task = {
                url,
                input,
                options,
                signal,
                controller,
                fetchSignal,
                resolve,
                reject,
                attempts: 0,
                settled: false,
                // Streams are consumed by fetch and cannot be safely sent again.
                replayable:
                    !body ||
                    (typeof body.getReader !== 'function' &&
                        typeof body[Symbol.asyncIterator] !== 'function'),
            }
            task.onAbort = () => {
                controller.abort(signal.reason)
                cancelWaiting(queue, task, controller.signal.reason)
                drain(queue)
            }
            if (signal?.aborted) {
                task.onAbort()
                return
            }
            signal?.addEventListener('abort', task.onAbort, { once: true })
            queue.tasks.push(task)
            drain(queue)
        })
    }

    function stop(queueName, force, destroying) {
        validateName(queueName)
        const queue = queues.get(queueName)
        if (!queue) return Promise.resolve()
        queue.destroying ||= destroying
        if (!queue.stopping) {
            let resolve
            const promise = new Promise((done) => {
                resolve = done
            })
            queue.stopping = { promise, resolve }
        }
        const promise = queue.stopping.promise
        for (const task of [...queue.tasks, ...queue.pending.keys()])
            cancelWaiting(queue, task, 'Queue Killed')
        if (force) {
            for (const task of queue.running) {
                settle(task, 'Queue Killed', true)
                task.controller.abort('Queue Killed')
            }
        }
        finishStop(queue)
        return promise
    }

    /** Cancel waiting work and wait for active requests. Force also aborts active fetches. */
    async function killQueue(queueName = 'default', force = false) {
        await stop(queueName, force, false)
    }

    /** Stop and remove a queue, recreating the default queue when needed. */
    async function destroyQueue(queueName = 'default', force = false) {
        await stop(queueName, force, true)
    }

    /** Toggle diagnostic counts. Request URLs, options, and responses are never logged. */
    function debugQueue(enabled = true) {
        debug = Boolean(enabled)
    }

    createQueue()
    return {
        fetchQueue,
        createQueue,
        checkQueue,
        killQueue,
        destroyQueue,
        debugQueue,
    }
}

const shared = createFetchQueue()
export const {
    fetchQueue,
    createQueue,
    checkQueue,
    killQueue,
    destroyQueue,
    debugQueue,
} = shared
export default fetchQueue

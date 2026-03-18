/**
 * @typedef {Object} QueueConfig
 * @property {number} [concurrent=3] - Max concurrent fetch requests
 * @property {number} [retries=3] - Max retry attempts per request
 * @property {number} [retryDelay=10] - Seconds between retries
 * @property {'fixed'|'exponential'} [retryBackoff='fixed'] - Retry delay strategy
 * @property {RequestInit} [fetchOptions={}] - Default fetch options merged into every request
 * @property {string} [baseUrl=''] - URL prefix for all requests
 * @property {Array<number|string>} [retryOn] - HTTP status codes or patterns like '5xx' to retry on
 * @property {boolean} [rejectOnHttpError=false] - If true, non-retryable HTTP errors reject immediately instead of being retried
 */

/**
 * @typedef {Object} QueueStatus
 * @property {string} queueName
 * @property {number} queued - Tasks waiting to be processed
 * @property {number} pending - Tasks waiting for retry
 * @property {number} running - Currently executing tasks
 * @property {number} total - Sum of queued + pending + running
 * @property {boolean} killed - Whether the queue has been killed
 */

/**
 * @typedef {Object} QueueError
 * @property {string} url - The URL that was requested
 * @property {RequestInit} fetchOptions - The fetch options used
 * @property {number} attempts - Number of attempts made
 * @property {Response|Error|string} error - The error that caused the failure
 */

const defaultConfig = {
    concurrent: 3,
    retries: 3,
    retryDelay: 10,
    retryBackoff: 'fixed',
    fetchOptions: {},
    baseUrl: '',
    retryOn: [408, 409, 418, 425, 429, '5xx'],
    rejectOnHttpError: false
}

const defaultQueue = {
    config: { ...defaultConfig },
    tasks: [],
    retryTimeouts: {},
    abortControllers: {},
    running: 0,
    kill: null
}

/**
 * Join a base URL with a path, handling slash boundaries correctly.
 * @param {string} base
 * @param {string} path
 * @returns {string}
 */
const joinUrl = (base, path) => {
    if (!base) return path
    if (base.endsWith('/') && path.startsWith('/')) return base + path.slice(1)
    if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path
    return base + path
}

/**
 * Create a rejection error object with a consistent shape.
 * @param {Object} task
 * @param {Response|Error|string} error
 * @returns {QueueError}
 */
const makeError = (task, error) => ({
    url: task.url,
    fetchOptions: task.fetchOptions,
    attempts: task.attempts,
    error
})

/**
 * Compute retry delay based on backoff strategy.
 * @param {number} baseDelay - Base delay in seconds
 * @param {number} attempt - Current attempt number (1-based)
 * @param {'fixed'|'exponential'} backoff - Backoff strategy
 * @returns {number} Delay in seconds
 */
const computeDelay = (baseDelay, attempt, backoff) => {
    if (backoff === 'exponential') {
        return baseDelay * Math.pow(2, attempt - 1)
    }
    return baseDelay
}

/**
 * Create an isolated fetch-queue instance with its own state.
 * @param {QueueConfig} [instanceConfig] - Optional default config overrides for this instance
 * @returns {Object} An object with fetchQueue, createQueue, checkQueue, killQueue, destroyQueue, debugQueue
 */
const createFetchQueue = (instanceConfig = {}) => {
    let debug = false
    const instanceDefaultConfig = { ...defaultConfig, ...instanceConfig }
    const instanceDefaultQueue = {
        ...defaultQueue,
        config: { ...instanceDefaultConfig }
    }
    let queues = {
        default: structuredClone(instanceDefaultQueue)
    }

    let taskIdCounter = 0

    const log = (message, queueName, ...args) => {
        if (!debug) return
        console.log(message, queueName ? queues[queueName] || queueName : null, ...args)
    }

    /**
     * Create a new named queue with custom configuration.
     * @param {string} [queueName='default'] - Name for the queue
     * @param {QueueConfig} [config={}] - Queue configuration options
     * @returns {{ error: string } | undefined}
     */
    const createQueue = (queueName = 'default', config = {}) => {
        log('Create queue', queueName)
        if (queues[queueName]) {
            log('Queue Exists', queueName)
            return { error: 'Queue exists. Cannot create a new one' }
        }
        queues[queueName] = {
            ...structuredClone(instanceDefaultQueue),
            config: { ...structuredClone(instanceDefaultConfig), ...config }
        }
        log('Queue created', queueName, queues[queueName])
        return
    }

    /**
     * Gracefully stop a queue. Running tasks finish; pending tasks are rejected.
     * @param {string} [queueName='default'] - Name of the queue to kill
     * @param {boolean} [force=false] - If true, clear retry timeouts and abort in-flight requests
     * @returns {Promise<void>} Resolves when all running tasks have completed
     */
    const killQueue = (queueName = 'default', force = false) => {
        return new Promise(resolve => {
            log('Kill queue', queueName)
            let queue = queues[queueName] || {}
            queue.kill = resolve
            if (force) {
                log('Force kill queue', queueName)
                Object.values(queue.retryTimeouts || {}).forEach(id => clearTimeout(id))
                if (queue.retryTimeouts) queue.retryTimeouts = {}
                Object.values(queue.abortControllers || {}).forEach(controller => {
                    try { controller.abort() } catch { /* already aborted */ }
                })
                if (queue.abortControllers) queue.abortControllers = {}
            }
            // Trigger processQueue so kill is handled immediately for idle/queued tasks
            processQueue(queueName)
        })
    }

    /**
     * Kill and remove a queue entirely. Recreates default queue if 'default' is destroyed.
     * @param {string} [queueName='default'] - Name of the queue to destroy
     * @returns {Promise<void>}
     */
    const destroyQueue = async (queueName = 'default') => {
        log('Destroy queue', queueName)
        await killQueue(queueName)
        delete queues[queueName]
        log('Queue destroyed', queueName)
        if (queueName === 'default') {
            log('Recreate default queue', queueName)
            createQueue()
        }
        return
    }

    /**
     * Get the current status of a queue.
     * @param {string} [queueName='default'] - Name of the queue to check
     * @returns {QueueStatus}
     */
    const checkQueue = (queueName = 'default') => {
        log('Check queue', queueName)
        let queue = queues[queueName]
        let queued = queue?.tasks?.length || 0
        let pending = Object.keys(queue?.retryTimeouts || {}).length
        let running = queue?.running || 0
        let total = queued + pending + running
        let killed = queue?.kill ? true : false
        return { queueName, queued, pending, running, total, killed }
    }

    /**
     * Add a fetch request to the queue. Drop-in replacement for fetch().
     * @param {string} url - The URL to fetch
     * @param {RequestInit & { queueName?: string }} [fetchOptions] - Fetch options, optionally including queueName
     * @param {string} [queueName='default'] - Which queue to use
     * @returns {Promise<Response>}
     */
    const fetchQueue = (url, fetchOptions, queueName = 'default') => {
        if (typeof url !== 'string' || !url) {
            return Promise.reject(new TypeError('url must be a non-empty string'))
        }
        if (fetchOptions?.queueName) {
            queueName = fetchOptions.queueName
        }
        log('Fetch queue', queueName)
        let queue = queues[queueName]
        if (!queue) {
            createQueue(queueName)
            queue = queues[queueName]
        }
        return new Promise((resolve, reject) => {
            queue.tasks.push({
                url,
                fetchOptions,
                resolve,
                reject,
                attempts: 0,
                error: null
            })
            log('Task added', queueName)
            processQueue(queueName)
        })
    }

    const wait = (seconds = 1, queueName) => {
        return new Promise(resolve => {
            log('Task wait', queueName, { seconds })
            let queue = queues[queueName]
            let timeout = setTimeout(() => {
                log('Task done waiting', queueName, { timeout })
                if (queue) {
                    delete queue.retryTimeouts[timeout]
                }
                resolve()
            }, 1000 * seconds)
            if (queue) {
                queue.retryTimeouts[timeout] = timeout
            }
        })
    }

    const processQueue = async (queueName) => {
        log('Process queue', queueName)
        let queue = queues[queueName]
        if (!queue) {
            log('Missing queue', queueName)
            return
        }
        if (queue.kill) {
            log('Queue kill requested', queueName)
            let remainingTasks = queue.tasks.splice(0, queue.tasks.length)
            if (remainingTasks.length) {
                log('Killing tasks', queueName, { remainingTasks })
                remainingTasks.forEach(task => task.reject('Queue Killed'))
            }
            let status = checkQueue(queueName)
            if (status.total === 0) {
                log('Queue killed', queueName, { status })
                queue.kill()
                queue.kill = null
            } else {
                log('Queue wrapping up tasks', queueName, { status })
            }
            return
        }
        let concurrent = queue.config.concurrent || instanceDefaultConfig.concurrent
        let count = concurrent - queue.running
        if (!count) {
            log('Concurrency maxed out', queueName)
            return
        } else {
            log('Concurrency allows for more tasks', queueName, { count })
        }
        let tasks = queue.tasks.splice(0, count)

        if (!tasks.length) {
            log('No tasks left', queueName)
            return
        }
        log(`Adding ${tasks.length} tasks`, queueName)
        queue.running += tasks.length
        let promises = tasks.map(async task => {
            task.attempts++
            if (task.attempts > queue.config.retries) {
                log('Task failed too many times', queueName)
                queue.running--
                return task.reject(makeError(task, task.error))
            }
            let options = {
                ...queue.config.fetchOptions,
                ...(task.fetchOptions || {})
            }

            // AbortController support
            const taskId = taskIdCounter++
            const controller = new AbortController()
            queue.abortControllers[taskId] = controller
            if (!options.signal) {
                options.signal = controller.signal
            }

            log('Running task', queueName)
            return fetch(joinUrl(queue.config.baseUrl, task.url), options)
                .then(resp => {
                    log('Task completed', queueName)
                    delete queue.abortControllers[taskId]

                    if (resp.ok) {
                        task.resolve(resp)
                        queue.running--
                        processQueue(queueName)
                        return
                    }

                    // Check if this status code should be retried
                    let httpErrorXX = resp.status ? resp.status.toString()[0] + 'xx' : null
                    let isRetryable = queue.config.retryOn.includes(resp.status) ||
                        queue.config.retryOn.includes(httpErrorXX)

                    if (queue.config.rejectOnHttpError && !isRetryable) {
                        // Non-retryable error: reject immediately without retry
                        queue.running--
                        task.reject(makeError(task, resp))
                        processQueue(queueName)
                        return
                    }

                    // Retry all non-ok responses (backwards compatible default)
                    log('Task should be retried', queueName)
                    throw resp
                }).catch(async err => {
                    delete queue.abortControllers[taskId]
                    queue.running--
                    task.error = err
                    log('Task threw an error', queueName)
                    processQueue(queueName)
                    let delay = queue.kill
                        ? 0
                        : computeDelay(queue.config.retryDelay, task.attempts, queue.config.retryBackoff)
                    await wait(delay, queueName)
                    log('Requeued task', queueName, queue)
                    queue.tasks.push(task)
                    processQueue(queueName)
                    return
                })
        })
        return Promise.allSettled(promises)
    }

    /**
     * Enable debug logging for all queue operations.
     */
    const debugQueue = () => {
        debug = true
    }

    return { fetchQueue, createQueue, checkQueue, killQueue, destroyQueue, debugQueue }
}

// Global instance for backwards compatibility
const globalInstance = createFetchQueue()

const {
    fetchQueue,
    createQueue,
    checkQueue,
    killQueue,
    destroyQueue,
    debugQueue
} = globalInstance

export default fetchQueue

export {
    fetchQueue,
    createQueue,
    checkQueue,
    killQueue,
    destroyQueue,
    debugQueue,
    createFetchQueue
}

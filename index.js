let debug = false

const defaultConfig = {
    concurrent: 3,
    retries: 3,
    retryDelay: 10,
    fetchOptions: {},
    baseUrl: '',
    retryOn: [408, 409, 418, 425, 429, '5xx']
}

const defaultQueue = {
    config: { ...defaultConfig },
    tasks: [],
    retryTimeouts: {},
    running: 0,
    pending: 0,
    kill: null
}

const clone = (obj) => {
    return JSON.parse(JSON.stringify(obj))
}

let queues = {
    default: clone(defaultQueue)
}

const log = (message, queueName, ...args) => {
    if (!debug) {
        return
    }
    console.log(message, queueName ? queues[queueName] || queueName : null, ...args)
}

const createQueue = (queueName = 'default', config = {}) => {
    log('Create queue', queueName)
    if (queues[queueName]) {
        log('Queue Exists', queueName)
        return {
            error: 'Queue exists. Cannot create a new one'
        }
    }
    queues[queueName] = {
        ...clone(defaultQueue),
        ...{ config: { ...clone(defaultConfig), ...config } }
    }
    log('Queue created', queueName, queues[queueName])
    return
}

const killQueue = (queueName = 'default', force = false) => {
    return new Promise(resolve => {
        log('Kill queue', queueName)
        let queue = queues[queueName] || {}
        queue.kill = resolve
        if (force) {
            log('Force kill queue', queueName)
            Object.keys(queue.retryTimeouts).forEach(timeout => clearTimeout(timeout))
        }
    })
}

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

const checkQueue = (queueName = 'default') => {
    log('Check queue', queueName)
    let queue = queues[queueName]
    let queued = queue?.tasks?.length || 0
    let pending = Object.keys(queue?.retryTimeouts || {}).length
    let running = queue?.running || 0
    let total = queued + pending + running
    let killed = queue?.kill ? true : false
    return {
        queueName,
        queued,
        pending,
        running,
        total,
        killed,
    }
}

const fetchQueue = (url, fetchOptions, queueName = 'default') => {
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
        queue.tasks.push(
            {
                url,
                fetchOptions,
                resolve,
                reject,
                attempts: 0,
                error: null
            }
        )
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
            resolve()
            if (queue) {
                clearTimeout(timeout)
                delete queue.retryTimeouts[timeout]
            }
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
    let concurrent = queue.config.concurrent || defaultConfig.concurrent
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
            return task.reject({
                url: task.url,
                fetchOptions: task.fetchOptions,
                attempts: task.error,
                error: task.error
            })
        }
        let options = {
            ...queue.config.fetchOptions,
            ...(task.fetchOptions || {})
        }
        log(`Running task`, queueName)
        return fetch(queue.config.baseUrl + task.url, options)
            .then(resp => {
                log('Task completed', queueName)
                let httpErrorXX = resp.status ? resp.status.toString()[0] + 'xx' : null
                if (
                    !resp.ok ||
                    queue.config.retryOn.indexOf(resp.status) > 1 ||
                    queue.config.retryOn.indexOf(httpErrorXX) > 1) {
                    log('Task did not succeed', queueName)
                    throw resp
                }
                task.resolve(resp)
                queue.running--
                processQueue(queueName)
                return
            }).catch(async err => {
                log(queue.running)
                queue.running--
                log(queue.running)
                task.error = err
                log('Task threw an error', queueName)
                processQueue(queueName)
                // queue.pending++
                let delay = queue.kill ? 0 : queue.config.retryDelay
                await wait(delay, queue)
                log('Requeued task', queueName, queue)

                // queue.pending--
                queue.tasks.push(task)
                processQueue(queueName)
                return
            })
    })
    return Promise.allSettled(promises)
}

const debugQueue = () => {
    debug = true
}

export default fetchQueue

export {
    fetchQueue,
    createQueue,
    checkQueue,
    killQueue,
    destroyQueue,
    debugQueue
}


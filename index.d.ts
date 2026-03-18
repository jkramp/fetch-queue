export interface QueueConfig {
    /** Max concurrent fetch requests (default: 3) */
    concurrent?: number
    /** Max retry attempts per request (default: 3) */
    retries?: number
    /** Seconds between retries (default: 10) */
    retryDelay?: number
    /** Retry delay strategy: 'fixed' uses constant delay, 'exponential' doubles each attempt (default: 'fixed') */
    retryBackoff?: 'fixed' | 'exponential'
    /** Default fetch options merged into every request */
    fetchOptions?: RequestInit
    /** URL prefix for all requests (default: '') */
    baseUrl?: string
    /** HTTP status codes or patterns like '5xx' to retry on */
    retryOn?: Array<number | string>
    /** If true, non-retryable HTTP errors reject immediately instead of being retried (default: false) */
    rejectOnHttpError?: boolean
}

export interface QueueStatus {
    /** Name of the queue */
    queueName: string
    /** Tasks waiting to be processed */
    queued: number
    /** Tasks waiting for retry */
    pending: number
    /** Currently executing tasks */
    running: number
    /** Sum of queued + pending + running */
    total: number
    /** Whether the queue has been killed */
    killed: boolean
}

export interface QueueError {
    /** The URL that was requested */
    url: string
    /** The fetch options used */
    fetchOptions: RequestInit
    /** Number of attempts made */
    attempts: number
    /** The error that caused the failure */
    error: Response | Error | string
}

export interface FetchQueueInstance {
    fetchQueue: typeof fetchQueue
    createQueue: typeof createQueue
    checkQueue: typeof checkQueue
    killQueue: typeof killQueue
    destroyQueue: typeof destroyQueue
    debugQueue: typeof debugQueue
}

/**
 * Add a fetch request to the queue. Drop-in replacement for fetch().
 */
export declare function fetchQueue(
    url: string,
    fetchOptions?: RequestInit & { queueName?: string },
    queueName?: string
): Promise<Response>

/**
 * Create a new named queue with custom configuration.
 */
export declare function createQueue(
    queueName?: string,
    config?: QueueConfig
): { error: string } | undefined

/**
 * Get the current status of a queue.
 */
export declare function checkQueue(queueName?: string): QueueStatus

/**
 * Gracefully stop a queue. Running tasks finish; pending tasks are rejected.
 */
export declare function killQueue(
    queueName?: string,
    force?: boolean
): Promise<void>

/**
 * Kill and remove a queue entirely. Recreates default queue if 'default' is destroyed.
 */
export declare function destroyQueue(queueName?: string): Promise<void>

/**
 * Enable debug logging for all queue operations.
 */
export declare function debugQueue(): void

/**
 * Create an isolated fetch-queue instance with its own state.
 */
export declare function createFetchQueue(
    instanceConfig?: QueueConfig
): FetchQueueInstance

export default fetchQueue

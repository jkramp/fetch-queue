/** HTTP status families accepted by retryOn. Only non-OK responses are retried. */
export type HttpStatusFamily = '1xx' | '2xx' | '3xx' | '4xx' | '5xx'

/** Native request options, including the duplex mode required for Node stream uploads. */
export interface QueueRequestInit extends RequestInit {
    duplex?: 'half'
}

export interface FetchQueueOptions extends QueueRequestInit {
    /** Overrides the queueName argument. This field is not forwarded to fetch. */
    queueName?: string
}

export interface QueueConfig {
    /** Maximum concurrent fetch calls, a positive integer. Default: 3. */
    concurrent?: number
    /** Total attempts, including the first. Both 0 and 1 mean one attempt. Default: 3. */
    retries?: number
    /** Fixed retry delay in seconds, from 0 through 2147483.647. Default: 10. */
    retryDelay?: number
    /** Request defaults. Headers merge case-insensitively; platform objects retain identity. */
    fetchOptions?: QueueRequestInit
    /** Prefix for relative string inputs. Absolute strings, URL, and Request bypass it. */
    baseUrl?: string
    /** HTTP failures to retry. Network failures also retry. Default: [408, 409, 418, 425, 429, '5xx']. */
    retryOn?: Array<number | HttpStatusFamily>
}

export interface QueueStatus {
    queueName: string
    /** Requests waiting for a concurrency slot. */
    queued: number
    /** Requests waiting for a retry timer. */
    pending: number
    /** Fetch calls waiting for response headers or rejection. Excludes body consumption. */
    running: number
    /** queued + pending + running */
    total: number
    /** True while a stop or destroy is waiting for active fetches. */
    killed: boolean
}

/** Final HTTP or fetch failure. Cancellation and validation use separate rejection values. */
export interface QueueError {
    url: string | URL | Request
    /** Merged request options. May include sensitive headers; avoid logging this object. */
    fetchOptions: QueueRequestInit
    /** Number of fetch calls actually started. */
    attempts: number
    /** Final Response or the value thrown by fetch. */
    error: unknown
}

export interface FetchQueueInstance {
    fetchQueue: typeof fetchQueue
    createQueue: typeof createQueue
    checkQueue: typeof checkQueue
    killQueue: typeof killQueue
    destroyQueue: typeof destroyQueue
    debugQueue: typeof debugQueue
}

/** Enqueue a fetch. Non-OK HTTP responses reject, unlike native fetch. */
export declare function fetchQueue(
    url: string | URL | Request,
    fetchOptions?: FetchQueueOptions,
    queueName?: string,
): Promise<Response>

/** Create a named queue, or return an error object if it exists. Invalid config throws TypeError. */
export declare function createQueue(
    queueName?: string,
    config?: QueueConfig,
): { error: string } | undefined

/** Inspect a queue without creating it. Missing queues report zero counts. */
export declare function checkQueue(queueName?: string): QueueStatus

/** Cancel waiting work and await active fetches. Force also aborts active fetches. The queue remains reusable. */
export declare function killQueue(
    queueName?: string,
    force?: boolean,
): Promise<void>

/** Stop and remove a queue. The default queue is recreated with instance defaults. */
export declare function destroyQueue(
    queueName?: string,
    force?: boolean,
): Promise<void>

/** Enable or disable diagnostic counts. Default: true. */
export declare function debugQueue(enabled?: boolean): void

/** Create an isolated queue registry. Defaults also apply to later named queues. */
export declare function createFetchQueue(
    config?: QueueConfig,
): FetchQueueInstance

export default fetchQueue

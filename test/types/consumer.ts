import fetchQueue, {
    createFetchQueue,
    createQueue,
    checkQueue,
    killQueue,
    destroyQueue,
    debugQueue,
    type QueueConfig,
    type QueueError,
    type QueueStatus,
    type FetchQueueInstance,
} from 'fetch-queue'
import legacyPath from 'fetch-queue/index.js'

const config: QueueConfig = {
    concurrent: 2,
    retries: 0,
    retryDelay: 0.25,
    retryOn: [429, '5xx'],
    fetchOptions: { headers: new Headers({ accept: 'application/json' }) },
}
const queue: FetchQueueInstance = createFetchQueue(config)
const response: Promise<Response> = queue.fetchQueue(
    new URL('https://example.test'),
)
const request: Promise<Response> = fetchQueue(
    new Request('https://example.test'),
    {
        signal: AbortSignal.timeout(500),
        queueName: 'api',
    },
)
const status: QueueStatus = checkQueue()
const created: { error: string } | undefined = createQueue('api', config)
const stopped: Promise<void> = killQueue('api', true)
const destroyed: Promise<void> = destroyQueue('api', true)
debugQueue(false)
void [response, request, status, created, stopped, destroyed, legacyPath]

function readFailure(error: QueueError) {
    const attempts: number = error.attempts
    if (error.error instanceof Response) return error.error.status
    return attempts
}
void readFailure

// @ts-expect-error URLs must be strings or native URL/Request objects.
fetchQueue(42)
// @ts-expect-error concurrency is numeric.
createQueue('invalid', { concurrent: 'two' })
// @ts-expect-error status families must be valid HTTP families.
createFetchQueue({ retryOn: ['6xx'] })
// @ts-expect-error toggles take booleans.
debugQueue('yes')

const upload: Promise<Response> = queue.fetchQueue(
    'https://example.test/upload',
    {
        method: 'POST',
        body: new ReadableStream<Uint8Array>(),
        duplex: 'half',
    },
)
createFetchQueue({ fetchOptions: { duplex: 'half' } })
void upload
// @ts-expect-error Node fetch only accepts half duplex.
fetchQueue('https://example.test/upload', { duplex: 'full' })

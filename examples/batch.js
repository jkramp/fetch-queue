import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createFetchQueue } from '../index.js'

const attempts = new Map()
const server = createServer((request, response) => {
    const attempt = (attempts.get(request.url) ?? 0) + 1
    attempts.set(request.url, attempt)
    const status = request.url === '/retry' && attempt === 1 ? 503 : 200
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ path: request.url, attempt }))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const client = createFetchQueue({
    concurrent: 2,
    retries: 2,
    retryDelay: 0.01,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
})

try {
    const results = await Promise.all(
        ['/first', '/retry', '/last'].map(async (path) => {
            const response = await client.fetchQueue(path)
            return response.json()
        }),
    )
    assert.deepEqual(results, [
        { path: '/first', attempt: 1 },
        { path: '/retry', attempt: 2 },
        { path: '/last', attempt: 1 },
    ])
    console.log(results)
    console.log('Queue status:', client.checkQueue())
} finally {
    await client.destroyQueue('default', true)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
}

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createFetchQueue } from '../index.js'

test(
    'native fetch retries HTTP responses, sends headers, and supports cancellation',
    { timeout: 5000 },
    async (t) => {
        let attempts = 0
        let signalReceived
        const received = new Promise((resolve) => {
            signalReceived = resolve
        })
        const server = createServer((request, response) => {
            if (request.url === '/slow') {
                signalReceived()
                return
            }
            assert.equal(request.headers['x-client'], 'fetch-queue')
            attempts++
            response.writeHead(attempts === 1 ? 503 : 200, {
                'content-type': 'application/json',
            })
            response.end(JSON.stringify({ attempts }))
        })
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
        t.after(async () => {
            server.closeAllConnections()
            await new Promise((resolve) => server.close(resolve))
        })
        const queue = createFetchQueue({
            baseUrl: `http://127.0.0.1:${server.address().port}`,
            retryDelay: 0,
            fetchOptions: { headers: { 'x-client': 'fetch-queue' } },
        })
        assert.deepEqual(await (await queue.fetchQueue('/retry')).json(), {
            attempts: 2,
        })
        const controller = new AbortController()
        const slow = queue
            .fetchQueue('/slow', { signal: controller.signal })
            .catch((error) => error)
        await received
        await queue.killQueue('default', true)
        assert.equal(await slow, 'Queue Killed')
        assert.equal(controller.signal.aborted, false)
        assert.equal(queue.checkQueue().total, 0)
    },
)

for (const status of [200, 503])
    test(
        `caller abort cancels the response body after HTTP ${status} headers arrive`,
        { timeout: 5000 },
        async (t) => {
            const server = createServer((_, response) => {
                response.writeHead(status)
                response.write('partial')
            })
            await new Promise((resolve) =>
                server.listen(0, '127.0.0.1', resolve),
            )
            t.after(async () => {
                server.closeAllConnections()
                await new Promise((resolve) => server.close(resolve))
            })
            const queue = createFetchQueue({ retries: 1 })
            const controller = new AbortController()
            const response = await queue
                .fetchQueue(`http://127.0.0.1:${server.address().port}`, {
                    signal: controller.signal,
                })
                .catch((error) => error.error)
            const body = response.text()
            controller.abort()
            await assert.rejects(body, (error) => error.name === 'AbortError')
        },
    )

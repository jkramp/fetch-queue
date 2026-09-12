import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = mkdtempSync(path.join(tmpdir(), 'fetch-queue-package-'))
const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'Run this check with npm run test:package')
const run = (command, args, cwd) =>
    execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    })

try {
    const [packed] = JSON.parse(
        run(
            process.execPath,
            [
                npmCli,
                'pack',
                '--json',
                '--ignore-scripts',
                '--pack-destination',
                temporary,
            ],
            root,
        ),
    )
    const files = packed.files.map((file) => file.path)
    for (const required of [
        'index.js',
        'index.d.ts',
        'README.md',
        'LICENSE',
        'logo.svg',
    ])
        assert.ok(files.includes(required), `Package is missing ${required}`)
    assert.ok(
        files.every((file) =>
            /^(index\.(js|d\.ts)|package\.json|README\.md|LICENSE|logo\.svg|CHANGELOG\.md|docs\/(api|migration)\.md)$/.test(
                file,
            ),
        ),
        `Unexpected package contents: ${files.join(', ')}`,
    )
    const consumer = path.join(temporary, 'consumer')
    mkdirSync(consumer)
    writeFileSync(
        path.join(consumer, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }),
    )
    run(
        process.execPath,
        [
            npmCli,
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
            path.join(temporary, packed.filename),
        ],
        consumer,
    )
    writeFileSync(
        path.join(consumer, 'smoke.mjs'),
        `
        import assert from 'node:assert/strict'
        import fetchQueue, { createFetchQueue } from 'fetch-queue'
        import legacyPath from 'fetch-queue/index.js'
        assert.equal(fetchQueue, legacyPath)
        const queue = createFetchQueue({ retries: 0 })
        const response = await queue.fetchQueue('data:text/plain,package-ok')
        assert.equal(await response.text(), 'package-ok')
        await queue.destroyQueue()
    `,
    )
    run(process.execPath, ['smoke.mjs'], consumer)
    writeFileSync(
        path.join(consumer, 'consumer.ts'),
        readFileSync(path.join(root, 'test/types/consumer.ts')),
    )
    for (const module of ['NodeNext', 'ESNext']) {
        run(
            process.execPath,
            [
                path.join(root, 'node_modules/typescript/bin/tsc'),
                '--noEmit',
                '--strict',
                '--target',
                'ES2022',
                '--module',
                module,
                '--moduleResolution',
                module === 'NodeNext' ? 'NodeNext' : 'Bundler',
                '--lib',
                'ES2022,DOM,DOM.Iterable',
                'consumer.ts',
            ],
            consumer,
        )
    }
    console.log(
        `Package verified: ${files.length} files, ${packed.size} bytes; runtime and TypeScript consumers passed.`,
    )
} finally {
    rmSync(temporary, { recursive: true, force: true })
}

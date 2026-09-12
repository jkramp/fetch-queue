import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const markdown = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) return markdown(file)
        return entry.name.endsWith('.md') ? [file] : []
    })
const files = [
    ...readdirSync(root)
        .filter((file) => file.endsWith('.md'))
        .map((file) => path.join(root, file)),
    ...markdown(path.join(root, 'docs')),
    ...markdown(path.join(root, '.github')),
]
let snippets = 0
for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const [, target] of source.matchAll(
        /\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
        if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue
        const [relative, fragment] = target.split('#')
        const resolved = path.resolve(
            path.dirname(file),
            decodeURIComponent(relative),
        )
        assert.ok(
            existsSync(resolved),
            `${path.relative(root, file)}: missing link target ${target}`,
        )
        if (fragment && resolved.endsWith('.md')) {
            const headings = [
                ...readFileSync(resolved, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm),
            ].map(([, heading]) =>
                heading
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
                    .replace(/ /g, '-'),
            )
            assert.ok(
                headings.includes(decodeURIComponent(fragment)),
                `${path.relative(root, file)}: missing heading ${target}`,
            )
        }
    }
    for (const [, snippet] of source.matchAll(
        /```(?:js|javascript)\n([\s\S]*?)```/g,
    )) {
        const result = spawnSync(
            process.execPath,
            ['--input-type=module', '--check'],
            { input: snippet, encoding: 'utf8' },
        )
        assert.equal(
            result.status,
            0,
            `${path.relative(root, file)}: invalid JavaScript example\n${result.stderr}`,
        )
        snippets++
    }
}
console.log(
    `Documentation verified: ${files.length} Markdown files and ${snippets} JavaScript examples.`,
)

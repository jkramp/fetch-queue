# Security policy

Report suspected vulnerabilities through
[GitHub's private vulnerability reporting form](https://github.com/jkramp/fetch-queue/security/advisories/new).
Include the affected version, a minimal reproduction, expected behavior, and the
impact you observed. Omit live credentials and personal data.

Use public issues for ordinary bugs. Please keep unpatched security vulnerabilities
private while the maintainer investigates. This project does not promise a fixed
response deadline or security maintenance for older release lines.

## Using request queues safely

Queue defaults and final failure objects may contain headers, URLs, or bodies.
Avoid sharing credential-bearing instances between unrelated users and avoid
logging full failure objects. Built-in debugging emits counts only.

Retries can repeat server-side writes. For non-idempotent operations, make one
attempt or use a server-supported idempotency key. A network error does not prove
that the server rejected the operation.

The package forwards inputs to native fetch. It does not validate destinations,
restrict redirects, enforce authorization, or provide an SSRF filter. Applications
that accept untrusted URLs must apply their own destination policy.

Use supported runtimes and keep development tooling current. Dependency updates
arrive through Dependabot; review their diffs and CI before merging.

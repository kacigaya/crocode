# Security model

Treat the PR author, PR text, changed code, repository files, and agent output as untrusted.
Treat the host operator, GitHub App key, base-branch config, database, and Docker daemon as trusted.
The model provider receives code and review context.
Self-hosting CroCode does not keep that data away from the chosen provider.

## Prompt injection and startup code

CroCode wraps PR text and diffs in a fresh random boundary.
The prompt tells the agent to treat repository content as data.
The boundary makes a guessed closing tag harder to inject.
It does not prove that a model will ignore malicious instructions.

The worker reads `.crocode.yml` from the PR base commit through GitHub.
A PR cannot change its own review policy through its head copy of that file.
Maintainer instructions can focus the review. They cannot change the output format or safety rules.
An ignored file can still be read because the sandbox receives the full head checkout.

Claude uses `--bare`, `--restricted`, strict MCP config, and only Read, Grep, and Glob tools.
Codex uses `exec --sandbox read-only`, an ephemeral session, and ignores user config and rules.
OpenCode denies all tools except read, glob, and grep.
It also uses `--pure` and disables project config, Claude config, and external skill discovery.
These controls stop PR files from supplying OpenCode plugins or startup config.
A local test showed that a project plugin ran before model access with the old command.
The same plugin did not run with the new controls.
See the [OpenCode CLI controls](https://opencode.ai/docs/cli/#environment-variables).

Read-only files do not stop a process from executing code or sending network requests.
A prompt instruction is not an OS security boundary.
Recheck agent startup behavior whenever you change CLI versions.

## Finding validation and publication

The core accepts findings only for normalized paths in the reviewed diff.
It rejects absolute paths, backslashes, and path traversal segments.
It permits inline comments only on RIGHT-side diff lines.
A multiline range must stay inside one hunk.
Other valid findings move to the review summary.
Suggestions need an inline range.

CroCode escapes HTML, disables Markdown images, removes control characters, and breaks mentions in agent prose.
It limits summaries, titles, bodies, suggestions, and the number of findings.
Suggestion code stays inside a fence longer than any backtick run in that code.
Images matter because a URL can encode private code and cause a remote fetch.

Ordinary Markdown links remain in agent output.
A link can contain private text in its URL.
Do not follow agent links without checking them.
The sanitizer is not a complete data-loss prevention system.
It does not prove that a URL, explanation, or suggested patch is safe.

Fingerprints use the file path, category, normalized title, and line content.
Previously published fingerprints on that PR are suppressed.
The bot sends `COMMENT`, never `APPROVE` or `REQUEST_CHANGES`.
If GitHub rejects inline positions with HTTP 422, the worker retries once with a summary-only review.
Human review remains necessary before applying suggestions.

## Credentials and checkout

The webhook handler checks HMAC SHA-256 before it parses or records an event.
It uses a constant-time MAC check and records successful delivery IDs.
The dashboard API asks GitHub which installations a user can access.
Its 60-second cache keeps token hashes, not raw user tokens.
The API does not store user tokens in Postgres.
Access changes can take up to the cache lifetime to appear.

The worker creates a repository-scoped installation token with Contents read and Pull requests write.
It passes the checkout token through `GIT_CONFIG_*` environment variables.
It does not put the token in a Git URL or argument.
Git runs without global or system config and without interactive prompts.
Checkout sets `core.symlinks=false`, so repository symlinks become plain text files.
The worker removes `.git` before it starts the agent.
Submodules are not fetched.

Never put a GitHub token, private key, database URL, or dashboard secret in `CROCODE_AGENT_ENV`.
Never mount these values, a personal CLI home, or the Docker socket into an agent container.
Only the selected agent's model credentials and explicit extra variable names pass into Docker.
Secrets pass as `-e NAME`. Their values stay off the command line.
Docker administrators can still inspect container environment values.

The agent can read its own model credentials.
The worker redacts known passed values and the installation token from agent output before storing it.
Redaction covers exact strings of at least 8 bytes.
It does not cover encoded, split, transformed, or unknown secrets.
Use separate model keys with provider-side spending limits.
Keep `.env` private and use a secret manager or read-only key mount where suitable.
The example shares one environment file across Compose services. Treat those services as one trusted deployment.

## Sandbox boundary

Each Docker job uses these controls from `crates/server/src/sandbox.rs`:

| Control | Value |
| --- | --- |
| Root filesystem | Read-only |
| Capabilities | `--cap-drop=ALL` |
| Privilege escalation | `--security-opt=no-new-privileges` |
| User | `10001:10001` |
| Process limit | 512 |
| Memory limit | 4 GiB |
| CPU limit | 2 |
| Repository | `/repo:ro` |
| Prompt schema input | `/input:ro` |
| Result directory | `/output:rw` |
| Temporary files | `/tmp` tmpfs, 512 MiB, `nosuid,nodev` |
| Agent home | `/home/agent` tmpfs, 512 MiB, `nosuid,nodev`, owned by 10001 |

The worker kills the container on timeout or cancellation.
The normal job path removes checkout files when the work directory is dropped.
A host crash or forced process exit can leave files behind.
Use a private work directory and a disk quota on its filesystem.
The GitHub repository-size pre-check is not a hard checkout or output quota.

`CROCODE_SANDBOX=none` runs the CLI on the host with a reduced environment.
It does not supply the container controls above.
Use it only for trusted local development.

Codex's bubblewrap sandbox cannot create namespaces under this host's default Docker restrictions.
The deprecated Landlock fallback also failed with the pinned version.
The example disables Codex instead of bypassing its sandbox.
See [the exact local results and operational workaround](../docker/README.md#local-verification).
Do not add privileges or disable security profiles just to make a failing probe disappear.

## Docker socket

The API does not need the Docker socket.
The worker needs it to start sibling sandbox containers.
The work directory must have the same absolute host and container path because the host daemon resolves bind sources.

Docker socket access gives effective control of the Docker host.
A worker exploit can start a container with host mounts or other privileges.
Running the worker as uid 10000 does not remove this risk.
See Docker's [daemon security model](https://docs.docker.com/engine/security/#docker-daemon-attack-surface).

1. Use a dedicated host or Docker daemon for CroCode reviews.
2. Give socket access only to the worker service.
3. Keep host credentials and unrelated application data off that host.
4. Keep the kernel, Docker, and agent images updated.
5. Consider a separate daemon, VM, or an installed gVisor runtime for a stronger host boundary.

Set `CROCODE_SANDBOX_RUNTIME=runsc` only after you install and configure that Docker runtime.
This selects gVisor for sandbox jobs. It does not make Docker socket access harmless.
The `runsc` runtime was not tested on this host.
See [gVisor's Docker guide](https://gvisor.dev/docs/user_guide/quick_start/docker/).

## Network and data exposure

Sandbox egress is not restricted by default.
The default Docker `bridge` network permits provider traffic and other reachable destinations.
This can include private network services.
Tool permissions do not replace network policy.
A compromised CLI or injected command can attempt to exfiltrate code or model keys.

1. Put the sandbox on a dedicated network.
2. Deny direct outbound traffic from that network.
3. Allow model traffic through an egress proxy with a narrow destination list.
4. Pass only the proxy variables that the selected CLI needs through `CROCODE_AGENT_ENV`.
5. Test both an allowed provider connection and a blocked external destination.

Selecting a Docker network does not create these firewall or proxy rules.
`runsc` adds isolation. It does not create a provider egress allowlist.
A `none` network also blocks model access unless you provide a supported local route.

The database stores summaries, findings, PR metadata, and redacted errors.
There is no automatic review or finding retention policy.
Delivery-ID records expire after 7 days.
Protect database access and backups as source-code data.
The API and dashboard need HTTPS at the public reverse proxy.

## Known limits and verification

Local tests covered signed webhook state changes, queue leases and retries, finding replacement, and missing API authentication.
Container probes used no real credentials and no paid model calls.
They checked CLI startup, Claude flag parsing, Codex flag parsing and namespace failure, read-only mounts, and the OpenCode plugin control.
A live API container returned a healthy response and rejected missing authentication and an unsigned webhook.

Authenticated model reviews, end-to-end GitHub publication, the dashboard, AMD64 runtime behavior, an egress proxy, and `runsc` were not tested locally.
CI builds the images on both native architectures.

The per-installation concurrency cap is soft under concurrent claims.
Cancellation can take until the next heartbeat to stop a running review.
GitHub publication and Postgres updates are not one transaction.
A crash after GitHub accepts a review but before its ID is saved can cause a duplicate on retry.
A unique head SHA prevents another queue row, including when the prior result was skipped.
The current API has no manual rerun endpoint.

A dependency scan found [RUSTSEC-2024-0449](https://rustsec.org/advisories/RUSTSEC-2024-0449.html) for `unsafe-libyaml 0.2.11`, a transitive YAML parser dependency.
The advisory states that it is unmaintained.
OSV supplied no severity or fixed version in the scan.
A parser change needs a separate compatibility review of `.crocode.yml` behavior.

The sandbox scan first found 19 advisories across 6 dependencies of npm.
The runtime image now removes npm and Corepack after installing the agents.
A second OSV scan of 7 remaining package records, including Node's reported Undici version, found no matching advisories.
This scan does not inspect dependencies embedded inside the native agent binaries or audit Debian packages.

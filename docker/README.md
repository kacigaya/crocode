# Container images

Both Dockerfiles use base images and npm packages that support Linux ARM64 and AMD64.
Build on a native runner for each architecture, or use a configured buildx builder.
No image contains credentials.

## Build

1. Build the API and worker image from the repository root.

   ```sh
   sudo docker build -t crocode:latest .
   ```

2. Build the sandbox image on the same Docker daemon that the worker will use.

   ```sh
   sudo docker build -t crocode-sandbox:latest docker/sandbox
   ```

3. Check the installed versions without network access.

   ```sh
   sudo docker run --rm --network none crocode:latest --help
   sudo docker run --rm --network none crocode-sandbox:latest claude --version
   sudo docker run --rm --network none crocode-sandbox:latest codex --version
   sudo docker run --rm --network none crocode-sandbox:latest opencode --version
   ```

The sandbox uses Node 24 LTS on Debian Bookworm.
It removes npm and Corepack after installation. Review jobs do not need package managers.
Its build arguments pin the agent packages:

| Build argument | Default | npm package |
| --- | --- | --- |
| `CLAUDE_CODE_VERSION` | `2.1.316` | `@anthropic-ai/claude-code` |
| `CODEX_VERSION` | `0.166.0` | `@openai/codex` |
| `OPENCODE_VERSION` | `1.19.5` | `opencode-ai` |

The package names match the official [Claude Code install guide](https://code.claude.com/docs/en/setup#install-with-npm), [Codex install guide](https://learn.chatgpt.com/docs/codex/cli#npm), and [OpenCode install guide](https://opencode.ai/docs/#install).
OpenCode stays on version 1. Version 2 is a separate upgrade.
Recheck the CLI flags and security probes when you change these pins.

## Worker access

The server image runs as uid/gid `10000:10000`.
The worker needs write access to `CROCODE_WORK_DIR` and access to the Docker socket.
Give the worker the socket's host group ID as a supplementary group.
The API does not need the socket.

Socket access is a host trust boundary.
A process with this access can ask Docker to mount host files or start privileged containers.
A non-root worker with socket access still has effective control of the Docker host.
Use a dedicated host or daemon for untrusted reviews.

The worker starts sibling containers through the host daemon.
The work directory must exist at the same absolute path on the host and in the worker.
The sandbox must never receive the socket, GitHub token, or GitHub App private key.

## Local verification

ARM64 checks on 2026-11-01 used no agent credentials and no paid model calls.
All three CLIs reported the pinned versions as uid/gid `10001:10001`.
The probe used the flags from `crates/server/src/sandbox.rs`, including the read-only root, no capabilities, no privilege escalation, and resource limits.
Writes to `/repo`, `/input`, and `/etc` failed.
Writes to `/output`, `/tmp`, and `/home/agent` worked.

Claude accepted CroCode's complete flag set.
It returned `Not logged in` with zero API usage.
Codex accepted `exec --sandbox read-only` and reached HTTP 401 without a token.
These checks do not prove a complete model review or GitHub publication.

A separate `codex sandbox -- sh -c 'cat /repo/hello.txt'` probe failed:

```text
bwrap: No permissions to create a new namespace
```

Docker's default namespace restrictions block bubblewrap on this host.
The deprecated `features.use_legacy_landlock=true` option also failed.
It reported that restricted execution requires bubblewrap to isolate app-server sockets.
Adding that option does not fix this version.

1. Set `CROCODE_AGENTS=claude,opencode` on hosts with this failure.
2. Keep `CROCODE_DEFAULT_AGENT=claude`.
3. To enable Codex, use a dedicated Docker host or runtime that supports its bubblewrap namespaces.
4. Repeat the read, blocked-write, and blocked-network probes there before enabling Codex.

Keep `--sandbox read-only` and the outer container limits.
Do not use privileged containers or a sandbox bypass to hide the failure.
See the official [Linux sandbox prerequisites](https://developers.openai.com/codex/concepts/sandboxing#prerequisites).
`CROCODE_SANDBOX_RUNTIME=runsc` can select an installed gVisor runtime, but compatibility was not tested here.

An OpenCode project-plugin probe executed code with the old command before model access.
CroCode now uses `--pure` and disables project config, Claude config, and external skill discovery.
The same plugin probe did not execute with those controls.

Local AMD64 builds were not possible because this ARM64 host has no AMD64 emulator.
[CI passed both image builds](https://github.com/kacigaya/crocode/actions/runs/41360371611) on native AMD64 and ARM64 runners without pushing images.

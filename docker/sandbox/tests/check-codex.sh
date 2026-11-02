#!/usr/bin/env bash
# Run on the Docker host. The outer TCP probe needs Internet access.
set -euo pipefail
image=${1:-crocode-sandbox:latest}
runtime=${2:-runsc}
probe_dir=$(mktemp -d /tmp/crocode-sandbox-check.XXXXXX)
trap 'rm -rf "$probe_dir"' EXIT
chmod 755 "$probe_dir"
mkdir "$probe_dir/repo" "$probe_dir/outside"
chmod 777 "$probe_dir/outside"
printf '%s\n' read-ok > "$probe_dir/repo/hello.txt"
cp "$(dirname "$0")/read-only.cjs" "$probe_dir/repo/probe.js"
docker run --rm --runtime "$runtime" --network bridge --read-only \
  --cap-drop ALL --security-opt no-new-privileges --user 10001:10001 \
  --pids-limit 512 --memory 4g --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev \
  --tmpfs /home/agent:rw,nosuid,nodev,uid=10001,gid=10001 \
  --volume "$probe_dir/repo:/repo:ro" \
  --volume "$probe_dir/outside:/outside:rw" "$image" sh -c '
    set -e
    touch /outside/outer-write-ok
    node -e '\''const s=require("net").connect(443,"1.1.1.1",()=>{console.log("Outer network works");s.end()});s.setTimeout(5000,()=>process.exit(1));s.on("error",()=>process.exit(1));'\''
    codex sandbox -- node /repo/probe.js
  '

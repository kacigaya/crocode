# Review evaluation

Use `crocode eval` to replay small, explicit source snapshots. It never connects to the database or posts to GitHub. It uses the same prompt builder, restricted agent command, result parser, redaction, sandbox runner, and finding validator as the worker.

## Validate fixtures without model calls

Run from the repository root:

```sh
cargo run -p crocode-server -- eval eval/fixtures/regex.json
```

The default command validates the fixture and exits. It does not call a model. The bundled fixtures cover visible text lost by a regex, snapshot line injection through an href, first-modal selection, and a corrected regex. These are reduced examples inspired by WebSkrap PR #80. They are not full PR replays or proof of improved detection.

## Run a model

1. Build the sandbox image as described in [container checks](../docker/README.md).
2. Set the same sandbox image, runtime, network, and provider credentials used by the worker.
3. Set `CROCODE_WORK_DIR` to an absolute writable directory on the Docker host. If running inside a container, bind the same absolute path in both containers.
4. Run the evaluation with an explicit agent and model:

```sh
cargo run -p crocode-server -- eval eval/fixtures/regex.json \
  --run --agent claude --model claude-opus-5-5 > /tmp/crocode-eval.json
```

`--run` makes real provider calls and can incur cost. Docker is required. There is no host execution mode, automatic fallback, or shared Codex login-cache mount for evaluations. Use `CODEX_API_KEY` for Codex. Repository code never runs. All agent file access stays read-only. Provider access still needs the configured network.

Only the source files listed in the fixture are mounted. The expected bugs are not placed in the sandbox or prompt. Do not put secrets or unrelated source in fixtures. Fixture files cannot use `.git`, `.env*`, or `*.pem` path components. Paths must be normalized, relative, and unique. Added and context lines in each patch must match its head content.

## Fixture format

```json
{
  "id": "example",
  "title": "Change snapshot handling",
  "body": "Optional untrusted PR description",
  "files": [
    {
      "path": "example.js",
      "content": "head source text\n",
      "patch": "@@ -1 +1 @@\n-old source\n+head source text\n"
    }
  ],
  "expected": [
    {
      "id": "stable-bug-id",
      "path": "example.js",
      "start_line": 1,
      "end_line": 1,
      "description": "Failure input, mechanism, and impact"
    }
  ]
}
```

Use `patch: null` for supporting source that the agent can read but that is outside the changed-file scope. Use `expected: []` for a clean case. Default production ignore patterns apply to patched files. Each input file has an 8 MiB limit.

## Evaluate saved output

Use `--response` instead of `--run` to parse an existing CLI response without calling a model:

```sh
cargo run -p crocode-server -- eval eval/fixtures/regex.json \
  --agent claude --response /tmp/claude-envelope.json
```

The live report can be reused directly as `--response /tmp/crocode-eval.json`, with the same fixture and agent. It contains the redacted structured agent review, not the raw tool transcript. A fixture digest prevents accidental reuse with a different snapshot or expected-bug list. Runtime and usage metadata stay available.

You can also import CLI output. Claude input is its JSON result envelope with `structured_output`. OpenCode input is its JSON event stream. Codex input is its final result JSON file, not the JSONL event log. Codex token usage is unavailable from that final file.

## Confirm actual bugs

The report lists location candidates. Location overlap is not a confirmed detection. A person must verify that the finding describes the expected failure mechanism. Then create an adjudication file:

```json
[
  {"bug_id": "stable-bug-id", "fingerprint": "fingerprint from the findings output"}
]
```

Pass it with `--adjudication /tmp/matches.json` and the saved response. Adjudication requires `--response` and cannot be combined with `--run`. Each bug and fingerprint can be assigned once. Unknown bugs, unrelated locations, and duplicate assignments fail validation. The score then lists confirmed bugs, missed bugs, and unconfirmed findings. An empty adjudication confirms no detections. Unconfirmed findings need review; they are not automatically false positives. Scores stay unset without adjudication.

Keep bug descriptions specific. Use known-bug cases, fixed counterparts, and clean changes from more than one repository. Independently verify expected failures. Record source revisions and fixture provenance with the corpus. This initial runner does not fetch repositories or reconstruct Git commits.

## Compare changes

1. Save the baseline result and prompt revision.
2. Change one factor: model, prompt, or supported provider settings.
3. Keep the fixture, source snapshot, sandbox, and tools constant.
4. Repeat each case to check variation.
5. Adjudicate detections and false alarms before choosing a default.

Evaluate SAST-assisted runs separately. The initial replay runner omits SAST and maintainer guidance, so it measures the agent on the supplied patches and context. It does not reproduce every production review condition. Synthetic repository and commit metadata are used in the prompt. Model, prompt, and tool comparisons still require a broader corpus before any quality claim.

## Run telemetry

Evaluation JSON includes model/token usage, wall time, and optional Claude `num_turns`, `duration_api_ms`, and permission-denial counts. Missing fields stay null. Production writes the same activity counts to the worker log for each attempt. No migration or API change is needed. Tool inputs and denial messages are not logged.

Availability of these optional envelope fields has not yet been verified against the pinned production Claude CLI. Turn count does not identify which files were read. Long runs and many calls do not prove a good review. Self-reported confidence is not a calibrated quality score and does not control publication.

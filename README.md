# opencode-github-pr-watch

OpenCode V2 plugin that watches a GitHub pull request until it is deployed to production, so the agent doesn't have to poll with `sleep`.

Code polls `gh` (checks, review, merge, workflow runs and jobs on the merge commit). Key events are reported by fixed rules; a model only judges the remaining changes. The session gets a message for anything worth knowing, until the PR is deployed, closed, or merged without a deploy.

> **Note:** this plugin grew out of my own day-to-day work, so it reflects the repos, pipelines and habits I know. Some of it may assume naming or conventions (job names, how deploys and approvals are set up in GitHub Actions) that don't match yours. If something is reported wrongly or not at all for your setup, please give feedback and [open an issue](https://github.com/anderssv/opencode-github-pr-watch/issues) with what you expected and what happened. I'll do my best to fix it. The debug log (see [Debug log](#debug-log)) usually shows what the plugin saw and decided, which helps a lot.

## Install

Requirements: OpenCode V2 (2.3 or later), the GitHub CLI `gh` logged in to the repos you watch, and a model provider with a light model (haiku, mini, flash). The pill and the side panel need the OpenCode desktop app; watching itself works in any OpenCode client.

Add the plugin to your OpenCode config (`~/.config/opencode/opencode.json`), with any options from [Options](#options):

```jsonc
{ "plugins": [{ "package": "opencode-github-pr-watch" }] }
```

## Tools

- `watch_pr` — start watching one or more PRs (`123`, `owner/repo#123` or a PR URL, separated by spaces, commas or newlines). PRs started together form a batch. `notify: "all"` also reports progress within a step (see below).
- `unwatch_pr` — stop watching
- `list_pr_watches` — show watched PRs, their last state, and when it was last checked and last changed. The state is from the last poll, not live. A watch not checked for more than twice its poll interval is marked `STALE: last checked N min ago`. Each state starts with whether the PR is approved and whether it is up to date with its base branch. `tail: N` shows only the last N lines of each state (where the deploy jobs are), plus the PR title, approval and up-to-date lines. Lists this session's watches; `allSessions: true` lists every session's.

## How watching works

Each check reads the PR and the workflow runs on its merge commit and turns them into facts: review, checks, branch, merge state and deploy state. A summary line in the same terms as `github_pr_status.sh` comes first, for example `summary: REVIEW_REQUIRED · checks PASS · branch OK · next: NEEDS_REVIEW`.

- **Checks are the build pipeline only.** GitHub code scanning results (Trivy, Hadolint, CodeQL; check runs without a workflow, plus the CodeQL workflow) are ignored. The pipeline's own scan jobs still count.
- **Required checks must have reported.** The base branch's required checks (classic branch protection and rulesets) are compared with what reported. A required check that never reported, while nothing else is running, is `checks MISSING:<names>` and not ready for merge: GitHub blocks it. The watch waits for it for the pipeline limit, then ends naming the checks.

- **Every change of step is reported, without a model** (`notify: "major"`, the default): where the PR is changes (checks running → passed, waiting for code review → approved, merged → deploying → deployed, run approval needed → given), so a "checks restarted" message is always followed by how that run ended, and no message means the PR is still where it was. Messages say what changed: "checks passed; now waiting for code review", "run approval given; now checks running". With `notify: "all"`, progress within a step is reported too ("checks running 4/5 · Build"); that wakes the agent often, so it suits short runs you want to follow closely. An automatic start on a PR already watched keeps that watch's setting. In the pill and the side panel, the bell on a watched PR switches a running watch between the two (full: all progress, dimmed: changes of step); the switch applies from its next check.
- **Fixed events always notify, without a model:** auto-merge enabled or disabled, with who did it ("auto-merge disabled by octocat"); new commit on the PR (on a bot PR it says which bot; checks restart and the new commit becomes the baseline), approved, changes requested, approval dismissed, checks failing, behind or in conflict with the base branch, merged, closed, deploy started, checks waiting for an environment approval (before the merge, for example a plan that needs a reviewer to release it), deploy waiting for an environment approval, deploy failed, deployed, merged with no deploy starting. A watch that starts, or restarts, while a check or deploy already waits for an approval says so once, since there is no change to report; it reports again when the set of waiting jobs changes.
- **The model only judges the rest, and states facts, not intent:** text changes no fixed event explains. It can flag something (for example a rollback in the logs) but never stops a watch. Skipped jobs and checks are treated as expected and never reported.
- **Follows the PR until a person has to act or it is in production.** The PR's state decides what is being waited for:
  - **Waiting for review, or for an environment approval (on a PR check or on the deploy):** no time limit; a reminder every 24 working hours, none on weekends.
  - **Branch build running, auto-merge pending, branch behind with auto-merge, deploy running:** up to `maxMinutes` (default 30) per phase, then it hands back with "call watch_pr again to keep watching".
  - **Ends** with what happened or what to do next: ready for merge (approved and checks pass, no auto-merge), behind the base branch (no auto-merge), changes requested, checks failed, conflict, draft, closed, deployed, deploy failed (`gh run rerun <id>` starts a new watch), or merged with no deploy starting within 15 minutes.
  - **With auto-merge on,** approval and passing checks don't end the watch: it follows the automatic merge into the deploy.
- **Polling:** every minute while a build or deploy runs and while an auto-merge PR waits for GitHub to merge it; every 5 minutes while waiting on people (review, environment approval) or for GitHub to update a branch.
- **Stuck jobs:** a merge-pipeline job unfinished for longer than `stuckMinutes` is reported once; watching continues.
- **Starting:** the PR is read first. A PR that would end right away (for example ready for merge, already deployed, closed) is not watched; the reply says why. A PR that is behind its base branch is watched until it is updated (for example by a bot refreshing it) and reports "back up to date"; with no update within 30 minutes it ends with a suggestion (see below). A PR with failing checks is watched until the next run (for example after a bot refreshes the PR) and only ends if that run fails too, or if no new run starts within 30 minutes. After `gh pr update-branch` or `gh run rerun`, the state those commands replace (behind, ready, failing checks, failed deploy) is ignored for up to 10 minutes. In all three cases this stops as soon as the new run shows up, so a failure of the new run counts right away. Starting a watch on a PR that is already watched replaces the earlier watch (or stops it, if the new start is refused). Before any message is sent, the PR is read again: a replaced watch sends nothing, and a message the live state no longer supports (for example "ready for merge" after the merge) is dropped and the next check reports the new state. A branch update or rerun on a PR that is already watched starts the same grace period on that watch. The merge commit a branch update creates is not reported as a new commit, if it shows up within 10 minutes.

- **Monorepos:** every merge-commit pipeline whose deploy jobs were all skipped (the component wasn't changed) is left out of the PR's deploy state and listed as "not this PR's deploy". If a job in that pipeline failed, the deploys were skipped because of the failure, and the deploy counts as failed.
- **Workflows without deploy jobs** (CodeQL, dependency submission) on the merge commit can fail the deploy, but don't keep it running or get reported as stuck while a pipeline with deploy jobs exists. Without such a pipeline they decide the deploy state on their own.
- **Checks:** only the latest attempt of each check counts, and a failed check whose workflow is running again (a re-run) counts as pending. The PR stays at `WAIT_CHECKS` until every required check has reported. The state lists only the PR's own checks and merge pipeline; skipped checks, other component pipelines and other runs on the merge commit are shown as counts.
- **Earlier deploys:** an open PR that would be ready for merge shows `next: WAIT_DEPLOY` while a merge pipeline on its base branch is still deploying a pipeline this PR also builds (in a monorepo, the same component). The watch waits for that deploy (up to 30 minutes) and then reports ready for merge.
- **Which workflows are the deploy:** the guarded model judges each workflow once per repo, from its name, file path, job names and workflow file, as `deploy` (ships the service) or `other` (docs/GitHub Pages, scans, CodeQL, dependency submission…). The answer is stored, so each workflow is judged once. `other` workflows don't affect the deploy state: they can't hold it as running, mark it deployed or fail it. Without a model, the job-based rules below apply.
- **Nothing to deploy:** when every deploy pipeline on the merge commit finished and skipped its deploy jobs (a monorepo component the PR didn't touch, a workflow-only change), the watch ends with "merged; nothing to deploy". Workflows without deploy jobs (CodeQL, docs sync) don't count as a deploy then. A repo marked with `deployWorkflow: "none"` ends at merge the same way.
- **At least one deploy workflow, or ask:** if every workflow on the merge commit was judged and none deploys (and the 15 minutes after the merge, when deploy runs may still be on their way, have passed), the watch doesn't guess. It ends with "couldn't tell which workflow deploys this repo (saw: …)" and suggests calling `watch_pr` again with `deployWorkflow` set to the workflow's name or file, or `"none"` if the repo doesn't deploy. The answer is stored for the repo and overrides the model. Several deploy workflows are fine (a monorepo has one per component; the ones a merge didn't touch skip their deploy jobs and are set aside).
- **Deploy pipelines that haven't listed their deploy jobs yet:** GitHub only lists a job once it is about to run. A running workflow on the merge commit whose last successful merge run had deploy jobs counts as deploying, so a quicker side workflow (for example docs published to GitHub Pages) can't make the PR look deployed early.
- **Time limits from history:** when a build or deploy phase starts, the limit is learned from the last 20 successful runs of the workflows that are running (PR runs for builds, merge runs for deploys): 1.5× the 90th percentile, at least 5 minutes. With fewer than 5 runs of history, `maxMinutes` (default 30) applies. When a run passes its limit and the model judges it still progressing, the limit is doubled once and the watch goes on quietly. Otherwise, or past the doubled limit, the watch hands back with the basis (for example "normally under 9 min") and the guarded model's reading of the running jobs and steps: stuck or slow but progressing.
- **A step after the deploy failed:** for a failed deploy, the model also sees the failed job's steps. When every step that ships the service succeeded and only a later one failed (registering a release in an issue tracker, a notification), the watch says "deployed, but a step after the deploy failed: …" instead of "the merge pipeline failed".
- **Facts and a suggestion:** a watch ends with facts (what happened, the PR's author) and a separate `suggestion:` line; the main agent decides what to do. Suggestions are rule-based where the rule is clear (`gh pr update-branch` for people's PRs). Whether the author is a bot comes from GitHub (`is_bot`), not from its name; for a bot PR that is behind or in conflict, the guarded model reads the PR description and says how to get that bot to refresh it (Dependabot's `@dependabot recreate`, Renovate's rebase checkbox, …), never `update-branch`, which would make the commit yours so you couldn't approve the PR. Without the model it says to see the PR description. For a failed check or deploy, the guarded model reads the end of the PR's own failed log (last 150 lines) and finds the error itself and classifies the failure: `flaky` needs clear infrastructure evidence (lost runner, network or registry errors), everything else is `real`. A rerun is suggested at most once per identical failure on the same commit; the second time it says to treat it as real.
- **Failed runs:** the snapshot shows the error and finding lines (`##[error]`, `CVE-…`, `Total:`, `FAILED`, exceptions) instead of the end of the log.
- **Replaced bot PRs:** when a bot's PR closes, the guarded model reads its closing comments and the same bot's open PRs and names the replacement, if one clearly exists (only PRs it was shown are accepted). The message says "superseded by #41, now watching it" and a watch starts on the new PR in the same session.
- **Watches report together:** polls line up on the wall clock (every 1-minute watch checks on the minute, every 5-minute watch on the same 5-minute marks), so the same event on several PRs in a session lands in one message, even across batches and separately started watches.
- **Workflow runs without a PR:** `watch_pr` also takes a run link (`https://github.com/owner/repo/actions/runs/123`), for a manual dispatch from a branch. It follows that run until it succeeds, fails or waits for approval, with the same failure diagnosis, time limits and pill row. `gh run rerun` on a run without a PR starts such a watch, and so does `gh workflow run <workflow> [--ref <branch>]`: gh doesn't print the run it created, so the run is the newest manual dispatch of that workflow (and branch) created since the command, looked up for up to a minute.
- **Terraform plans:** for an open PR, the summary line shows each finished plan with changes ("terraform: PROD … 0 to add, 6 to change, 0 to destroy"); plans that destroy something come first, marked "(DESTROYS)".
- **Runs on a watched PR's branch join that PR's watch:** a run link, `gh workflow run --ref <branch>` or a rerun whose branch has an open PR this session already watches is followed in that PR's watch instead of a row of its own ("Following run N in the watch of o/r#42"). The PR's row shows it while it goes ("waiting for review · run Deploy 3/8 · Build docker image", the run button pointing at it), its end is reported as "run <workflow> succeeded / failed (<link>): <jobs> / waiting for approval", and then it leaves the watch, which carries on.
- **Code review and run approval are told apart:** "waiting for code review" is a person reviewing the code; "run approval needed (checks / deploy): <jobs>" is a person approving a run into an environment. Rows carry which one it is.
- **Checks queued behind other runs:** each workflow runs one run at a time, so a PR's check run can sit queued with no jobs behind an older run (often another PR's) waiting for run approval. GitHub then shows no check runs for it, so the checks look passing. The watch says "checks queued behind runs waiting for run approval: <workflow> (behind <title>)", once as a message with links, and waits without a time limit like other approval waits. The row has a gear per run ahead to open it.
- **Unwatching sticks:** after `unwatch_pr` (or the slashed eye in the pill or panels), a merge, branch update or rerun in that session doesn't start the PR again; `watch_pr` does. An unwatch right after `gh pr merge` also cancels the watch the merge is starting, and queued messages for it are dropped.
- **No orphaned watches:** a watch nobody has checked for 15 minutes (its directory has no running plugin instance after a restart) is taken over by another instance.
- **After a restart:** watches resume from plugin storage, and each session gets a quiet note like "resumed 4 watches after restart: o/r#1, …". The note is built from storage when it is sent, so unwatched PRs never appear in it, and it is posted at most once per process: OpenCode can run the plugin setup again within the same process (per instance or reload), and those reruns neither repeat the note nor start extra poll loops (one poll loop per directory). A note identical to the last one sent to the session is skipped.
- **No duplicates:** OpenCode can load the plugin more than once, and each instance may run the same watch. An identical message to the same session within 30 minutes is sent only once (tracked in plugin storage, which all instances share).
- **Batches and digests:** messages for one session arriving within 20 seconds are sent as one digest. For each batch involved, the digest adds progress like `approved 3/6 · merged 1/6 · deployed 0/6`. Any watch on a batch PR, including a separate deploy watch after a merge, keeps the batch's numbers current. The batch ends when its last watch stops; a later merge starts its own, separate watch.

## Automatic start on merge

When a `shell` (or legacy `bash`) tool call that runs `gh pr merge` (including `--auto`), `gh pr update-branch` (or its REST form `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/update-branch`) or `gh run rerun <id>` completes, a watch starts for that PR (never on PR creation). The REST form the agent sometimes uses (`gh api -X PUT repos/<owner>/<repo>/pulls/<n>/update-branch` or `…/merge`, also via `$GH`) counts too. A command without a PR number, run outside a git repo, is skipped silently. The watch starts through the same provider guard as `watch_pr`. A short note is posted to the session without waking the agent.

- `gh` must be the command being run (start of the command, or after `;`, `&&`, `||`, `|`, `(`, `do`, `then`), so `echo` or `grep` mentioning it doesn't count.
- The PR can be a number, `owner/repo#123` or a URL; the repo comes from `--repo`/`-R` or the command's working directory. Without a PR argument, the current branch's PR is used.
- Merges whose PR or repo is a shell variable (loops) are skipped, as is `--disable-auto`.
- A PR that is already watched isn't started twice.

## Provider guard

The judging model must come from the same provider the session has selected, for privacy and data-processing reasons. The plugin fails closed:

- A watch only starts if the session has a selected model and runs in the plugin's location, or in a directory inside it (or around it): one workspace, compared per path segment. The provider is pinned then.
- Before every model call, the session is read again. If the model is missing, the provider changed, or the session left the workspace, no model is called; the watch stops and the session is told why.
- Provider IDs are compared exactly. V2's legacy alias mapping is not applied.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "opencode-github-pr-watch", // or the path to a local checkout
      "options": {
        "preferences": ["haiku", "mini", "flash"], // substrings matched against model IDs of the session's provider, in order
        "stuckMinutes": 30, // report a deploy job unfinished for longer than this
        "ghPath": "/opt/homebrew/bin/gh", // optional; gh is found on your login shell's PATH (mise shims skipped), then in /opt/homebrew/bin and /usr/local/bin
        "maxMinutes": 30, // limit when a workflow has too little history, and for auto-merge/auto-update waits
        "desktopNotifications": true, // macOS notification with the watcher's message
        "debugLog": true, // JSON-lines debug log at ~/.local/state/opencode-github-pr-watch/debug.jsonl; false, or a path
        "bookkeepingJobs": ["detect changes", "build status"] // jobs that only detect changes or report a status in monorepos; defaults cover common names
      }
    }
  ]
}
```

If no preference matches, the session's own model is used.

## Debug log

Every decision is written as one JSON line to `~/.local/state/opencode-github-pr-watch/debug.jsonl` (rotated to `.1` at 5 MB). Set `"debugLog": false` to turn it off, or a path to write elsewhere. Events, each with the watch id:

- `command`: a shell command with a merge, rerun, branch update, bot command or dispatch, what was detected, and how long it ran.
- `start`, `start-kept`, `start-skipped`, `no-watch`, `unwatch`, `resumed`: why a watch started, continued, didn't start or stopped.
- `check`: each poll's step, phase, events and summary; `end` with the reason; `result` with stop and the next delay.
- `judge`, `diagnosis`, `bot-advice`, `stall`: each model call's answer or error.
- `model-answer-invalid`: a model answer the code couldn't fully use: which call and model, what was wrong (no JSON, a value outside the choices, a missing field), and the start of the raw answer. A wrong value in a decision field falls back (for example "notify" when judging, "real" for a failure's cause) and the model's own text is still used; useful when trying a different model.
- `notify`, `delivered`, `deliver-dropped`, `dropped`: messages sent, delivered, or dropped (unwatched, superseded, stale).
- `read-failed`: GitHub couldn't be read, so the check decided nothing. `tolerated-error`: something optional failed and was left out. `check-failed`: a check threw and will be retried.

Find one watch's history with `grep '"id":"o/r#123"' ~/.local/state/opencode-github-pr-watch/debug.jsonl`.

## Notifications

Messages that need attention (fixed events, things the model flags, stuck jobs and stops) are posted to the session and wake the agent. With `desktopNotifications` on, the same message is also shown as a macOS notification (PR as title, first line as text). With [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) installed (`brew install terminal-notifier`), clicking it brings the OpenCode desktop app to the front and a newer notification for the same PR replaces the older one; if it is missing or fails (for example when macOS hasn't allowed its notifications yet), `osascript` is used instead and clicking opens Script Editor. Allow notifications for terminal-notifier in System Settings → Notifications. It appears on the machine running the OpenCode background service. The quiet "Watching …" notes don't notify.

## Development

```sh
bun install
bun test
```

## Desktop: watched PRs above the composer

In OpenCode Desktop, a pill above the session's composer shows how many PRs the session watches ("3 PRs watched"), coloured by the one needing attention most: red when something failed, yellow when a person has to act. Clicking it lists each PR with where it is now ("checks running", "waiting for review", "deploying"…), with buttons that open the PR and its workflow run in the browser. The run is the one still going, else a failed one, else the latest: the PR's checks before merge, the deploy pipeline after. It updates as the watches change.

- The server part exposes the watches over RPC (`rpc.ts`: `pr-watch.list` and a `changed` event); the desktop part (`src/gui.tsx`, the experimental GUI plugin API) reads them.
- The desktop part is a prebuilt bundle: run `bun run build` (or `bun run dev` while changing it). `dist/` is not committed, so build after a fresh clone.

### Side panel: PRs

A pinned "PRs" tab in the session's side region (shown by default) lists the open PRs the `gh` user created, in every repo (`gh search prs --author @me`), grouped by repo. One dropdown narrows it to one organisation, another sorts it: by name (repos A–Z), by newest PR, or by oldest PR (repos and their PRs; merged PRs by merge time). A "Show drafts" checkbox (on by default) hides draft PRs when off. A "Group by" dropdown groups by repo (folder icon, the default), by topic (list icon), or not at all ("None": one "All PRs" list, by repo then newest first for "Name", else by date). Topics come from a light model of the panel session's own provider (the same provider guard and model preferences as watches): it names 3–8 topics and puts each PR in one; code drops unknown PRs and puts any it left out under "Other". Topics are kept for the same set of PRs, so the model is only asked again when your PRs change; while they load, or if they can't be made (the reason is shown), the list stays grouped by repo. In topic view each PR also shows its repo. "Show PRs that aren't mine" (on by default) adds the watched PRs others opened (bots, colleagues). "Current session only" (off by default) narrows the tab to the PRs and runs the current session watches, whoever opened them. Watches of runs without a PR are listed first under "Workflow runs". A watched PR has a button to open the session watching it. All these choices are remembered. A status line at the top shows everything in progress with one spinner ("Loading your PRs…", "Sorting your PRs into topics…", "Starting watching o/r#42…", "Stopping watching …", "Starting a session about …"), then the latest result for a few seconds. PRs in My PRs use the same line as the watch lists: a watched PR shows its watch's status icon and where it is (from whichever session watches it), and its run links. A search field at the top filters both lists as you type: every word must be in the PR's title, repo or number (`#803` or `803`), in any case. The search is kept while switching tabs and sessions, but not stored. Each group heading (repo or topic) has a copy button that puts its listed PRs on the clipboard as a list of `- <title>: <url>` lines, in the order shown. Each PR shows draft, age and whether it's watched, with buttons to watch it in the current session, to start a new session about it (in the current session's folder, with its provider, model and agent, titled "PR #N on owner/repo", whose first message asks for a summary of the PR) and to open it on GitHub. "Recently merged (7 days)" expands to the PRs merged in the last week. It reloads every 3 minutes and when a watch changes, only while the tab is on screen; the server keeps search results for a minute. Search can lag a few minutes behind a merge.

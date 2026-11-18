# Nightly name-only cup catch-up playbook

A scheduled Claude task runs this playbook every night until the backlog is gone. Each round does four things:

- gives about 1,000 name-only domestic cup winners their real final and team id;
- checks the newly identified clubs' current owners;
- reads the Club History of clubs that are bots or ownerless now;
- publishes the result.

Background: [HISTORICAL_WINNER_RECOVERY.md](HISTORICAL_WINNER_RECOVERY.md#missing-finalteam-facts).

The site owner's rules apply as in [WEEKLY_UPDATE_PLAYBOOK.md](WEEKLY_UPDATE_PLAYBOOK.md):

- **Every published winner names its manager.** The only exception is a winning club or account that no
  longer exists. Managers come only from guarded CHPP data or Club History evidence, never from guesses,
  name matches or hand-fed lists.
- **Approved on 2026-11-19:** nightly CHPP rounds, and reading the Club History pages of these clubs in the
  built-in browser. Read one page every 1.2–2 s, as `club-history-capture.js` already does. Club History is
  public: never type credentials and never sign in.

Work from the main checkout `C:/dev/toto-hattrick`, and invoke its scripts by absolute path or from
inside it. In the commands below:

- `$M` is `C:/dev/toto-hattrick`;
- `<D>` is today's date (`YYYY-MM-DD`);
- `<C>` is the round's capture folder, `.scrape/club-history-cups-<D>`.

If a file for `<D>` already exists from an earlier attempt today, append `-b` to the date in every name.

## 1. Preflight

```bash
cd C:/dev/toto-hattrick && git fetch -q origin && git status -sb | head -1 && git rev-parse main origin/main && cat .update-store/locks/update.json
```

Continue only if all of these hold:

- the checkout is clean `main`;
- `main` equals `origin/main`;
- the lock shows `"expiresAt":0`.

Otherwise stop and report. The weekly update (Mondays ~08:03) must never overlap a round.

## 2. Checkout, carry, materialize

```bash
cd C:/dev/toto-hattrick && npm run update:checkout -w server -- --database ../.update-work/cup-teamids-<D>.db
```

Let `<P>` be the previous round's checkout, the second to last of
`ls .update-work/cup-teamids-20*.db | sort` (date-named, so the trial checkout is never picked). Replay what
it holds: this is a no-op when it was published, and it saves its facts when another import made it stale.

```bash
cd C:/dev/toto-hattrick && npm run update:materialize -w server -- --database ../.update-work/cup-teamids-<D>.db --carry-from ../.update-work/<P>
```

If that dry run reports `carried > 0`, run it again with `--apply --report ../.update-work/cup-teamids-<D>-carry.json`.
Then look at the plan:

```bash
cd C:/dev/toto-hattrick && npm run update:materialize -w server -- --database ../.update-work/cup-teamids-<D>.db
```

If `nameOnlyFinals` is above 0, fetch. This takes about 25 minutes, so run it in the background:

```bash
cd C:/dev/toto-hattrick && npm run update:materialize -w server -- --database ../.update-work/cup-teamids-<D>.db --apply --max-calls 2000 --report ../.update-work/cup-teamids-<D>-materialize.json
```

The run is fine when `aborted` is false. A few `issues` are expected: winner-name mismatches on early
two-leg finals. If `aborted` is true, CHPP failed repeatedly; continue with whatever was filled.

## 3. Current owners of the newly identified clubs

```bash
cd C:/dev/toto-hattrick && node scripts/cup-catchup.mjs round-state --canonical .update-work/attribution-backfill-state.json --report .update-work/cup-teamids-<D>-materialize.json --out .update-work/cup-teamids-<D>-attr-state.json
```

Add `--report .update-work/cup-teamids-<D>-carry.json` if step 2 carried finals. With `N` = the printed
`newClubs`, and only when `N > 0`, run this in the background (about 1 s per club):

```bash
cd C:/dev/toto-hattrick && npm run update:attribute -w server -- --database ../.update-work/cup-teamids-<D>.db --backfill --state ../.update-work/cup-teamids-<D>-attr-state.json --max-teams <N+100> --apply --report ../.update-work/cup-teamids-<D>-attribution.json
cd C:/dev/toto-hattrick && node scripts/cup-catchup.mjs merge-state --canonical .update-work/attribution-backfill-state.json --from .update-work/cup-teamids-<D>-attr-state.json
```

`account_gone` means the club no longer exists, so "—" is correct. `unresolved` clubs go to step 4.

## 4. Club History of bot and ownerless clubs (browser)

List the targets. Pass every round's attribution report and every earlier capture:

```bash
cd C:/dev/toto-hattrick && mkdir -p .scrape/club-history-cups-<D> && node scripts/cup-catchup.mjs history-targets --database .update-work/cup-teamids-<D>.db $(for f in .update-work/cup-teamids-*-attribution*.json; do printf -- '--attribution %s ' "$f"; done) $(for f in .scrape/club-history-2026-11-18/histories.annotated.json .scrape/club-history-cups-*/histories.annotated.json; do [ -f "$f" ] && printf -- '--captured %s ' "$f"; done) --out .scrape/club-history-cups-<D>/targets.json
```

If `clubs` is 0, skip to the replay at the end of this step.

**Start the receiver.** In your session's working directory, add or replace this entry in
`.claude/launch.json` (create the file if needed; it is git-ignored). Use the absolute `<C>` path:

```json
{ "name": "history-receiver", "runtimeExecutable": "node", "runtimeArgs": ["C:/dev/toto-hattrick/server/scrape/history-receiver.mjs", "C:/dev/toto-hattrick/.scrape/club-history-cups-<D>", "3017"], "port": 3017 }
```

Then start it with `preview_start {name: "history-receiver"}`. Its page should show `{"ok":true,…}`.

**Read the pages.**

1. In the built-in browser, open `https://www.hattrick.org/en/Club/History/?teamId=<first target's teamId>`.
2. Read `C:/dev/toto-hattrick/server/scrape/club-history-capture.js` and pass its full text to
   `javascript_tool`. It must return `window.__htHistory ready`.
3. Call `window.__htHistory.start('http://127.0.0.1:3017')`.
4. Wait for `C:/dev/toto-hattrick/.scrape/club-history-cups-<D>/histories.jsonl` to reach the target count:
   `until [ $(wc -l < <file> 2>/dev/null || echo 0) -ge <clubs> ]; do sleep 30; done` in the background, with a
   30-minute Monitor re-armed as needed. Pages take about 9 s per club. Check
   `window.__htHistory.status()` on each wake-up; stop waiting once it says `finished`.
5. If `failedCount > 0`, call `start(...)` once more. It skips clubs already received.
6. Stop the receiver with `preview_stop`.

If the browser cannot be reached, or Hattrick shows a challenge page that does not clear, skip the reads
and say so. The next round reads these clubs again.

**Annotate the new capture, then replay every capture.**

```bash
cd C:/dev/toto-hattrick && node scripts/cup-catchup.mjs captures --input .scrape/club-history-cups-<D>/histories.jsonl --out .scrape/club-history-cups-<D>/histories.json
cd C:/dev/toto-hattrick && npm run annotate:club-histories -w server -- --input ../.scrape/club-history-cups-<D>/histories.json --output ../.scrape/club-history-cups-<D>/histories.annotated.json
cd C:/dev/toto-hattrick && node scripts/cup-catchup.mjs captures $(for f in .scrape/club-history-2026-11-18/histories.annotated.json .scrape/club-history-cups-*/histories.annotated.json; do [ -f "$f" ] && printf -- '--input %s ' "$f"; done) --out .scrape/club-history-cups-<D>/replay.json
cd C:/dev/toto-hattrick && DATABASE_URL=file:C:/dev/toto-hattrick/.update-work/cup-teamids-<D>.db npm run recover:historical-winners -w server -- --input ../.scrape/club-history-cups-<D>/replay.json --report ../.update-work/cup-teamids-<D>-history-dry.json
```

The replay makes no CHPP calls. It fills only empty managers, with the tenure guards of
[HISTORICAL_WINNER_RECOVERY.md](HISTORICAL_WINNER_RECOVERY.md#attribution-rules). Existing credits that
disagree are reported as `conflicts` and left alone.

If the dry run's `counts.ready` is above 0, apply it:

```bash
cd C:/dev/toto-hattrick && DATABASE_URL=file:C:/dev/toto-hattrick/.update-work/cup-teamids-<D>.db npm run recover:historical-winners -w server -- --input ../.scrape/club-history-cups-<D>/replay.json --report ../.update-work/cup-teamids-<D>-history-applied.json --apply
```

## 5. Import, package, review, publish

```bash
cd C:/dev/toto-hattrick && npm run update:import -w server -- --database ../.update-work/cup-teamids-<D>.db
```

Then run `node C:/dev/toto-hattrick/scripts/run-local-update.mjs --no-fetch` in the background, followed by:

```bash
node C:/dev/toto-hattrick/scripts/diff-release.mjs "$(ls -td C:/dev/toto-hattrick/.update-work/run-* | head -1)"
```

Exit code 3, or anything under `blocking`, means a title vanished or a named manager changed. Do **not**
publish then; report it. If the import is refused as stale, another update moved the archive. Start
again at step 2 with a `-b` checkout: the carry step replays this round's facts without any CHPP call.
Otherwise publish and verify:

```bash
cd C:/dev/toto-hattrick && git fetch -q origin && git status -sb | head -1 && node scripts/git-release.mjs publish
curl -s https://toto-hattrick.vercel.app/data/manifest.json
```

The live `dataVersion` must equal the packaged one.

## 6. Report, and stop when done

Finish with a short report:

- finals materialized and team ids found;
- the attribution outcome (credited, `account_gone`, `unresolved`);
- Club History: clubs read, failures, managers named, conflicts;
- `nameOnlyRemaining` after the round;
- the release id and the live `dataVersion`.

When step 2's dry run shows `nameOnlyFinals` 0 **and** step 4 lists no targets, the backlog is done.
Say so, and disable this task (`update_scheduled_task` with `enabled: false`). A few rows always need a
person: early two-leg mismatches, finals left to the updater, and the Supporter Week S11 row known only
from HattrickWiki. List them in the final report.

## Never

- Edit `.update-store`, a run's `working.db` or published JSON by hand, or commit or merge code.
- Credit a manager from a name match, the wording "a now retired manager", or a current owner who fails
  the guards.
- Read Hattrick pages other than these Club History pages, faster than the script's pace, or signed in
  with typed credentials.
- Retry a failing publish more than once; report it.

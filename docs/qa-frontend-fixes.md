# Frontend statistical corrections — 11 September 2026

All seven frontend findings from the original statistical audit have been addressed. The first complete frontend QA run passed **27/27 test groups**, including the six formerly failing groups and three additional adversarial regressions. The existing web URL/share tests passed **15/15**, and `npm run typecheck --workspace web` passed. The final review added the renamed-club streak correction below and expanded the suite to **28 groups**; its complete rerun is included in the coordinating final validation.

The original audit document remains unchanged at [`qa-frontend-statistics.md`](qa-frontend-statistics.md). Its original machine-readable failure evidence is preserved separately at [`frontend-statistics-before-fixes.json`](../qa/results/frontend-statistics-before-fixes.json). Current results are in [`frontend-statistics.json`](../qa/results/frontend-statistics.json).

| Finding | Corrected behavior |
|---|---|
| Split nation medal totals | Nation tables and expanded podium lists now use the same stable country identity. The youth scope has **105 country rows**, and the all-competition scope has **129**, with all medal counts reconciled against raw podium records. The display name is separate from the identity key and omits the U21 prefix. |
| Stale cabinet after recency changes | The open cabinet reloads when manager, recency window or language changes. Scope checks prevent the old cabinet from appearing beside a new total, and cleanup ignores late responses from superseded requests. |
| Same-login account collision | Club competition Top managers panels group by numeric user ID when available. Bangladesh now keeps `siftekhar`'s two accounts separate: **5 and 3** league wins; **4 and 4** main-cup wins. Account links remain attached to their own counts. |
| Youth election dates | Timeline dates use the youth World Cup history for youth elections and senior history for senior elections. All **2,666 formerly incorrect dates** now match their own bracket. |
| Youth election result attribution | Regional result windows also use the election's own bracket. All **45 formerly incorrect mandate lists** now reconcile. An election for a next cycle that has no history row starts at the preceding final and keeps an open end. |
| Streaks spanning missing seasons | A streak requires both the same club and adjacent season numbers. Missing years split runs; valid runs on either side are retained. |
| Renamed clubs splitting valid streaks | Adjacent titles use the numeric team ID when both records have one, falling back to names when identity is unavailable. Renames preserve a run, while separate IDs sharing a name remain distinct. The four observed affected club pairs were Cyprus team 463679, Egypt 30477, Ukraine 268321 and Hattrick International Cup team 2054098. Corrected examples include Cyprus S11 ×3, Ukraine S9 ×6 and Egypt S7 ×2. |
| World Cup editions shown as seasons | National cabinets display World Cup records as **WC 40**, for example, while regional records keep their season prefix **S40**. All **265 formerly mislabeled rows** are corrected. |

The navigation tabs' border styles were also changed to non-overlapping properties to remove the React shorthand/longhand update warning without changing the design.

## Validation

Run the complete statistical suite from the repository root:

```sh
node qa/run-frontend-statistics.mjs
```

The suite continues to inspect all 10,307 managers, all eight trophy/medal fields and six reigning counts across five windows, every cabinet, all 640 trophy-filter configurations, 980 club competition rolls, 12 national competitions, all 15 medal scopes, and all 7,137 election rows in the original audited snapshot. Counts are discovered dynamically, so it also accepts a refreshed snapshot.

The three additional regression groups cover:

- The actual cabinet request effect and render guard across manager/language/window changes, unchanged rerenders, and requests resolving out of order.
- A missing season between two legitimate title runs, so correcting the gap does not erase valid streaks.
- Country aliases and youth names joining correctly while England and Northern Ireland remain distinct.

The independent tests were adapted only where the corrected product output now uses stable identity keys or explicit World Cup labels. The original discrepancy assertions remain active. Nation counts are additionally checked against an independently grouped country-level podium oracle. The original full statistical audit had 24 groups; the initial three new groups brought it to 27. The final independent streak oracle inspects every roll and caught eight incorrect displayed streak rows across the renamed-club pairs. It was red before the identity correction and green afterward. Adversarial examples also check renamed teams and distinct numeric teams with the same name; all three focused streak regression groups passed, and the full suite now contains 28 groups.

The existing web tests were bundled without modifying their source and run with Node's test runner. These corrections did not modify the baked JSON files, backend, API, database, OAuth credentials or CHPP schemas. Browser interaction verification remains part of the coordinating end-to-end QA pass.

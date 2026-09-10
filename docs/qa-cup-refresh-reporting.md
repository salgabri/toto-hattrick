# Unresolved cup refresh reporting

`syncMasters` now returns every cup-resolution issue and logs a warning containing cup ID, season, optional final match ID and the sanitized reason. `refreshLatestChampions` does the same for each competition and returns `cupIssues` with cup/country context. Both paths report issues even when they added zero champions. The normal refresh and standalone Masters CLI summaries include unresolved-final counts.

Three focused regressions run the real orchestrators, cup sync and resolver with mocked database and HTTP boundaries. They verify that an archived tied final without winner events is surfaced in both paths without creating or updating a champion, and that an already stored final produces neither a warning nor an HTTP request. The new tests and related cup/enrichment regressions pass **50/50**; the server TypeScript build passes. No production database write or bake was performed for this reporting change.

```powershell
npm run build -w server
```

From `server/`:

```powershell
node --test dist/sync/cupSyncReporting.test.js dist/sync/cupFinals.test.js dist/sync/enrichManagers.test.js
```

# Shareable filters

Selecting a tab or changing a filter updates the address bar. Copy that URL to share the
selection; opening it or reloading restores the filters. Browser Back/Forward restores earlier
selections. Search text replaces the current history entry so typing does not add an entry for
every keystroke.

The **Share** button in the header opens a preview with **Copy link** and a copy confirmation.
Where supported, **More options…** opens the device's share menu. If clipboard access is unavailable,
the link is selected for manual copying. Shared links include only the visible page's relevant
filters; remembered selections from other tabs and unrelated URL parameters are omitted.

Examples (append to the site's base URL):

```text
/?view=trophies&trophies.recency=5&trophies.group=nation
/?view=cups&cups.category=secondary&cups.country=4&cups.secondary=773
/?view=medals&medals.scope=one&medals.bracket=youth&medals.competition=cup-4878483&medals.by=coachNation
/?view=elections&elections.tab=nations&elections.q=Italia
```

Filters are namespaced by tab so selections survive switching tabs. Missing parameters use the
usual defaults. Unknown enum values fall back to defaults; country and competition selections
are checked after their reference data loads. Country codes and cup/competition IDs are the
values in the corresponding selectors, not translated labels.

| Parameter | Values |
| --- | --- |
| `view` | `trophies` (default), `leagues`, `cups`, `worldcup`, `medals`, `elections` |
| `trophies.nation` | Nationality value, or `ALL` (default) |
| `trophies.q` | Search text |
| `trophies.competitions` | Comma-separated `champ,main,sec,hm,sn,wc`; missing includes all except `sec`, an empty value includes none |
| `trophies.recency` | `all` (default), `reigning`, `5`, `10`, `20` |
| `trophies.count` | `winners` (default), `medals`; reigning always counts winners |
| `trophies.group` | `manager` (default), `nation` |
| `leagues.country` | League country code |
| `cups.country` | Cup country code |
| `cups.category` | `main` (default), `secondary`, `masters`, `seasonal` |
| `cups.secondary`, `cups.seasonal` | Positive cup ID |
| `worldcup.bracket`, `medals.bracket` | `senior` (default), `youth` |
| `worldcup.competition`, `medals.competition` | `senior`, `youth`, or `cup-<ID>`; missing uses the first competition in the selected bracket |
| `medals.scope` | `senior` (default), `one`, `u21`, `all` |
| `medals.by` | `nation` (default), `coach`, `coachNation` |
| `elections.tab` | `managers` (default), `nations`, `countries` |
| `elections.country` | Election country code |
| `elections.q` | Search text for manager/nationality rankings |

Pagination and expanded rows are local presentation state. Language follows the reader's saved
preference. These are not part of a filter link.

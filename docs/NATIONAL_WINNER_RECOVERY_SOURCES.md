# National trophy source notes

The replayable records are in `server/src/data/verified-national-trophy-winners.json`.
They identify an exact senior/youth edition, medal slot, country, final date, national
team ID and numeric manager ID. They are evidence for missing attribution, not
permission to overwrite an existing positive manager ID. The guarded recovery
planner reports disagreements for review.

The initially verified external-source records are:

| Edition and medal | Historical manager | Numeric identity proof |
| --- | --- | --- |
| U20 IX, México silver | Morelos (215249) | Hattrick Press articles 21925 and 23905 explicitly give the numeric account; Mexico's history identifies the exact edition. |
| U20 XI, Italia bronze | Mokiforever (1585064) | Hattrick Press article 19362 and his wiki profile explicitly give the numeric account; first-person Italy history explains his appointment after the elected candidate withdrew. |
| U20 IX, Deutschland gold | Alando-Brinkman (184069) | The retired account retains Harsefelder FC, its exact tenure and Bundesliga season 30 trophy. The German history names Alando-Brinkman for that club/title and the national title. Selected primary-page observations are retained in `national-winner-source-observations.json`. |

Every record includes its actual source URLs and an explanation of the evidence
chain. These supplement complete official former-coach histories; they do not
replace those histories with a username lookup. From `server/`, preview the
combined committed evidence with `npx tsx src/scripts/recover-national-coaches.ts`.
Inspect the resulting report before deliberately adding `--apply`. No web calls
or baking are performed by that command.

## Research leads are not verified identities

The following sources identify historical coaches, but the names alone do **not**
establish a numeric account. Do not add these to the applicable source manifest
without independent primary evidence. These are research notes, not a live list of
remaining database gaps; later official-history recovery may resolve a slot.

| Historical result | Named coach | Source |
| --- | --- | --- |
| Sverige senior I gold | Livergarden | [Sweden national history](https://wiki.hattrick.org/index.php?title=Sweden_National_team&oldid=502409) |
| Sverige senior III gold | DrDDD | [Sweden national history](https://wiki.hattrick.org/index.php?title=Sweden_National_team&oldid=502409) |
| Sverige senior VI gold | Hacker | [Sweden national history](https://wiki.hattrick.org/index.php?title=Sweden_National_team&oldid=502409) |
| Sverige youth I, II and VIII gold | Absolut, Pucko, westhamunited respectively | [Sweden youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_Sverige&oldid=420455) |
| România youth V gold | -tva- | [Romania youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_Rom%C3%A2nia&oldid=421082) |
| Nederland youth V silver | Ruyven | [Netherlands youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_Nederland&oldid=413764) |
| Österreich youth VII silver and VIII bronze | LukasW | [Austria youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_%C3%96sterreich&oldid=420670) |
| Deutschland youth VI bronze | Sickboy83 | [German history](https://wiki.hattrick.org/index.php?title=De/Deutschland&oldid=420507) |
| Eesti youth V bronze | Theor | [Estonia youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_Eesti&oldid=487888) |
| Česko senior IX silver, youth IX bronze | Stefan004, Jar_Jar_Binks respectively | [Czech history](https://wiki.hattrick.org/wiki/Cs/%C4%8Cesk%C3%A1_republika) |
| Scotland senior VI silver | Boggler | [Final record](https://wiki.hattrick.org/wiki/World_Cup_VI_-_Final) |
| England senior XIII bronze | gove-CFC | [England national history](https://wiki.hattrick.org/index.php?title=National_team_England&oldid=443961) |
| Slovenija senior XVIII silver, XXV bronze | Djombaslo, PohanD respectively | [Slovenia national history](https://wiki.hattrick.org/index.php?title=National_team_Slovenija&oldid=461762) |

## Ambiguity and date warnings

- Sverige senior II: the Sweden history names Valium, but [DrPOMO's primary
  interview](https://www.hattrick.org/en/Community/Press/?ArticleID=19363) recalls
  assisting DrDDD during both editions II and III. Neither source supplies the
  missing numeric identity. Do not resolve this disagreement by majority vote.
- [Hellas history](https://wiki.hattrick.org/index.php?title=National_team_Hellas&oldid=443620)
  explicitly distinguishes the early `iratmac` and later `IraTmac` as different
  users. Case-insensitive names are not an identity key.
- [Malta youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_Malta&oldid=420780)
  explicitly distinguishes the Steve007 of edition XX from the earlier Steve007.
- [Italy's first-person youth history](https://wiki.hattrick.org/wiki/IT/National_team_U-20_Italia)
  describes an elected manager withdrawing before Mokiforever took over. Likewise,
  [Belarus youth history](https://wiki.hattrick.org/index.php?title=National_team_U-20_Belarus&oldid=407072)
  identifies swim_Minsk taking over from Andriy1991 for the final campaign. An
  election winner is not sufficient proof of the eventual trophy winner.
- Bronze medals were earned at the semifinal, which can precede the edition's
  stored final date by several days. The source manifest's `finalDate` is the
  exact guarded database row date, not a claim that the bronze match occurred then.
- A retired manager profile may omit the old name and national trophy. Retaining
  a numeric account's exact old club tenure and specific historical club title can
  provide corroboration; a current club owner or an undated same-name match cannot.
- England senior V is not yet safely linked to active PirateWolf (47604). The
  [English national history](https://wiki.hattrick.org/index.php?title=National_team_England&oldid=443961)
  aliases katze666 to PirateWolf, and its final page uses PirateWolf, but the
  [older Russian history](https://wiki.hattrick.org/index.php?title=Ru/%D0%90%D0%BD%D0%B3%D0%BB%D0%B8%D1%8F&oldid=117231)
  names katze666 for senior V and PirateWolf for youth V, overlapping campaigns.
  The captured official senior history marks the relevant tenure as retired,
  whereas account 47604 remains active. Pirate FC and its season 36 English Cup
  title support that active account's club identity, not its alleged senior V
  coaching tenure. No verified-source record should bridge this discrepancy using
  the wiki alias or current username alone.

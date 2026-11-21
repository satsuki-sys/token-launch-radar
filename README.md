# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/satsuki-sys/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/satsuki-sys/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot, finds the protocols that record no token yet and are not a wrapped or staked product of one that trades, and ranks all 198 of them by implied launch value. The price is a peer benchmark, not a guess: each pre-token protocol is priced at its category's market-cap-per-TVL ratio among protocols whose token already trades, shrunk toward the market median by peer count, then tilted by its own seven-day TVL momentum and by how long it has run with no token. The dashboard shows the ranked board, a detail view per protocol with the peer evidence and the arithmetic, the launched protocols kept apart at market value, and a six-step farm plan with costs and times for every row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node.js 22.18 or later, standard library only. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory; open `dashboard/index.html` from there to use the radar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=27qytqes&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

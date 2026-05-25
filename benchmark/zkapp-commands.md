# zkappCommands Benchmark Plan

This benchmark is for `Query.zkappCommands`, which is expected to be the highest fan-out archive query because it scans block ranges, zkApp commands, account updates, and nested field arrays.

## Dataset

Use a real archive database snapshot or seeded Lightnet archive with representative zkApp activity:

- sparse ranges with few zkApp commands;
- dense ranges with many zkApp commands;
- commands with multiple account updates;
- account updates with empty and non-empty actions/events;
- account updates with app state and account preconditions.

Create `benchmark/zkapp-commands.csv` with this shape:

```csv
from,to,accountPublicKey,tokenId
1000,1100,B62...,1
1100,2100,B62...,1
2100,7100,B62...,1
```

Include at least one unfiltered full-range row for every range by reusing the same `from` and `to` values; the benchmark weights the unfiltered scenario more heavily.

## Server Setup

Start the API against the benchmark archive database:

```sh
PG_CONN=postgres://postgres:postgres@localhost:5432/archive ENABLE_GRAPHIQL=false npm run dev
```

Use the default server port `8080`, or update `benchmark/zkapp-commands.yaml` if testing another port.

## Run

```sh
npx artillery run benchmark/zkapp-commands.yaml --output benchmark/zkapp-commands-report.json
```

Generate an HTML report when needed:

```sh
npx artillery report benchmark/zkapp-commands-report.json
```

## Measurements To Capture

- p50, p95, p99 latency for unfiltered and filtered scenarios;
- requests per second at the sustained phase;
- API process RSS and event loop lag;
- Postgres CPU, buffer hit ratio, temp file usage, and slow query log entries;
- `EXPLAIN (ANALYZE, BUFFERS)` for representative sparse and dense ranges.

## SQL Plan Checks

For representative ranges, verify that the planner filters `blocks` and `blocks_zkapp_commands` before lateral aggregation over actions, events, app state, and preconditions. The expensive work should only execute for rows inside the bounded range and non-failed zkApp commands.

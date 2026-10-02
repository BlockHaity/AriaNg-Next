# Documentation

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | The layer split, the dependency rule, the incremental task-list refresh, the scheduler, state management, profile hot-switching and the testing strategy. |
| [rpc.md](rpc.md) | The two transports, the secret token, the connection state machine, the full method table, notifications and the aria2/aria2-next gotchas this front end had to get right. |
| [build-targets.md](build-targets.md) | The two Vite build targets (`dist/` and `dist-single/`), `base: './'`, hash routing, the PWA configuration and a verification checklist per target. |
| [material-design.md](material-design.md) | The Material Design 3 compliance checklist, how each item is met, the responsive navigation mapping, the hand-built data tables and the known deviations. |
| [migrating-from-ariang.md](migrating-from-ariang.md) | What is identical to AriaNg, what changed, how to import an existing `AriaNg.Options` blob, and which AriaNg URLs keep working. |

Start with [../README.md](../README.md) for installation and quick start.

Also see [ci.md](ci.md) for the CI workflow and how to reproduce each quality
gate locally, and [../src/ui/mdui/README.md](../src/ui/mdui/README.md) for the
mdui wrapper layer every component is built on.

# MVP Roadmap

Core MVP flows are implemented; completed phase records are [archived](archive/). [Past automated acceptance](archive/mvp-acceptance-record.md) does not replace fresh [release verification](development.md#release-verification). Real-device multiplayer and VPS release remain open.

The [research and maintenance roadmap](open-source-roadmap.md) is outside MVP scope and may take priority through bounded changes that preserve ongoing UI work. MVP completion is not its prerequisite; the gates below remain open.

| Priority | Work | Completion gate |
| --- | --- | --- |
| Now | Local UI polish following [visual direction](web-visual-direction.md). | Revised screens checked locally at desktop/mobile sizes, including affected interactions. |
| Now | Remaining independent features; list and scope still to be supplied by the owner. | Record each agreed requirement in the relevant current document and verify its behavior. |
| Later | [Release acceptance](development.md#release-verification). | Fresh automated gates and a recorded real-device multiplayer session pass; arrange a reachable test site when needed. |
| Later | VPS release: Docker artifact, persistent SQLite volume, explicit migrations, operating instructions, and existing `cloudflared` tunnel. | Friends can play over HTTPS; application/container restarts retain committed data. |

Keep each agreed task to its outcome and completion check; plan dependencies only where needed. Follow [verification](development.md#phase-verification) and update current requirements or UI guidance when decisions change.

Deferred: spectators, Room discovery, turn timing, connection-driven pause, and off-VPS backups. CLI account administration is sufficient for MVP.

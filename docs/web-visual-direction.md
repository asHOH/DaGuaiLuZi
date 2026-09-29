# Web visual direction

PC-first game surface: one continuous table, spatial four/six-player seating, local player at the bottom, and compact avatars. Preserve actual seat order, teams, rules, actions, synchronization, and account/privacy behavior. Use HTML/CSS, Chinese-capable fonts, and simple SVGs; no artwork dependency.

- Overlap upright cards horizontally; rank above suit at the upper left. Sort by descending single-card strength, then spade, heart, club, diamond; keep copies distinct. Wrap only between complete rank groups.
- Show each seat's latest played cards until lead reset, including after a pass; emphasize the current play to beat. Recover these public plays on reconnect. Pass markers follow the current unbeaten play.
- Automatically display the count declaration required by [the rules](ruleset.md#turn-flow): opponents' counts only at 10 or fewer; your own count always. Exact counts remain in transmitted views.
- Keep selection and explicit submission separate; retain off-turn selection, keyboard operation, and setup/result/recovery actions.

Existing account/lobby baseline:

Deep green felt, warm ivory cards, muted brass accents. Chinese headings use Songti/SimSun; controls use PingFang SC/Microsoft YaHei. Thin table borders and soft card shadows; no artwork dependency. Keep the hand and current actor prominent on mobile. Restrict motion to brief focus/hover transitions and disable it for reduced-motion preferences.

Account settings reuse these controls in one narrow, centered form; keep password-change consequences beside the fields.

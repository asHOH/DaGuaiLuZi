# Web visual direction

PC-first game surface: one continuous table, spatial four/six-player seating, local player at the bottom, and compact avatars. Preserve actual seat order, teams, rules, actions, synchronization, and account/privacy behavior. Use HTML/CSS, Chinese-capable fonts, and simple SVGs; no artwork dependency.

- Overlap upright cards horizontally; rank above suit at the upper left. Sort by descending single-card strength, then spade, heart, club, diamond; keep copies distinct. Wrap only between complete rank groups.
- Center the hand when it fits on one row; keep wrapped hands left-aligned.
- Show each seat's latest played cards until lead reset, including after a pass; emphasize the current play to beat. Recover these public plays on reconnect. Pass markers follow the current unbeaten play.
- Automatically display the count declaration required by [the rules](ruleset.md#turn-flow): opponents' counts only at 10 or fewer; your own count always. Exact counts remain in transmitted views.
- Keep selection and explicit submission separate; retain off-turn selection, keyboard operation, and setup/result/recovery actions.
- Selected cards use azure for a legal play, orange for a legal response of matching count that cannot beat the unbeaten play, and yellow otherwise; apply this feedback off-turn too.
- Use filled Remix Icon hearts/diamonds in red and Game-icons.net spades/clubs by Skoll in black, with no visible suit text. Prioritize visual balance over equal area: diamond area is 95% of heart; black suits share one proportional scale to preserve their original stem proportions. Retain Phosphor for UI icons. Active play hides account/history/logout/home navigation and invitations; retain owner termination. Use accessible icons for connection/sync/command states.
- Show numbered avatars only for other players; omit the entire self-seat display, team/turn/play captions, and visible hand heading. Keep other players' yellow turn markers and the current-play marker. Indicate your turn with a bold accent divider above the hand; hide it otherwise.
- Center avatars on their seat anchors; align opposite-seat plays beneath them in both Rulesets. Keep pass markers prominent. Active play uses one header row for Hand/level metadata, connection status, and termination; omit the brand and hide the username on narrow screens.
- Above the hand, keep your card count left and center only play/pass; clear appears to their right without shifting them. On narrow screens, place the count on its own row. Show play/pass only on your turn, hide pass on an open lead, and show clear only with a selection. Play and pass have equally prominent azure/orange fills; clear stays neutral and pass markers are orange. Selection feedback shows only the recognized type for five cards. Metadata: enlarged Trump Rank first, then the other Team Level, in team colors and baseline-aligned.

Color roles (shared CSS variables):

- Team one is red with a circle; team two is dark green with a diamond. Use the same identity in lobby and play, with dark badge fills and brighter text/borders on the green table. Keep team labels or symbols alongside color.
- Azure means valid selection or affirmative action, including setup confirmation and readiness. Orange means pass, unable to beat, or failed/unavailable status.
- Yellow means awaiting action or resolution: turn/current-play markers, unfinished selections, pending commands, synchronization, and uncertainty. Connected/synchronized is muted neutral; offline/failed icons are orange with visible Chinese explanations.
- Keep card-suit colors independent of UI status colors.
- Apply these meanings throughout account, history, Replay, and Challenge screens. Errors share orange alert styling; primary actions share azure default/hover styles.

Existing account/lobby baseline:

Deep green felt, warm ivory cards, muted brass accents. Chinese headings use Songti/SimSun; controls use PingFang SC/Microsoft YaHei. Thin table borders and soft card shadows; no artwork dependency. Keep the hand and current actor prominent on mobile. Restrict motion to brief focus/hover transitions and disable it for reduced-motion preferences.

Share font roles across pages: UI, decorative headings/avatars, cards, and codes. Live/replay card ranks use bold Times New Roman/Times with Chinese heading fallbacks and lining, tabular numerals; all Challenge Code fields use monospace. Active-game headings retain UI typography. Use local fonts; no font downloads.

Account settings reuse these controls in one narrow, centered form; keep password-change consequences beside the fields.

Information density: keep current decisions visible; collapse previous-Hand details, optional Challenge entry, and Replay sharing by default. Open Challenge entry for a prefilled Challenge link. Remove repeated headings, decorative login copy, and idle-table prompts; retain results, errors, privacy warnings, and recovery actions.

Replay shares the live table renderer, card faces, grouped hands, team colors, turn markers, and latest plays. Use a blue-gray table background and visible `回放` label. Default to the participant's seat (seat one for other viewers); allow seat switching and collapsed all-hands inspection. Replay has playback controls and recorded setup actions, never gameplay commands. Seat switching pauses playback; each viewer's seat and position remain independent.

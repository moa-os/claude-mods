# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that change its interface.

## Mods

### usage-rings

Three rings above the prompt showing how much of your plan's usage limits you've used: the
5-hour limit, the weekly limit across all models, and the weekly Fable limit. Each shows the
percent used and the time until it resets, and turns amber at 50% and red at 80%.

- In the desktop app each ring is a small arc with its percent beside it, then the window's name
  and time left; hover over a ring for its reset time. In a terminal they're a text row with
  circle symbols.
- The rings take the left of the band and leave the rest of the row to other mods, such as
  control-panel's pill.
- The 5-hour and weekly figures come from Claude Code itself. The Fable figure comes from the
  desktop app's usage card, so in a terminal-only session it may show "–".
- Only plans with usage limits have these figures (not API keys, Bedrock, Vertex or gateways).

### control-panel

A control panel for your mods. A pill at the right end of the band above the prompt says
"✦ Moa's CP" (with your own name), and clicking it, or typing `/cp`, opens the panel.

- Your name is your Claude account's display name, which Claude Code keeps in its config file on
  each machine; without one, it's your login name (`USER`, or `USERNAME` on Windows).

- The panel greets you by the time of day ("Good evening, Moa") on a strip whose colours change
  from morning to night, as the pill's do.
- Its Launch section has a card for every command your installed mods add, plus Claude Code's own
  `/diff`. Launch runs that command as if you'd typed it. Skills aren't listed, and nor are mods
  with nothing to launch.
- Mods it doesn't know yet get a card too, coloured by their name.

## Install

In a Claude Code terminal session, run:

```
/plugin install usage-rings --marketplace moa-os/claude-mods
/plugin install control-panel --marketplace moa-os/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope. Once installed from a terminal, the
mods also load in the desktop app's sessions on that machine.

## Update

After a new version is pushed here:

```
claude plugin update usage-rings
claude plugin update control-panel
```

Then restart Claude Code, or run `/reload-plugins` in a terminal session.

## Developing

Each mod is a folder listed in `.claude-plugin/marketplace.json`. To check one:

```
claude plugin validate usage-rings
claude plugin test usage-rings
```

To work on the mods from a clone, add the clone itself as a marketplace and install from it.
Claude Code then reads the mods straight from the clone, so `/reload-plugins` picks up your
edits:

```
claude plugin marketplace add <path to this clone>
claude plugin install usage-rings@claude-mods
```

# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that change its interface.

## Mods

### usage-rings

Three rings above the prompt showing how much of your plan's usage limits you've used: the
5-hour limit, the weekly limit across all models, and the weekly Fable limit. Each shows the
percent used and the time until it resets, and turns amber at 50% and red at 80%.

- In the desktop app the rings are drawn as small circles. In a terminal they're a text row with
  circle symbols.
- The 5-hour and weekly figures come from Claude Code itself. The Fable figure comes from the
  desktop app's usage card, so in a terminal-only session it may show "–".
- Only plans with usage limits have these figures (not API keys, Bedrock, Vertex or gateways).

## Install

In a Claude Code terminal session, run:

```
/plugin install usage-rings --marketplace moa-os/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope. Once installed from a terminal, the
mod also loads in the desktop app's sessions on that machine.

## Update

After a new version is pushed here:

```
claude plugin update usage-rings
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

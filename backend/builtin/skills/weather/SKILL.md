---
name: weather
description: Query the wttr.in weather service for the current weather at a city. Use this skill whenever PilotDeck must report real-time temperature, precipitation, wind, or sky conditions for a named location. Connects only to wttr.in; declared in front-matter for the egress allowlist.
egress:
  - wttr.in
---

# Weather (wttr.in)

Single-purpose weather lookup skill. Uses Python stdlib `urllib` (no third-party deps), routed through the platform's `127.0.0.1:8080` egress proxy — which only allows hosts declared in this `SKILL.md` front-matter.

## Usage from Copilot / Digital Employee

From Copilot, **always run via `action=run`** — never inline a `curl` or `requests.get` (those bypass the egress allowlist enforcement).

```text
action=open   # read this SKILL.md
action=run    # python3 scripts/weather.py <city>
```

Examples:

```bash
python3 scripts/weather.py "London"
python3 scripts/weather.py "Beijing"
python3 scripts/weather.py "San Francisco"
```

Output format (one-line):

```
London: 🌧 +12°C
```

Exit code `0` on a successful response, `1` on network failure, `2` on egress denied (the proxy rejected the host — should be impossible since `wttr.in` is allowlisted, but surfaced clearly so logs aren't ambiguous).

## What this skill will NOT do

- Will **not** call any host other than `wttr.in`. The egress proxy returns `502 egress denied: <host>` for anything else, which the script surfaces as exit code `2`.
- Will **not** persist or upload anything. wttr.in responses are read, printed to stdout, and discarded.
- Will **not** install pip packages. `urllib.request` is the only network primitive — keeps the skill reproducible inside the gVisor sandbox.

## Why the `egress:` front-matter matters

The skill declares its egress needs in this file's front-matter. The platform's control plane intersects this declaration with the admin policy and signs the result into the RunToken. Without an entry here, the skill defaults to **deny-all** and the proxy will block every connection.
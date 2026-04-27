# win98

A web-first desktop OS over your Solid pod, **but it looks like 1998**.

Sister project to [solid-apps/chrome](https://github.com/solid-apps/chrome) —
identical primitives (window manager, registry, auth, real-time, panes,
pod sync), peak teal aesthetic.

> Your data, your apps, your pod. Now in glorious gray-and-blue with
> a 3D bevel on every button.

## What's the same as chrome

Everything, structurally:

- App registry + `urn:App` / `urn:Pane` from
  [`solid-apps/registry`](https://github.com/solid-apps/registry)
- Identity via WebID + Solid OIDC (xlogin)
- Real-time via solid-0.1 WebSocket Notifications
- Pod-stored installed apps (TypeRegistration `urn:solid:App`)
- Pod-stored wallpaper (`urn:solid:Wallpaper`)
- SLIP-48 LOSOS panes — typed resources dispatch to registry panes
- Window manager (drag / resize / snap / multi-desk)
- Lock screen, quick settings, built-in Files
- Same localStorage origin as chrome → install on chrome, log in on
  win98, your apps follow

## What's different from chrome

The vibe.

- Classic teal wallpaper (the one)
- 3D-beveled everything via `box-shadow` tricks
- Blue gradient title bars
- Tahoma / MS Sans Serif fonts
- A single bottom **taskbar** instead of separate tray + shelf
- A **Start** button with the red/green/blue/yellow flag
- Vertical Start menu in place of the chrome launcher
- System tray on the right with the clock, sign-in pill, settings cog,
  and desk indicators

## Run it

Static site. Pure ES modules, no build.

```bash
python3 -m http.server 3004
```

Open <http://localhost:3004/>.

Live: <https://solid-apps.github.io/win98/>

## License

AGPL-3.0

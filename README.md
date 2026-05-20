# pi-extensions

Personal extensions for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

## Extensions

- `clear.ts` — adds `/clear`, which starts a fresh empty session while preserving parent-session linkage.
- `extension-manager.ts` — adds `/extensions`, an interactive UI to enable/disable user, project, and package extensions.

## Install

```bash
pi install git:github.com/8bury/pi-extensions
```

Or try without installing permanently:

```bash
pi -e git:github.com/8bury/pi-extensions
```

## Local development

```bash
git clone git@github.com:8bury/pi-extensions.git
cd pi-extensions
pi -e .
```

After changing extensions already installed locally, run `/reload` in pi.

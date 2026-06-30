# Config Drift Watcher

**English** · [Русский](README.ru.md)

An Obsidian plugin that detects when a server's actual configuration has diverged from what you documented in your notes — read-only, over SFTP.

## Problem

Infrastructure documentation rots. You write down how a server should be configured, then a reboot, a manual fix, or someone else's script changes the real file, and your notes silently become wrong. There is no built-in way to know your documentation is out of date until something breaks in production.

## What it does

You annotate a `drift` code block in a note with a server alias and a remote file path. The plugin connects to that server over SSH in read-only mode, fetches the current content of the file via SFTP, and compares it line by line against the code block. If they match, the block is marked in sync. If they differ, the plugin shows which lines are only in your notes and which are only on the real server, and leaves the note untouched.

The plugin **never executes commands** and **never writes to the remote server**. It only reads.

## Usage

Annotate a `drift` code block. The first line is `target: alias:/absolute/remote/path`; everything after it is the documented content that gets compared against the remote file:

````markdown
```drift
target: gammastack-stfox:/etc/network/interfaces
auto eth0
iface eth0 inet dhcp
iface eth0 inet6 manual
```
````

> **Important:** the opening ` ```drift ` fence must start at the **beginning of the line** (no leading spaces). An indented code block is rendered as plain Markdown in Reading view and the plugin will not process it.

The block renders as a card with a status badge and two actions:

- **Check drift** — reads the current remote file and compares it against the block content without modifying the note. Differences are shown inline below the block.
- **Snapshot from server** — reads the current remote file and replaces the block content with it. Use this to capture a baseline, then edit the block manually if you want to document an *intended* state rather than the current one. If the block already has content, this asks for confirmation first, so a manual edit is never silently overwritten.

### Status badges

| Badge | Meaning |
| --- | --- |
| **Not checked** | The block has not been compared yet this session. |
| **Checking… / Reading…** | A read is in progress. |
| **In sync** | The note and the remote file match. |
| **Drift · N lines** | They differ; the inline diff shows what changed. |
| **Error / Unknown alias / Invalid block** | Something went wrong; the message explains what. |

## How comparison works

The comparison is plain text diffing, line by line. There is no interpretation of what a config "should" mean, no AI involved, and no awareness of any specific config format (nginx, sysctl, network interfaces, and so on are all treated as plain text). The plugin is only as correct as what you wrote in the note: if you document the wrong thing, the plugin will faithfully tell you that the wrong thing does not match reality.

Two comparison options are available in settings, to cut noise on real config files:

- **Ignore whitespace** — treat whitespace-only differences as in sync.
- **Ignore comments** — drop comment-only lines (per a configurable list of prefixes, e.g. `#`, `;`, `//`) before diffing.

A trailing newline at the end of the remote file (which the code block never has) is never reported as drift.

## Server profiles

Credentials are never stored inside a note. Each alias used in a code block (for example `gammastack-stfox`) refers to a connection profile configured once in the plugin settings:

| Field | Description |
| --- | --- |
| **Alias** | The name referenced from notes as `target: alias:/path`. |
| **Host** | IP address or hostname of the server. |
| **Port** | SSH port (default `22`). |
| **Username** | SSH user to connect as. |
| **Private key path** | Path to a private key on this machine (`~` is expanded). |
| **Key passphrase** | Only if the private key is encrypted. |

Notes only ever reference the alias, which keeps them safe to sync, share, or commit to version control.

## Connection method

Remote files are read over **SFTP** rather than by executing shell commands. This is a deliberate choice: an SFTP read can only read a file, it cannot run arbitrary code on the remote host, regardless of how the path or alias is manipulated.

Authentication is **key-based only**. Password authentication is not supported.

## Security

This plugin connects to remote servers and handles SSH credentials. Read this before using it.

- **Read-only by design.** The plugin only performs SFTP reads. It never executes a remote command and never writes to the remote server. It cannot apply a fix or change anything on the host.
- **Credentials live in plugin data, not in notes.** Profiles (host, username, private key path, and optional passphrase) are stored in `.obsidian/plugins/config-drift-watcher/data.json` inside your vault. Your notes only contain the alias. If you sync or publish your vault, be aware that `data.json` contains this connection data — exclude it (or the whole `.obsidian` folder) from anything public. **A key passphrase, if you set one, is stored in `data.json` in plain text.**
- **The private key never leaves your machine.** The plugin reads the key file from local disk to authenticate, exactly like the `ssh` command does. The key itself is not copied into the vault.
- **Host key verification (trust on first use).** The first time you connect to a profile, the server's SHA-256 host key fingerprint is recorded and pinned. On later connections a changed fingerprint aborts the read with a warning, protecting against a machine-in-the-middle or an unexpected server change. **Caveat:** trust-on-first-use cannot detect interception that is already present on the very first connection — pin the fingerprint up front if you need that guarantee (see below).
- **Desktop only.** The plugin requires Node APIs (SSH and local file access) and does not run on Obsidian mobile.

### Host key verification

By default each profile learns and pins the server's host key on first connect, and shows the fingerprint in a notice. You can also verify or pin it manually:

- The plugin's fingerprint format matches OpenSSH, so you can compare it with:

  ```bash
  ssh-keygen -lf <(ssh-keyscan -t ed25519 your.host 2>/dev/null)
  ```

- To **pin strictly from the start**, paste a known `SHA256:…` fingerprint into the profile's *Host key fingerprint* field before the first connection.
- To **re-trust** after a legitimate server change, press *Forget* next to that field; the next connection learns the new key.

## Limitations

- Single file per code block. No directory-wide drift detection in the current version.
- Read-only by design. The plugin will never apply a fix to the remote server automatically.
- Requires SSH key-based authentication. Password authentication is not supported.
- No scheduling. Checks run on demand, not on a timer, in the current version.

## Roadmap

- `known_hosts` file integration (fingerprints are currently pinned per profile)
- Optional scheduled background checks with a notification on drift
- Directory and multi-file watching
- Diff ignoring rules per block (whitespace, comments, ordering)
- Optional integration with an LLM to suggest a fix command for a detected drift, off by default

## Installation

### Manual

Not yet published to the community plugin directory. Until then, install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `config-drift-watcher` inside `<vault>/.obsidian/plugins/`.
3. Place the three files inside it.
4. Enable the plugin from Community plugins in Obsidian settings.

### BRAT (beta)

If you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, add this repository (`rixct/config-drift-watcher`) to install and auto-update the beta before it reaches the community directory.

## Development

```bash
npm install        # install dependencies
npm run dev        # watch build
npm run build      # type-check + production bundle
npm test           # run unit tests (parser, diff, snapshot)
```

The plugin bundles `ssh2` and `diff` into a single `main.js` via esbuild.

## Contributing

Issues and pull requests are welcome. Before submitting a feature, open an issue describing the use case so the scope can be discussed first, since the plugin intentionally stays read-only and minimal in what it touches on the remote server.

## License

MIT. See [LICENSE](LICENSE).

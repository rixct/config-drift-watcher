# Config Drift Watcher

An Obsidian plugin that detects when a server's actual configuration has diverged from what you documented in your notes.

## Problem

Infrastructure documentation rots. You write down how a server should be configured, then a reboot, a manual fix, or someone else's script changes the real file, and your notes silently become wrong. There is no built-in way to know your documentation is out of date until something breaks in production.

## What it does

You annotate a code block in a note with a server alias and a remote file path. The plugin connects to that server over SSH in read-only mode, fetches the current content of the file, and compares it line by line against the code block. If they match, the block is marked as in sync. If they differ, the plugin shows which lines are only in your notes, which lines are only on the real server, and leaves everything else untouched.

The plugin never executes commands and never writes to the remote server. It only reads.

## How comparison works

The comparison is plain text diffing, line by line. There is no interpretation of what a config "should" mean, no AI involved, and no awareness of any specific config format (nginx, sysctl, network interfaces, and so on are all treated as plain text). The plugin is only as correct as what you wrote in the note. If you document the wrong thing, the plugin will faithfully tell you that the wrong thing does not match reality.

Whitespace-only and comment-only differences can be ignored via a setting, since exact byte-for-byte matching produces noise on most real config files.

## Usage

Annotate a code block with a target server alias and a remote path:

    ```
    target: gammastack-stfox:/etc/network/interfaces
    ```
    auto eth0
    iface eth0 inet dhcp
    iface eth0 inet6 manual
    ```

Two actions are available on the block:

- Snapshot from server: reads the current remote file and replaces the block content with it. Use this to capture a baseline, then edit the block manually if you want to document an intended state rather than the current one.
- Check drift: reads the current remote file and compares it against the block content without modifying the note. Differences are shown inline below the block.

If a block already has content, re-running Snapshot from server requires confirmation, so a manual edit (an intentionally documented future state) is never silently overwritten by the current state of the server.

## Server profiles

Credentials are never stored inside a note. Each alias used in a code block (for example `gammastack-stfox`) refers to a connection profile configured once in the plugin settings: host, port, username, and private key path. Notes only ever reference the alias, which keeps them safe to sync, share, or commit to version control.

## Connection method

Remote files are read over SFTP rather than by executing shell commands. This is a deliberate choice: an SFTP read can only read a file, it cannot run arbitrary code on the remote host, regardless of how the path or alias is manipulated.

## Limitations

- Single file per code block. No directory-wide drift detection in the current version.
- Read-only by design. The plugin will never apply a fix to the remote server automatically.
- Requires SSH key-based authentication. Password authentication is not supported.
- No scheduling. Checks run on demand, not on a timer, in the current version.

## Roadmap

- Optional scheduled background checks with a notification on drift
- Directory and multi-file watching
- Diff ignoring rules per block (whitespace, comments, ordering)
- Optional integration with an LLM to suggest a fix command for a detected drift, off by default

## Installation

Not yet published to the community plugin directory. Until then, install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `config-drift-watcher` inside `<vault>/.obsidian/plugins/`.
3. Place the three files inside it.
4. Enable the plugin from Community plugins in Obsidian settings.

## Contributing

Issues and pull requests are welcome. Before submitting a feature, open an issue describing the use case so the scope can be discussed first, since the plugin intentionally stays read-only and minimal in what it touches on the remote server.

## License

MIT. See [LICENSE](LICENSE).

# AGENTS.md

- Run with `bun start`; typecheck with `bun run typecheck`. OpenTUI needs Bun, not Node.
- To test the TUI headlessly, launch it in a Rex pane (`rex run --focus=false -- env YTM_DL_DIR=<scratch> bun src/main.tsx`), drive it with `rex send` / `rex send-key`, read it with `rex capture`.
- Album track lists from `getAlbum` use music-video IDs that lack artist/album metadata; download album tracks from the album playlist with `--playlist-items N` instead (see `albumArgs`).
- OpenTUI global `useKeyboard` handlers run before the focused element; call `key.preventDefault()` to keep a key (e.g. tab) out of the input.
- In this user's shell `ls` is eza and `cat` is bat, and both can hang or misbehave in non-TTY tool calls: use `command ls` / `command cat`.

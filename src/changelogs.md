\# Changelogs

\## 2026-10-17

\### Agent & tools

\- Path sanitize: block Termux/abs path nesting under project root

\- Project memory → `.aicodex/project_memory.md` (legacy root migrate)

\- Recursive folder delete

\- File change undo/redo `/undo`, `/redo`) + chat event rows

\- Branch history: edit/regenerate keep version trees; `‹ ›` on **user** message only

\- Regenerate truncates lower chats per version; older versions keep full subtree

\- FS write undo snapshots on mutating tools

\- Agent loop / plan card / work shell stability (prior sessions)

\### UI — messages

\- User footer: counts left · time/edit/copy right (response.txt sizes)

\- Assistant footer: model **id only** (no provider name); timing `12s  16:17`

\- Copy feedback: user “Copied!” / response green tick

\- Soft-edit + cancel restores prompt+response; commit uses branches

\- Event/info rows: \~20px height, live styles, no stretch gap under last reply

\- Collapsible markdown: setting `collapsible` | `normal`; apply **live** on stream (prose + parts)

\- User attachments: images horizontal wrap; **files** shown as chips; persist + restore on edit/regenerate

\- OpenAI-compat multimodal: keep `image_url` / fold file text on regenerate

\### Providers & models

\- Model footer from `*SelectedModel` ConfigManager (not provider slug)

\- `/settings` opens same modal as model ⋮ `ModelSetupUI`)

\- Usage / recommended models / max_tokens afford retry (prior)

\### Slash commands

\- `/` palette: `/undo` `/redo` `/path` `/settings` (extensible registry)

\### Fixes

\- `editMessage` sync: remove illegal `await import`

\- Live collapsible: target `.gpt-stream-prose` / part-text each paint, not only finalize
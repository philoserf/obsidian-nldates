# AGENTS.md

> **Note:** `CLAUDE.md` is a symlink to `AGENTS.md`. Edit `AGENTS.md` to change this content.

## Project Overview

Obsidian plugin to parse and insert dates using natural language. Supports autosuggest, date picker modal, and URI protocol handler. Originally created by [Argentina Ortega Sainz](https://github.com/argenos/nldates-obsidian). Forked as [obsidian-nldates](https://github.com/philoserf/obsidian-nldates).

## Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # Run all checks (typecheck + biome)
bun run typecheck        # TypeScript type checking only
bun run lint             # Biome lint + format check
bun run lint:fix         # Auto-fix lint and format issues
bun run format           # Format code with Biome
bun run format:check     # Check formatting without changes
bun run test             # Run tests
bun run deploy           # Copy build to Obsidian vault
bun run validate         # Full validation (types, checks, build, output)
bun run version          # Sync package.json version → manifest.json + versions.json
```

## Architecture

### Build System

- **Build script**: `build.ts` uses Bun's native bundler
- **Entry point**: `src/main.ts`
- **Output**: `./main.js` (CommonJS format, minified in production)
- **Externals**: `obsidian` and `electron` are not bundled

### Plugin Structure

- `src/main.ts` — Plugin class, commands, protocol handler
- `src/parser.ts` — NLDParser wrapping chrono-node with custom rules
- `src/settings.ts` — Settings interface and settings tab UI
- `src/commands.ts` — Command handlers for date parsing and insertion
- `src/utils.ts` — Date formatting, daily note helpers, text utilities
- `src/suggest/date-suggest.ts` — EditorSuggest for inline date autocomplete
- `src/modals/date-picker.ts` — Interactive date picker modal

### Version Management

`version-bump.ts` syncs version from package.json to manifest.json and versions.json.

### Release Process

Tag and push to trigger the GitHub Actions release workflow:

```bash
git tag -a 0.7.0 -m "Release 0.7.0"
git push origin 0.7.0
```

## Code Style

Enforced by Biome (`biome.json`): 2-space indent, organized imports, git-aware VCS integration.

# Natural Language Dates for Obsidian Walkthrough

*2026-03-14T03:38:19Z by Showboat 0.6.1*
<!-- showboat-id: a1464ea1-d3a2-4a9f-9c37-65c1a0fbeba4 -->

## Overview

Natural Language Dates (nldates) is an Obsidian plugin that parses natural language date expressions — "tomorrow," "next week," "in 3 days" — and inserts formatted dates into notes. It provides commands, a date picker modal, and an inline autosuggest feature triggered by `@`.

**Key technologies:** TypeScript, Bun (build + test), chrono-node (NLP date parsing), moment.js (formatting), Obsidian Plugin API.

**Entry point:** `src/main.ts` — the `NaturalLanguageDates` plugin class.

**This project is archived. This is its final walkthrough.**

## Architecture

```bash
cat <<'TREE'
src/
  main.ts              Plugin class, commands, protocol handler
  parser.ts            chrono-node wrapper with custom parsers
  commands.ts          Command implementations (parse, insert date/time)
  settings.ts          Settings interface, defaults, settings tab UI
  utils.ts             Editor helpers, date formatting, ordinal parsing
  chrono-node.d.ts     Type declarations for chrono-node
  modals/
    date-picker.ts     Modal dialog for date input with preview
  suggest/
    date-suggest.ts    Inline autosuggest (EditorSuggest)
  test-preload.ts      Bun test mocks for obsidian modules
  utils.test.ts        Unit tests for pure utility functions
scripts/
  validate-plugin.ts   Pre-release validation script
build.ts               Bun bundler configuration
version-bump.ts        Syncs version across manifest/versions files
TREE
```

```output
src/
  main.ts              Plugin class, commands, protocol handler
  parser.ts            chrono-node wrapper with custom parsers
  commands.ts          Command implementations (parse, insert date/time)
  settings.ts          Settings interface, defaults, settings tab UI
  utils.ts             Editor helpers, date formatting, ordinal parsing
  chrono-node.d.ts     Type declarations for chrono-node
  modals/
    date-picker.ts     Modal dialog for date input with preview
  suggest/
    date-suggest.ts    Inline autosuggest (EditorSuggest)
  test-preload.ts      Bun test mocks for obsidian modules
  utils.test.ts        Unit tests for pure utility functions
scripts/
  validate-plugin.ts   Pre-release validation script
build.ts               Bun bundler configuration
version-bump.ts        Syncs version across manifest/versions files
```

**Data flow:** User types `@tomorrow` → `DateSuggest.onTrigger` detects the trigger phrase → `getDateSuggestions` builds completion list → user selects → `selectSuggestion` calls `plugin.parseDate` → `NLDParser.getParsedDate` delegates to chrono-node → formatted string inserted into editor.

## Build System

The build uses Bun's native bundler. Entry point is `src/main.ts`, output is `./main.js` in CommonJS format. `obsidian` and `electron` are externalized. Minification is enabled for production builds but disabled in watch mode.

```bash
cat build.ts
```

```output
const watch = process.argv.includes("--watch");

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: ".",
  format: "cjs",
  external: ["obsidian", "electron"],
  minify: !watch,
});

if (!result.success) {
  console.error("Build failed");
  for (const message of result.logs) console.error(message);
  process.exit(1);
}

if (watch) console.log("Watching for changes...");

export {};
```

## Plugin Entry Point — main.ts

The `NaturalLanguageDates` class extends Obsidian's `Plugin`. On load, it registers eight commands, a settings tab, a URL protocol handler (`obsidian://nldates`), and the inline date suggest. The parser is initialized lazily in `onLayoutReady` so the correct locale is available.

```bash
sed -n '14,93p' src/main.ts
```

```output
export default class NaturalLanguageDates extends Plugin {
  private parser!: NLDParser;
  public settings!: NLDSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "nlp-dates",
      name: "Parse natural language date",
      callback: () => getParseCommand(this, "replace"),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-dates-link",
      name: "Parse natural language date (as link)",
      callback: () => getParseCommand(this, "link"),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-date-clean",
      name: "Parse natural language date (as plain text)",
      callback: () => getParseCommand(this, "clean"),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-parse-time",
      name: "Parse natural language time",
      callback: () => getParseCommand(this, "time"),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-now",
      name: "Insert the current date and time",
      callback: () => getNowCommand(this),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-today",
      name: "Insert the current date",
      callback: () => getCurrentDateCommand(this),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-time",
      name: "Insert the current time",
      callback: () => getCurrentTimeCommand(this),
      hotkeys: [],
    });

    this.addCommand({
      id: "nlp-picker",
      name: "Date picker",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return !!this.app.workspace.getActiveViewOfType(MarkdownView);
        }
        new DatePickerModal(this.app, this).open();
      },
      hotkeys: [],
    });

    this.addSettingTab(new NLDSettingsTab(this.app, this));
    this.registerObsidianProtocolHandler(
      "nldates",
      this.actionHandler.bind(this),
    );
    this.registerEditorSuggest(new DateSuggest(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      // initialize the parser when layout is ready so that the correct locale is used
      this.parser = new NLDParser();
    });
  }
```

The plugin exposes two public parsing methods that other plugins or internal commands consume. `parse()` is the core method; `parseDate()` and `parseTime()` are convenience wrappers that apply the user's configured format strings.

```bash
sed -n '112,137p' src/main.ts
```

```output
  parse(dateString: string, format: string): NLDResult {
    const date = this.parser.getParsedDate(dateString, this.settings.weekStart);
    const formattedString = getFormattedDate(date, format);
    if (formattedString === "Invalid date") {
      console.debug(`Input date ${dateString} can't be parsed by nldates`);
    }

    return {
      formattedString,
      date,
      moment: window.moment(date),
    };
  }

  /*
    @param dateString: A string that contains a date in natural language, e.g. today, tomorrow, next week
    @returns NLDResult: An object containing the date, a cloned Moment and the formatted string.
  */
  parseDate(dateString: string): NLDResult {
    return this.parse(dateString, this.settings.format);
  }

  parseTime(dateString: string): NLDResult {
    return this.parse(dateString, this.settings.timeFormat);
  }

```

The protocol handler lets external tools open daily notes via `obsidian://nldates?day=tomorrow&newPane=yes`. It parses the natural language day parameter and opens (or creates) the corresponding daily note.

```bash
sed -n '138,151p' src/main.ts
```

```output
  async actionHandler(params: ObsidianProtocolData): Promise<void> {
    const { workspace } = this.app;

    const date = this.parseDate(params.day);
    const newPane = parseTruthy(params.newPane || "yes");

    if (date.moment.isValid()) {
      const dailyNote = await getOrCreateDailyNote(date.moment);
      if (dailyNote) {
        workspace.getLeaf(newPane).openFile(dailyNote);
      }
    }
  }
}
```

## Parser — parser.ts

`NLDParser` wraps chrono-node with locale awareness and custom parsers. It builds a `Chrono` instance configured for the user's locale (en-gb gets little-endian date parsing), then adds two custom parsers: one for "Christmas" and one for ordinal day references like "the twenty-first" or "15th."

```bash
sed -n '19,54p' src/parser.ts
```

```output
function getLocalizedChrono(): Chrono {
  const locale = window.moment.locale();

  switch (locale) {
    case "en-gb":
      return new Chrono(chrono.en.createCasualConfiguration(true));
    default:
      return new Chrono(chrono.en.createCasualConfiguration(false));
  }
}

function getConfiguredChrono(): Chrono {
  const localizedChrono = getLocalizedChrono();
  localizedChrono.parsers.push({
    pattern: () => {
      return /\bChristmas\b/i;
    },
    extract: () => {
      return {
        day: 25,
        month: 12,
      };
    },
  });

  localizedChrono.parsers.push({
    pattern: () => new RegExp(ORDINAL_NUMBER_PATTERN),
    extract: (_context, match) => {
      return {
        day: parseOrdinalNumberPattern(match[0]),
        month: window.moment().month(),
      };
    },
  } as Parser);
  return localizedChrono;
}
```

The `getParsedDate` method is the main parsing logic. It handles special cases — "this week," "next week/month/year," "last day of," and "mid" — before falling back to chrono-node's general parser. Week start preference is respected throughout.

```bash
sed -n '63,134p' src/parser.ts
```

```output
  getParsedDate(selectedText: string, weekStartPreference: DayOfWeek): Date {
    const parser = this.chrono;
    const initialParse = parser.parse(selectedText);
    const weekdayIsCertain = initialParse[0]?.start.isCertain("weekday");

    const weekStart =
      weekStartPreference === "locale-default"
        ? getLocaleWeekStart()
        : weekStartPreference;

    const locale = {
      weekStart: getWeekNumber(weekStart),
    };

    const thisDateMatch = selectedText.match(/this\s([\w]+)/i);
    const nextDateMatch = selectedText.match(/next\s([\w]+)/i);
    const lastDayOfMatch = selectedText.match(
      /(last day of|end of)\s*([^\n\r]*)/i,
    );
    const midOf = selectedText.match(/mid\s([\w]+)/i);

    const referenceDate = weekdayIsCertain
      ? window.moment().weekday(0).toDate()
      : new Date();

    if (thisDateMatch && thisDateMatch[1] === "week") {
      return parser.parseDate(`this ${weekStart}`, referenceDate);
    }

    if (nextDateMatch && nextDateMatch[1] === "week") {
      return parser.parseDate(`next ${weekStart}`, referenceDate, {
        forwardDate: true,
      });
    }

    if (nextDateMatch && nextDateMatch[1] === "month") {
      const thisMonth = parser.parseDate("this month", new Date(), {
        forwardDate: true,
      });
      return parser.parseDate(selectedText, thisMonth, {
        forwardDate: true,
      });
    }

    if (nextDateMatch && nextDateMatch[1] === "year") {
      const thisYear = parser.parseDate("this year", new Date(), {
        forwardDate: true,
      });
      return parser.parseDate(selectedText, thisYear, {
        forwardDate: true,
      });
    }

    if (lastDayOfMatch) {
      const tempDate = parser.parse(lastDayOfMatch[2]);
      const year = tempDate[0].start.get("year") ?? new Date().getFullYear();
      const month = tempDate[0].start.get("month") ?? new Date().getMonth() + 1;
      const lastDay = getLastDayOfMonth(year, month);

      return parser.parseDate(`${year}-${month}-${lastDay}`, new Date(), {
        forwardDate: true,
      });
    }

    if (midOf) {
      return parser.parseDate(`${midOf[1]} 15th`, new Date(), {
        forwardDate: true,
      });
    }

    return parser.parseDate(selectedText, referenceDate, { locale });
  }
```

## Commands — commands.ts

Four exported functions implement the plugin's commands. `getParseCommand` handles the four parse modes (replace with wikilink, markdown link, clean text, or time). `insertMomentCommand` is a shared helper for the "insert current date/time/now" commands.

```bash
sed -n '5,48p' src/commands.ts
```

```output
export function getParseCommand(
  plugin: NaturalLanguageDates,
  mode: string,
): void {
  const { workspace } = plugin.app;
  const activeView = workspace.getActiveViewOfType(MarkdownView);

  // The active view might not be a markdown view
  if (!activeView) {
    return;
  }

  const editor = activeView.editor;
  const cursor = editor.getCursor();
  const selectedText = getSelectedText(editor);

  const date = plugin.parseDate(selectedText);

  if (!date.moment.isValid()) {
    // Do nothing
    editor.setCursor({
      line: cursor.line,
      ch: cursor.ch,
    });
    return;
  }

  //mode == "replace"
  let newStr = `[[${date.formattedString}]]`;

  if (mode === "link") {
    newStr = `[${selectedText}](${date.formattedString})`;
  } else if (mode === "clean") {
    newStr = `${date.formattedString}`;
  } else if (mode === "time") {
    const time = plugin.parseTime(selectedText);

    newStr = `${time.formattedString}`;
  }

  editor.replaceSelection(newStr);
  adjustCursor(editor, cursor, newStr, selectedText);
  editor.focus();
}
```

```bash
sed -n '65,81p' src/commands.ts
```

```output
export function getNowCommand(plugin: NaturalLanguageDates): void {
  const format = `${plugin.settings.format}${plugin.settings.separator}${plugin.settings.timeFormat}`;
  const date = new Date();
  insertMomentCommand(plugin, date, format);
}

export function getCurrentDateCommand(plugin: NaturalLanguageDates): void {
  const format = plugin.settings.format;
  const date = new Date();
  insertMomentCommand(plugin, date, format);
}

export function getCurrentTimeCommand(plugin: NaturalLanguageDates): void {
  const format = plugin.settings.timeFormat;
  const date = new Date();
  insertMomentCommand(plugin, date, format);
}
```

## Settings — settings.ts

The `NLDSettings` interface defines all configurable options. Defaults use ISO date format (`YYYY-MM-DD`), 24-hour time (`HH:mm`), locale-default week start, and autosuggest enabled with `@` as the trigger.

```bash
sed -n '5,43p' src/settings.ts
```

```output
export type DayOfWeek =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "locale-default";

export interface NLDSettings {
  autosuggestToggleLink: boolean;
  autocompleteTriggerPhrase: string;
  isAutosuggestEnabled: boolean;

  format: string;
  timeFormat: string;
  separator: string;
  weekStart: DayOfWeek;

  modalToggleTime: boolean;
  modalToggleLink: boolean;
  modalMomentFormat: string;
}

export const DEFAULT_SETTINGS: NLDSettings = {
  autosuggestToggleLink: true,
  autocompleteTriggerPhrase: "@",
  isAutosuggestEnabled: true,

  format: "YYYY-MM-DD",
  timeFormat: "HH:mm",
  separator: " ",
  weekStart: "locale-default",

  modalToggleTime: false,
  modalToggleLink: false,
  modalMomentFormat: "YYYY-MM-DD HH:mm",
};
```

## Date Autosuggest — suggest/date-suggest.ts

`DateSuggest` extends Obsidian's `EditorSuggest` to provide inline completions. The trigger is the configured phrase (default `@`). It generates contextual suggestions based on the query: time-prefixed queries get time offsets, "next/last/this" queries get weekday/period completions, numeric queries get relative date options, and the fallback is Today/Yesterday/Tomorrow.

```bash
sed -n '39,95p' src/suggest/date-suggest.ts
```

```output
  getSuggestions(context: EditorSuggestContext): IDateCompletion[] {
    const suggestions = this.getDateSuggestions(context);
    if (suggestions.length) {
      return suggestions;
    }

    // catch-all if there are no matches
    return [{ label: context.query }];
  }

  getDateSuggestions(context: EditorSuggestContext): IDateCompletion[] {
    if (context.query.match(/^time/)) {
      return ["now", "+15 minutes", "+1 hour", "-15 minutes", "-1 hour"]
        .map((val) => ({ label: `time:${val}` }))
        .filter((item) => item.label.toLowerCase().startsWith(context.query));
    }
    if (context.query.match(/(next|last|this)/i)) {
      const reference = context.query.match(/(next|last|this)/i)?.[1];
      return [
        "week",
        "month",
        "year",
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ]
        .map((val) => ({ label: `${reference} ${val}` }))
        .filter((items) => items.label.toLowerCase().startsWith(context.query));
    }

    const relativeDate =
      context.query.match(/^in ([+-]?\d+)/i) ||
      context.query.match(/^([+-]?\d+)/i);
    if (relativeDate) {
      const timeDelta = relativeDate[1];
      return [
        { label: `in ${timeDelta} minutes` },
        { label: `in ${timeDelta} hours` },
        { label: `in ${timeDelta} days` },
        { label: `in ${timeDelta} weeks` },
        { label: `in ${timeDelta} months` },
        { label: `${timeDelta} days ago` },
        { label: `${timeDelta} weeks ago` },
        { label: `${timeDelta} months ago` },
      ].filter((items) => items.label.toLowerCase().startsWith(context.query));
    }

    return [
      { label: "Today" },
      { label: "Yesterday" },
      { label: "Tomorrow" },
    ].filter((items) => items.label.toLowerCase().startsWith(context.query));
  }
```

The `onTrigger` method controls when the suggest menu appears. It checks the trigger phrase is at the start of the typed sequence and is not mid-word (not preceded by an alphanumeric character or backtick — avoiding false triggers in email addresses and inline code).

```bash
sed -n '131,168p' src/suggest/date-suggest.ts
```

```output
  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile,
  ): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.isAutosuggestEnabled) {
      return null;
    }

    const triggerPhrase = this.plugin.settings.autocompleteTriggerPhrase;
    const startPos = this.context?.start || {
      line: cursor.line,
      ch: cursor.ch - triggerPhrase.length,
    };

    if (!editor.getRange(startPos, cursor).startsWith(triggerPhrase)) {
      return null;
    }

    const precedingChar = editor.getRange(
      {
        line: startPos.line,
        ch: startPos.ch - 1,
      },
      startPos,
    );

    // Short-circuit if `@` as a part of a word (e.g. part of an email address)
    if (precedingChar && /[`a-zA-Z0-9]/.test(precedingChar)) {
      return null;
    }

    return {
      start: startPos,
      end: cursor,
      query: editor.getRange(startPos, cursor).substring(triggerPhrase.length),
    };
  }
```

## Date Picker Modal — modals/date-picker.ts

The modal provides a form-based date input with live preview. Users type a natural language date, choose a moment format, and toggle link wrapping. The preview updates on every keystroke. Appending `|` to the input triggers alias mode (e.g., `[[2026-01-15|next Thursday]]`).

```bash
sed -n '13,43p' src/modals/date-picker.ts
```

```output
  onOpen(): void {
    let previewEl: HTMLElement;

    let dateInput = "";
    let momentFormat = this.plugin.settings.modalMomentFormat;
    let insertAsLink = this.plugin.settings.modalToggleLink;

    const getDateStr = () => {
      let cleanDateInput = dateInput;
      let shouldIncludeAlias = false;

      if (dateInput.endsWith("|")) {
        shouldIncludeAlias = true;
        cleanDateInput = dateInput.slice(0, -1);
      }

      const parsedDate = this.plugin.parseDate(cleanDateInput || "today");
      let parsedDateString = parsedDate.moment.isValid()
        ? parsedDate.moment.format(momentFormat)
        : "";

      if (insertAsLink) {
        parsedDateString = generateMarkdownLink(
          this.app,
          parsedDateString,
          shouldIncludeAlias ? cleanDateInput : undefined,
        );
      }

      return parsedDateString;
    };
```

## Utilities — utils.ts

The utils module contains editor helpers, date formatting, ordinal parsing, markdown link generation, and daily note integration. Notable pieces:

- `getWordBoundaries` accesses the internal CodeMirror API to find word boundaries at the cursor
- `generateMarkdownLink` respects the user's vault preference for wikilinks vs markdown links
- `getOrCreateDailyNote` bridges to the `obsidian-daily-notes-interface` library
- Ordinal parsing supports both words ("twenty-first") and numeric suffixes ("21st") for all 31 days

```bash
sed -n '28,67p' src/utils.ts
```

```output
export default function getWordBoundaries(editor: Editor): EditorRange {
  const cursor = editor.getCursor();

  const pos = editor.posToOffset(cursor);
  // biome-ignore lint/suspicious/noExplicitAny: accessing internal CodeMirror API
  const word = (editor as any).cm.state.wordAt(pos);
  const wordStart = editor.offsetToPos(word.from);
  const wordEnd = editor.offsetToPos(word.to);
  return {
    from: wordStart,
    to: wordEnd,
  };
}

export function getSelectedText(editor: Editor): string {
  if (editor.somethingSelected()) {
    return editor.getSelection();
  } else {
    const wordBoundaries = getWordBoundaries(editor);
    editor.setSelection(wordBoundaries.from, wordBoundaries.to); // TODO check if this needs to be updated/improved
    return editor.getSelection();
  }
}

export function adjustCursor(
  editor: Editor,
  cursor: EditorPosition,
  newStr: string,
  oldStr: string,
): void {
  const cursorOffset = newStr.length - oldStr.length;
  editor.setCursor({
    line: cursor.line,
    ch: cursor.ch + cursorOffset,
  });
}

export function getFormattedDate(date: Date, format: string): string {
  return window.moment(date).format(format);
}
```

```bash
sed -n '89,111p' src/utils.ts
```

```output
export function generateMarkdownLink(
  app: App,
  subpath: string,
  alias?: string,
) {
  // biome-ignore lint/suspicious/noExplicitAny: accessing undocumented Obsidian vault API
  const useMarkdownLinks = (app.vault as any).getConfig("useMarkdownLinks");
  const path = normalizePath(subpath);

  if (useMarkdownLinks) {
    if (alias) {
      return `[${alias}](${path.replace(/ /g, "%20")})`;
    } else {
      return `[${subpath}](${path})`;
    }
  } else {
    if (alias) {
      return `[[${path}|${alias}]]`;
    } else {
      return `[[${path}]]`;
    }
  }
}
```

## Testing

Tests use Bun's test runner with a preload file that mocks the `obsidian` and `obsidian-daily-notes-interface` modules. Only pure utility functions are tested — the Obsidian-dependent code is not unit-testable outside the app.

```bash
cat src/test-preload.ts
```

```output
import { mock } from "bun:test";

mock.module("obsidian", () => ({
  Plugin: class Plugin {},
  Notice: class Notice {},
  PluginSettingTab: class PluginSettingTab {},
  Setting: class Setting {},
  normalizePath: (path: string) => path,
}));

mock.module("obsidian-daily-notes-interface", () => ({
  createDailyNote: () => {},
  getAllDailyNotes: () => ({}),
  getDailyNote: () => null,
}));
```

```bash
bun test 2>&1 | sed 's/\[[0-9.]*ms\]/[Nms]/'
```

```output
bun test v1.3.5 (1e86cebd)

 15 pass
 0 fail
 37 expect() calls
Ran 15 tests across 1 file. [Nms]
```

## Version Management

`version-bump.ts` keeps `manifest.json` and `versions.json` in sync with `package.json`. The `versions.json` file maps plugin versions to minimum Obsidian app versions, used by Obsidian's update checker.

```bash
cat version-bump.ts
```

```output
import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error("No version found in package.json");
}

// Update manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// Update versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Updated to version ${targetVersion}`);
```

## Dependencies

Two runtime dependencies:

- **chrono-node** (forked at `liamcain/chrono`) — natural language date parsing engine
- **obsidian-daily-notes-interface** — standardized access to Obsidian daily notes

Dev dependencies: Biome (linting/formatting), Bun types, Node types, Obsidian API types, TypeScript.

```bash
sed -n '23,36p' package.json
```

```output
  "dependencies": {
    "chrono-node": "github:liamcain/chrono",
    "obsidian-daily-notes-interface": "0.9.4"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.7",
    "@types/bun": "^1.3.10",
    "@types/node": "^25.5.0",
    "obsidian": "^1.12.3",
    "typescript": "^5.9.3"
  },
  "trustedDependencies": [
    "chrono-node"
  ]
```

## Concerns

1. **chrono-node fork dependency.** The `chrono-node` dependency points to `github:liamcain/chrono`, a fork. This fork is unmaintained and diverges from upstream chrono-node. The custom type declarations in `src/chrono-node.d.ts` paper over type mismatches.

2. **Internal API access.** Two `biome-ignore` suppressions mark deliberate use of undocumented APIs: `editor.cm.state.wordAt()` in `getWordBoundaries` (CodeMirror internals) and `app.vault.getConfig("useMarkdownLinks")` in `generateMarkdownLink`. Both are fragile across Obsidian updates.

3. **No error handling in `getParsedDate`.** If chrono-node returns `null` from `parseDate`, the result propagates as `null` through `getFormattedDate` → `moment(null)`, producing "Invalid date." The invalid state is logged but not surfaced to the user.

4. **`getSelectedText` side effect.** When nothing is selected, it calls `editor.setSelection()` to select the word at cursor — a mutation during what reads like a getter. The inline TODO acknowledges this.

5. **Test coverage limited to pure functions.** Only `utils.test.ts` exists. The parser, commands, modal, and suggest modules have no tests. The Obsidian runtime dependency makes them hard to test, but the parser could be tested with `window.moment` mocked.

6. **`modalToggleTime` setting is defined but never used.** It appears in `NLDSettings` and `DEFAULT_SETTINGS` but no code reads it.


# Natural Language Dates — Code Walkthrough

*2026-03-11T22:17:20Z by Showboat 0.6.1*
<!-- showboat-id: 2b315c74-50e0-4234-b87c-655f5f4ab907 -->

## Overview

An Obsidian plugin that parses natural language into dates. Users type phrases
like "next friday" or "in 3 days" and get formatted date strings, wikilinks, or
daily notes. The plugin has four user-facing surfaces: commands, a date picker
modal, an editor autosuggest, and a URI protocol handler.

## File Structure

```bash
find src -name "*.ts" | sort && echo "---" && echo "build.ts" && echo "version-bump.ts" && echo "scripts/validate-plugin.ts"
```

```output
src/chrono-node.d.ts
src/commands.ts
src/main.ts
src/modals/date-picker.ts
src/parser.ts
src/settings.ts
src/suggest/date-suggest.ts
src/test-preload.ts
src/utils.test.ts
src/utils.ts
---
build.ts
version-bump.ts
scripts/validate-plugin.ts
```

**Source files** (under `src/`):

| File | Purpose |
|------|---------|
| `main.ts` | Plugin entry point — lifecycle, commands, API |
| `parser.ts` | Wraps chrono-node with locale and custom parsers |
| `settings.ts` | Settings interface, defaults, and settings tab UI |
| `commands.ts` | Command implementations for parse/insert operations |
| `utils.ts` | Shared helpers: formatting, links, ordinals, daily notes |
| `utils.test.ts` | Unit tests for pure utility functions |
| `modals/date-picker.ts` | Date picker modal dialog |
| `suggest/date-suggest.ts` | Editor autosuggest provider |
| `chrono-node.d.ts` | Type declarations for the chrono-node fork |
| `test-preload.ts` | Bun test preload — mocks Obsidian and daily-notes APIs |

**Build scripts** (project root):

| File | Purpose |
|------|---------|
| `build.ts` | Bun bundler config (CJS output, externals) |
| `version-bump.ts` | Syncs version across manifest.json and versions.json |
| `scripts/validate-plugin.ts` | Pre-release validation checks |

## Entry Point: `src/main.ts`

The `NaturalLanguageDates` class extends Obsidian's `Plugin`. On load it:
1. Loads settings from disk
2. Registers 8 commands (parse date, parse time, insert current date/time, date picker)
3. Adds a settings tab
4. Registers the `obsidian://nldates` protocol handler
5. Registers the editor autosuggest
6. Defers parser initialization to `onLayoutReady` so locale is available

```bash
sed -n "14,93p" src/main.ts
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

The plugin exposes two public API methods — `parseDate()` and `parseTime()` — that
other plugins can call via `app.plugins.getPlugin("nldates")`.

```bash
sed -n "107,151p" src/main.ts
```

```output
  /*
    @param dateString: A string that contains a date in natural language, e.g. today, tomorrow, next week
    @param format: A string that contains the formatting string for a Moment
    @returns NLDResult: An object containing the date, a cloned Moment and the formatted string.
  */
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

The `actionHandler` responds to `obsidian://nldates?day=tomorrow&newPane=yes` URIs —
it parses the `day` parameter, resolves or creates the daily note, and opens it.

## Parser: `src/parser.ts`

The parser wraps [chrono-node](https://github.com/wanasit/chrono) (via a
[liamcain fork](https://github.com/liamcain/chrono) that adds Obsidian-friendly tweaks).
On construction it builds a locale-aware `Chrono` instance with two custom parsers:

1. **Christmas** — matches "Christmas" and returns December 25
2. **Ordinal numbers** — matches "first", "twenty-third", "15th", etc. and returns
   the day number for the current month

```bash
sed -n "19,54p" src/parser.ts
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

`getParsedDate` is the core dispatch. It handles several special-case patterns
before falling through to chrono's general parser:

| Pattern | Behavior |
|---------|----------|
| `this week` | Resolves to the configured week-start day |
| `next week` | Forward-dates from the week-start day |
| `next month` / `next year` | Advances the reference date first, then re-parses |
| `last day of` / `end of` | Calculates the actual last day of the target month |
| `mid <month>` | Returns the 15th of the named month |
| Everything else | Passes through to chrono with locale week-start config |

The week-start preference is either a specific day or `"locale-default"`, which
reads from `moment.localeData()._week.dow`.

```bash
sed -n "63,134p" src/parser.ts
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

## Commands: `src/commands.ts`

Four exported functions handle text insertion:

- **`getParseCommand`** — reads selected text (or word at cursor), parses it,
  and replaces with the result. The `mode` parameter controls output format:
  `"replace"` → `[[date]]`, `"link"` → `[text](date)`, `"clean"` → plain text,
  `"time"` → time only
- **`insertMomentCommand`** — formats a Date with a Moment format string and
  inserts at cursor
- **`getNowCommand`** — inserts current date+time
- **`getCurrentDateCommand`** / **`getCurrentTimeCommand`** — inserts just date or time

```bash
sed -n "5,48p" src/commands.ts
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

## Settings: `src/settings.ts`

The `NLDSettings` interface defines all persisted preferences:

```bash
sed -n "15,43p" src/settings.ts
```

```output
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

The `NLDSettingsTab` renders the settings UI with three sections:
1. **Parser settings** — date format, week start day
2. **Hotkey formatting** — time format, separator between date and time
3. **Date autosuggest** — enable/disable, wikilink toggle, trigger phrase

Note: `modalToggleTime` is defined in `NLDSettings` and carried in `DEFAULT_SETTINGS`
but is never exposed in the settings tab UI — it's a dead setting.

## Utilities: `src/utils.ts`

A collection of pure helpers and Obsidian integration functions.

```bash
grep -n "^export" src/utils.ts
```

```output
28:export default function getWordBoundaries(editor: Editor): EditorRange {
42:export function getSelectedText(editor: Editor): string {
52:export function adjustCursor(
65:export function getFormattedDate(date: Date, format: string): string {
69:export function getLastDayOfMonth(year: number, month: number) {
73:export function parseTruthy(flag: string): boolean {
77:export function getWeekNumber(
83:export function getLocaleWeekStart(): Omit<DayOfWeek, "locale-default"> {
89:export function generateMarkdownLink(
113:export async function getOrCreateDailyNote(
198:export const ORDINAL_NUMBER_PATTERN = `(?:${matchAnyPattern(
202:export function parseOrdinalNumberPattern(match: string): number {
```

Key functions:

- **`getWordBoundaries`** — uses CodeMirror's internal `wordAt` API to find the
  word under the cursor. This is the only place the code reaches into CM internals
  (suppressed with a biome-ignore for the `any` cast).
- **`getSelectedText`** — returns the selection, or auto-selects the word at cursor
- **`generateMarkdownLink`** — respects the user's vault preference for wikilinks
  vs markdown links, including alias support. Reads the undocumented
  `vault.getConfig("useMarkdownLinks")` API.
- **`getOrCreateDailyNote`** — delegates to `obsidian-daily-notes-interface` for
  daily note resolution and creation
- **`ORDINAL_NUMBER_PATTERN`** and **`parseOrdinalNumberPattern`** — adapted from
  chrono's source to handle "first" through "thirty-first" plus numeric ordinals
  like "15th"

```bash
sed -n "28,50p" src/utils.ts
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
```

```bash
sed -n "89,111p" src/utils.ts
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

## Date Picker Modal: `src/modals/date-picker.ts`

A modal dialog with three fields: a natural language date input, a Moment format
override, and a link toggle. The date input live-previews the parsed result in
the setting description. Typing a trailing `|` enables alias mode (inserts
`[[date|alias]]`).

```bash
sed -n "13,59p" src/modals/date-picker.ts
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

    this.contentEl.createEl("form", {}, (formEl) => {
      const dateInputEl = new Setting(formEl)
        .setName("Date")
        .setDesc(getDateStr())
        .addText((textEl) => {
          textEl.setPlaceholder("Today");

          textEl.onChange((value) => {
            dateInput = value;
            previewEl.setText(getDateStr());
          });

          window.setTimeout(() => textEl.inputEl.focus(), 10);
        });
      previewEl = dateInputEl.descEl;
```

## Editor Autosuggest: `src/suggest/date-suggest.ts`

`DateSuggest` extends Obsidian's `EditorSuggest` to provide inline date
completion. It activates when the user types the trigger phrase (default `@`)
at the start of a word.

```bash
sed -n "131,168p" src/suggest/date-suggest.ts
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

The suggestion engine provides context-sensitive completions:

- **`time:` prefix** — offers time presets (now, +15 minutes, etc.)
- **`next/last/this` prefix** — offers week/month/year/weekday completions
- **Numeric prefix** — offers relative date suggestions ("in N days", "N weeks ago")
- **Default** — Today, Yesterday, Tomorrow

On selection, the trigger phrase and query are replaced with the formatted date.
Shift+Enter preserves the original text as an alias in the wikilink.

```bash
sed -n "49,95p" src/suggest/date-suggest.ts
```

```output
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

## Type Declarations: `src/chrono-node.d.ts`

Hand-written type declarations for the chrono-node fork, which ships without
its own types. Declares `Chrono`, `Parser`, `ParsedComponents`, `ParsedResult`,
and the `en` configuration namespace.

```bash
cat src/chrono-node.d.ts
```

```output
declare module "chrono-node" {
  interface ParsedComponents {
    get(component: string): number | undefined;
    isCertain(component: string): boolean;
  }

  interface ParsedResult {
    start: ParsedComponents;
    end?: ParsedComponents;
  }

  interface ParsingOption {
    forwardDate?: boolean;
    locale?: { weekStart?: number };
  }

  interface Parser {
    pattern: () => RegExp;
    extract: (
      context: unknown,
      match: RegExpMatchArray,
    ) => Record<string, unknown>;
  }

  class Chrono {
    constructor(configuration?: unknown);
    parsers: Parser[];
    parse(
      text: string,
      referenceDate?: Date,
      option?: ParsingOption,
    ): ParsedResult[];
    parseDate(text: string, referenceDate?: Date, option?: ParsingOption): Date;
  }

  const en: {
    createCasualConfiguration(littleEndian?: boolean): unknown;
  };

  export default { en };
  export { Chrono, Parser };
}
```

## Testing: `src/utils.test.ts` and `src/test-preload.ts`

Tests use Bun's test runner with a preload script that mocks `obsidian` and
`obsidian-daily-notes-interface`. Only the pure utility functions are tested:

```bash
grep -c "test(" src/utils.test.ts
```

```output
15
```

```bash
grep "describe\|test(" src/utils.test.ts
```

```output
import { describe, expect, test } from "bun:test";
describe("getLastDayOfMonth", () => {
  test("returns 31 for January", () => {
  test("returns 28 for February in a non-leap year", () => {
  test("returns 29 for February in a leap year", () => {
  test("returns 30 for April", () => {
  test("returns 31 for December", () => {
describe("parseTruthy", () => {
  test("returns true for truthy strings", () => {
  test("is case insensitive", () => {
  test("returns false for falsy strings", () => {
describe("getWeekNumber", () => {
  test("returns 0 for sunday", () => {
  test("returns 1 for monday", () => {
  test("returns 6 for saturday", () => {
describe("parseOrdinalNumberPattern", () => {
  test("parses ordinal words", () => {
  test("parses numeric ordinals", () => {
  test("parses plain numbers", () => {
  test("is case insensitive", () => {
```

15 tests across 4 suites covering `getLastDayOfMonth`, `parseTruthy`,
`getWeekNumber`, and `parseOrdinalNumberPattern`. No tests for the parser,
commands, modal, or autosuggest — those depend on Obsidian runtime APIs.

The preload mock is minimal:

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

## Build System: `build.ts`

Uses Bun's native bundler. Produces a single `main.js` in CommonJS format
(required by Obsidian's plugin loader). `obsidian` and `electron` are externalized.
Minification is disabled in watch mode.

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

## Version Management: `version-bump.ts`

Reads the version from `package.json` (via `npm_package_version` env), then
updates both `manifest.json` and `versions.json` to match. Run via
`bun run version` which sets the env automatically.

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

## Validation: `scripts/validate-plugin.ts`

Pre-release validation that checks manifest fields, version consistency between
`package.json` and `manifest.json`, runs `bun run check`, and does a production build.

## Concerns

### Code quality issues

1. **`mode` parameter is a stringly-typed union** (`commands.ts:7`). The `mode`
   parameter to `getParseCommand` is `string` but only accepts `"replace"`,
   `"link"`, `"clean"`, or `"time"`. Should be a string literal union type.

2. **`getWordBoundaries` crashes on empty lines** (`utils.ts:33`). If the cursor
   is on an empty line or whitespace, `wordAt(pos)` returns `null`, causing a
   `Cannot read properties of null` error. No null check.

3. **`getSelectedText` has a side effect** (`utils.ts:47`). When nothing is
   selected, it silently selects the word at cursor. The TODO comment acknowledges
   this: `// TODO check if this needs to be updated/improved`.

4. **Ordinal parser claims current month unconditionally** (`parser.ts:49`).
   Typing "the fifteenth" always resolves to the current month. Combined with a
   month name ("March fifteenth") chrono handles it, but bare ordinals may
   surprise users late in the month.

5. **`modalToggleTime` is a dead setting** (`settings.ts:25`). Defined in the
   interface, initialized in defaults, persisted to disk, but never read or
   written anywhere in the codebase.

6. **Duplicate weekday arrays** — `daysOfWeek` in `utils.ts:18` and `weekdays`
   in `settings.ts:45` are identical arrays serving different purposes. One
   shared constant would suffice.

### Dependency concerns

7. **`obsidian-daily-notes-interface`** is unmaintained (last commit 2021). It
   works, but is a risk for future Obsidian API changes. This is tracked as
   GitHub issue #19.

8. **`chrono-node` fork** — the `liamcain/chrono` fork may drift from upstream.
   The hand-written type declarations (`chrono-node.d.ts`) cover only the
   subset of the API actually used, which is fine, but they'll need manual
   updates if the fork changes.

### Missing test coverage

9. **No parser tests** — the most complex module (`parser.ts`) has zero test
   coverage. The special-case matching for "this week", "next month", "last day
   of", and "mid" would benefit from regression tests.

10. **No autosuggest tests** — the suggestion filtering logic in
    `date-suggest.ts` is pure enough to test but isn't covered.


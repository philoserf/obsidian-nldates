# Natural Language Dates — Code Walkthrough

*2026-03-11T19:40:26Z by Showboat 0.6.1*
<!-- showboat-id: 479821ca-5e3d-4215-ae57-a5c3c39fa548 -->

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
src/utils.ts
---
build.ts
version-bump.ts
scripts/validate-plugin.ts
```

## Entry Point: `src/main.ts`

The `NaturalLanguageDates` class extends Obsidian's `Plugin`. On load it:
1. Loads settings from disk
2. Registers 8 commands (parse date, parse time, insert current date/time, date picker)
3. Adds a settings tab
4. Registers the `obsidian://nldates` protocol handler
5. Registers the editor autosuggest
6. Defers parser initialization to `onLayoutReady` so locale is available

The plugin exposes two public API methods — `parseDate()` and `parseTime()` — that
other plugins can call via `app.plugins.getPlugin("obsidian-nldates")`.

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

The `parse()` method is the core: it takes a date string and a moment format,
runs it through the chrono-based parser, and returns an `NLDResult` with the
formatted string, raw `Date`, and a cloned `Moment`.

```bash
sed -n "112,136p" src/main.ts
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

## Parser: `src/parser.ts`

The parser wraps [chrono-node](https://github.com/wanasit/chrono) with locale
awareness and custom rules. `getLocalizedChrono()` picks `en-gb` (day-first) vs
default (month-first) based on `window.moment.locale()`. Two custom parsers are
injected: one for "Christmas" and one for ordinal day numbers ("1st", "twenty-third").

`getParsedDate()` handles several special cases that chrono doesn't natively
support: "this week", "next week" (respecting configured week start), "next month",
"next year", "last day of / end of [month]", and "mid [month]".

```bash
sed -n "56,135p" src/parser.ts
```

```output
export default class NLDParser {
  chrono: Chrono;

  constructor() {
    this.chrono = getConfiguredChrono();
  }

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
}
```

## Commands: `src/commands.ts`

Four exported functions handle command execution:

- `getParseCommand` — the main parse command with four modes: `replace` (wikilink),
  `link` (markdown link), `clean` (plain text), `time` (time only)
- `getNowCommand` — inserts current date+time using the configured separator
- `getCurrentDateCommand` — inserts current date
- `getCurrentTimeCommand` — inserts current time

All commands operate on the active `MarkdownView` editor. `getParseCommand` uses
`getSelectedText()` which either takes the selection or auto-selects the word
at the cursor.

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

## Autosuggest: `src/suggest/date-suggest.ts`

`DateSuggest` extends Obsidian's `EditorSuggest` to provide inline completions.
It activates when the user types the trigger phrase (default `@`) and offers
context-aware suggestions:

- `time:` prefix → time suggestions (now, ±15min, ±1h)
- `next/last/this` → weekdays + week/month/year
- Numeric input → relative date suggestions (in N days, N weeks ago, etc.)
- Default fallback → Today, Yesterday, Tomorrow

Shift+Enter keeps the original text as an alias in the wikilink.

The `onTrigger` method includes a guard against triggering inside email addresses
or backtick-quoted text.

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

## Date Picker Modal: `src/modals/date-picker.ts`

A modal dialog with a text input, format override, and link toggle. The modal
parses the input in real-time and shows a preview. On submit it inserts the
formatted date at the cursor in the active editor.

The modal persists format and link preferences back to settings on change,
so the user's choices carry over between invocations.

```bash
sed -n "5,43p" src/modals/date-picker.ts
```

```output
export default class DatePickerModal extends Modal {
  plugin: NaturalLanguageDates;

  constructor(app: App, plugin: NaturalLanguageDates) {
    super(app);
    this.plugin = plugin;
  }

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

## Settings: `src/settings.ts`

The `NLDSettings` interface defines all configurable options:

- **Parser**: date format, week start day
- **Hotkeys**: time format, date+time separator
- **Autosuggest**: enable/disable, trigger phrase, insert as link
- **Modal**: time toggle, link toggle, moment format

The settings tab UI uses Obsidian's `Setting` API with `addMomentFormat`,
`addDropdown`, `addText`, and `addToggle` components. Week start defaults to
the locale setting.

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

## Utilities: `src/utils.ts`

A collection of helpers:

- `getWordBoundaries` — uses CodeMirror's internal `wordAt` API to find the word
  at the cursor (note the `any` cast to access the CM state)
- `getSelectedText` — returns selection or auto-selects the word at cursor
- `adjustCursor` — repositions cursor after text replacement
- `getFormattedDate` — thin wrapper around `moment.format()`
- `getLastDayOfMonth` — uses `new Date(year, month, 0)` trick
- `parseTruthy` — loose boolean parsing for URI params
- `getWeekNumber` / `getLocaleWeekStart` — week start day utilities
- `generateMarkdownLink` — respects Obsidian's `useMarkdownLinks` vault config
- `getOrCreateDailyNote` — delegates to `obsidian-daily-notes-interface`
- Ordinal number parsing — ported from chrono's source for custom parser support

```bash
sed -n "28,67p" src/utils.ts
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

## Type Declarations: `src/chrono-node.d.ts`

Hand-written type declarations for the chrono-node package, which ships without
types. Covers `ParsedComponents`, `ParsedResult`, `ParsingOption`, `Parser`,
and `Chrono` — just enough surface area for what the plugin uses.

## Build System

`build.ts` uses Bun's native bundler. Entry point is `src/main.ts`, output is
`main.js` in CommonJS format (Obsidian requires CJS). `obsidian` and `electron`
are marked external. Minification is on for production, off in watch mode.

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

## Concerns

### Private API usage

Two places reach into undocumented Obsidian/CodeMirror internals:

- `src/utils.ts:33` — `(editor as any).cm.state.wordAt(pos)` accesses the
  CodeMirror 6 state directly. This could break on any Obsidian update that
  changes the editor internals. No null guard if `wordAt` returns undefined.
- `src/utils.ts:85` — `window.moment.localeData()._week.dow` accesses a
  private moment.js property with a `@ts-expect-error` suppression.
- `src/utils.ts:95` — `(app.vault as any).getConfig("useMarkdownLinks")`
  accesses an undocumented vault API.

### Missing null guards

- `getWordBoundaries` will throw if the cursor is at a position where
  `wordAt()` returns null/undefined (e.g. empty line, whitespace).
- `getParsedDate` accesses `initialParse[0]?.start` safely but the
  `lastDayOfMatch` branch accesses `tempDate[0].start` without optional
  chaining — will throw if chrono can't parse the month name.

### Stale TODO

- `src/utils.ts:47` has an unresolved TODO comment about whether
  `setSelection` in `getSelectedText` needs updating.

### `modalToggleTime` setting is declared but never used

The `NLDSettings` interface includes `modalToggleTime` and it has a default
value, but neither the settings tab nor the modal references it.

### chrono-node dependency

The plugin depends on `chrono-node` via a GitHub fork (`liamcain/chrono`),
not the canonical npm package. This fork may drift from upstream. It's also
listed in `trustedDependencies` since it has install scripts.

### No tests

The test preload is scaffolded but no test files exist yet. The parser logic
(especially the special-case matching in `getParsedDate`) would benefit from
unit tests.


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

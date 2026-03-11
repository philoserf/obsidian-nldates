import { describe, expect, test } from "bun:test";
import {
  getLastDayOfMonth,
  getWeekNumber,
  parseOrdinalNumberPattern,
  parseTruthy,
} from "./utils";

describe("getLastDayOfMonth", () => {
  test("returns 31 for January", () => {
    expect(getLastDayOfMonth(2026, 1)).toBe(31);
  });

  test("returns 28 for February in a non-leap year", () => {
    expect(getLastDayOfMonth(2025, 2)).toBe(28);
  });

  test("returns 29 for February in a leap year", () => {
    expect(getLastDayOfMonth(2024, 2)).toBe(29);
  });

  test("returns 30 for April", () => {
    expect(getLastDayOfMonth(2026, 4)).toBe(30);
  });

  test("returns 31 for December", () => {
    expect(getLastDayOfMonth(2026, 12)).toBe(31);
  });
});

describe("parseTruthy", () => {
  test("returns true for truthy strings", () => {
    for (const value of ["y", "yes", "1", "t", "true"]) {
      expect(parseTruthy(value)).toBe(true);
    }
  });

  test("is case insensitive", () => {
    for (const value of ["Y", "YES", "Yes", "T", "TRUE", "True"]) {
      expect(parseTruthy(value)).toBe(true);
    }
  });

  test("returns false for falsy strings", () => {
    for (const value of ["n", "no", "0", "f", "false", "other"]) {
      expect(parseTruthy(value)).toBe(false);
    }
  });
});

describe("getWeekNumber", () => {
  test("returns 0 for sunday", () => {
    expect(getWeekNumber("sunday")).toBe(0);
  });

  test("returns 1 for monday", () => {
    expect(getWeekNumber("monday")).toBe(1);
  });

  test("returns 6 for saturday", () => {
    expect(getWeekNumber("saturday")).toBe(6);
  });
});

describe("parseOrdinalNumberPattern", () => {
  test("parses ordinal words", () => {
    expect(parseOrdinalNumberPattern("first")).toBe(1);
    expect(parseOrdinalNumberPattern("tenth")).toBe(10);
    expect(parseOrdinalNumberPattern("twenty-first")).toBe(21);
    expect(parseOrdinalNumberPattern("thirty-first")).toBe(31);
  });

  test("parses numeric ordinals", () => {
    expect(parseOrdinalNumberPattern("1st")).toBe(1);
    expect(parseOrdinalNumberPattern("2nd")).toBe(2);
    expect(parseOrdinalNumberPattern("3rd")).toBe(3);
    expect(parseOrdinalNumberPattern("15th")).toBe(15);
  });

  test("parses plain numbers", () => {
    expect(parseOrdinalNumberPattern("7")).toBe(7);
    expect(parseOrdinalNumberPattern("25")).toBe(25);
  });

  test("is case insensitive", () => {
    expect(parseOrdinalNumberPattern("First")).toBe(1);
    expect(parseOrdinalNumberPattern("THIRD")).toBe(3);
  });
});

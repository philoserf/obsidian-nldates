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

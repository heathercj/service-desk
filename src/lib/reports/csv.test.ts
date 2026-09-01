import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("renders a header row and one row per record, in column order", () => {
    const csv = toCsv(
      [
        { name: "Alex Agent", count: 3 },
        { name: "Priya Accounting-Agent", count: 5 },
      ],
      [
        { key: "name", header: "Agent" },
        { key: "count", header: "Tickets" },
      ],
    );
    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("Agent,Tickets");
    expect(lines[1]).toBe("Alex Agent,3");
    expect(lines[2]).toBe("Priya Accounting-Agent,5");
  });

  it("prefixes the file with a UTF-8 BOM so Excel opens it cleanly", () => {
    const csv = toCsv([{ a: "x" }], [{ key: "a", header: "A" }]);
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("quotes a field containing a comma", () => {
    const csv = toCsv(
      [{ note: "urgent, please review" }],
      [{ key: "note", header: "Note" }],
    );
    expect(csv).toContain('"urgent, please review"');
  });

  it("quotes a field containing a newline", () => {
    const csv = toCsv(
      [{ note: "line one\nline two" }],
      [{ key: "note", header: "Note" }],
    );
    expect(csv).toContain('"line one\nline two"');
  });

  it("doubles embedded double quotes and wraps the field in quotes", () => {
    const csv = toCsv([{ note: 'she said "hi"' }], [{ key: "note", header: "Note" }]);
    expect(csv).toContain('"she said ""hi"""');
  });

  it("neutralizes a leading formula-trigger character to prevent CSV injection", () => {
    const cases = ["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(1)"];
    for (const value of cases) {
      const csv = toCsv([{ title: value }], [{ key: "title", header: "Title" }]);
      const dataLine = csv.replace(/^﻿/, "").split("\r\n")[1];
      expect(dataLine!.startsWith("'")).toBe(true);
      expect(dataLine).toContain(value);
    }
  });

  it("renders null and undefined cells as empty, never the string 'null'/'undefined'/'NaN'", () => {
    const csv = toCsv(
      [{ a: null, b: undefined, c: Number.NaN }],
      [
        { key: "a", header: "A" },
        { key: "b", header: "B" },
        { key: "c", header: "C" },
      ],
    );
    const dataLine = csv.replace(/^﻿/, "").split("\r\n")[1];
    expect(dataLine).toBe(",,");
  });

  it("renders a Date cell as an ISO string", () => {
    const csv = toCsv(
      [{ when: new Date("2026-01-15T10:00:00.000Z") }],
      [{ key: "when", header: "When" }],
    );
    expect(csv).toContain("2026-01-15T10:00:00.000Z");
  });

  it("renders just the header row when there are no records", () => {
    const csv = toCsv([], [{ key: "a", header: "A" }]);
    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(lines).toEqual(["A"]);
  });
});

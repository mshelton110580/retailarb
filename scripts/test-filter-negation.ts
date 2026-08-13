// Test for src/lib/filter-negation.ts — off/include/exclude tri-state helpers
// Run: npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-filter-negation.ts
//
// TriState chips cycle off -> include -> exclude -> off. `encode`/`decode` serialize a
// Map<string, TriState> to/from URL-param-friendly string arrays (unprefixed = include,
// "!v" = exclude, back-compat with pre-tri-state URLs/localStorage). `matches` evaluates
// a candidate-keys array against a filter map: true when (no includes OR candidates
// intersect includes) AND candidates intersect no excludes.

import { cycle, encode, decode, matches, type TriState } from "../src/lib/filter-negation";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}` + (ok ? "" : ` — expected ${e}, got ${a}`));
}

// ── cycle ──────────────────────────────────────────────────────────────────

check("cycle off -> include", cycle("off"), "include");
check("cycle include -> exclude", cycle("include"), "exclude");
check("cycle exclude -> off", cycle("exclude"), "off");

// ── encode ─────────────────────────────────────────────────────────────────

check("encode include/exclude/off",
  encode(new Map<string, TriState>([["a", "include"], ["b", "exclude"], ["c", "off"]])),
  ["a", "!b"]);

check("encode empty map", encode(new Map()), []);

// ── decode ─────────────────────────────────────────────────────────────────

check("decode unprefixed=include, !=exclude, invalid dropped",
  Array.from(decode(["a", "!b", "junk"], new Set(["a", "b"])).entries()),
  [["a", "include"], ["b", "exclude"]]);

check("decode empty raw", Array.from(decode([], new Set(["a"])).entries()), []);

check("decode stray '!' (empty value after strip) is skipped",
  Array.from(decode(["!", "a"], new Set(["a"])).entries()),
  [["a", "include"]]);

// ── matches ────────────────────────────────────────────────────────────────

check("matches: no filters => true",
  matches(["delivered"], new Map()), true);

check("matches: excluded value present => false",
  matches(["delivered"], new Map<string, TriState>([["delivered", "exclude"]])), false);

check("matches: include set, candidate absent => false",
  matches(["late"], new Map<string, TriState>([["delivered", "include"]])), false);

check("matches: include hit but exclude also hit => false",
  matches(["delivered", "late"], new Map<string, TriState>([["delivered", "include"], ["late", "exclude"]])), false);

check("matches: include hit, no exclude hit => true",
  matches(["delivered"], new Map<string, TriState>([["delivered", "include"], ["late", "exclude"]])), true);

if (failed > 0) {
  console.log(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll tests passed");

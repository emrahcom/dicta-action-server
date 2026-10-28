import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkContext } from "../src/context.ts";

const VALID = readFileSync(
  new URL("fixtures/context.json", import.meta.url),
  "utf8",
);

// A valid context, changed by `change`.
function context(change: (c: any) => void = () => {}) {
  const c = JSON.parse(VALID);
  change(c);
  return c;
}

test("accepts a valid context", () => {
  const c = checkContext(context());

  assert.equal(c.site.name, "Teamboard");
  assert.equal(c.capabilities.length, 3);
  assert.equal(c.capabilities[2]?.navigates, true);
});

const INVALID: [string, (c: any) => void, RegExp][] = [
  ["another version", (c) => (c.version = 2), /^version must be 1$/],
  ["no site", (c) => delete c.site, /^site must be an object$/],
  ["a site name that is not text", (c) => (c.site.name = 1), /^site.name /],
  ["no state description", (c) => delete c.state.description, /^state.descr/],
  ["capabilities that are not a list", (c) => (c.capabilities = {}), /^capab/],
  [
    "a capability without a name",
    (c) => delete c.capabilities[1].name,
    /^capabilities\[1\]\.name must be a string$/,
  ],
  [
    "an unknown level",
    (c) => (c.capabilities[0].level = "admin"),
    /^capabilities\[0\]\.level must be one of read, write, destructive, external$/,
  ],
  [
    "navigates that is not a boolean",
    (c) => (c.capabilities[2].navigates = "yes"),
    /^capabilities\[2\]\.navigates must be true or false$/,
  ],
  [
    "a capability without args",
    (c) => delete c.capabilities[0].args,
    /^capabilities\[0\]\.args must be an object$/,
  ],
  [
    "a schema keyword that is not allowed",
    (c) => (c.capabilities[1].args.properties.title.minLength = 1),
    /^capabilities\[1\]\.args\.properties\.title uses minLength, which is not allowed$/,
  ],
  [
    "a keyword not allowed inside items",
    (c) =>
      (c.capabilities[1].args.properties.tags = {
        type: "array",
        items: { type: "string", pattern: "x" },
      }),
    /args\.properties\.tags\.items uses pattern/,
  ],
  [
    "required that is not a list of names",
    (c) => (c.capabilities[1].args.required = "title"),
    /args\.required must be an array$/,
  ],
  [
    "two capabilities with one name",
    (c) => (c.capabilities[1].name = "tasks.list"),
    /^capability tasks\.list is listed twice$/,
  ],
  ["no notes", (c) => delete c.notes, /^notes must be an array$/],
  [
    "a note without text",
    (c) => delete c.notes[0].text,
    /^notes\[0\]\.text must be a string$/,
  ],
];

for (const [name, change, message] of INVALID) {
  test(`refuses ${name}`, () => {
    assert.throws(() => checkContext(context(change)), { message });
  });
}

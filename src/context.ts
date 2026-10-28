// The site context: read from CONTEXT_FILE and checked at startup
// (contract-context.md).

import { readFileSync } from "node:fs";

export const LEVELS = ["read", "write", "destructive", "external"] as const;
export type Level = (typeof LEVELS)[number];

// The JSON Schema keywords capability arguments may use
// (contract-capability.md, Capabilities).
const SCHEMA_KEYWORDS = [
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "description",
];

export type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  description?: string;
};

export type Capability = {
  name: string;
  level: Level;
  description: string;
  args: Schema;
  navigates?: boolean;
};

export type SiteContext = {
  version: 1;
  site: { name: string; description: string };
  state: { description: string };
  capabilities: Capability[];
  notes: { title: string; text: string }[];
};

class ContextError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string) {
  if (!isObject(value)) {
    throw new ContextError(`${path} must be an object`);
  }
  return value;
}

function array(value: unknown, path: string) {
  if (!Array.isArray(value)) {
    throw new ContextError(`${path} must be an array`);
  }
  return value as unknown[];
}

function string(value: unknown, path: string) {
  if (typeof value !== "string") {
    throw new ContextError(`${path} must be a string`);
  }
  return value;
}

function schema(value: unknown, path: string): Schema {
  const s = object(value, path);
  for (const key of Object.keys(s)) {
    if (!SCHEMA_KEYWORDS.includes(key)) {
      throw new ContextError(`${path} uses ${key}, which is not allowed`);
    }
  }
  if (s.type !== undefined) {
    string(s.type, `${path}.type`);
  }
  if (s.description !== undefined) {
    string(s.description, `${path}.description`);
  }
  if (s.properties !== undefined) {
    for (const [name, property] of Object.entries(
      object(s.properties, `${path}.properties`),
    )) {
      schema(property, `${path}.properties.${name}`);
    }
  }
  if (s.required !== undefined) {
    array(s.required, `${path}.required`).forEach((name, i) =>
      string(name, `${path}.required[${i}]`),
    );
  }
  if (s.items !== undefined) {
    schema(s.items, `${path}.items`);
  }
  if (s.enum !== undefined) {
    array(s.enum, `${path}.enum`);
  }
  return s as Schema;
}

function capability(value: unknown, path: string): Capability {
  const c = object(value, path);
  const level = string(c.level, `${path}.level`);
  if (!(LEVELS as readonly string[]).includes(level)) {
    throw new ContextError(`${path}.level must be one of ${LEVELS.join(", ")}`);
  }
  if (c.navigates !== undefined && typeof c.navigates !== "boolean") {
    throw new ContextError(`${path}.navigates must be true or false`);
  }
  return {
    name: string(c.name, `${path}.name`),
    level: level as Level,
    description: string(c.description, `${path}.description`),
    args: schema(c.args, `${path}.args`),
    ...(c.navigates === undefined ? {} : { navigates: c.navigates }),
  };
}

// Checks a parsed context file. Throws an error that names the wrong field.
export function checkContext(value: unknown): SiteContext {
  const c = object(value, "context");
  if (c.version !== 1) {
    throw new ContextError("version must be 1");
  }
  const site = object(c.site, "site");
  const state = object(c.state, "state");
  const capabilities = array(c.capabilities, "capabilities").map((item, i) =>
    capability(item, `capabilities[${i}]`),
  );
  const names = new Set<string>();
  for (const { name } of capabilities) {
    if (names.has(name)) {
      throw new ContextError(`capability ${name} is listed twice`);
    }
    names.add(name);
  }
  const notes = array(c.notes, "notes").map((item, i) => {
    const note = object(item, `notes[${i}]`);
    return {
      title: string(note.title, `notes[${i}].title`),
      text: string(note.text, `notes[${i}].text`),
    };
  });
  return {
    version: 1,
    site: {
      name: string(site.name, "site.name"),
      description: string(site.description, "site.description"),
    },
    state: { description: string(state.description, "state.description") },
    capabilities,
    notes,
  };
}

export function loadContext(file: string): SiteContext {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new ContextError(`CONTEXT_FILE ${file} cannot be read`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ContextError(`CONTEXT_FILE ${file} is not JSON`);
  }
  try {
    return checkContext(value);
  } catch (err) {
    throw new ContextError(
      `CONTEXT_FILE ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

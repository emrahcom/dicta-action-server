// The site context: it comes with every round and is checked there
// (contract-context.md).

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
  desc: string;
  args: Schema;
};

export type SiteContext = {
  site: { name: string; desc: string };
  state: { desc: string };
  capabilities: Capability[];
};

export class ContextError extends Error {}

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
  return {
    name: string(c.name, `${path}.name`),
    level: level as Level,
    desc: string(c.desc, `${path}.desc`),
    args: schema(c.args, `${path}.args`),
  };
}

// Checks the context of a round. Throws a ContextError that names the wrong
// field.
export function checkContext(value: unknown): SiteContext {
  const c = object(value, "context");
  const site = object(c.site, "context.site");
  const state = object(c.state, "context.state");
  const capabilities = array(c.capabilities, "context.capabilities").map(
    (item, i) => capability(item, `context.capabilities[${i}]`),
  );
  const names = new Set<string>();
  for (const { name } of capabilities) {
    if (names.has(name)) {
      throw new ContextError(`capability ${name} is listed twice`);
    }
    names.add(name);
  }
  return {
    site: {
      name: string(site.name, "context.site.name"),
      desc: string(site.desc, "context.site.desc"),
    },
    state: { desc: string(state.desc, "context.state.desc") },
    capabilities,
  };
}

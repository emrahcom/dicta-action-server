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

// The seven JSON Schema types (contract-context.md, Checks).
const SCHEMA_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

export type Schema = {
  // One type, or a list of types any of which a value may have.
  type?: string | string[];
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
  args?: Schema;
  output?: Schema;
};

export type SiteContext = {
  site: { name: string; desc: string };
  state: { desc: string };
  capabilities: Capability[];
};

export class ContextError extends Error {}

export function isObject(value: unknown): value is Record<string, unknown> {
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

function schemaType(value: unknown, path: string) {
  const type = string(value, path);
  if (!SCHEMA_TYPES.includes(type)) {
    throw new ContextError(`${path} must be one of ${SCHEMA_TYPES.join(", ")}`);
  }
}

function schema(value: unknown, path: string): Schema {
  const s = object(value, path);
  for (const key of Object.keys(s)) {
    if (!SCHEMA_KEYWORDS.includes(key)) {
      throw new ContextError(`${path} uses ${key}, which is not allowed`);
    }
  }
  if (Array.isArray(s.type)) {
    // A list of types: a value matches it when it matches any of them
    // (contract-capability.md, Capabilities).
    if (s.type.length === 0 || new Set(s.type).size !== s.type.length) {
      throw new ContextError(
        `${path}.type must be a non-empty list of types without repeats`,
      );
    }
    s.type.forEach((type, i) => schemaType(type, `${path}.type[${i}]`));
  } else if (s.type !== undefined) {
    schemaType(s.type, `${path}.type`);
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
    // A required name must be one of the properties, or no plan can match.
    const properties = isObject(s.properties) ? s.properties : {};
    array(s.required, `${path}.required`).forEach((value, i) => {
      const name = string(value, `${path}.required[${i}]`);
      if (!Object.hasOwn(properties, name)) {
        throw new ContextError(
          `${path}.required names ${name}, which is not in its properties`,
        );
      }
    });
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
  // The arguments are always an object (contract-context.md, Checks).
  if (
    isObject(c.args) &&
    c.args.type !== undefined &&
    c.args.type !== "object"
  ) {
    throw new ContextError(`${path}.args.type must be object`);
  }
  const level = string(c.level, `${path}.level`);
  if (!(LEVELS as readonly string[]).includes(level)) {
    throw new ContextError(`${path}.level must be one of ${LEVELS.join(", ")}`);
  }
  return {
    name: string(c.name, `${path}.name`),
    level: level as Level,
    desc: string(c.desc, `${path}.desc`),
    ...(c.args === undefined ? {} : { args: schema(c.args, `${path}.args`) }),
    ...(c.output === undefined
      ? {}
      : { output: schema(c.output, `${path}.output`) }),
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

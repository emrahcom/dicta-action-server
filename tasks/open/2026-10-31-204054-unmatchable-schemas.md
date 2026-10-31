# Unmatchable schemas

A context with a schema no plan can match gets a `400` that names the problem
(`contract-context.md`, Checks).

- The context check refuses a `type` that is not one of the seven JSON Schema
  types, at any depth of `args` and `output`.
- It refuses a `required` name that is not in the schema's `properties`.
- It refuses an `args` whose `type` is not `object`.
- Tests for each of the three, and for valid schemas with each of the seven
  types.

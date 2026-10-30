# Unnamed properties

A plan's `args` have no properties the schema does not name (`contract-plan.md`,
Failures).

- The plan check refuses an object with a property its schema does not name,
  also when the schema has no `properties`. Today such a schema lets any
  property through.
- Tests for each, at the top of `args` and in a nested object.

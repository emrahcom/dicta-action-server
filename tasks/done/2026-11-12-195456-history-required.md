# History required

`history` is a required field of the request body (`contract-protocol.md`,
Request body). A body without it fails the round check with `400`, as a body
without `exchange` does now; an empty array is a valid history.

Tests: the test bodies send `history`, an empty array unless the test needs
entries; a body without `history` gets `400` naming the field; the test that
takes a missing history as empty is removed.

Check: `npm run check`, `npm run lint` and `npm run test` pass.

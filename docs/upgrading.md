# Upgrading

How to move a site to a new version of dicta.

## What changes

Three parts work together on a site:

- `dicta-action-server`, this server.
- `dicta-action-js`, the browser part, bundled into the site's pages.
- The site's capability module, made with `dicta-action-harness`.

Each release has notes. Read them first. They say what changed and what a site
must change.

## Until version 1.0.0

Any release may break the other parts. So update the three together:

1. Update the harness, and check the module with it.
2. Update the server, `dicta-action-js` and the module at the same time.
3. Try some requests on the site.

## From version 1.0.0 on

A new server works with older sites of the same protocol version. The protocol
version is the `v1` in `/dicta-action/v1/round`. So:

1. Update the server first.
2. Then update `dicta-action-js` and the module, when it suits you.

A change that would break older sites gets a new protocol version, such as `v2`.
The server then serves both versions for a while. The release notes say when the
old one goes away.

## Updating the server

1. Get the new code.
2. Run `npm install`.
3. Restart the server.

The server keeps no data, so there is nothing to move.

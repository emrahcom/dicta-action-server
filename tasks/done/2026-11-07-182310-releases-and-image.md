# Releases and image

Add the release process and the Docker image, as `architecture.md` (Releases)
says, the same way as in `dicta-server` and `dicta-action-js`.

- `Dockerfile` and `.github/workflows/image.yml`, after `dicta-server`'s,
  without the `dicta-js` stage and label.
- `docs/releasing.md`, after `dicta-server`'s and `dicta-action-js`'s, in simple
  English: version numbers (first release `0.1.0`; while the major number is 0,
  a change that breaks sites or setups raises the minor number, everything else
  the patch number; the protocol version for protocol changes), the steps
  (checks, `npm version --no-git-tag-version`, `chore: release` commit, GitHub
  release) and the image the release builds.
- `README.md`: running the server from the image, after `dicta-server`'s
  deployment document.

Check: `npm run check`, `npm run lint` and `npm run test` pass. The image builds
and the server starts in it, if Docker is available here.

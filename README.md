# QA Touchstone

QA Touchstone is a local-first desktop tool for API testing and embedded QA workflows. The first public-facing edition focuses on a Postman-compatible API client, generic environments, and the firmware flashing utilities that can run without company-specific services.

## Features

- Import and browse Postman collection files
- Execute API requests locally with request history and response export
- Use No Auth, Bearer Token, API Key, Basic Auth, or AWS SigV4 authentication
- Define generic API environments for local, staging, and production targets
- Manage AWS credential profiles for SigV4 signing
- Run Nordic and Silabs flashing workflows from a desktop UI
- Save local paths and settings on the machine where the app runs

## Requirements

- Node.js 18 or newer
- npm
- Rust toolchain, required for Tauri commands and desktop builds
- Platform tools needed by the flashing workflows you plan to use

## Development

Install dependencies:

```bash
npm install
```

Run the frontend dev server:

```bash
npm run dev
```

Run the Tauri desktop app in development mode:

```bash
npm run tauri:dev
```

### k6 binary (Performance testing)

The Performance page runs real load tests via [k6](https://k6.io). The k6
binary is **not** committed (it's tens of MB and platform-specific — see
`.gitignore`), so after a fresh clone or `git pull` it must be materialized at
`src-tauri/resources/` (`k6` on macOS/Linux, `k6.exe` on Windows). This is
automatic, but uses two modes with different trust levels:

- **Dev** — `npm run tauri:dev` runs `setup:k6`: no-op if present, else copy a
  `k6` from your PATH, else download the pinned release. Fast and offline-friendly.
- **Release** — `npm run tauri:build` runs `setup:k6:release`, which **never**
  trusts PATH or an unverified pre-existing file. It downloads the pinned,
  OS/arch-correct official artifact, verifies its **SHA256** against checksums
  baked into `scripts/setup-k6.mjs`, then runs `k6 version` to confirm the
  version and target before the binary is bundled into the installer. Any
  mismatch fails the build (fail-closed). This keeps an untrusted executable
  from being shipped and later executed by the app.

Run either manually (dev is a no-op if already present):

```bash
npm run setup:k6           # dev: PATH copy or download
npm run setup:k6:release   # release: pinned + SHA256-verified official artifact
```

Bumping the k6 version (`K6_VERSION=<x.y.z>`) requires adding that version's
checksums to the `CHECKSUMS` table in `scripts/setup-k6.mjs` (copy them from the
release's `k6-v<x.y.z>-checksums.txt`), or release mode will refuse to build.

Run unit tests:

```bash
npm test
```

Build the frontend:

```bash
npm run build
```

Build the Tauri desktop app:

```bash
npm run tauri:build
```

macOS produces a `.dmg` under `src-tauri/target/release/bundle/dmg/`,
Windows an NSIS installer. The macOS k6 binary is bundled into the app at
`Contents/Resources/resources/k6`, so Performance testing works without a
system install.

### Opening the macOS app (Gatekeeper)

The build is not signed/notarized with an Apple Developer ID, so on first
launch macOS Gatekeeper will block it with "app is damaged / cannot be
opened". Bypass it once, either way:

- **Right-click** the app → **Open** → **Open** in the dialog, **or**
- Strip the quarantine attribute from a terminal:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/QA Touchstone.app"
  ```

For wider distribution, sign with a Developer ID certificate and notarize
the build instead.

## API Client

The API client can load Postman collections and execute requests with the selected environment. Environment presets are intentionally generic in the public edition so teams can map the app to their own services.

Supported authentication modes:

- No Auth
- Bearer Token
- API Key in a header or query string
- Basic Auth
- AWS SigV4

## Configuration

Runtime configuration is stored locally. Common generated files include:

- `config.json` for application settings
- `flash_path_data.json` for flashing tool paths
- `postman_collections_cache.json` for cached collection metadata
- `api_credential_configs.json` for API credential profile metadata

Do not commit local credentials, generated cache files, or machine-specific paths.

## License

ISC

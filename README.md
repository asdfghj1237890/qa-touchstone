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

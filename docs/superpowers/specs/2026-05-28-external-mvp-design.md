# External MVP Design

## Context

Sidewalk QA Friends is currently an internal QA desktop application for Sidewalk device workflows. The externalized product should become a professional desktop QA tool that keeps the strongest generic capabilities while hiding or replacing internal-only workflows, links, product names, release channels, and assumptions.

The first external version should not become a SaaS platform. It should remain a local desktop app with a cleaner product shell, a Postman-compatible API client as the primary feature, and embedded flashing utilities as secondary capabilities.

## Product Direction

The external MVP positioning is:

> A Postman-compatible API client for QA workflows, with first-class AWS SigV4 support and optional embedded device flashing utilities.

This makes the app easier to explain outside the original team. API testing has broad external value, while Nordic and Silabs flashing remain useful differentiators for embedded QA users.

## Goals

- Ship an external-facing desktop MVP without exposing Amazon, Sidewalk, Ring, Echo, corp drive, phonetool, labcollab, or internal wiki references.
- Make API testing the primary visible workflow.
- Preserve AWS SigV4 as a first-version auth option.
- Add first-version support for No Auth, Bearer Token, API Key, Basic Auth, and AWS SigV4.
- Keep Nordic and Silabs flashing visible as embedded QA utilities.
- Hide higher-risk or more internal-specific features until they can be redesigned.
- Preserve internal-edition functionality in code where practical by hiding features through configuration or edition gating instead of deleting valuable implementation.

## Non-Goals

- No account system, cloud sync, team workspace, billing, or hosted SaaS backend in the first external MVP.
- No public exposure of Sidewalk-specific environments, internal API endpoints, internal release links, or internal runbook links.
- No large rewrite of the Tauri backend in this design phase.
- No deletion of EFD, RFD, Files, Certificates, network scan, SSH, or internal device workflow code unless legal/security review later requires removal.

## Visible First-Version Surface

The external MVP should show:

- Home
- API Client
- API Settings
- Environments
- Nordic Flash
- Silabs Flash
- General Settings

The Home page should explain the product through the API-client-first positioning and provide local, public-safe quick actions. It should not link to internal docs or support pages.

## Hidden First-Version Surface

The external MVP should hide:

- Certificates
- EFD
- RFD
- Files
- Network scan and SSH device discovery
- Ring, Echo, Sidewalk, HALO, labcollab, phonetool, and Amazon-internal links
- Internal Sidewalk API environment presets

These features can remain in the repository behind edition gates or configuration flags. They should not be reachable from the external navigation, docs, or default settings.

## API Client Design

The API Client is the primary MVP experience. It should support:

- Postman collection import and scanning
- Request tree navigation
- Request execution
- Headers, params, body, and variable editing
- Response viewer
- Collection editing where currently supported
- Environment selection
- Auth method selection
- Export or download of request/response output where currently supported

The API experience should be described and labeled as a generic API client, not as a Sidewalk API tester.

## Authentication

The Authentication panel should become a generic auth selector with these options:

- No Auth
- Bearer Token
- API Key
- Basic Auth
- AWS SigV4

Each auth option should reveal only the fields it needs.

No Auth:

- Sends the request without adding authentication headers or query params.

Bearer Token:

- Token input.
- Adds or updates `Authorization: Bearer <token>`.
- Token field should be masked by default with a reveal toggle.

API Key:

- Key name.
- Key value.
- Placement: header or query param.
- Header mode adds or updates the configured header, such as `x-api-key`.
- Query mode adds or updates the configured URL query parameter.
- Value should be masked by default with a reveal toggle.

Basic Auth:

- Username.
- Password.
- Adds or updates `Authorization: Basic <base64(username:password)>`.
- Password should be masked by default with a reveal toggle.

AWS SigV4:

- Credential source.
- Access key, secret key, optional session token.
- Region.
- Service.
- Optional profile selection when credentials come from an AWS credentials file.
- Optional AssumeRole if already supported by the current backend flow.
- Should be presented as an advanced but fully supported auth provider, not an internal credential workflow.

## Environments

The current hardcoded Sidewalk environments should be removed from the external edition and replaced with user-managed generic environments.

The default external environment list should be:

- None
- Local
- Staging
- Production

Each environment should support:

- Name
- Base URL
- Variables

The URL rebasing logic must stop depending on Sidewalk-specific known base paths in the external edition. If the internal edition still needs those paths, they should be edition-specific.

## Branding And Packaging

External MVP must replace internal branding and packaging metadata:

- Rename the product from `Sidewalk QA Friends` to a neutral product name.
- Rename the package from `@amzn/sidewalk-qa-friends`.
- Replace Amazon/Tauri identifiers such as `com.amazon.sidewalk-qa-friends`.
- Remove internal release links from README.
- Remove `Amazon internal use only` from external documentation.
- Replace internal installation instructions with public-safe build/install steps.

Final product naming is outside this design unless the user provides a preferred name before implementation.

## Security Requirements

The external MVP must reduce risk before release:

- Do not expose arbitrary command execution as a generic user feature.
- Hide network scan and SSH discovery in the external edition.
- Mask secrets in all auth forms by default.
- Avoid logging full tokens, passwords, secret access keys, or session tokens.
- Prefer storing only credential file references for AWS credentials where possible.
- Mark manual credential storage as local-only and sensitive if it remains file-backed in the first version.
- Plan a follow-up migration to OS keychain or a credential vault for stored secrets.
- Add a non-null Tauri CSP before public distribution.
- Use signed and notarized builds for public macOS distribution.

## Edition Gating

The first implementation should prefer an edition/configuration gate over deleting working internal functionality.

Recommended approach:

- Add an edition config, such as `internal` or `external`.
- Default external builds to the external visible surface.
- Keep internal-only routes and settings hidden from external navigation.
- Keep internal presets and links out of external docs and external defaults.

This keeps one codebase while allowing the internal tool to continue evolving.

## Testing Strategy

The first implementation should include focused tests for:

- External navigation only shows approved tabs.
- Home page contains no internal links or internal brand terms.
- API auth selector shows all five auth options.
- Bearer auth writes the expected Authorization header.
- API Key auth writes the configured header or query param.
- Basic auth writes the expected Authorization header.
- AWS SigV4 remains callable through the existing backend path.
- External environments do not include Sidewalk-specific presets.

Manual verification should include:

- Launch external edition.
- Import or scan a Postman collection.
- Execute No Auth, Bearer, API Key, Basic, and AWS SigV4 requests against safe test endpoints.
- Verify secrets are masked and not printed in UI logs.

## Open Decisions

- Final public product name.
- Whether internal and external editions are selected by build-time env var, runtime config, or both.
- Whether manual AWS credential values may be stored in the first external MVP, or whether file/profile-only credentials are required.
- Whether Nordic and Silabs naming is acceptable externally or should be grouped under a generic "Flashing" workspace.

# Privacy Policy for WebMCP Inspector

Effective date: September 10, 2026

WebMCP Inspector is a developer tool extension for discovering, testing, and debugging WebMCP tools on web pages.

This policy explains what data the extension processes and how it is used.

## Data We Process

The extension may process the following categories of data:

1. Authentication information
- API keys entered by the user for hosted AI providers (for example Gemini, OpenAI, and Anthropic).

2. Personal communications
- User-entered AI chat prompts and assistant/tool responses shown in the extension UI.

3. Website content
- WebMCP tool metadata and execution data from the active page, such as tool names, schemas, input arguments, and tool results.

## How We Use Data

Data is used only to provide the extension's core function:
- inspect WebMCP tools,
- execute tools on user request,
- provide optional AI-assisted tool workflows,
- save user settings and preferences.

## Storage

The extension stores data using Chrome extension storage:
- `chrome.storage.sync`: non-secret preferences and provider configuration. API keys are explicitly removed from this synced copy.
- `chrome.storage.local`: provider API keys and short-lived local UI state.

Chrome extension storage is not encrypted. Users should use restricted development keys and remove them when they are no longer required. AI conversation and trace history remain in the open side panel's memory and are not intentionally persisted.

## Data Sharing and Transfer

We do not sell user data.

When the user uses AI Chat, prompts plus relevant page-controlled tool names, descriptions, schemas, calls, and results are sent directly to the selected provider endpoint. This transfer is user-initiated and required for that feature. Manual inspection and manual tool execution do not send content to an AI provider.

Except for these functional API requests, we do not transfer user data to third parties for unrelated purposes.

## What We Do Not Do

- We do not use data for advertising.
- We do not create user profiles for unrelated purposes.
- We do not use or transfer data to determine creditworthiness or lending eligibility.

## Security

We take reasonable measures to limit data access to what is required for extension features. Users control provider configuration and can remove API keys and settings at any time.

## User Choices

Users can:
- disable AI provider usage by not configuring providers,
- clear/replace saved settings in extension configuration,
- uninstall the extension to stop all processing.

## Changes to This Policy

We may update this policy when extension behavior changes. The current version will be published at this file URL.

## Contact

Project repository and issue tracker:
https://github.com/mr-shitij/webmcp_inspector

# Privacy Policy for WebMCP Inspector

Effective date: February 16, 2026

WebMCP Inspector is a developer tool extension for discovering, testing, and debugging WebMCP tools on web pages.

This policy explains what data the extension processes and how it is used.

## Data We Process

The extension may process the following categories of data:

1. Authentication information
- API keys entered by the user for AI providers (for example Gemini, OpenAI, Anthropic, Ollama-compatible endpoints).

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
- `chrome.storage.sync`: settings and provider configuration.
- `chrome.storage.local`: short-lived local UI state.

Data is stored to support extension functionality and user experience only.

## Data Sharing and Transfer

We do not sell user data.

When the user configures an AI provider, relevant request content is sent directly to that selected provider endpoint to fulfill the requested AI function. This transfer is user-initiated and required for that feature.

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

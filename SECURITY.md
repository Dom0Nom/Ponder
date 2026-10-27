# Security

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include the version or commit, your OS, and steps to reproduce. You'll get a reply within a week.

## Scope

Ponder stores API keys and OAuth tokens in the OS keychain and sends AI requests through a local Rust proxy that only attaches credentials for the provider's own base URL. Reports about key leakage, the proxy, deep links (`ponder://`), the MCP server, imported files, or code cells escaping their sandbox are especially welcome.

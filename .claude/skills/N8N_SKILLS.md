# n8n agent skills

The `n8n-*` and `using-n8n-mcp-skills` folders in this directory are Claude Code
skills for building n8n workflows and AI agents. They are vendored from
[czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills)
(commit `e037563`, MIT; parts adapted from n8n-io/skills under Apache 2.0 —
see `N8N_SKILLS_LICENSE` and `N8N_SKILLS_NOTICES*`).

Claude Code loads them automatically from `.claude/skills/`. Start with
`using-n8n-mcp-skills`, which routes to the right skill for the task.

## Optional: n8n-mcp server

Most skills assume the [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) MCP
server is connected. To enable it, create `.mcp.json` at the repo root (keep
your API key out of git):

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "https://your-n8n-instance.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

To update the skills, re-copy `skills/*` from the upstream repo.

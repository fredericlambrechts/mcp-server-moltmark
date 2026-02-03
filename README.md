# mcp-server-moltmark

A Model Context Protocol (MCP) server for Moltmark agent certification. This server provides tools for managing agent trust scores, capabilities, and certification status.

## Features

- **Agent Certification** - Track and verify agent trust scores
- **Capability Registry** - Declare and manage agent skills
- **Test Results** - Record test outcomes that affect trust scores
- **Auto-Certification** - Agents are automatically certified when they reach 80% trust score with 5+ tests

## Installation

```bash
npm install mcp-server-moltmark
```

Or run directly with npx:

```bash
npx mcp-server-moltmark
```

## Requirements

- Node.js 18+
- PostgreSQL database
- `DATABASE_URL` environment variable

## Configuration

Set the `DATABASE_URL` environment variable to your PostgreSQL connection string:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/moltmark"
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "moltmark": {
      "command": "npx",
      "args": ["mcp-server-moltmark"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/moltmark"
      }
    }
  }
}
```

## Tools

### get_certification

Query the certification status of an agent, including trust score, capabilities, and test history.

```typescript
get_certification({ agent_id: "agent-123" })
```

Returns:
- Agent details (trust score, certified status)
- List of declared capabilities
- Recent test results
- Test summary (passed/failed counts)

### report_test_result

Submit a test outcome for an agent's capability. This affects the agent's trust score.

```typescript
report_test_result({
  agent_id: "agent-123",
  capability: "code-generation",
  result: "pass", // or "fail"
  evidence: "Successfully generated valid TypeScript code for the given task"
})
```

The trust score is automatically recalculated after each test result.

### declare_capability

Register a new skill or capability for an agent.

```typescript
declare_capability({
  agent_id: "agent-123",
  capability_name: "code-generation",
  description: "Ability to generate code in multiple programming languages"
})
```

### verify_agent

Check if an agent meets a minimum trust score threshold.

```typescript
verify_agent({
  agent_id: "agent-123",
  min_trust_score: 75
})
```

Returns whether the agent meets the threshold and the reason.

### list_verified_agents

Get a list of certified agents, optionally filtered by capability.

```typescript
// List all certified agents
list_verified_agents({})

// Filter by capability
list_verified_agents({ capability_filter: "code" })
```

## Trust Score Calculation

- Trust score = (passed tests / total tests) × 100
- Auto-certification occurs when:
  - Trust score ≥ 80%
  - At least 5 tests recorded

## Database Schema

The server automatically creates the following tables:

- `agents` - Stores agent information and certification status
- `capabilities` - Stores declared capabilities per agent
- `test_results` - Records all test outcomes

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-server-moltmark.git
cd mcp-server-moltmark

# Install dependencies
npm install

# Build
npm run build

# Run locally
DATABASE_URL="postgresql://..." npm start
```

## License

MIT

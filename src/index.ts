#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  initializeDatabase,
  getAgent,
  getAgentCapabilities,
  getAgentTestResults,
  declareCapability,
  reportTestResult,
  verifyAgent,
  listVerifiedAgents,
} from "./db.js";

// Tool input schemas
const GetCertificationSchema = z.object({
  agent_id: z.string().describe("Unique identifier for the agent"),
});

const ReportTestResultSchema = z.object({
  agent_id: z.string().describe("Unique identifier for the agent"),
  capability: z.string().describe("Name of the capability being tested"),
  result: z.enum(["pass", "fail"]).describe("Test outcome"),
  evidence: z
    .string()
    .describe("Description or proof of the test execution and result"),
});

const DeclareCapabilitySchema = z.object({
  agent_id: z.string().describe("Unique identifier for the agent"),
  capability_name: z.string().describe("Name of the capability to declare"),
  description: z.string().describe("Description of what this capability does"),
});

const VerifyAgentSchema = z.object({
  agent_id: z.string().describe("Unique identifier for the agent"),
  min_trust_score: z
    .number()
    .min(0)
    .max(100)
    .describe("Minimum trust score required (0-100)"),
});

const ListVerifiedAgentsSchema = z.object({
  capability_filter: z
    .string()
    .optional()
    .describe("Optional filter to find agents with specific capabilities"),
});

// Create the MCP server
const server = new Server(
  {
    name: "mcp-server-moltmark",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_certification",
        description:
          "Query the certification status of an agent, including trust score, capabilities, and test history",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "Unique identifier for the agent",
            },
          },
          required: ["agent_id"],
        },
      },
      {
        name: "report_test_result",
        description:
          "Submit a test outcome for an agent's capability. This affects the agent's trust score.",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "Unique identifier for the agent",
            },
            capability: {
              type: "string",
              description: "Name of the capability being tested",
            },
            result: {
              type: "string",
              enum: ["pass", "fail"],
              description: "Test outcome",
            },
            evidence: {
              type: "string",
              description:
                "Description or proof of the test execution and result",
            },
          },
          required: ["agent_id", "capability", "result", "evidence"],
        },
      },
      {
        name: "declare_capability",
        description:
          "Register a new skill or capability for an agent. This declares what the agent can do.",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "Unique identifier for the agent",
            },
            capability_name: {
              type: "string",
              description: "Name of the capability to declare",
            },
            description: {
              type: "string",
              description: "Description of what this capability does",
            },
          },
          required: ["agent_id", "capability_name", "description"],
        },
      },
      {
        name: "verify_agent",
        description:
          "Check if an agent meets a minimum trust score threshold for a specific use case",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "Unique identifier for the agent",
            },
            min_trust_score: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Minimum trust score required (0-100)",
            },
          },
          required: ["agent_id", "min_trust_score"],
        },
      },
      {
        name: "list_verified_agents",
        description:
          "Get a list of certified agents, optionally filtered by capability",
        inputSchema: {
          type: "object",
          properties: {
            capability_filter: {
              type: "string",
              description:
                "Optional filter to find agents with specific capabilities",
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_certification": {
        const { agent_id } = GetCertificationSchema.parse(args);

        const agent = await getAgent(agent_id);
        if (!agent) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    found: false,
                    message: `Agent '${agent_id}' not found in the certification system`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const capabilities = await getAgentCapabilities(agent_id);
        const testResults = await getAgentTestResults(agent_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  found: true,
                  agent: {
                    id: agent.id,
                    trust_score: parseFloat(String(agent.trust_score)),
                    certified: agent.certified,
                    certified_at: agent.certified_at,
                    created_at: agent.created_at,
                  },
                  capabilities: capabilities.map((c) => ({
                    name: c.name,
                    description: c.description,
                    declared_at: c.declared_at,
                  })),
                  recent_tests: testResults.slice(0, 10).map((t) => ({
                    capability: t.capability,
                    result: t.result,
                    evidence: t.evidence,
                    tested_at: t.tested_at,
                  })),
                  test_summary: {
                    total: testResults.length,
                    passed: testResults.filter((t) => t.result === "pass")
                      .length,
                    failed: testResults.filter((t) => t.result === "fail")
                      .length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "report_test_result": {
        const { agent_id, capability, result, evidence } =
          ReportTestResultSchema.parse(args);

        const testResult = await reportTestResult(
          agent_id,
          capability,
          result,
          evidence
        );
        const agent = await getAgent(agent_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  test_result: {
                    id: testResult.id,
                    capability: testResult.capability,
                    result: testResult.result,
                    tested_at: testResult.tested_at,
                  },
                  agent_status: {
                    trust_score: agent ? parseFloat(String(agent.trust_score)) : 0,
                    certified: agent?.certified || false,
                  },
                  message: `Test result recorded. Agent trust score is now ${agent?.trust_score || 0}%`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "declare_capability": {
        const { agent_id, capability_name, description } =
          DeclareCapabilitySchema.parse(args);

        const capability = await declareCapability(
          agent_id,
          capability_name,
          description
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  capability: {
                    name: capability.name,
                    description: capability.description,
                    declared_at: capability.declared_at,
                  },
                  message: `Capability '${capability_name}' registered for agent '${agent_id}'`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "verify_agent": {
        const { agent_id, min_trust_score } = VerifyAgentSchema.parse(args);

        const verification = await verifyAgent(agent_id, min_trust_score);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  verified: verification.verified,
                  reason: verification.reason,
                  agent: verification.agent
                    ? {
                        id: verification.agent.id,
                        trust_score: parseFloat(
                          String(verification.agent.trust_score)
                        ),
                        certified: verification.agent.certified,
                      }
                    : null,
                  threshold_requested: min_trust_score,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_verified_agents": {
        const { capability_filter } = ListVerifiedAgentsSchema.parse(args);

        const agents = await listVerifiedAgents(capability_filter);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: agents.length,
                  filter: capability_filter || null,
                  agents: agents.map((a) => ({
                    id: a.id,
                    trust_score: parseFloat(String(a.trust_score)),
                    certified_at: a.certified_at,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Main entry point
async function main() {
  // Check for DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is required");
    process.exit(1);
  }

  // Initialize database schema
  try {
    await initializeDatabase();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }

  // Start the server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Moltmark MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

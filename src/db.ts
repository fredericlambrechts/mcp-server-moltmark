import pg from "pg";

const { Pool } = pg;

// Initialize pool with DATABASE_URL from environment
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

export interface Agent {
  id: string;
  created_at: Date;
  trust_score: number;
  certified: boolean;
  certified_at: Date | null;
}

export interface Capability {
  id: number;
  agent_id: string;
  name: string;
  description: string;
  declared_at: Date;
}

export interface TestResult {
  id: number;
  agent_id: string;
  capability: string;
  result: "pass" | "fail";
  evidence: string;
  tested_at: Date;
}

// Initialize database schema
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id VARCHAR(255) PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        trust_score DECIMAL(5,2) DEFAULT 0,
        certified BOOLEAN DEFAULT FALSE,
        certified_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS capabilities (
        id SERIAL PRIMARY KEY,
        agent_id VARCHAR(255) REFERENCES agents(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        declared_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agent_id, name)
      );

      CREATE TABLE IF NOT EXISTS test_results (
        id SERIAL PRIMARY KEY,
        agent_id VARCHAR(255) REFERENCES agents(id) ON DELETE CASCADE,
        capability VARCHAR(255) NOT NULL,
        result VARCHAR(10) NOT NULL CHECK (result IN ('pass', 'fail')),
        evidence TEXT,
        tested_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_capabilities_agent ON capabilities(agent_id);
      CREATE INDEX IF NOT EXISTS idx_test_results_agent ON test_results(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agents_certified ON agents(certified) WHERE certified = TRUE;
    `);
  } finally {
    client.release();
  }
}

// Ensure agent exists, create if not
export async function ensureAgent(agentId: string): Promise<Agent> {
  const client = await pool.connect();
  try {
    // Try to insert, ignore conflict
    await client.query(
      `INSERT INTO agents (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [agentId]
    );

    const result = await client.query<Agent>(
      `SELECT * FROM agents WHERE id = $1`,
      [agentId]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// Get agent certification status
export async function getAgent(agentId: string): Promise<Agent | null> {
  const result = await pool.query<Agent>(
    `SELECT * FROM agents WHERE id = $1`,
    [agentId]
  );
  return result.rows[0] || null;
}

// Get agent capabilities
export async function getAgentCapabilities(
  agentId: string
): Promise<Capability[]> {
  const result = await pool.query<Capability>(
    `SELECT * FROM capabilities WHERE agent_id = $1 ORDER BY declared_at`,
    [agentId]
  );
  return result.rows;
}

// Get agent test results
export async function getAgentTestResults(
  agentId: string
): Promise<TestResult[]> {
  const result = await pool.query<TestResult>(
    `SELECT * FROM test_results WHERE agent_id = $1 ORDER BY tested_at DESC`,
    [agentId]
  );
  return result.rows;
}

// Declare a capability for an agent
export async function declareCapability(
  agentId: string,
  name: string,
  description: string
): Promise<Capability> {
  await ensureAgent(agentId);

  const result = await pool.query<Capability>(
    `INSERT INTO capabilities (agent_id, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (agent_id, name) DO UPDATE SET description = $3
     RETURNING *`,
    [agentId, name, description]
  );
  return result.rows[0];
}

// Report a test result
export async function reportTestResult(
  agentId: string,
  capability: string,
  result: "pass" | "fail",
  evidence: string
): Promise<TestResult> {
  await ensureAgent(agentId);

  const insertResult = await pool.query<TestResult>(
    `INSERT INTO test_results (agent_id, capability, result, evidence)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [agentId, capability, result, evidence]
  );

  // Recalculate trust score
  await recalculateTrustScore(agentId);

  return insertResult.rows[0];
}

// Recalculate trust score based on test results
async function recalculateTrustScore(agentId: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Calculate score: (passed tests / total tests) * 100
    // Weight recent tests more heavily
    const result = await client.query<{ pass_count: string; total: string }>(
      `SELECT 
        COUNT(*) FILTER (WHERE result = 'pass') as pass_count,
        COUNT(*) as total
       FROM test_results 
       WHERE agent_id = $1`,
      [agentId]
    );

    const { pass_count, total } = result.rows[0];
    const passCount = parseInt(pass_count) || 0;
    const totalCount = parseInt(total) || 0;

    const trustScore = totalCount > 0 ? (passCount / totalCount) * 100 : 0;

    // Auto-certify if trust score >= 80 and at least 5 tests
    const certified = trustScore >= 80 && totalCount >= 5;

    await client.query(
      `UPDATE agents 
       SET trust_score = $2, 
           certified = $3,
           certified_at = CASE WHEN $3 AND certified_at IS NULL THEN NOW() ELSE certified_at END
       WHERE id = $1`,
      [agentId, trustScore.toFixed(2), certified]
    );
  } finally {
    client.release();
  }
}

// Verify agent meets trust threshold
export async function verifyAgent(
  agentId: string,
  minTrustScore: number
): Promise<{ verified: boolean; agent: Agent | null; reason: string }> {
  const agent = await getAgent(agentId);

  if (!agent) {
    return { verified: false, agent: null, reason: "Agent not found" };
  }

  if (agent.trust_score < minTrustScore) {
    return {
      verified: false,
      agent,
      reason: `Trust score ${agent.trust_score} is below threshold ${minTrustScore}`,
    };
  }

  return { verified: true, agent, reason: "Agent meets trust threshold" };
}

// List verified agents with optional capability filter
export async function listVerifiedAgents(
  capabilityFilter?: string
): Promise<Agent[]> {
  let query: string;
  let params: string[];

  if (capabilityFilter) {
    query = `
      SELECT DISTINCT a.* FROM agents a
      JOIN capabilities c ON a.id = c.agent_id
      WHERE a.certified = TRUE AND c.name ILIKE $1
      ORDER BY a.trust_score DESC
    `;
    params = [`%${capabilityFilter}%`];
  } else {
    query = `
      SELECT * FROM agents 
      WHERE certified = TRUE 
      ORDER BY trust_score DESC
    `;
    params = [];
  }

  const result = await pool.query<Agent>(query, params);
  return result.rows;
}

export { pool };

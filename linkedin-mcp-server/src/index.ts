import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerLinkedInTools } from './tools/linkedin-tools.js';
import { storeToken } from './services/linkedin.js';

// ─── ENV VALIDATION ─────────────────────────────────────────────────────────
const REQUIRED_ENV = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID!;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET!;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI!;
const PORT = parseInt(process.env.PORT ?? '3000');

// ─── MCP SERVER ──────────────────────────────────────────────────────────────
const mcpServer = new McpServer({
  name: 'linkedin-mcp-server',
  version: '1.0.0',
});

registerLinkedInTools(mcpServer);

// ─── EXPRESS APP ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── OAUTH ROUTES ─────────────────────────────────────────────────────────────

/**
 * Step 1: Redirect user to LinkedIn login
 * Visit: GET /auth/linkedin?user_id=YOUR_USER_ID
 */
app.get('/auth/linkedin', (req, res) => {
  const userId = req.query.user_id as string;
  if (!userId) {
    res.status(400).json({ error: 'user_id query param required' });
    return;
  }

  const scopes = [
    'r_liteprofile',
    'r_emailaddress',
    'w_member_social',
    // Add below if you have LinkedIn approval:
    // 'r_organization_social',
    // 'rw_organization_admin',
  ].join(' ');

  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64');

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  res.redirect(authUrl.toString());
});

/**
 * Step 2: LinkedIn redirects here with ?code=...
 * Exchange code for access token, store it
 */
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.status(400).json({ error: `LinkedIn auth denied: ${error}` });
    return;
  }

  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state from LinkedIn callback' });
    return;
  }

  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    userId = decoded.userId;
  } catch {
    res.status(400).json({ error: 'Invalid state parameter' });
    return;
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json() as { error_description?: string };
      throw new Error(err.error_description ?? 'Token exchange failed');
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };

    // Fetch person ID
    const profileRes = await fetch('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as { id: string };

    // Store token in memory (replace with Supabase in production)
    storeToken(userId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      person_id: profile.id,
    });

    res.json({
      success: true,
      message: `LinkedIn authenticated for user ${userId}`,
      person_id: profile.id,
      expires_in_days: Math.floor(tokenData.expires_in / 86400),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ─── MCP ENDPOINT ─────────────────────────────────────────────────────────────
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'linkedin-mcp-server' });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`LinkedIn MCP Server running on port ${PORT}`);
  console.log(`MCP endpoint:   POST http://localhost:${PORT}/mcp`);
  console.log(`Auth start:     GET  http://localhost:${PORT}/auth/linkedin?user_id=YOUR_USER_ID`);
  console.log(`Auth callback:  GET  http://localhost:${PORT}/auth/callback`);
});

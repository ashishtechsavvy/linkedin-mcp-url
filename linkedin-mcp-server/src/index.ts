import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerLinkedInTools } from './tools/linkedin-tools.js';
import { storeToken } from './services/linkedin.js';

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

const app = express();
app.use(cors());
app.use(express.json());

app.get('/auth/linkedin', (req, res) => {
  const userId = req.query.user_id as string;
  if (!userId) { res.status(400).json({ error: 'user_id required' }); return; }

  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64');
  const scopes = ['openid', 'profile', 'w_member_social'].join(' ');

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  res.redirect(authUrl.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  if (error) { res.status(400).json({ error: `LinkedIn denied: ${error}` }); return; }
  if (!code || !state) { res.status(400).json({ error: 'Missing code or state' }); return; }

  let userId: string;
  try {
    userId = JSON.parse(Buffer.from(state, 'base64').toString('utf-8')).userId;
  } catch { res.status(400).json({ error: 'Invalid state' }); return; }

  try {
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
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profileText = await profileRes.text();
    console.log('Profile raw response:', profileText);
    const profile = JSON.parse(profileText) as { sub?: string; id?: string };

    const personId = profile.sub ?? profile.id ?? 'unknown';

    storeToken(userId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      person_id: personId,
    });

    res.json({
      success: true,
      person_id: personId,
      profile_raw: profile,
      expires_in_days: Math.floor(tokenData.expires_in / 86400),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/mcp', async (req, res) => {
  const server = new Server(
    { name: 'linkedin-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  registerLinkedInTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'linkedin-mcp-server' });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`LinkedIn MCP Server on port ${PORT}`);
  });
}

module.exports = app;

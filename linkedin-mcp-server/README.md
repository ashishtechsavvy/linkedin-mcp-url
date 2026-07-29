# LinkedIn MCP Server

MCP server for LinkedIn post management and analytics. Deploy on Vercel, connect to Claude or any MCP-compatible LLM.

---

## Architecture

```
Claude / LLM
     │
     │ POST /mcp (JSON-RPC)
     ▼
LinkedIn MCP Server (Vercel)
     │
     │ OAuth 2.0 + Bearer token
     ▼
LinkedIn API v2
```

---

## Step-by-Step Setup

### STEP 1 — Create LinkedIn App

1. Go to https://developer.linkedin.com/apps
2. Click **Create App**
3. Fill in: App Name, LinkedIn Page (your company), App Logo
4. Click **Create App**
5. Go to **Auth** tab → note your **Client ID** and **Client Secret**
6. Under **OAuth 2.0 settings → Authorized redirect URLs**, add:
   - Local dev: `http://localhost:3000/auth/callback`
   - Production: `https://your-app.vercel.app/auth/callback`
7. Go to **Products** tab → request access to:
   - **Sign In with LinkedIn using OpenID Connect** (instant approval)
   - **Share on LinkedIn** → gives you `w_member_social` scope (instant)
   - **Marketing Developer Platform** → only if you need impression analytics (requires manual review)

---

### STEP 2 — Clone and Install

```bash
git clone <your-repo>
cd linkedin-mcp-server
npm install
```

---

### STEP 3 — Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
LINKEDIN_CLIENT_ID=86xxxxxxxxxx
LINKEDIN_CLIENT_SECRET=WPxxxxxxxxxx
LINKEDIN_REDIRECT_URI=http://localhost:3000/auth/callback
PORT=3000
```

---

### STEP 4 — Build and Run Locally

```bash
npm run build
npm start
```

Server starts at `http://localhost:3000`

**Endpoints:**
- `GET  /health` — health check
- `GET  /auth/linkedin?user_id=YOUR_ID` — start OAuth flow
- `GET  /auth/callback` — LinkedIn redirects here automatically
- `POST /mcp` — MCP endpoint for LLM tool calls

---

### STEP 5 — Authenticate a LinkedIn Account

Open in browser:
```
http://localhost:3000/auth/linkedin?user_id=herbert
```

This redirects you to LinkedIn → you log in → LinkedIn redirects to your callback → token is stored.

Response you'll see:
```json
{
  "success": true,
  "message": "LinkedIn authenticated for user herbert",
  "person_id": "abc123xyz",
  "expires_in_days": 60
}
```

**Save the `person_id`** — you'll need it when calling post tools.

---

### STEP 6 — Deploy to Vercel

```bash
npm install -g vercel
vercel login

# Set secrets
vercel env add LINKEDIN_CLIENT_ID
vercel env add LINKEDIN_CLIENT_SECRET
vercel env add LINKEDIN_REDIRECT_URI  # set to https://your-app.vercel.app/auth/callback

# Deploy
npm run build
vercel --prod
```

After deploy, update your LinkedIn app's redirect URI to the production URL.

---

### STEP 7 — Connect to Claude

In Claude.ai → Settings → Connectors → Add MCP Server:

```
URL: https://your-app.vercel.app/mcp
```

That's your MCP URL.

---

## Available MCP Tools

| Tool | What it does |
|------|-------------|
| `linkedin_check_auth` | Check if a user is authenticated |
| `linkedin_get_profile` | Get profile info + LinkedIn person ID |
| `linkedin_create_post` | Publish a post to LinkedIn |
| `linkedin_get_my_posts` | Fetch your recent posts |
| `linkedin_get_post_analytics` | Get likes/comments on a post |
| `linkedin_delete_post` | Delete a post you own |

---

## Example Claude Usage

Once connected, you can say:

> "Check if user herbert is authenticated on LinkedIn"

> "Post to LinkedIn as herbert: 'Excited to share our latest Oracle HCM implementation update...'"

> "Get the last 5 LinkedIn posts for herbert and show me engagement"

---

## Production: Replace In-Memory Token Store with Supabase

The current code stores tokens in memory (lost on restart). For production:

```typescript
// src/services/linkedin.ts — replace storeToken/getToken with:

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function storeToken(userId: string, token: LinkedInToken) {
  await supabase.from('linkedin_tokens').upsert({
    user_id: userId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(token.expires_at).toISOString(),
    person_id: token.person_id,
  });
}

export async function getToken(userId: string): Promise<LinkedInToken | undefined> {
  const { data } = await supabase
    .from('linkedin_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (!data) return undefined;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(data.expires_at).getTime(),
    person_id: data.person_id,
  };
}
```

Supabase table:
```sql
create table linkedin_tokens (
  user_id text primary key,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  person_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

---

## LinkedIn API Scope Reference

| Scope | What it unlocks | Approval |
|-------|----------------|----------|
| `r_liteprofile` | Name, ID, photo | Instant |
| `r_emailaddress` | Email address | Instant |
| `w_member_social` | Post as yourself | Instant |
| `r_organization_social` | Read company page posts | Manual review |
| `rw_organization_admin` | Post as company page | Manual review |
| `r_ads_reporting` | Impression/click analytics | Marketing partner only |

---

## Token Expiry

- Access tokens expire in **60 days**
- Refresh tokens expire in **365 days** (if `offline_access` granted)
- The server auto-refreshes tokens before they expire

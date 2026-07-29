import { LinkedInToken, LinkedInProfile, PostAnalytics, OAuthTokenResponse, LinkedInApiError } from '../types.js';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_AUTH_BASE = 'https://www.linkedin.com/oauth/v2';

// In production, replace with Supabase token store
// For local dev, use environment variables or a simple JSON file
const tokenStore = new Map<string, LinkedInToken>();

export function storeToken(userId: string, token: LinkedInToken): void {
  tokenStore.set(userId, token);
}

export function getToken(userId: string): LinkedInToken | undefined {
  return tokenStore.get(userId);
}

export function isTokenExpired(token: LinkedInToken): boolean {
  // Refresh 5 minutes before actual expiry
  return Date.now() >= token.expires_at - 5 * 60 * 1000;
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<OAuthTokenResponse> {
  const response = await fetch(`${LINKEDIN_AUTH_BASE}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const err = await response.json() as LinkedInApiError;
    throw new Error(`Token refresh failed: ${err.message}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

export async function getValidToken(userId: string): Promise<string> {
  const token = getToken(userId);
  if (!token) {
    throw new Error(`No token found for user ${userId}. User must authenticate first via /auth/linkedin`);
  }

  if (isTokenExpired(token) && token.refresh_token) {
    const clientId = process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
    const refreshed = await refreshAccessToken(token.refresh_token, clientId, clientSecret);

    const updatedToken: LinkedInToken = {
      ...token,
      access_token: refreshed.access_token,
      expires_at: Date.now() + refreshed.expires_in * 1000,
      refresh_token: refreshed.refresh_token ?? token.refresh_token,
    };
    storeToken(userId, updatedToken);
    return updatedToken.access_token;
  }

  return token.access_token;
}

async function linkedInRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE',
  accessToken: string,
  body?: unknown
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${LINKEDIN_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    let errMsg = `LinkedIn API error: ${response.status} ${response.statusText}`;
    try {
      const err = await response.json() as { message?: string };
      if (err.message) errMsg += ` — ${err.message}`;
    } catch {}
    throw new Error(errMsg);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

export async function getProfile(accessToken: string): Promise<LinkedInProfile> {
  const data = await linkedInRequest<{
    id: string;
    localizedFirstName: string;
    localizedLastName: string;
    localizedHeadline?: string;
  }>('/me', 'GET', accessToken);

  return {
    id: data.id,
    firstName: data.localizedFirstName,
    lastName: data.localizedLastName,
    headline: data.localizedHeadline,
  };
}

export async function createPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  visibility: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN' = 'PUBLIC'
): Promise<string> {
  const visibilityMap = {
    PUBLIC: 'PUBLIC',
    CONNECTIONS: 'CONNECTIONS',
    LOGGED_IN: 'LOGGED_IN',
  };

  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': visibilityMap[visibility],
    },
  };

  const response = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errMsg = `Failed to create post: ${response.status}`;
    try {
      const err = await response.json() as { message?: string };
      if (err.message) errMsg += ` — ${err.message}`;
    } catch {}
    throw new Error(errMsg);
  }

  // LinkedIn returns the post ID in the X-RestLi-Id header
  const postId = response.headers.get('x-restli-id') ?? 'unknown';
  return postId;
}

export async function deletePost(accessToken: string, postId: string): Promise<void> {
  await linkedInRequest(`/ugcPosts/${encodeURIComponent(postId)}`, 'DELETE', accessToken);
}

export async function getPostAnalytics(
  accessToken: string,
  postId: string
): Promise<PostAnalytics> {
  // LinkedIn analytics uses the /organizationalEntityShareStatistics or /socialActions endpoints
  const [reactions, comments] = await Promise.all([
    linkedInRequest<{ paging: { total: number } }>(
      `/socialActions/${encodeURIComponent(postId)}/likes?count=0`,
      'GET',
      accessToken
    ).catch(() => ({ paging: { total: 0 } })),
    linkedInRequest<{ paging: { total: number } }>(
      `/socialActions/${encodeURIComponent(postId)}/comments?count=0`,
      'GET',
      accessToken
    ).catch(() => ({ paging: { total: 0 } })),
  ]);

  const likeCount = reactions.paging?.total ?? 0;
  const commentCount = comments.paging?.total ?? 0;

  return {
    postId,
    impressionCount: 0, // Requires Marketing API partner access
    clickCount: 0,
    likeCount,
    commentCount,
    shareCount: 0,
    engagementRate: 0,
  };
}

export async function getMyPosts(
  accessToken: string,
  personId: string,
  count = 10
): Promise<unknown[]> {
  const data = await linkedInRequest<{ elements?: unknown[] }>(
    `/ugcPosts?q=authors&authors=List(${encodeURIComponent(`urn:li:person:${personId}`)})&count=${count}`,
    'GET',
    accessToken
  );
  return data.elements ?? [];
}

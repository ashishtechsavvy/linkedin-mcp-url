import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getValidToken,
  getProfile,
  createPost,
  deletePost,
  getPostAnalytics,
  getMyPosts,
  getToken,
} from '../services/linkedin.js';

export function registerLinkedInTools(server: McpServer): void {

  // ─── CHECK AUTH ────────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_check_auth',
    {
      title: 'Check LinkedIn Auth Status',
      description: `Check whether a user has a valid LinkedIn token stored.
Returns: { authenticated, hasRefreshToken, expiresAt, isExpired }`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID to check'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id }) => {
      const token = getToken(user_id);
      const result = {
        authenticated: !!token,
        hasRefreshToken: !!token?.refresh_token,
        expiresAt: token ? new Date(token.expires_at).toISOString() : null,
        isExpired: token ? Date.now() >= token.expires_at : null,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── GET PROFILE ───────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_get_profile',
    {
      title: 'Get LinkedIn Profile',
      description: `Fetch the authenticated user's LinkedIn profile (name, ID, headline).
Use this first to get the person's LinkedIn ID needed for posting.
Returns: { id, firstName, lastName, headline }`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id }) => {
      const token = await getValidToken(user_id);
      const profile = await getProfile(token);
      return { content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }] };
    }
  );

  // ─── CREATE POST ───────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_create_post',
    {
      title: 'Create LinkedIn Post',
      description: `Publish a text post to LinkedIn as the authenticated user or a company page.
Args: user_id, person_linkedin_id, text (max 3000 chars), visibility (PUBLIC|CONNECTIONS|LOGGED_IN), author_type (person|organization), organization_id (if org)
Returns: { postId, authorUrn, visibility, message }`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
        person_linkedin_id: z.string().describe('LinkedIn person ID from linkedin_get_profile'),
        text: z.string().min(1).max(3000).describe('Post text content'),
        visibility: z.enum(['PUBLIC', 'CONNECTIONS', 'LOGGED_IN']).default('PUBLIC'),
        author_type: z.enum(['person', 'organization']).default('person'),
        organization_id: z.string().optional().describe('Required if author_type is organization'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ user_id, person_linkedin_id, text, visibility, author_type, organization_id }) => {
      const token = await getValidToken(user_id);
      let authorUrn: string;
      if (author_type === 'organization') {
        if (!organization_id) throw new Error('organization_id is required when author_type is organization');
        authorUrn = `urn:li:organization:${organization_id}`;
      } else {
        authorUrn = `urn:li:person:${person_linkedin_id}`;
      }
      const postId = await createPost(token, authorUrn, text, visibility);
      const result = { postId, authorUrn, visibility, message: 'Post published successfully' };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── GET MY POSTS ──────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_get_my_posts',
    {
      title: 'Get My LinkedIn Posts',
      description: `Retrieve recent posts by the authenticated user.
Args: user_id, person_linkedin_id, count (1-50, default 10)
Returns: { count, posts[] }`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
        person_linkedin_id: z.string().describe('LinkedIn person ID'),
        count: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, person_linkedin_id, count }) => {
      const token = await getValidToken(user_id);
      const posts = await getMyPosts(token, person_linkedin_id, count);
      const result = { count: posts.length, posts };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ─── GET POST ANALYTICS ────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_get_post_analytics',
    {
      title: 'Get LinkedIn Post Analytics',
      description: `Get engagement metrics for a LinkedIn post you own.
Args: user_id, post_id (URN e.g. urn:li:ugcPost:123456789)
Returns: { postId, likeCount, commentCount }`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
        post_id: z.string().describe('LinkedIn post URN'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, post_id }) => {
      const token = await getValidToken(user_id);
      const analytics = await getPostAnalytics(token, post_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(analytics, null, 2) }] };
    }
  );

  // ─── DELETE POST ───────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_delete_post',
    {
      title: 'Delete LinkedIn Post',
      description: `Permanently delete a LinkedIn post you own. Cannot be undone.
Args: user_id, post_id (URN)
Returns: { deleted, postId }`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
        post_id: z.string().describe('LinkedIn post URN to delete'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, post_id }) => {
      const token = await getValidToken(user_id);
      await deletePost(token, post_id);
      const result = { deleted: true, postId: post_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}

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

  // ─── GET PROFILE ───────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_get_profile',
    {
      title: 'Get LinkedIn Profile',
      description: `Fetch the authenticated user's LinkedIn profile info (name, ID, headline).
Use this first to get the person's LinkedIn ID, which is needed for posting.

Returns: { id, firstName, lastName, headline }

Error: "No token found" means user needs to authenticate at /auth/linkedin first.`,
      inputSchema: {
        user_id: z.string().describe('Your internal user ID used to look up the stored LinkedIn token'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id }) => {
      const token = await getValidToken(user_id);
      const profile = await getProfile(token);
      return {
        content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }],
        structuredContent: profile,
      };
    }
  );

  // ─── CREATE POST ───────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_create_post',
    {
      title: 'Create LinkedIn Post',
      description: `Publish a text post to LinkedIn on behalf of the authenticated user or a company page they manage.

Args:
  - user_id: Your internal user ID (used to retrieve stored token)
  - person_linkedin_id: LinkedIn person ID (get from linkedin_get_profile)
  - text: Post content (plain text, max ~3000 chars recommended)
  - visibility: PUBLIC | CONNECTIONS | LOGGED_IN (default: PUBLIC)
  - author_type: 'person' (default) | 'organization'
  - organization_id: Required if author_type is 'organization'

Returns: { postId } — the LinkedIn post URN

Notes:
  - Requires w_member_social scope for person posts
  - Requires rw_organization_admin scope for company page posts
  - LinkedIn rate limits: ~100 posts/day per user`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID to look up stored token'),
        person_linkedin_id: z.string().describe('LinkedIn person ID from linkedin_get_profile'),
        text: z.string().min(1).max(3000).describe('Post text content'),
        visibility: z.enum(['PUBLIC', 'CONNECTIONS', 'LOGGED_IN']).default('PUBLIC').describe('Post visibility'),
        author_type: z.enum(['person', 'organization']).default('person').describe('Post as person or organization'),
        organization_id: z.string().optional().describe('LinkedIn organization ID (required if author_type is organization)'),
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

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── GET MY POSTS ──────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_get_my_posts',
    {
      title: 'Get My LinkedIn Posts',
      description: `Retrieve recent posts published by the authenticated user.

Args:
  - user_id: Internal user ID
  - person_linkedin_id: LinkedIn person ID from linkedin_get_profile
  - count: Number of posts to return (1–50, default 10)

Returns: Array of post objects with id, text, visibility, lifecycleState, created timestamps`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
        person_linkedin_id: z.string().describe('LinkedIn person ID'),
        count: z.number().int().min(1).max(50).default(10).describe('Number of posts to return'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, person_linkedin_id, count }) => {
      const token = await getValidToken(user_id);
      const posts = await getMyPosts(token, person_linkedin_id, count);
      const result = { count: posts.length, posts };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── GET POST ANALYTICS ────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_get_post_analytics',
    {
      title: 'Get LinkedIn Post Analytics',
      description: `Get engagement metrics for a specific LinkedIn post you own.

Args:
  - user_id: Internal user ID
  - post_id: LinkedIn post URN (e.g., urn:li:ugcPost:123456789)

Returns: { postId, likeCount, commentCount }

Note: Full impression/click data requires LinkedIn Marketing API partner access.
Basic like/comment counts are available with standard API access.`,
      inputSchema: {
        user_id: z.string().describe('Internal user ID'),
        post_id: z.string().describe('LinkedIn post URN from linkedin_create_post or linkedin_get_my_posts'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ user_id, post_id }) => {
      const token = await getValidToken(user_id);
      const analytics = await getPostAnalytics(token, post_id);

      return {
        content: [{ type: 'text', text: JSON.stringify(analytics, null, 2) }],
        structuredContent: analytics,
      };
    }
  );

  // ─── DELETE POST ───────────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_delete_post',
    {
      title: 'Delete LinkedIn Post',
      description: `Delete a LinkedIn post you own.

Args:
  - user_id: Internal user ID
  - post_id: LinkedIn post URN

Warning: This is permanent and cannot be undone.`,
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

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );

  // ─── CHECK AUTH STATUS ─────────────────────────────────────────────────────
  server.registerTool(
    'linkedin_check_auth',
    {
      title: 'Check LinkedIn Auth Status',
      description: `Check whether a user has a valid LinkedIn token stored.

Returns: { authenticated, hasRefreshToken, expiresAt }
Use this before any other tool to confirm the user is authenticated.`,
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

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}

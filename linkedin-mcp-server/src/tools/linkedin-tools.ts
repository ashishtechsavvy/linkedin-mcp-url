import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getValidToken,
  getProfile,
  createPost,
  deletePost,
  getPostAnalytics,
  getMyPosts,
  getToken,
} from '../services/linkedin.js';

export function registerLinkedInTools(server: Server): void {

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'linkedin_check_auth',
        description: 'Check whether a user has a valid LinkedIn token. Returns { authenticated, hasRefreshToken, expiresAt, isExpired }',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string', description: 'Internal user ID' },
          },
          required: ['user_id'],
        },
      },
      {
        name: 'linkedin_get_profile',
        description: 'Get LinkedIn profile (name, ID, headline). Returns { id, firstName, lastName, headline }',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string', description: 'Internal user ID' },
          },
          required: ['user_id'],
        },
      },
      {
        name: 'linkedin_create_post',
        description: 'Publish a text post to LinkedIn. Returns { postId, authorUrn, visibility, message }',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            person_linkedin_id: { type: 'string', description: 'From linkedin_get_profile' },
            text: { type: 'string', description: 'Post content max 3000 chars' },
            visibility: { type: 'string', enum: ['PUBLIC', 'CONNECTIONS', 'LOGGED_IN'], default: 'PUBLIC' },
            author_type: { type: 'string', enum: ['person', 'organization'], default: 'person' },
            organization_id: { type: 'string', description: 'Required if author_type is organization' },
          },
          required: ['user_id', 'person_linkedin_id', 'text'],
        },
      },
      {
        name: 'linkedin_get_my_posts',
        description: 'Get recent posts by the authenticated user. Returns { count, posts[] }',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            person_linkedin_id: { type: 'string' },
            count: { type: 'number', default: 10, description: '1-50' },
          },
          required: ['user_id', 'person_linkedin_id'],
        },
      },
      {
        name: 'linkedin_get_post_analytics',
        description: 'Get likes and comments for a post. Returns { postId, likeCount, commentCount }',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            post_id: { type: 'string', description: 'LinkedIn post URN' },
          },
          required: ['user_id', 'post_id'],
        },
      },
      {
        name: 'linkedin_delete_post',
        description: 'Permanently delete a LinkedIn post you own.',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: { type: 'string' },
            post_id: { type: 'string', description: 'LinkedIn post URN' },
          },
          required: ['user_id', 'post_id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, string | number | undefined>;

    try {
      switch (name) {

        case 'linkedin_check_auth': {
          const token = await getToken(a.user_id as string);
          return { content: [{ type: 'text', text: JSON.stringify({
            authenticated: !!token,
            hasRefreshToken: !!token?.refresh_token,
            expiresAt: token ? new Date(token.expires_at).toISOString() : null,
            isExpired: token ? Date.now() >= token.expires_at : null,
          }, null, 2) }] };
        }

        case 'linkedin_get_profile': {
          const token = await getValidToken(a.user_id as string);
          const profile = await getProfile(token);
          return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }] };
        }

        case 'linkedin_create_post': {
          const token = await getValidToken(a.user_id as string);
          const authorType = (a.author_type as string) ?? 'person';
          let authorUrn: string;
          if (authorType === 'organization') {
            if (!a.organization_id) throw new Error('organization_id required');
            authorUrn = `urn:li:organization:${a.organization_id}`;
          } else {
            authorUrn = `urn:li:person:${a.person_linkedin_id}`;
          }
          const visibility = (a.visibility as 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN') ?? 'PUBLIC';
          const postId = await createPost(token, authorUrn, a.text as string, visibility);
          return { content: [{ type: 'text', text: JSON.stringify({ postId, authorUrn, visibility, message: 'Post published successfully' }, null, 2) }] };
        }

        case 'linkedin_get_my_posts': {
          const token = await getValidToken(a.user_id as string);
          const posts = await getMyPosts(token, a.person_linkedin_id as string, (a.count as number) ?? 10);
          return { content: [{ type: 'text', text: JSON.stringify({ count: posts.length, posts }, null, 2) }] };
        }

        case 'linkedin_get_post_analytics': {
          const token = await getValidToken(a.user_id as string);
          const analytics = await getPostAnalytics(token, a.post_id as string);
          return { content: [{ type: 'text', text: JSON.stringify(analytics, null, 2) }] };
        }

        case 'linkedin_delete_post': {
          const token = await getValidToken(a.user_id as string);
          await deletePost(token, a.post_id as string);
          return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, postId: a.post_id }, null, 2) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });
}

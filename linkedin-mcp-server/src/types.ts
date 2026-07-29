// LinkedIn API Types

export interface LinkedInToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // Unix timestamp
  person_id?: string;
}

export interface LinkedInProfile {
  id: string;
  firstName: string;
  lastName: string;
  profilePicture?: string;
  headline?: string;
}

export interface LinkedInPost {
  id: string;
  author: string;
  text: string;
  visibility: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN';
  lifecycleState: 'PUBLISHED' | 'DRAFT';
  created?: number;
  lastModified?: number;
}

export interface PostAnalytics {
  postId: string;
  impressionCount: number;
  clickCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate: number;
}

export interface CreatePostParams {
  text: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN';
  authorType?: 'person' | 'organization';
  organizationId?: string;
}

export interface LinkedInApiError {
  status: number;
  message: string;
  code?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
  token_type: string;
}

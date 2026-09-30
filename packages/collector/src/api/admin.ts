import {
  API_ENDPOINTS,
  type ApiKeyInfo,
  type OrganizationMember,
  type Workspace,
} from '@claude-audit/shared';
import { HttpClient, type HttpClientOptions } from './client.js';

/** Admin API client (sk-ant-admin key). */
export class AdminApi {
  private readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  listMembers(): Promise<OrganizationMember[]> {
    return this.http.getAll(API_ENDPOINTS.ORG_MEMBERS);
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.http.getAll(API_ENDPOINTS.ORG_WORKSPACES);
  }

  listApiKeys(): Promise<ApiKeyInfo[]> {
    return this.http.getAll(API_ENDPOINTS.ORG_API_KEYS);
  }
}

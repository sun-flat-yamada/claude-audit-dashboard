import { API_ENDPOINTS, type AuditActivity } from '@claude-audit/shared';
import { HttpClient, type HttpClientOptions } from './client.js';

/** Compliance API client (Compliance Access Key). */
export class ComplianceApi {
  private readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  /** Fetch activities, optionally only those after the given activity id. */
  listActivities(afterId?: string): Promise<AuditActivity[]> {
    return this.http.getAll<AuditActivity>(
      API_ENDPOINTS.COMPLIANCE_ACTIVITIES,
      afterId ? { after_id: afterId } : {},
    );
  }
}

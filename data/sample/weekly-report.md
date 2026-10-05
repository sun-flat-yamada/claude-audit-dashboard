# Weekly audit digest — 2026-09-22 to 2026-09-28

Period: 2026-09-22T00:00:00.000Z – 2026-09-29T00:00:00.000Z  
Generated: 2026-09-29T12:00:00.000Z

## Summary

| Metric | Value |
| --- | --- |
| Compliance score | 70/100 |
| Score change | +0 |
| Activities collected | 271 |
| Cost (7 days) | $1,455.33 |

## Open findings

| Rule | Name | Severity | Status | Message |
| --- | --- | --- | --- | --- |
| AC-001 | Inactive Members | medium | fail | 4 member(s) without activity in the last 90 days |
| AC-004 | Stale Pending Invites | low | fail | 1 invite(s) pending for more than 30 days |
| AK-001 | Unused API Keys | medium | fail | 1 key(s) unused for more than 30 days |
| AK-002 | Over-privileged API Keys | high | fail | 1 active key(s) hold write or delete scopes |
| AK-003 | API Key Age | medium | fail | 1 active key(s) older than 180 days |
| UA-001 | Usage Spike Detection | high | fail | 2026-09-28: 29,775,326 tokens exceed 3x the 7-day average (7,422,143) |
| UA-003 | Members Without Spend Limit | medium | fail | 3 member(s) have no spend limit |
| UA-004 | Spend Limit Nearly Exhausted | low | warning | 2 member(s) at or above 90% of their limit |
| DG-001 | Empty Groups | low | fail | 1 group(s) have no members |
| CF-003 | IP Allowlist Enabled | medium | fail | 1 of 3 organization(s) deviate on ip_allowlist_enabled |
| CF-005 | Finite Data Retention | medium | fail | 2 of 3 organization(s) deviate on data_retention_periods |
| AM-001 | Privileged Role Changes | high | warning | 1 matching event(s) since the previous collection |
| AM-003 | Network Restriction Changes | medium | warning | 1 matching event(s) since the previous collection |
| AM-005 | Data Export Events | medium | warning | 1 matching event(s) since the previous collection |
| AM-006 | Authentication Failure Burst | medium | warning | 24 matching event(s) since the previous collection |

## Top activity types

| Activity type | Events |
| --- | --- |
| claude_chat_created | 53 |
| claude_file_uploaded | 53 |
| sso_login_succeeded | 53 |
| claude_project_created | 52 |
| compliance_api_accessed | 33 |
| sso_login_failed | 24 |
| claude_user_role_updated | 1 |
| org_ip_restriction_updated | 1 |
| org_members_exported | 1 |

## Cost by product (7 days)

| Name | Cost | Share of total |
| --- | --- | --- |
| chat | $654.89 | 45.0% |
| claude_code | $582.14 | 40.0% |
| cowork | $218.30 | 15.0% |

## Insights

- claude-opus-5 accounts for 62% of spend — Review whether routine tasks can be routed to a smaller, cheaper model.
- Only 27.1% of input tokens were cache reads — Long, repeated context (projects, system prompts, tools) benefits from prompt caching.

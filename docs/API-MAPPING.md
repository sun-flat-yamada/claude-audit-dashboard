# API Mapping — Claude Enterprise APIs → datasets

> **確認日:** 2026-09-30 (`platform.claude.com/docs` の Markdown 原文を取得して照合)
> **実テナントでの疎通:** 未確認。未検証の仮定は [CHANGE-PLAN.md §10](CHANGE-PLAN.md#10-リスクと未検証の仮定-phase-b1-で確認) を参照。
> 実装: `packages/collector/src/adapters/anthropic/`

---

## 1. 共通

| 項目       | 内容                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ベース URL | `https://api.anthropic.com`                                                                                                                                                         |
| 認証       | `x-api-key: <key>` + `anthropic-version: 2023-06-01`                                                                                                                                |
| キー       | claude.ai **Organization settings > API** で primary owner が作成する `sk-ant-api01-...` (対象: すべてのリンク組織)                                                                 |
| エラー形式 | 非 2xx、`request-id` ヘッダ、`{ "error": { "type", "message" } }`。403 のメッセージは保持スコープと必要スコープを列挙する                                                           |
| リトライ   | 429: `retry-after` 秒待機 (無ければ指数バックオフ)。500 (`x-should-retry: false` を除く) / 502 / 503 / 504 / 529: 1 秒から 60 秒上限の指数バックオフ。4xx (429 以外) は再試行しない |
| 配列クエリ | `key[]=a&key[]=b`                                                                                                                                                                   |
| 範囲クエリ | ドット記法 (`created_at.gte=...`)                                                                                                                                                   |
| 金額       | セント単位の小数文字列 (`"41280.000000"` = $412.80)。÷100 で主単位へ                                                                                                                |

### ページング方式

| 方式           | リクエスト                               | レスポンス                                | 終了条件                                     | 使用箇所                                                                     |
| -------------- | ---------------------------------------- | ----------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| ID カーソル    | `after_id` (または `before_id`)、`limit` | `data`, `has_more`, `first_id`, `last_id` | `has_more = false`                           | Activity Feed、Admin users / invites                                         |
| ページトークン | `page`, `limit`                          | `data`, `has_more`, `next_page`           | `has_more = false` または `next_page = null` | Compliance organizations / groups、Admin rbac_groups、Analytics usage / cost |
| next_page のみ | `page`, `limit`                          | `data`, `next_page`                       | `next_page = null`                           | Analytics users、Spend Limits                                                |
| (単一)         | —                                        | オブジェクト                              | —                                            | Compliance settings、Analytics summaries (系列は 1 ページで全件)             |

Analytics のカーソルはデータ更新で失効し 410 を返す → 先頭から 1 回だけ再取得する。

---

## 2. Compliance API (`/v1/compliance/*`、600 req/分/親組織)

### 2.1 `GET /v1/compliance/activities` → `activities`

| 項目     | 内容                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| スコープ | `read:compliance_activities`                                                                                                                                                                                                         |
| 取得方式 | window polling: `created_at.gte = 前回の窓終端 − 10 分`、`created_at.lt = 現在 − 2 分`、`limit=5000` (並び順は新しい順の既定のまま。公式に並び替えパラメータの記載がないため送らない)、`after_id=<last_id>` で `has_more=false` まで |
| 除外     | 既定で `exclude_activity_types[]` に閲覧系 (`claude_chat_viewed` など)。`activity_types[]` と同時指定不可                                                                                                                            |
| 重複排除 | 窓の重複区間の ID を状態 (`cursors.activities.recentIds`) に保持し除外 (公式推奨の at-least-once + ID 重複排除)                                                                                                                      |
| 保持     | Anthropic 側 6 年。記録は Compliance API 有効化以降のみ                                                                                                                                                                              |
| 注意     | 返却順は既定で新しい順、`after_id` は「より古い」方向。`*_viewed` は表示ではなくアプリの読み込み回数                                                                                                                                 |

| 外部項目                                                                       | ドメイン                               |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| `id`                                                                           | `Activity.id`                          |
| `type` (516 種、増加する)                                                      | `Activity.type` (未知の値も保持)       |
| `created_at`                                                                   | `Activity.createdAt`                   |
| `organization_uuid` / `organization_id`                                        | `Activity.organizationId` (null 可)    |
| `actor.type`                                                                   | `Activity.actor.kind` (未知の値も保持) |
| `actor.user_id` / `api_key_id` / `admin_api_key_id`                            | `Activity.actor.id`                    |
| `actor.email_address` / `unauthenticated_email_address`                        | `Activity.actor.email`                 |
| `actor.ip_address`                                                             | `Activity.actor.ip`                    |
| その他のトップレベル項目 (例: `previous_role`, `current_role`, `new_owner_id`) | `Activity.attributes`                  |

### 2.2 `GET /v1/compliance/organizations` → `organizations`

スコープ `read:compliance_org_data`。ページトークン (`limit` 最大 1000)。`uuid`, `name`, `created_at` → `Organization`。親組織自身は含まれない。

### 2.3 `GET /v1/compliance/organizations/{uuid}/settings` → `settings`, `credentials`

| 項目         | 内容                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| スコープ     | `read:compliance_org_data` (旧 `read:compliance_org_settings` は 2026-06-30 に廃止)                                                                                                                      |
| 呼び出し     | リンク組織ごとに 1 回。親組織は対象外。未提供のテナントは全組織で 404                                                                                                                                    |
| `settings[]` | `{ name, type, value }`。type は `boolean` / `integer` (null = 無制限) / `string` / `string_list` / `provisioning_mode` / `data_retention`。**行が無い = その組織の管理者が変更できない (オフではない)** |
| `api_keys[]` | 親組織配下のキー台帳 (どの組織で呼んでも同じ)。`id`, `name`, `scopes`, `is_active`, `created_at`, `expires_at`, `created_by_id` → `Credential`                                                           |

### 2.4 `GET /v1/compliance/groups` → `groups` (代替経路)

スコープ `read:compliance_org_data`。`id`, `name`, `source_type` (`direct` / `scim`), `roles` → `Group` (メンバー数は `read:compliance_user_data` が必要なため取得しない)。

### 2.5 `GET /v1/compliance/organizations/{uuid}/users` → `members` (代替経路)

スコープ `read:compliance_user_data` (**本文閲覧権限を含むため既定では使わない**)。`organization_role` は `admin`, `billing`, `claude_code_user`, `developer`, `managed`, `membership_admin`, `owner`, `parent_org_admin`, `parent_org_owner`, `primary_owner`, `user`。

---

## 3. Admin API — user management (`/v1/organizations/*`、100 req/分/組織)

| エンドポイント                                     | スコープ                                          | ページング                      | ドメイン                                                                             |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /v1/organizations/users`                      | `read:members`                                    | ID カーソル (`limit` 最大 1000) | `Member { id, email, name, role, joinedAt ← added_at }`                              |
| `GET /v1/organizations/invites?statuses[]=pending` | `read:members`                                    | ID カーソル                     | `Invite { id, email, role, status, invitedAt ← invited_at, expiresAt ← expires_at }` |
| `GET /v1/organizations/rbac_groups`                | `read:rbac_groups` (全リンク組織対象のキーが必要) | ページトークン                  | `Group { id, name, source ← source_type, roleIds ← role_ids }`                       |
| `GET /v1/organizations/rbac_groups/{id}/members`   | `read:rbac_groups`                                | ページトークン                  | `Group.memberCount` (件数のみ。上限 `sources.groups.maxMemberRequests`)              |

Enterprise のロールは `user`, `managed`, `owner`, `membership_admin`, `primary_owner` (primary owner は 1 名)。管理系ロールは API から付与・変更できない。

---

## 4. Claude Enterprise Analytics API (`/v1/organizations/analytics/*`、60 req/分/組織、`read:analytics`)

2026-01-01 以前のデータは無い。活動系は 1 日遅れ、使用量・コストは通常 4 時間以内 (最大 24 時間)、30 日間は改訂され得る。

| エンドポイント                | 取得パラメータ                                                                                                                            | ドメイン                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /analytics/users`        | `starting_date = 今日 − 90 日` (期間ロールアップ)、`limit=1000`、next_page のみ                                                           | `MemberActivity { userId ← user.id, email ← user.email_address, lastActiveOn ← last_activity_date, active ← 活動カウンタ > 0 }` (`last_activity_date` は機能が有効な組織のみ)                        |
| `GET /analytics/summaries`    | `starting_date = 今日 − 30 日`                                                                                                            | `AdoptionDay { date, dau, wau, mau, assignedSeats, dailyAdoptionRate, monthlyAdoptionRate, pendingInvites }`                                                                                         |
| `GET /analytics/usage_report` | `starting_at = 今日 − 30 日 00:00Z`、`bucket_width=1d`、`limit=31`、`group_by[]` を total / `product` / `model` / `rbac_group_id` で 4 回 | `UsageRow { date, dimension, key, uncachedInputTokens, cacheReadInputTokens, cacheCreationInputTokens (5m + 1h), outputTokens, webSearchRequests, requests }`、`data_refreshed_at` → coverage `asOf` |
| `GET /analytics/cost_report`  | 同上                                                                                                                                      | `CostRow { date, dimension, key, amount ← amount ÷ 100, listAmount ← list_amount ÷ 100, currency }`                                                                                                  |

任意収集 (`sources.usageMatrix.enabled`、既定 off、スナップショットのデータセットではない): `cost_report` に `group_by[]=model&group_by[]=rbac_group_id` (モデル × グループ、重なりあり) と `group_by[]=model` (加算可能なモデル構成比) を `bucket_width=1d` で取得し、月次に集計して `detail/usage-matrix.json` にする (F-010)。`group_by[]` が配列パラメータであることは Admin Usage / Cost API リファレンスで確認済み。Analytics API が 2 値を同時に受け付けるかは**未確認 (推定)**で、拒否された場合は `unavailable` として扱う (実テナントでの確認は `--capture-raw` で行う)。

`rbac_group_id` 別の値は「所属していた全グループに計上」されるため合計が総額を超え得る。総額は group_by 無しの行を使う。各バケットは上位 100 グループまで。

---

## 5. Spend Limits API (`/v1/organizations/spend_limits/*`、60 req/分/組織)

| エンドポイント                                                  | スコープ            | ページング                         | ドメイン                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/organizations/spend_limits/effective?period[]=monthly` | `read:spend_limits` | next_page のみ (`limit` 最大 1000) | `SpendLimit { userId ← actor.user_id, email ← actor.email_address, period, limit ← amount ÷ 100 (null = 無制限), spent ← period_to_date_spend ÷ 100, source ← source.type, currency }` |

前提: 組織で usage credits が有効。`period_to_date_spend` は一時的に `"0"` になり得る (参考値)。

---

## 6. 使わない API と理由

| API                                                                      | 理由                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Compliance の chats / files / projects / sessions                        | 本文・添付・トランスクリプトの閲覧権限 (`read:compliance_user_data`) を要する。監査ダッシュボードの目的を超えるため対象外 |
| 書き込み・削除系 (`write:*`, `delete:*`)                                 | 読み取り専用の監査基盤とするため                                                                                          |
| Admin API の workspaces / api_keys / usage_report / cost_report          | Claude Console 組織向け。Enterprise には存在しない (リンクされた Console 組織への対応は Phase B4 の任意アダプタ)          |
| Claude Code Analytics API (`/v1/organizations/usage_report/claude_code`) | Admin API キー (Console) が必要。Phase B4 の任意アダプタ                                                                  |

---

## 7. 一次情報

- Compliance API: <https://platform.claude.com/docs/en/manage-claude/compliance-api>
- Set up the Compliance API (キー種別・スコープ): <https://platform.claude.com/docs/en/manage-claude/compliance-api-access>
- Query the Activity Feed: <https://platform.claude.com/docs/en/manage-claude/compliance-activity-feed>
- Design your compliance integration (window polling / cursor): <https://platform.claude.com/docs/en/manage-claude/compliance-integration-patterns>
- Organizations, users, roles, groups, settings: <https://platform.claude.com/docs/en/manage-claude/compliance-org-data>
- Compliance errors (429 / 5xx): <https://platform.claude.com/docs/en/manage-claude/compliance-errors>
- Activity list reference (516 activity types): <https://platform.claude.com/docs/en/api/compliance/activities/list>
- Effective settings reference: <https://platform.claude.com/docs/en/api/compliance/organizations/settings/retrieve>
- Create an Admin API key (Enterprise のスコープ表): <https://platform.claude.com/docs/en/manage-claude/admin-api-keys>
- User management (Enterprise): <https://platform.claude.com/docs/en/manage-claude/user-management>
- Analytics APIs: <https://platform.claude.com/docs/en/manage-claude/analytics-api>
- Enterprise Analytics reference: <https://platform.claude.com/docs/en/api/beta/organization/analytics>
- Spend Limits API: <https://platform.claude.com/docs/en/manage-claude/spend-limits-api>

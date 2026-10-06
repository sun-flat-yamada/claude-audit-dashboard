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

| エンドポイント                | 取得パラメータ                                                                                                                            | ドメイン                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /analytics/users`        | `starting_date = 今日 − 90 日` (期間ロールアップ)、`limit=1000`、next_page のみ                                                           | `MemberActivity { userId ← user.id, email ← user.email_address, lastActiveOn ← last_activity_date, active ← 活動カウンタ > 0, engagement }` (`last_activity_date` は機能が有効な組織のみ、`engagement` は下記) |
| `GET /analytics/summaries`    | `starting_date = 今日 − 30 日`                                                                                                            | `AdoptionDay { date, dau, wau, mau, assignedSeats, dailyAdoptionRate, monthlyAdoptionRate, pendingInvites, byProduct }` (`byProduct` は下記)                                                                   |
| `GET /analytics/usage_report` | `starting_at = 今日 − 30 日 00:00Z`、`bucket_width=1d`、`limit=31`、`group_by[]` を total / `product` / `model` / `rbac_group_id` で 4 回 | `UsageRow { date, dimension, key, uncachedInputTokens, cacheReadInputTokens, cacheCreationInputTokens (5m + 1h), outputTokens, webSearchRequests, requests }`、`data_refreshed_at` → coverage `asOf`           |
| `GET /analytics/cost_report`  | 同上                                                                                                                                      | `CostRow { date, dimension, key, amount ← amount ÷ 100, listAmount ← list_amount ÷ 100, currency }`                                                                                                            |

`users` の製品別エンゲージメント (AN-3): 同じ呼び出しの各行のメトリクスブロックを `MemberActivity.engagement` に写像する (追加の API 呼び出しは無い)。`chat_metrics` → `chat { messages ← message_count, conversations ← distinct_conversation_count, projectsCreated ← distinct_projects_created_count, artifactsCreated ← distinct_artifacts_created_count, filesUploaded ← distinct_files_uploaded_count, connectorCalls ← connectors_used_count, thinkingMessages ← thinking_message_count }`、`claude_code_metrics.core_metrics` → `claudeCode { sessions ← distinct_session_count, commits ← commit_count, pullRequests ← pull_request_count, addedLines / removedLines ← lines_of_code.{added,removed}_count, artifactsCreated ← artifacts_created_count }`、`claude_code_metrics.tool_actions.{edit,multi_edit,write,notebook_edit}_tool` → `claudeCode.tools.{edit,multiEdit,write,notebookEdit} { accepted ← accepted_count, rejected ← rejected_count }`、`cowork_metrics` → `cowork { messages, sessions, actions ← action_count, dispatchTurns ← dispatch_turn_count, skillCalls ← skills_used_count, artifactsCreated }`、`design_metrics` → `design { messages, sessions, projectsCreated }`、`office_metrics.{excel,outlook,powerpoint,word}` → `office` (4 アプリの合計: `messages`, `sessions`, `skillCalls`, `connectorCalls`)、`science_metrics` → `science { messages, sessions, delegations ← delegation_count, computeJobs ← remote_compute_job_count }`、`web_search_count` → `webSearches`。すべて寛容に読む (欠落したブロックはその製品なし、`null` や想定外の値のカウンタは `null` で、収集は失敗させない)。distinct 系は期間ロールアップでは HLL の概算 (誤差 2% 未満) または `null`。`active` / `lastActiveOn` (AC-001 の入力) の写像は変わらない。Cowork のファイル編集・プラグイン系、`distinct_*_used_count` などの残りのフィールドは写像しない。ダッシュボードには個人単位でなく集計 (`DashboardView.engagement`) だけを出す。

`summaries` の製品別アクティブユーザー (AN-2): 同じ呼び出しの `<product>_{daily,weekly,monthly}_active_user_count` (`product` = `chat` / `claude_code` / `cowork` / `claude_design` / `office_agent` / `science`) を `AdoptionDay.byProduct { product, dau, wau, mau }[]` に写像する。公式リファレンスでは `cowork_*` が必須、他は optional / nullable (製品別内訳が組織で有効でない間は省略) だが、すべて寛容 (`nullish`) に読み、3 値のどれかが欠落または `null` の製品は含めない (収集は失敗させない)。`science_entitled_user_count` は写像しない。追加の API 呼び出しは無い。

任意収集 (`sources.usageMatrix.enabled`、既定 off、スナップショットのデータセットではない): `cost_report` に `group_by[]=model&group_by[]=rbac_group_id` (モデル × グループ、重なりあり) と `group_by[]=model` (加算可能なモデル構成比) を `bucket_width=1d` で取得し、月次に集計して `dashboard.json` の `modelMatrix` にする (F-010、`DashboardView` v3)。`group_by[]` が配列パラメータであることは Admin Usage / Cost API リファレンスで確認済み。Analytics API が 2 値を同時に受け付けるかは**未確認 (推定)**で、拒否された場合は `unavailable` として扱う (実テナントでの確認は `--capture-raw` で行う)。

`rbac_group_id` 別の値は「所属していた全グループに計上」されるため合計が総額を超え得る。総額は group_by 無しの行を使う。各バケットは上位 100 グループまで。

---

## 5. Spend Limits API (`/v1/organizations/spend_limits/*`、60 req/分/組織)

| エンドポイント                                                  | スコープ            | ページング                         | ドメイン                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/organizations/spend_limits/effective?period[]=monthly` | `read:spend_limits` | next_page のみ (`limit` 最大 1000) | `SpendLimit { userId ← actor.user_id, email ← actor.email_address, period, limit ← amount ÷ 100 (null = 無制限), spent ← period_to_date_spend ÷ 100, source ← source.type, currency }` |

前提: 組織で usage credits が有効。`period_to_date_spend` は一時的に `"0"` になり得る (参考値)。

---

## 6. 任意アダプタ (Phase B4、既定オフ)

**リンクされた Console 組織の Admin API** と **Claude Code Analytics API** を、設定で有効にしたときだけ収集する。どちらも **Console 組織の Admin API キー** (`sk-ant-admin...`、環境変数 `ANTHROPIC_CONSOLE_ADMIN_API_KEY`) が必要で、Enterprise キーや `ANTHROPIC_ADMIN_API_KEY` (Enterprise の Admin 系統の上書き) にはフォールバックしない。API 仕様の差異は [api-spec-mismatch-findings.md](api-spec-mismatch-findings.md) §4 を参照。**実テナントでの疎通は未確認** (人手のタスク。`--capture-raw` で採取しサニタイズしてフィクスチャに反映する)。

| 設定                           | データセット                                                                      | 無効時                                            |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `sources.console.enabled`      | `consoleWorkspaces` / `consoleApiKeys` / `consoleUsage` / `consoleCost`           | 登録されず coverage に現れない (既存の挙動と同一) |
| `sources.claudeCode.enabled`   | `claudeCodeActivity`                                                              | 同上                                              |
| `sources.featureUsage.enabled` | `skillUsage` / `connectorUsage` / `pluginUsage` / `chatProjectUsage` (AN-6、§6.3) | 同上                                              |

例外として `sources.featureUsage` (AN-6) は Console キーではなく Enterprise Analytics API のキー (`ANTHROPIC_ENTERPRISE_API_KEY` または `ANTHROPIC_ANALYTICS_API_KEY`、`read:analytics`) を使う。

有効でキー未設定、または 401 / 403 / 404 は `unavailable` (理由にキー名を含む。OP-002 が設定漏れを知らせる)、スキーマ差異は `error`。他のデータセットの収集は止まらない。

### 6.1 Console Admin API (`/v1/organizations/*`)

| エンドポイント               | 取得パラメータ                                                                                                        | ページング                                        | ドメイン                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /workspaces`            | `include_archived=true`、`limit=1000`                                                                                 | ID カーソル (`after_id` / `has_more` / `last_id`) | `ConsoleWorkspace { id, name, createdAt ← created_at, archivedAt ← archived_at }`                                                                                        |
| `GET /api_keys`              | `limit=1000`                                                                                                          | ID カーソル                                       | `ConsoleApiKey { id, name, status, workspaceId ← workspace_id (default ワークスペースは null)、createdAt, createdBy ← created_by.id }` (`partial_key_hint` は保存しない) |
| `GET /usage_report/messages` | `starting_at = 今日 − lookbackDays 00:00Z`、`bucket_width=1d`、`limit=31`、`group_by[]=workspace_id&group_by[]=model` | ページトークン (`page` / `next_page`)             | `ConsoleUsageRow { date, workspaceId, model, uncachedInputTokens, cacheReadInputTokens, cacheCreationInputTokens (5m + 1h), outputTokens, webSearchRequests }`           |
| `GET /cost_report`           | 同上、`group_by[]=workspace_id&group_by[]=description`                                                                | ページトークン                                    | `ConsoleCostRow { date, workspaceId, model, costType ← cost_type, amount ← amount ÷ 100 (セント単位の小数文字列)、currency }`                                            |

`workspace_id: null` は default ワークスペース。Priority Tier のコストは `cost_report` に含まれない。

### 6.2 Claude Code Analytics API

| エンドポイント                  | 取得パラメータ                                                      | ページング                            | ドメイン                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /usage_report/claude_code` | `starting_at=YYYY-MM-DD` (1 日分。日ごとに系列を取得)、`limit=1000` | ページトークン (`page` / `next_page`) | `ClaudeCodeActivity { date, actorKind ← actor.type (`user_actor`→`user`、`api_actor`→`api`)、actor ← email_address / api_key_name、customerType, terminalType, sessions, linesAdded / linesRemoved, commits, pullRequests, toolAccepted / toolRejected (全ツール合計)、models[] ← model_breakdown (トークンと estimated_cost ÷ 100) }` |

行はユーザー (メールアドレス) または API キー名単位の個人データ。スナップショット (`data/audit`) にだけ保存し、`dashboard.json` と詳細ファイルには**公開しない** (集計のみ: coverage の件数)。

### 6.3 機能別の採用状況 (AN-6、Enterprise Analytics API、`read:analytics`)

スキル・コネクタ・プラグイン・claude.ai チャットプロジェクトの採用状況を、`sources.featureUsage.lookbackDays` (既定 30、1〜366) 日の**期間ロールアップ**で 1 系列ずつ取得する。共通パラメータは `starting_date = max(今日 − lookbackDays, 2026-01-01)`、`ending_date` なし (API が今日を使う)、`limit=1000`、`group_by[]` / `filter[]` なし (行にユーザーを含めない)。ページングはページトークン (`page` / `next_page`)。すべて `looseObject` と `nullish` で寛容に読み、必須フィールド (名前・ID と `distinct_user_count` など) の欠落はスキーマ差異 (`error`) とする。

| エンドポイント                      | ドメイン                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /analytics/skills`             | `SkillUsage { name ← skill_name, displayName ← skill_display_name, users ← distinct_user_count, invocations ← invocation_count, shareStatus ← share_status, chatConversations ← chat_metrics.distinct_conversation_skill_used_count, claudeCodeSessions / coworkSessions ← *.distinct_session_skill_used_count, officeSessions ← office_metrics.{excel,outlook,powerpoint,word} の合計 }` |
| `GET /analytics/connectors`         | `ConnectorUsage { name ← connector_name, displayName ← connector_display_name, users, readCalls ← read_call_count, writeCalls ← write_call_count, unclassifiedCalls ← unclassified_call_count, managedAuthUsers ← managed_auth_distinct_user_count, individualAuthUsers ← individual_auth_distinct_user_count, 製品別の会話 / セッション数 (skills と同じ) }`                             |
| `GET /analytics/plugins`            | `PluginUsage { name ← plugin_name, pluginId ← plugin_id, users, invocations ← invocation_count, installs ← install_count, claudeCodeSessions / coworkSessions ← *.distinct_session_plugin_used_count }`                                                                                                                                                                                   |
| `GET /analytics/apps/chat/projects` | `ChatProjectUsage { id ← project_id, name ← project_name, users, messages ← message_count, conversations ← distinct_conversation_count, createdAt ← created_at }`。**`created_by` (作成者のユーザー ID とメールアドレス) はスキーマに含めず、読まない・保存しない**                                                                                                                       |

`enable_count` (期間ロールアップでは常に null)、`estimated_overage_spend` / `attributed_list_price` / `currency`、`rbac_group_*`、`user_id`、`product` は写像しない。distinct 系の会話 / セッション数は期間ロールアップでは HLL の概算 (誤差 2% 未満) または `null`。コネクタの read / write 分類は 2026-05-29 以降の日にだけあり、それより前を含む期間では `null` (API がサーバー側で判定)。managed / individual 認証の利用者数は期間が 2026-07-01 以降に始まる場合だけ値を持つ。

公開: `dashboard.json` の任意フィールド `features` に、種類ごとに利用者数 (distinct users) 上位 20 件と総件数、コネクタ呼び出しの read / write / unclassified 合計を出す (§ BLUEPRINT の契約)。スキル・コネクタ・プラグイン・プロジェクトの**名前は組織の設定情報として公開する**。ユーザー ID・メールアドレス・作成者は公開しない。

---

## 7. 使わない API と理由

| API                                                                                                 | 理由                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Compliance の chats / files / projects / sessions                                                   | 本文・添付・トランスクリプトの閲覧権限 (`read:compliance_user_data`) を要する。監査ダッシュボードの目的を超えるため対象外 |
| 書き込み・削除系 (`write:*`, `delete:*`)                                                            | 読み取り専用の監査基盤とするため                                                                                          |
| Admin API の workspaces / api_keys / usage_report / cost_report                                     | Claude Console 組織向け。Enterprise キーでは使えない (リンクされた Console 組織への対応は §6 の任意アダプタ)              |
| Claude Code Analytics API (`/v1/organizations/usage_report/claude_code`)                            | Console の Admin API キーが必要。§6 の任意アダプタ (既定オフ)                                                             |
| Analytics API の `skills` / `connectors` / `plugins` / `apps/chat/projects` の `group_by[]=user_id` | 個人単位の利用状況になるため使わない。§6.3 は組織全体のロールアップだけを任意で取得する                                   |

---

## 8. 一次情報

- Compliance API: <https://platform.claude.com/docs/en/manage-claude/compliance-api>
- Analytics API (skills / connectors / plugins / chat projects): <https://platform.claude.com/docs/en/api/http/beta/organization/analytics/skills/list>、[connectors](https://platform.claude.com/docs/en/api/http/beta/organization/analytics/connectors/list)、[plugins](https://platform.claude.com/docs/en/api/http/beta/organization/analytics/plugins/list)、[apps/chat/projects](https://platform.claude.com/docs/en/api/http/beta/organization/analytics/apps/chat/projects/list)
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
- Admin API (workspaces / api_keys): <https://platform.claude.com/docs/en/api/admin/workspaces/list>, <https://platform.claude.com/docs/en/api/admin/api_keys/list>
- Usage and Cost API: <https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_messages>, <https://platform.claude.com/docs/en/api/admin/cost_report/retrieve>
- Claude Code Analytics API: <https://platform.claude.com/docs/en/api/claude-code-analytics-api>

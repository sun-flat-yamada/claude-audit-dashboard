# 検出した問題点: 実 Admin API 仕様とコード/ルール定義の不一致

新セッションで「ルール・型の修正方針」を検討するための入力資料。
作成日: 2026-09-30 / 対象リポジトリ: `sun-flat-yamada/claude-audit-dashboard`

> **来歴:** 本書 §1〜§7 は PR #24 を作成したセッションが出力した資料の原文(未コミットだったもの)をそのまま収録している。
> 本書を起点に行った要求仕様・設計方針の見直し結果は [CHANGE-PLAN.md](CHANGE-PLAN.md)、
> 公式ドキュメントとの再照合で判明した追加事項は末尾の [§8 追補](#8-追補-2026-09-30-公式ドキュメント再照合) を参照。
> §5 の「選択が必要な点」1 (組織種別) は **Claude Enterprise** に確定した。

---

## 1. 結論(要約)

1. **[修正済み・PR #24]** ページネーションのバグ。`HttpClient.getAll` が `starting_after` を送っていたが、Admin API の一覧系カーソルは `after_id`。`has_more: true` のとき同じ 1 ページ目を永遠に取得し続ける(無限ループ)。
2. **[未対応・要判断]** `@claude-audit/shared` の型と一部コンプライアンスルールが、実 API に存在しないフィールドを前提にしている。該当ルールは**実データでは何も検出せず pass する**(エラーにならないため気付きにくい)。
3. **[未対応・要判断]** Claude Enterprise(claude.ai)組織には Admin API キーがなく、別の Analytics API を使う。本プロジェクトが想定する組織の種別が未確定。
4. **[未確認]** Compliance API(`/v1/compliance/activities`)の実仕様は未取得。現状は `after_id` で実装しているが推測。

---

## 2. リポジトリの現状

| PR  | 内容                                                                    | 状態                      |
| --- | ----------------------------------------------------------------------- | ------------------------- |
| #17 | API クライアント、FileStore、Plugin Registry、10 ルールのチェッカー     | merged                    |
| #18 | repo 全体の Prettier 整形、`pnpm-lock.yaml`、未使用 import 削除         | merged                    |
| #23 | collectors、StateManager、`collect-audit` / `compliance-check` コマンド | merged                    |
| #24 | usage/cost collector、ページネーション修正                              | **open (draft)、CI 全緑** |

- 作業ブランチ: `claude/optimistic-bohr-oglejn`(マージ済み PR の後は main から作り直して使用)
- 誤って作った不要なリモートブランチ `feat/collector/collectors` が残っている(この環境からは削除不可。GitHub UI で削除が必要)
- 品質ゲート: `npm run fork:verify && typecheck && test && secret-scan && build`(`AGENTS.md` 規約 5)。CI は加えて `lint` と `format:check`
- **ルールを変更する場合の必須同期先**(`.agents/rules/compliance-rules-management.md`、`AGENTS.md` 規約 8):
  1. `packages/shared/src/constants/audit-rules.ts`
  2. `packages/shared/src/types/compliance.ts`
  3. `packages/collector/src/checkers/<category>.ts`
  4. `packages/collector/src/checkers/__tests__/<category>.test.ts`
  5. `docs/BLUEPRINT.md`(ルール表 §7.1)
  6. `README.md` のルール表
  7. `data/sample/dashboard.json`(デモ結果の更新が必要なら)

---

## 3. 根拠(一次情報)

公式リファレンスを取得して確認した。`docs.anthropic.com` は環境の egress proxy でブロックされたため、`platform.claude.com` の `.md` ページを使用。取得は WebFetch 経由(要約モデルを介するが、フィールド名・型・例は原文どおりに見えた)。**実 API には未接続**(この環境に API キーがない)。

- Users: `https://platform.claude.com/docs/en/api/admin/users/list.md`
- Workspaces: `https://platform.claude.com/docs/en/api/admin/workspaces/list.md`
- API Keys: `https://platform.claude.com/docs/en/api/admin/api_keys/list.md`
- Usage report: `https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_messages.md`
- Cost report: `https://platform.claude.com/docs/en/api/admin/cost_report/retrieve.md`
- ガイド: `https://platform.claude.com/docs/en/build-with-claude/usage-cost-api.md`

---

## 4. 詳細: 型/ルールと実 API の不一致

### 4.1 共通: ページネーション(修正済み)

| 種別                                  | 実 API                                                                                                   | 旧実装                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 一覧系(users / workspaces / api_keys) | `after_id` / `before_id` / `limit`(既定 20、最大 1000)。レスポンスは `has_more` / `first_id` / `last_id` | `starting_after` を送信(無視される) |
| usage / cost                          | `page` / `next_page`(不透明トークン)。1 ページは最大 `limit` 個の時間バケット                            | (未実装)                            |

配列パラメータは `group_by[]=model&group_by[]=workspace_id` 形式。

### 4.2 メンバー(`OrganizationMember`、`GET /v1/organizations/users`)

| shared の型                                                               | 実 API                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created_at`                                                              | **`added_at`**                                                                                                                                      |
| `last_active_at`                                                          | **存在しない**                                                                                                                                      |
| `role`: `primary_owner \| owner \| admin \| developer \| billing \| user` | 組織種別で異なる。Console: `user, developer, billing, admin, claude_code_user`。Enterprise: `user, owner, primary_owner, membership_admin, managed` |

影響するルール:

- **AC-001 Inactive Members**(90 日非アクティブ): `last_active_at ?? created_at` を使うが、実データでは両方 `undefined` → 日数が `NaN` になり比較が常に false → **常に pass**。Users API には活動情報がない。
- **AC-002 Excessive Admin Roles**: 対象ロールを `primary_owner, owner, admin` としている。`membership_admin` などが抜けている。
- **AC-003 Single Primary Owner**: `primary_owner` は Enterprise 組織にしか存在しない。**Console 組織では 0 件 → critical で誤って fail する**。

### 4.3 ワークスペース(`Workspace`、`GET /v1/organizations/workspaces`)

| shared の型    | 実 API                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| `member_count` | **存在しない**                                                                  |
| (なし)         | `archived_at`, `display_color`, `tags`, `data_residency`, `compartment_id` ほか |

- 既定ではアーカイブ済みは返らない(`include_archived=false`)。
- 影響: **DG-001 Empty Workspaces** は `member_count === 0` で判定 → `undefined` なので **常に pass**。

### 4.4 API キー(`ApiKeyInfo`、`GET /v1/organizations/api_keys`)

| shared の型                             | 実 API                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `last_used_at`                          | **存在しない**                                                                                      |
| `scopes: string[]`                      | **存在しない**。代わりに `scope`(`{type:'workspace', workspace_id}` または `{type:'organization'}`) |
| `status: active \| disabled \| expired` | `active \| archived \| expired \| inactive`                                                         |
| `created_by: {id, name}`                | `{type: 'user'\|'service_account', id}` または `null`(`name` なし)                                  |
| (なし)                                  | `expires_at`, `partial_key_hint`, `principal`                                                       |
| `workspace_id`                          | 非推奨。default workspace と、workspace を持たない principal 付きキーの**両方で `null`**            |

影響するルール:

- **AK-001 Unused API Keys**: `last_used_at ?? created_at` を使うが、`last_used_at` がないため**「作成から 30 日超」で判定**される。意図(未使用検出)とは別物。
- **AK-002 Unscoped API Keys**: `workspace_id === null` を「非限定」と判定 → **default workspace のキーを誤検出**。`scope.type === 'organization'` のほうが意味が近いが、ルールの定義(「ワークスペース非限定」)自体の再定義が必要。
- **AK-003 API Key Age**: `created_at` のみ使用。実 API に存在するため問題なし。

### 4.5 usage / cost(PR #24 で実装済みの前提)

- usage: `uncached_input_tokens`, `cache_read_input_tokens`, `cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens`, `output_tokens`, `server_tool_use.web_search_requests`。グループ次元は `workspace_id, model, api_key_id, account_id, service_tier, context_window, inference_geo, speed, service_account_id`。
- cost: `amount` は**セント単位の小数文字列**(`"123.45"` = $1.23)、`currency`(現状 `"USD"` のみ)、`description`, `cost_type`, `model`, `token_type` ほか。日次バケットのみ。**Priority Tier のコストは含まれない**(usage 側で `service_tier=priority` を見る)。Code execution は cost 側のみ。
- `workspace_id: null` = default workspace。
- データ反映は通常 5 分以内。推奨ポーリングは 1 分に 1 回まで。

### 4.6 認証/組織種別

- Usage & Cost Admin API は **Claude Console(Claude Platform)組織用**(Admin API キー `sk-ant-admin01-...` など)。
- **Claude Enterprise(claude.ai)の親組織は Console に現れず Admin API キーを持たない**。代わりに Analytics API キーで Enterprise Analytics API を使う。
- BLUEPRINT は「Claude Enterprise」を名乗り、`ANTHROPIC_ADMIN_API_KEY`(`sk-ant-admin...`)と Compliance API を併用する前提。**この前提が成立する組織種別を確認する必要がある。**
- Claude Platform on AWS では usage/cost API は使えない。

---

## 5. 修正案(検討用の選択肢)

| ルール          | 案                                                                                                                                                                  | 必要な追加 API / データ                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AC-001          | (a) usage を `account_id` でグルーピングして最終活動を導く(OAuth 利用者のみ) / (b) Compliance activities の actor から最終活動を導く / (c) 非対応として仕様から外す | usage 拡張 or Compliance API                             |
| AK-001          | usage を `api_key_id` でグルーピングし、直近の利用バケットから「最終利用日」を導く。利用実績なしは「未使用」                                                        | usage の追加グルーピング(日次、`limit` 最大 31 日分ずつ) |
| AK-002          | `scope.type === 'organization'` を「非限定」とし、default workspace のキーは別扱い(またはルールの意味を再定義)                                                      | `ApiKeyInfo` に `scope` を追加                           |
| DG-001          | workspace ごとにメンバー取得して 0 件を検出                                                                                                                         | workspace members エンドポイント(未調査、N+1 リクエスト) |
| AC-002 / AC-003 | 組織種別ごとにロール集合を切り替え。Console 組織では AC-003 を skipped にする                                                                                       | 組織種別の判定方法(設定 or ロール値から推定)             |
| 型              | 実 API に合わせて `OrganizationMember`, `Workspace`, `ApiKeyInfo`, `OrganizationRole` を修正。`collector` の checkers・テスト・`data/sample/` も追随                | —                                                        |

選択が必要な点:

1. 想定する組織種別(Console / Enterprise / 両対応)。これで認証方式とロール集合が決まる。
2. 判定不能になるルール(特に AC-001)を「近似で維持」するか「仕様から外す」か。
3. N+1 になる DG-001 を許容するか(rate limit は API ごとに要確認)。

---

## 6. 関連する未解決事項

- **Compliance API の実仕様が未確認**: `ComplianceApi` は増分取得に `after_id` を使う実装。パラメータ名・レスポンス形状・認証が未検証。`docs.anthropic.com` はブロックされるので、`platform.claude.com` の該当ページを探す必要がある(Compliance API は Enterprise 向けで、`api/admin` 配下とは別の可能性あり)。
- **UA-001(使用量スパイク検出)** は `baselineTokens`(直近 7 日のトークン日次合計)が渡されないと `skipped`。渡す処理(過去スナップショットの集計)が未実装。
- **月次請求レポート**(`report:monthly`、`monthly-report.yml`)が未着手。`package.json` の `start:monthly-*`、`start:usage`、`start:notify`、`start:weekly-report` は指す先のコマンドがまだ存在しない。
- **通知(Slack / Discord / Email)** は Phase 4 で未着手。
- **実 API での動作確認ゼロ**: collectors は stub のソースでのみテスト済み。
- `README.md` / `docs/BLUEPRINT.md` §5.2(Admin API 一覧)には、上記の実仕様との差分(ページネーション、`cost_report` の単位など)がまだ反映されていない。

---

## 7. 新セッションへの推奨手順

1. 上記 §5 の「選択が必要な点」をユーザーに確認する(組織種別が最優先)。
2. Compliance API の実仕様を調べる(§6)。
3. 決定に沿って `shared` の型 → checkers → テスト → `BLUEPRINT.md` / `README.md` / `data/sample/` の順に、§2 の同期先を漏れなく更新する。
4. 品質ゲートを通し、PR を作る(`Issue -> Sibling Worktree -> Quality Gate -> PR -> Rebase Merge`)。
5. 実 API で確認できる環境(キーあり)があれば、`collect-audit` を 1 回実行して、空レスポンスやフィールド欠落がないか確認する。

---

## 8. 追補 (2026-09-30 公式ドキュメント再照合)

本セッションで `platform.claude.com/docs` の原文 (Markdown) を取得し、§1〜§7 を再照合した。
一次情報の URL と、各エンドポイントの詳細な対応表は [API-MAPPING.md](API-MAPPING.md) にまとめた。

### 8.1 決定事項

- **対象組織種別は Claude Enterprise (claude.ai の親組織 + リンク組織)**。§4.6 の懸念どおり、
  Enterprise の親組織は Claude Console に現れず `sk-ant-admin01-...` の Admin API キーを持たない。
  代わりに claude.ai の **Organization settings > API** で primary owner が発行する
  **スコープ付きキー (`sk-ant-api01-...`)** で Compliance API / Admin API (user management) /
  Enterprise Analytics API / Spend Limits API を呼ぶ。
- 監査用途に必要な **最小権限スコープ** は `read:compliance_activities`, `read:compliance_org_data`,
  `read:members`, `read:rbac_groups`, `read:analytics`, `read:spend_limits`。
  チャット・ファイル・セッション本文を読める `read:compliance_user_data` / `read:org_audit` と、
  すべての `write:*` / `delete:*` は **要求しない**。

### 8.2 新たに判明した不一致・不具合

| ID    | 重大度 | 内容                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-A1  | 致命的 | **Activity Feed の増分取得が逆方向。** Activity Feed は新しい順に返り、`after_id` は「より古い」ページへ進む。現行コードは前回バッチの最後 (= 最古) の ID を次回の `after_id` に渡すため、初回同期以降の新着イベントを永久に取得できない。公式推奨は `created_at.gte/lt` による window polling (`order=asc`、1 分以上の遅延、重複排除) か `before_id` による catch-up。                             |
| F-A2  | 高     | **Activity の形が別物。** 実データは `created_at`, `organization_uuid`, 判別共用体の `actor` (`user_actor`, `api_actor`, `admin_api_key_actor`, `scim_directory_sync_actor` ほか 11 種以上) と種別固有のトップレベル項目。`category`, `target`, `details`, `timestamp`, `workspace_id` は存在しない。516 種の activity type があり増え続けるため、未知の type / actor.type は通過させる必要がある。 |
| F-A3  | 高     | **Enterprise のメンバー情報源。** Admin API の `GET /v1/organizations/users` (`read:members`) が Enterprise でも使え、`added_at` とロール (`user`, `managed`, `owner`, `membership_admin`, `primary_owner`) を返す。Compliance API の組織ユーザー一覧はリンク組織ごとに取れるが `read:compliance_user_data` (本文閲覧権限) を要する。                                                               |
| F-A4  | 高     | **Enterprise にはワークスペースとワークスペース限定キーがない。** DG-001 (空ワークスペース) と AK-002 (ワークスペース非限定キー) は Enterprise では対象が存在しない。Enterprise のキー台帳は Compliance API の実効設定 (`/v1/compliance/organizations/{uuid}/settings`) の `api_keys` (scopes, is_active, created_at, expires_at, created_by_id) で取得できる。                                     |
| F-A5  | 高     | **Enterprise の使用量・コストは Enterprise Analytics API。** `/v1/organizations/analytics/usage_report` / `cost_report` (`read:analytics`)。グルーピングは workspace ではなく `product`, `model`, `rbac_group_id` ほか。金額はセント単位の小数文字列。`data_refreshed_at` 以降は未確定、2026-01-01 以前は取得不可、レート制限 60 req/min。                                                          |
| F-A6  | 中     | **AC-001 は実データで判定可能。** Analytics `/v1/organizations/analytics/users` の期間ロールアップが `last_activity_date` を返す (Enterprise で機能が有効な場合)。                                                                                                                                                                                                                                  |
| F-A7  | 中     | **組織設定の監査が可能。** 実効設定は 60 種超の設定 (SSO 強制、SCIM、IP 許可リスト、セッション時間、保持期間、公開プロジェクト、コード実行の外部通信ほか) を返す。行が無い設定は「管理者が変更できない」を意味し、「オフ」ではない。                                                                                                                                                                |
| F-A8  | 中     | **Spend Limits API** (`read:spend_limits`) でメンバーごとの実効上限と当期支出が取れる。予算統制ルールの根拠になる。                                                                                                                                                                                                                                                                                 |
| F-A9  | 中     | **リトライ契約の不足。** 公式は 429 で `retry-after` を尊重、無い場合と 500/502/503/504/529 は 1 秒から 60 秒上限の指数バックオフ、`x-should-retry: false` の 500 は再試行しない。現行は 529 と `x-should-retry` を扱わず、最大 3 回・500ms 起点。Analytics のカーソル失効 (410) は先頭からやり直す必要がある。                                                                                     |
| F-A10 | 中     | **ページングは 4 方式が混在。** ID カーソル (`after_id`/`before_id`+`has_more`)、ページトークン (`page`/`next_page`+`has_more`)、`has_more` 無しの `next_page` (Analytics users, Spend Limits)、時間バケット (usage/cost)。                                                                                                                                                                         |
| F-A11 | 中     | **ワークフローの運用不具合。** `pnpm build:collector` が shared をビルドせず失敗する / `pnpm --filter` 実行時に `DATA_DIR` がパッケージ配下に解決される / アーカイブ処理が push 後かつ checkout 時刻 (mtime) 基準で実質動かない / 月次ワークフローがブランチ切替後にコピーしておりレポートが commit されない / Private リポジトリでも Pages が既定で公開されライブデータが露出し得る。              |
| F-A12 | 中     | **「実データで常に pass」の根本原因。** ルールが「データが無い」と「準拠している」を区別できない。データセット単位の取得状況 (coverage) とルールの前提データ宣言を導入し、前提が欠ければ `skipped` (理由付き)、取得失敗は OP-002 で検出する設計に改める。                                                                                                                                           |
| F-A13 | 低     | **スナップショット肥大。** 6 時間ごとに全データを 1 ファイルで保存すると git 履歴が線形に増える。データセット単位のファイルを決定的に直列化すれば、変化の無いデータは git が同一 blob として重複排除する。                                                                                                                                                                                          |
| F-A14 | 低     | **Pages 上の PII。** サンプルのダッシュボード JSON にメンバーのメール一覧が含まれる構造だった。ダッシュボードは集計値とマスク済み表示のみにする。                                                                                                                                                                                                                                                   |

### 8.3 対応状況

各項目の対応方針・フェーズ・受け入れ基準は [CHANGE-PLAN.md](CHANGE-PLAN.md) の §1 (起点対応表) を参照。

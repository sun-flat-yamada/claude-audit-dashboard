# 変更計画: Claude Enterprise 対応と Clean Architecture への再構成

> **Version:** 1.1 (2026-10-01) — Phase A 実装済み (実施結果は §12)
> **起点:** [api-spec-mismatch-findings.md](api-spec-mismatch-findings.md) (§1〜§7 は前セッションの原文、§8 は本計画の再照合結果)
> **関連:** [ARCHITECTURE.md](ARCHITECTURE.md) (設計) / [API-MAPPING.md](API-MAPPING.md) (API 対応表) / [BLUEPRINT.md](BLUEPRINT.md) (仕様の正)
> **対象:** Claude Enterprise テナント (claude.ai の親組織と、その配下のリンク組織)

---

## 0. 目的とスコープ

| 項目       | 内容                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目的       | 実 API 仕様と不一致だった要求仕様・データモデル・監査ルールを Claude Enterprise の実仕様に合わせ直し、API 変更や監査・分析・レポート方式の追加に耐える構造 (Clean Architecture) へ再構成する                                 |
| 対象 API   | Compliance API (`/v1/compliance/*`)、Admin API の user management (`/v1/organizations/users` ほか)、Claude Enterprise Analytics API (`/v1/organizations/analytics/*`)、Spend Limits API (`/v1/organizations/spend_limits/*`) |
| 対象外     | チャット・ファイル・セッション本文の取得 (最小権限のため)、書き込み・削除系 API、Claude Console 単独組織 (リンクされていない Console 組織)、Claude Platform on AWS                                                           |
| 非機能要件 | 追加・変更で既存コードの複雑度を増やさない (拡張は「ファイル追加 + 登録 1 行」または設定のみ)、データ欠落を「準拠」と誤判定しない、最小権限、PII をダッシュボードに出さない、Dependabot 指摘ゼロ                             |

---

## 1. 起点対応表 (findings → 決定 → 実施)

| Findings                               | 決定                                                                                                                                                                        | 実施           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| §1-1 ページネーション `starting_after` | ページング方式を戦略として分離 (ID カーソル / ページトークン / next_page のみ / 時間バケット)                                                                               | 本 PR (A2)     |
| §1-2, §4.2〜4.4 型が実 API と不一致    | 外部 DTO は各アダプタの zod スキーマ (寛容な読み取り) に閉じ込め、ドメインモデルへ写像する腐敗防止層を設ける。ドメイン型は Enterprise の実データから再定義                  | 本 PR (A2, A3) |
| §1-3, §4.6 組織種別未確定              | **Claude Enterprise に確定**。キーは claude.ai 発行のスコープ付きキー 1 本 (API 系統ごとに上書き可)                                                                         | 本 PR (A3)     |
| §1-4, §6 Compliance API 未確認         | 公式仕様を取得・照合済み。Activity Feed は window polling (昇順・遅延 2 分・重複 10 分・ID 重複排除) で取得                                                                 | 本 PR (A3)     |
| §4.2 AC-001 が常に pass                | Analytics `users` の期間ロールアップ (`last_activity_date`) で判定。データが無ければ `skipped`                                                                              | 本 PR (A4)     |
| §4.2 AC-002 のロール集合               | 管理系ロールを `primary_owner, owner, admin, membership_admin, parent_org_owner, parent_org_admin` に拡張しパラメータ化                                                     | 本 PR (A4)     |
| §4.2 AC-003 Console で誤 fail          | 組織単位で判定し、メンバー 0 件の組織は対象外                                                                                                                               | 本 PR (A4)     |
| §4.3 DG-001 常に pass                  | Enterprise にワークスペースは無いため「メンバー 0 件の RBAC グループ」に再定義                                                                                              | 本 PR (A4)     |
| §4.4 AK-001 実質「作成 30 日超」       | Activity Feed の `api_actor.api_key_id` から最終利用を投影 (projection) し、観測期間が閾値以上のときだけ判定                                                                | 本 PR (A4)     |
| §4.4 AK-002 default workspace を誤検出 | 「過剰権限キー」(削除・書き込みスコープ保持) に再定義                                                                                                                       | 本 PR (A4)     |
| §5 N+1 (DG-001)                        | グループ数の上限を設定化 (`sources.groups.maxMemberRequests`)。超過分は件数不明として扱う                                                                                   | 本 PR (A3)     |
| §6 UA-001 が baseline 未供給で skipped | 使用量データセット (直近 31 日の日次) からルール自身が基準線を計算                                                                                                          | 本 PR (A4)     |
| §6 月次レポート未着手                  | 汎用レポート文書 (ReportDocument) + レンダラ (Markdown / HTML / CSV / JSON) で週次・月次を実装                                                                              | 本 PR (A5)     |
| §6 通知未着手                          | Notifier ポート + console / Slack / Discord / Email アダプタ + アラートポリシー (冷却時間付き)                                                                              | 本 PR (A6)     |
| §6 実 API 未検証                       | 未検証の仮定を §10 に列挙し、Phase B1 で実テナント検証                                                                                                                      | Phase B1       |
| §6 README/BLUEPRINT 未反映             | BLUEPRINT v0.3.0 / README / SETUP / 付随文書を同期。ルール表と実装の一致をテストで強制                                                                                      | 本 PR (A8)     |
| §8 F-A1 Activity Feed の方向           | 上記 window polling に置換 (致命的不具合の修正)                                                                                                                             | 本 PR (A3)     |
| §8 F-A9 リトライ契約                   | 429 `retry-after` 優先、1 秒〜60 秒の指数バックオフ、529 追加、`x-should-retry: false` 尊重、Analytics 410 はページング再開                                                 | 本 PR (A2)     |
| §8 F-A11 ワークフロー不具合            | 依存込みビルド、データディレクトリをリポジトリ基準で解決、アーカイブを CLI 化して commit 前に実行、月次の commit 手順修正、Pages のライブデータ公開を明示的オプトインに変更 | 本 PR (A8)     |
| §8 F-A12 空振り pass                   | データセット coverage + ルール前提宣言 + OP-002 (データソース網羅性)                                                                                                        | 本 PR (A4)     |
| §8 F-A13 スナップショット肥大          | データセット単位ファイル + 決定的直列化 (git の blob 重複排除を利用)                                                                                                        | 本 PR (A2)     |
| §8 F-A14 Pages 上の PII                | ダッシュボードは集計値のみ、メールアドレスは既定でマスク                                                                                                                    | 本 PR (A7)     |

---

## 2. 要求仕様の見直し

### 2.1 ゴールの改訂 (BLUEPRINT §2 を置換)

| #   | 旧                                            | 新                                                                                                                  | 優先度 |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| G1  | Compliance API から監査アクティビティ自動収集 | Activity Feed を取りこぼし無く (at-least-once + 重複排除) 収集し、6 年超の独自保持を可能にする                      | P0     |
| G2  | Admin API からメンバー・WS・キー収集          | Enterprise のディレクトリ (リンク組織、メンバー、招待、RBAC グループ)、実効設定、キー台帳を収集する                 | P0     |
| G3  | 組み込みルールで監査                          | **データが揃ったときだけ判定する**ルールエンジン。欠けたら理由付き `skipped`、取得失敗は OP-002 で検出              | P0     |
| G4  | Pages で静的ダッシュボード                    | 集計済みの `DashboardView` (契約 v2) を Pages で表示。PII は既定でマスク、ライブデータ公開は明示的オプトイン        | P0     |
| G5  | Slack / Discord / Email 通知                  | Notifier ポートに準拠する任意チャネル。アラートポリシー (重大度・状態・冷却時間) で制御                             | P0     |
| G6  | 6 時間ごとの定期実行                          | 変更なし (レート制限内に収まることを §9 で確認)                                                                     | P0     |
| G7  | Fork-Safe                                     | 変更なし。サンプルデータは合成データ生成器から自動生成し、契約との一致をテストで保証                                | P0     |
| G8  | Private/Internal 前提                         | 変更なし + Pages の公開データ源を `PAGES_DATA_SOURCE` 変数で明示的に選択                                            | P0     |
| G9  | 週次サマリー                                  | 汎用レポート文書で生成し、Markdown / HTML / JSON で出力・配信                                                       | P1     |
| G10 | 月次請求レポート (WS 別)                      | **RBAC グループ別・プロダクト別・モデル別**のコスト配分 (Analytics API)。確定値は 30 日後である旨を明記             | P1     |
| G11 | モデル使用分析                                | Analyzer プラグイン (モデル集中度、キャッシュ効率、グループ集中度、シート利用率)                                    | P1     |
| G12 | 使用量異常検知                                | UA-001〜UA-004 (スパイク、月次予算、上限未設定、上限接近)                                                           | P1     |
| G13 | プラグイン拡張                                | 拡張点を 8 種に一般化 (データソース、投影、ルール、ルール生成器の期待値、分析、レポート、レンダラ、通知)。§3.3 参照 | P1     |
| G14 | 長期保持                                      | データセット単位スナップショット + CLI アーカイブ (gzip)                                                            | P1     |
| G15 | カスタムルール                                | **コード不要**で設定ベースライン (CF) とアクティビティ監視 (AM) を `config/custom-rules.json` に追加可能            | P2     |
| G16 | 多言語                                        | 変更なし                                                                                                            | P2     |
| G17 | (新) 最小権限                                 | 本文閲覧・書き込み・削除スコープを要求しない。必要スコープは §9.1                                                   | P0     |
| G18 | (新) API 変化への耐性                         | 外部 DTO の変更はアダプタ内のスキーマと写像のみで吸収。未知の activity type / actor / enum 値は通過させる           | P0     |

### 2.2 非ゴールの改訂

- プロンプト・応答・ファイル・セッション本文の取得と監査 (Compliance API では可能だが、`read:compliance_user_data` を要するため対象外)
- 書き込み・削除操作 (メンバー削除、上限変更、コンテンツ削除など)
- リアルタイム監視 (バッチのみ、変更なし)
- 複数テナントの一元管理 (変更なし)
- Public リポジトリでの本番運用 (変更なし)

### 2.3 データソース要求

| データセット    | 用途                                                       | API                                                                              | スコープ                                               |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| organizations   | リンク組織一覧                                             | Compliance `GET /v1/compliance/organizations`                                    | `read:compliance_org_data`                             |
| members         | メンバーとロール                                           | Admin `GET /v1/organizations/users` → (代替) Compliance 組織ユーザー             | `read:members` (代替時 `read:compliance_user_data`)    |
| memberActivity  | 最終活動日                                                 | Analytics `GET /v1/organizations/analytics/users` (期間ロールアップ)             | `read:analytics`                                       |
| invites         | 保留中の招待                                               | Admin `GET /v1/organizations/invites`                                            | `read:members`                                         |
| groups          | RBAC グループと人数                                        | Admin `GET /v1/organizations/rbac_groups` (+ members) → (代替) Compliance groups | `read:rbac_groups` (代替時 `read:compliance_org_data`) |
| settings        | 実効設定                                                   | Compliance `GET /v1/compliance/organizations/{uuid}/settings`                    | `read:compliance_org_data`                             |
| credentials     | キー台帳                                                   | 同上の `api_keys`                                                                | `read:compliance_org_data`                             |
| credentialUsage | キーの最終利用 (投影)                                      | Activity Feed の `api_actor` から導出                                            | (activities に同じ)                                    |
| activities      | 監査イベント (前回以降の差分)                              | Compliance `GET /v1/compliance/activities`                                       | `read:compliance_activities`                           |
| usage / cost    | 日次トークン・コスト (総計 / product / model / rbac_group) | Analytics `usage_report` / `cost_report`                                         | `read:analytics`                                       |
| adoption        | DAU/WAU/MAU、シート、保留招待数                            | Analytics `summaries`                                                            | `read:analytics`                                       |
| spendLimits     | メンバー別実効上限と当期支出                               | Spend Limits `GET /v1/organizations/spend_limits/effective`                      | `read:spend_limits`                                    |

---

## 3. 設計方針の見直し

詳細は [ARCHITECTURE.md](ARCHITECTURE.md)。要点のみ示す。

### 3.1 レイヤーとパッケージ

| レイヤー                                                            | パッケージ / ディレクトリ                      | 依存してよい先           | 強制手段                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| Domain (エンティティ、ルール、分析、投影)                           | `@claude-audit/core` `src/domain`              | なし (zod のみ)          | tsconfig に Node 型なし + ESLint `no-restricted-imports` |
| Application (ユースケース、ポート、プレゼンタ)                      | `@claude-audit/core` `src/application`         | Domain                   | 同上                                                     |
| Contracts (UI 向け公開 DTO)                                         | `@claude-audit/core` `src/contracts`           | なし                     | 同上                                                     |
| Adapters (Anthropic ゲートウェイ、ストレージ、通知、レンダラ、デモ) | `@claude-audit/collector` `src/adapters`       | Core                     | ESLint (main を参照禁止)                                 |
| Infrastructure (環境変数、設定ファイル、時計、ログ)                 | `@claude-audit/collector` `src/infrastructure` | Core                     | 同上                                                     |
| Composition root / CLI                                              | `@claude-audit/collector` `src/main`           | すべて                   | —                                                        |
| UI                                                                  | `@claude-audit/dashboard`                      | Core の `contracts` のみ | ESLint                                                   |

旧 `@claude-audit/shared` は `@claude-audit/core` に統合して廃止する (型だけの共有から、純粋なドメイン + アプリケーション層へ格上げ)。

### 3.2 設計原則

1. **依存性の規則** — 内側 (domain) は外側 (API、ファイル、UI) を知らない。外部 API の形はアダプタの zod スキーマに閉じ込める。
2. **前提データの宣言** — ルールと分析は必要なデータセットを `requires` で宣言し、エンジンが取得状況 (coverage) と照合する。欠ければ `skipped` (理由付き)。
3. **寛容な読み取り (Tolerant Reader)** — 使う項目だけ検証し、未知の項目・未知の列挙値・未知の activity type は通過させる。必須項目の欠落は「スキーマ差異」としてデータセット単位のエラーにする (静かな空振りを防ぐ)。
4. **加算的拡張** — レジストリに登録するだけで拡張できる。switch 文や if 連鎖で種類を分岐しない。
5. **データ駆動のルール** — 設定ベースライン (CF) とアクティビティ監視 (AM) は定義データからルールを生成する。追加はコード変更不要。
6. **N+M のレポート** — レポートは汎用文書 (セクションの列) を返し、レンダラは文書を任意形式へ変換する。レポート N 種 × 形式 M 種を N + M の実装で賄う。
7. **小さな単位** — 関数は原則 30 行以内、1 ファイル 1 責務。複雑度は ESLint `complexity` (上限 10) で監視する。

### 3.3 拡張点と追加手順 (複雑度保証)

| 追加したいもの                           | 追加するもの                                                      | 既存コードの変更                    |
| ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 新しい API エンドポイント / データセット | ゲートウェイのメソッド + zod スキーマ + 写像 + `DatasetCollector` | データセット型への 1 行 + 登録 1 行 |
| API のバージョン変更・項目名変更         | 該当アダプタのスキーマと写像の修正                                | ドメイン・ルールは無変更            |
| 監査ルール (コード)                      | `defineRule({...})` のファイル                                    | ルール一覧への 1 行                 |
| 設定ベースライン / アクティビティ監視    | `config/custom-rules.json` にデータを追加                         | なし                                |
| ベースラインの比較方法                   | 期待値ストラテジ 1 件                                             | 登録 1 行                           |
| 分析 (insight)                           | `Analyzer` 1 件                                                   | 登録 1 行                           |
| レポート種別                             | `ReportDefinition` 1 件                                           | 登録 1 行                           |
| 出力形式                                 | `DocumentRenderer` 1 件                                           | 登録 1 行                           |
| 通知チャネル                             | `Notifier` アダプタ 1 件                                          | 登録 1 行                           |
| CLI コマンド                             | `Command` 1 件                                                    | 登録 1 行                           |

---

## 4. ルールカタログの改訂

### 4.1 既存ルールの新旧対応

| ID     | 旧定義                                | 新定義 (Enterprise)                                                                           | 前提データ                   | 変更理由                                  |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------- |
| AC-001 | 90 日非アクティブ (`last_active_at`)  | 期間内に活動の無いメンバー (Analytics `last_activity_date`)。参加から閾値未満のメンバーは除外 | members, memberActivity      | 旧項目は API に存在しない                 |
| AC-002 | owner/admin 比率 >20%                 | 管理系ロール比率 >20% を組織単位で判定 (ロール集合はパラメータ)                               | members                      | Enterprise のロール体系に合わせる         |
| AC-003 | Primary Owner が 1 名                 | 組織単位で `primary_owner` が 1 名 (メンバー 0 件の組織は対象外)                              | members                      | 誤 fail の解消                            |
| AK-001 | 30 日未使用キー (`last_used_at`)      | Compliance スコープを持つ有効キーのうち、観測期間内に `api_actor` として現れないもの          | credentials, credentialUsage | 旧項目は API に存在しない                 |
| AK-002 | ワークスペース非限定キー              | 削除・書き込みスコープを持つ有効キー (過剰権限)                                               | credentials                  | Enterprise にワークスペース限定キーは無い |
| AK-003 | 作成 180 日超                         | 変更なし (Enterprise キー台帳に適用)                                                          | credentials                  | —                                         |
| UA-001 | 7 日平均の 3 倍超 (baseline 外部供給) | 直近の確定日トークン量が前 7 日平均の 3 倍超 (ルール内で算出、`data_refreshed_at` 以降は除外) | usage                        | 基準線が供給されず常に skipped だった     |
| UA-002 | 月次コスト予算超過                    | 当月累計コストが予算超過で fail、月末予測が超過で warning                                     | cost                         | 予測を追加                                |
| DG-001 | 空ワークスペース                      | メンバー 0 件の直接作成 (`direct`) RBAC グループ                                              | groups                       | Enterprise にワークスペースは無い         |
| OP-001 | 24 時間収集なし                       | 変更なし                                                                                      | —                            | —                                         |

### 4.2 新規ルール

| ID             | 名称                         | カテゴリ            | 重大度 | 前提データ  | 判定                                               |
| -------------- | ---------------------------- | ------------------- | ------ | ----------- | -------------------------------------------------- |
| AC-004         | Stale Pending Invites        | access-control      | Low    | invites     | 30 日を超えて保留中の招待                          |
| UA-003         | Members Without Spend Limit  | usage-anomaly       | Medium | spendLimits | すべての期間で上限 `null` (無制限) のメンバー      |
| UA-004         | Spend Limit Nearly Exhausted | usage-anomaly       | Low    | spendLimits | 当期支出が上限の 90% 以上 (warning)                |
| OP-002         | Data Source Coverage         | operational         | High   | —           | 取得に失敗・権限不足で取れなかったデータセット     |
| CF-001〜CF-009 | 設定ベースライン             | configuration       | 各定義 | settings    | 実効設定が期待値と一致しない組織 (§4.3)            |
| AM-001〜AM-007 | アクティビティ監視           | activity-monitoring | 各定義 | activities  | 前回収集以降に対象イベントが閾値以上発生 (warning) |

### 4.3 設定ベースライン (既定値、`config/custom-rules.json` で追加可能)

| ID     | 設定                                             | 期待値                                   | 重大度 |
| ------ | ------------------------------------------------ | ---------------------------------------- | ------ |
| CF-001 | `sso_claude_ai_enforced`                         | `true`                                   | High   |
| CF-002 | `sso_provisioning_mode`                          | `scim_advanced` または `scim_permissive` | Medium |
| CF-003 | `ip_allowlist_enabled`                           | `true`                                   | Medium |
| CF-004 | `account_session_duration_seconds`               | 604800 (7 日) 以下                       | Low    |
| CF-005 | `data_retention_periods`                         | すべての対象が 365 日以下の固定期間      | Medium |
| CF-006 | `public_projects_enabled`                        | `false`                                  | Medium |
| CF-007 | `code_execution_network_egress_enabled`          | `false`                                  | Medium |
| CF-008 | `claude_code_desktop_bypass_permissions_enabled` | `false`                                  | High   |
| CF-009 | `allowed_invite_domains`                         | 空でない                                 | Low    |

設定行が返らない組織は「その組織の管理者が変更できない設定」として対象外 (公式仕様どおり)。全組織で行が無ければ `skipped`。

### 4.4 アクティビティ監視 (既定値)

| ID     | 名称                         | 対象 activity type                                                                                                                                                                                                              | 閾値 | 重大度 |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| AM-001 | Privileged Role Changes      | `primary_owner_transferred`, `rbac_role_assigned`, `rbac_role_permission_added`, `role_assignment_granted`, 管理系ロールへの `claude_user_role_updated`                                                                         | 1    | High   |
| AM-002 | Identity Provider Changes    | `org_sso_toggled`, `org_sso_connection_deactivated`, `org_sso_connection_deleted`, `org_sso_provisioning_mode_changed`, `org_sso_group_role_mappings_updated`, `org_directory_sync_deleted`                                     | 1    | High   |
| AM-003 | Network Restriction Changes  | `org_ip_restriction_created`, `org_ip_restriction_updated`, `org_ip_restriction_deleted`                                                                                                                                        | 1    | Medium |
| AM-004 | API Key Lifecycle            | `api_key_created`, `admin_api_key_created`, `admin_api_key_updated`, `admin_api_key_deleted`, `scoped_api_key_updated`, `scoped_api_key_deleted`, `org_compliance_api_settings_updated`, `org_analytics_api_capability_updated` | 1    | Medium |
| AM-005 | Data Export Events           | `org_data_export_started`, `org_data_export_accessed`, `org_members_exported`, `audit_log_export_started`, `audit_log_export_accessed`                                                                                          | 1    | Medium |
| AM-006 | Authentication Failure Burst | `sso_login_failed`, `magic_link_login_failed`, `step_up_authentication_failed`                                                                                                                                                  | 20   | Medium |
| AM-007 | Data Protection Changes      | `org_claude_code_zero_data_retention_disabled`, `org_data_residency_updated`, `platform_workspace_inference_data_retention_disabled`                                                                                            | 1    | High   |

activity type は公式リファレンスの 516 種 (2026-09-30 時点) を `known-activity-types` として同梱し、未知の type を参照する定義はテストと実行時警告で検出する。

### 4.5 スコア

`Score = max(0, 100 − Σ 重み(fail の重大度))`、重み Critical 10 / High 5 / Medium 3 / Low 1 / Info 0 (変更なし)。
`warning` と `skipped` は減点しない。`skipped` の件数は coverage と併せてダッシュボードに表示し、「データ欠落による高スコア」を見えるようにする。

実装時の追加判断: キー未設定の空実行で `95/100` と表示されることを確認したため、`skipped` / `error` が 1 件でもある場合はスコアを常に評価済みルール数と併記する (`95/100 (2 of 30 rules assessed)`)。書式は domain の `formatScore` 1 か所に置き、ダッシュボードのヒーロー表示 (警告行付き)、通知タイトル、コンプライアンス / 週次レポートが共通に使う。計算式は変えない (除外方式は AWS Security Hub 等と同じ考え方で、欠落は OP-002 が fail として検出する)。

---

## 5. データモデルとストレージの変更

| 対象             | 旧                                                              | 新                                                                                                                                        |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| スナップショット | `snapshots/<ts>.json` (全データ 1 ファイル、`usage: null` 固定) | `snapshots/<ts>/manifest.json` + `snapshots/<ts>/<dataset>.json`。manifest に coverage (status / source / reason / window / asOf / count) |
| 直列化           | 任意順                                                          | 決定的 (キー順・要素順の固定) → 変化の無いデータセットは git が重複排除                                                                   |
| 状態             | `state.json` (`last_activity_id`)                               | `state.json` v2: `collections`, `cursors` (データセットごと、中身は各コレクタが所有), `projections`, `notifications`                      |
| レポート         | `reports/<ts>.json`                                             | `reports/compliance/<ts>.json`、`reports/weekly/<yyyy-Www>.*`、`reports/monthly/<yyyy-mm>/*`                                              |
| ダッシュボード   | `DashboardData` (メール一覧を含む)                              | `DashboardView` v2 (`schemaVersion: 2`、集計値のみ、メールはマスク)                                                                       |
| アーカイブ       | ワークフロー内の `find -mtime`                                  | `cli archive`: 保持日数を超えたスナップショットを `archive/<yyyy>/<ts>.json.gz` に圧縮 (commit 前に実行)                                  |

旧形式 (v1) のスナップショットと状態は読み込まない。初回実行時は `activities.initialLookbackHours` (既定 168 時間) から取り直す。旧データは `data/audit` ブランチに残り、`cli archive` の対象外とする。

---

## 6. 設定と環境変数の変更 (破壊的変更)

| 種別               | 旧                                                  | 新                                                                                                                              |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 主キー             | `ANTHROPIC_ADMIN_API_KEY` (必須、`sk-ant-admin...`) | `ANTHROPIC_ENTERPRISE_API_KEY` (claude.ai 発行 `sk-ant-api01-...`、§9.1 のスコープ)                                             |
| 上書き             | `ANTHROPIC_COMPLIANCE_API_KEY` (任意)               | `ANTHROPIC_COMPLIANCE_API_KEY` / `ANTHROPIC_ANALYTICS_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` (任意、API 系統ごとに主キーを上書き) |
| 必須性             | Admin キーが無いと起動失敗                          | キーが無い系統のデータセットは `unavailable` として続行し、OP-002 が検出                                                        |
| データディレクトリ | `DATA_DIR` (パッケージ基準で解決される不具合)       | `DATA_DIR` を pnpm 起動ディレクトリ (`INIT_CWD`) 基準で解決                                                                     |
| ルール有効化       | `compliance.enabled_rules` (許可リスト)             | `compliance.disabledRules` (拒否リスト。新ルールは既定で有効)                                                                   |
| ルール引数         | 無し                                                | `compliance.params.<ruleId>` (zod で検証、不正値は `error` 結果)                                                                |
| カスタムルール     | `{ rules: [{ checker: "fn名" }] }` (未実装)         | `{ settingBaselines: [...], activityWatches: [...] }`                                                                           |
| Pages の公開データ | data/audit があれば常にライブ                       | リポジトリ変数 `PAGES_DATA_SOURCE=live` のときのみライブ、既定はサンプル                                                        |
| npm スクリプト     | `collect:audit`, `collect:usage` (後者は実体なし)   | `collect`, `check:compliance`, `build:data`, `pipeline`, `report:weekly`, `report:monthly`, `notify`, `archive`, `demo`         |

---

## 7. 実施フェーズと WBS

### Phase A — 本 PR

| ID  | 作業                                                                                                                                                                                        | 受け入れ基準                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A1  | Dependabot 全件適用 (§8)                                                                                                                                                                    | `pnpm audit` 0 件、品質ゲート全通過                                                                         |
| A2  | Clean Architecture 再構成: core / collector / dashboard、レジストリ、HTTP クライアント (リトライ契約、4 種のページング)、データセット単位ストレージ                                         | 依存方向を ESLint と tsconfig で強制、既存機能の回帰なし                                                    |
| A3  | Enterprise アダプタ: Compliance (activities, organizations, settings, groups, 組織ユーザー)、Admin (members, invites, rbac groups, spend limits)、Analytics (users, summaries, usage, cost) | 公式ドキュメント記載のレスポンス例でのスキーマ・写像テストが通る                                            |
| A4  | ルールエンジン (前提宣言、zod 引数、エラー隔離)、既存 10 ルールの再定義、新規ルール、CF/AM 生成器、coverage、OP-002                                                                         | 全ルールに pass / fail / skipped のテスト。BLUEPRINT と README のルール表が実装と一致することをテストで検証 |
| A5  | 分析 4 種、レポート文書 (compliance / weekly / monthly)、レンダラ 4 種                                                                                                                      | 合成データで各レポートが生成される                                                                          |
| A6  | 通知: console / Slack / Discord / Email、アラートポリシー、冷却時間                                                                                                                         | fetch / transport を差し替えたテストで送信内容を検証                                                        |
| A7  | ダッシュボード v2 (概要、コンプライアンス結果、coverage、コスト推移、プロダクト / モデル別、採用状況、注目イベント、分析) とサンプルデータ自動生成 (`pnpm demo`)                            | サンプル JSON が生成結果と一致すること (ゴールデンテスト)、fork:verify が契約 v2 を検証                     |
| A8  | ワークフロー修正、ドキュメント同期 (BLUEPRINT v0.3.0、README / README.ja、SETUP、DEPLOYMENT、PLUGIN-ARCHITECTURE、DASHBOARD-FEATURES、エージェント規約、CHANGELOG)                          | 品質ゲート + lint + format:check 全通過                                                                     |

### Phase B — 実テナントでの検証と拡充 (後続 PR)

| ID  | 作業                                                                                                                              | 受け入れ基準                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| B1  | 実テナントでの疎通検証 (§10 の仮定 V1〜V7 の確認)、スキーマ差異の修正                                                             | `pnpm pipeline` が実テナントで coverage 全 `ok`、OP-002 pass |
| B2  | ダッシュボード詳細ページ (F-003 以降: 結果テーブルの絞り込み・エクスポート、アクティビティ検索、メンバー、キー、月次レポート閲覧) | DASHBOARD-FEATURES の P0/P1 を満たす                         |
| B3  | 長期運用: アーカイブ・保持の実データ検証、`data/audit` のサイズ監視                                                               | 1 か月運用でリポジトリ増分が想定内                           |
| B4  | 任意アダプタ: Claude Code Analytics API、リンクされた Console 組織の Admin API (ワークスペース、API キー、Usage & Cost)           | 既存コード無変更で追加できること (拡張性の実証)              |
| B5  | E2E テスト (Playwright) とアクセシビリティ確認                                                                                    | 主要フローが自動テストされる                                 |

> B3 の key-free 実装 (長期履歴の合成、容量計測と閾値警告、アーカイブ復元、ワークフロー入力、手順書) は #82 で実装済み。実データでの検証と 1 か月の運用記録は #38 に残る (§9.4 の数値は合成履歴に基づく暫定値)。

### Phase C — v1.0.0

Phase B 完了後にリリース。BLUEPRINT の Status を Stable に更新する。

---

## 8. Dependabot 指摘への対応

すべてコミット `chore(deps): apply all open Dependabot updates` で適用し、`pnpm audit` の 15 件 (High 3 / Moderate 11 / Low 1) を 0 件にした。本 PR のマージ後、各 Dependabot PR は依存が最新化済みとして自動クローズされる。

| PR                  | 内容                                                                                        | 対応                                    | 補足                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| #22                 | npm_and_yarn (セキュリティ): vitest 4.1.11, nodemailer 10.0.9                               | 適用 (vitest 5.0.3, nodemailer 10.0.13) | nodemailer 13 件 (GHSA-v53p-9fqp-m79j ほか、修正版 ≥10.0.6)、vitest GHSA-82fw-gwwq-j7x9 (修正版 ≥4.1.11)                |
| #7                  | vite 8.3.1, @vitejs/plugin-react 6.1.1, vitest 5.0.2                                        | 適用                                    | Rolldown ではオブジェクト形式 `manualChunks` が廃止 → `rolldownOptions.output.codeSplitting` に移行                     |
| #21                 | vitest 5.0.3                                                                                | 適用                                    | Node ≥22.12 が必要 → `engines` を ≥22.13 に                                                                             |
| #20, #13            | nodemailer 10.0.9 / 10.0.11                                                                 | 適用 (10.0.13)                          | —                                                                                                                       |
| #14                 | @types/nodemailer 8.0.2                                                                     | 適用                                    | —                                                                                                                       |
| #10                 | zod 4.6.5                                                                                   | 適用                                    | 新コードは zod 4 API (`z.looseObject` 等) で記述                                                                        |
| #11, #12            | eslint 10.11.0, @eslint/js 10.0.1                                                           | 適用                                    | typescript-eslint 8.71 が ESLint 10 に対応済み                                                                          |
| #16                 | globals 17.12.0                                                                             | 適用                                    | —                                                                                                                       |
| #15                 | prettier-plugin-tailwindcss 0.8.1                                                           | 適用                                    | —                                                                                                                       |
| #8                  | recharts 3.10.1                                                                             | 適用                                    | peer の `react-is` を追加                                                                                               |
| #9                  | @types/node 26.6.3                                                                          | 適用                                    | 実行環境は Node 22 のまま。Node 22 に無い API を使わないことをレビューで確認                                            |
| #2, #3, #5, #6, #19 | checkout v7, setup-node v7, upload-pages-artifact v5, deploy-pages v5, pnpm/action-setup v6 | 適用                                    | #3 の CI 失敗は lockfile 追加前の古い基点が原因で、v7 固有の問題ではない (ログで確認)。v4 系の Node 20 非推奨警告も解消 |

再発防止として `dependabot.yml` に lint / types のグループ (vitest は vite グループ) と Actions のグループを追加し、Actions の複合アクション (`.github/actions/setup`) も `directories` で更新対象に含めた。CI に `pnpm audit --audit-level=high` (`pnpm audit:deps`) のジョブを追加した。

---

## 9. 運用設計

### 9.1 キーとスコープ

primary owner が claude.ai **Organization settings > API** で「すべてのリンク組織」を対象にキーを 1 本作成し、次のスコープだけを付与する。

| スコープ                     | 用途                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `read:compliance_activities` | Activity Feed                                                |
| `read:compliance_org_data`   | リンク組織、RBAC グループ (代替経路)、実効設定、キー台帳     |
| `read:members`               | メンバー、招待、カスタムロール                               |
| `read:rbac_groups`           | RBAC グループとメンバー数 (親組織全体を対象にしたキーが必要) |
| `read:analytics`             | 活動・採用・使用量・コスト                                   |
| `read:spend_limits`          | メンバー別の実効上限                                         |

事前に Compliance API と Analytics API (public API access) を有効化しておく。スコープを分けたい場合は API 系統ごとのキーを `ANTHROPIC_COMPLIANCE_API_KEY` / `ANTHROPIC_ANALYTICS_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` で上書きする。

### 9.2 レート制限と 1 回の実行コスト (6 時間ごと)

| API                     | 上限              | 1 回あたりの概算リクエスト数                                        |
| ----------------------- | ----------------- | ------------------------------------------------------------------- |
| Compliance              | 600 / 分 / 親組織 | organizations 1 + settings (組織数) + activities (件数 / 5,000)     |
| Admin (user management) | 100 / 分 / 組織   | users (人数 / 1,000) + invites 1 + groups 1 + グループ数 (上限 200) |
| Analytics               | 60 / 分 / 組織    | users (人数 / 1,000) + summaries 1 + usage 4 + cost 4               |
| Spend Limits            | 60 / 分 / 組織    | 人数 / 1,000                                                        |

429 は `retry-after` に従う。自分自身の Compliance API 呼び出しは `compliance_api_accessed` として Activity Feed に記録される (AK-001 の観測にも使われる)。

### 9.3 データ鮮度

- Activity Feed: 発生から 1 分以内に照会可能 → 上限を現在時刻の 2 分前に置き、10 分の重複窓で遅延到着を回収。
- Analytics の活動系: 1 日遅れ。使用量・コスト: 通常 4 時間以内、最大 24 時間、30 日間は改訂され得る → UA-001 は `data_refreshed_at` より前の確定日のみ使用。月次レポートは「暫定値」を明記し、請求確定には 30 日以上前の月を再実行する。

### 9.4 容量の目安 (`data/audit`、B3 / #38)

> [!IMPORTANT]
> 次の数値は **合成テナント (デモ用、メンバー 40 名) の長期履歴での計測値**であり、実データでの値ではない。**実テナントでの 1 か月以上の運用記録 (#38 の受け入れ基準) と B1 の V5 の結果で再検証し、閾値を見直す**。メンバー数・モデル数・グループ数・アクティビティ量が増えるほど増分は大きくなる (線形とは限らない)。

計測方法: テスト用ジェネレータ (`packages/collector/src/__tests__/synthetic-history.ts`) が固定クロックでデモ合成テナントから 6 時間間隔のスナップショットを作り、データセットごとに変化頻度を変えて (組織は不変、設定は 60 日、グループは 30 日、キー / メンバーは 7〜14 日、招待は 3 日、支出上限・活動・使用量・コスト・採用状況は日次、アクティビティは毎回の新規イベントのみ) 一時 git リポジトリにコミットごとに記録し、`git repack` 後に `pnpm size` と同じ関数で測る。

| 履歴 (6 時間間隔)             | コミット | 到達可能サイズ | 直近 30 日の増分 | 備考                                                             |
| ----------------------------- | -------- | -------------- | ---------------- | ---------------------------------------------------------------- |
| 400 日                        | 1,600    | 約 10.5 MiB    | 約 0.8 MiB       | 1 スナップショットあたり約 6.7 KiB (ファイル合計は約 178 KiB)    |
| 730 日                        | 2,920    | 約 20.0 MiB    | 約 0.9 MiB       | 定常状態の月間増分はほぼ一定 (約 0.8〜0.9 MiB / 30 日)           |
| 400 日 + 365 日超をアーカイブ | 1,601    | 約 12.8 MiB    | 約 3.1 MiB       | 139 件を圧縮: `.json.gz` が約 2.4 MiB 加わり、履歴は縮まない     |
| 730 日 + 365 日超をアーカイブ | 2,921    | 約 45.1 MiB    | 約 26.0 MiB      | 1,459 件を圧縮: `.json.gz` が約 25.4 MiB 加わり、合計は約 2.3 倍 |

読み取れること:

- **重複排除は効く**: 400 日 × 13 データセット (20,800 ファイル) が、重複排除後は 3,508 blob (約 17%)。変化しないデータセット (組織) は 1,600 スナップショットで 1 blob、日次のデータセットは日数分の blob、アクティビティは毎回 1 blob。
- **容量の大半は日次で変わる集計系**: 使用量 (約 48%)、コスト (約 15%)、アクティビティ・採用状況 (各約 5%)。
- **アーカイブは履歴を縮めず、実行時に一度だけ大きく増やす**: 初回の `pnpm archive` (365 日経過後) は 1 年分のスナップショットを `.json.gz` として追加し、元の blob は履歴に残る。年次ローテーション (`docs/DEPLOYMENT.md`) で履歴を退避しない限り減らない。

既定の閾値 (`config/default.json` の `capacity`、実データで見直す前提の暫定値):

| 項目                           | 既定           | 根拠                                                                                                                       |
| ------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `capacity.maxTotalMiB`         | 1,024 MiB      | GitHub が推奨するリポジトリサイズ (1 GiB 未満)。合成テナントの約 20 倍の規模で 2 年運用 (初回アーカイブ後) まで 1 GiB 未満 |
| `capacity.maxMonthlyGrowthMiB` | 50 MiB / 30 日 | 合成テナントの定常値 (約 1 MiB) の約 50 倍。これを超える増分は設定 (除外 type、`lookbackDays`) の見直しの合図              |
| `capacity.warnRatio`           | 0.8            | 上限の 80% で警告し、ローテーションの準備期間を確保                                                                        |

運用の目安: 警告が出たら (1) 増分の大きいデータセットを `pnpm size` の内訳で確認、(2) 収集設定を見直す、(3) 年次ローテーションを計画する。

---

## 10. リスクと未検証の仮定 (Phase B1 で確認)

| ID  | 仮定                                                                                    | 外れた場合の影響                  | 緩和策                                                                                             |
| --- | --------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| V1  | 親組織対象のキーで `GET /v1/organizations/users` がテナントのメンバーを返す             | メンバーが一部の組織分だけになる  | members は Compliance 組織ユーザーへの代替経路を持つ (`sources.members.provider`)                  |
| V2  | Activity の `api_actor.api_key_id` と実効設定 `api_keys[].id` が同じ ID 体系            | AK-001 が全キーを未使用と誤判定   | 一致する ID が 1 件も無い場合は AK-001 を `skipped` にする                                         |
| V3  | Analytics `users` 期間ロールアップに `last_activity_date` が含まれる                    | 最終活動日が表示できない          | 活動カウンタから「期間内の活動有無」を判定して AC-001 は成立させる                                 |
| V4  | 実効設定エンドポイントがテナントで有効                                                  | settings / credentials が取れない | 404 を `unavailable` として扱い OP-002 で可視化                                                    |
| V5  | 既定の除外 activity type (`*_viewed` 等) で収集量が許容範囲                             | 実行時間・データ量の増大          | `sources.activities.excludeTypes` / `includeTypes` で調整                                          |
| V6  | Compliance / Analytics が `x-api-key` ヘッダで認証できる (リファレンス例は Bearer 表記) | 401                               | `x-api-key` は `http-client.ts` の `request()` に固定 (設定では切替不可)。変更にはコード修正が必要 |
| V7  | Analytics の `rbac_group_id` 別コストは所属重複で総額を超え得る                         | 配分表の合計が総額と一致しない    | レポートに注記し、総額は group_by 無しの値を使用                                                   |

その他のリスク:

- 公式 API は beta を含み変更され得る → 腐敗防止層 (スキーマ + 写像) と未知値の通過、スキーマ差異はデータセット単位のエラーとして可視化。
- 大規模組織での Activity Feed 量 → 既定で閲覧系イベントを除外、ページ上限なしでも 5,000 件/ページ × 600 req/分で処理可能。
- ライブデータの Pages 公開 → 既定はサンプル、ライブは明示的オプトイン、PII マスク既定オン。

---

## 11. 品質ゲートとテスト戦略

| 観点           | 手段                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 依存方向       | core の tsconfig に Node 型を含めない / ESLint `no-restricted-imports` でレイヤー越境を禁止                                                 |
| 複雑度         | ESLint `complexity: 10`、`max-lines-per-function: 60`                                                                                       |
| API 契約       | 公式ドキュメントのレスポンス例をフィクスチャ化したアダプタテスト、未知項目・未知 enum の通過テスト、必須項目欠落の検出テスト                |
| ルール         | 全ルールで pass / fail / skipped、引数検証、例外隔離のテスト                                                                                |
| 仕様同期       | BLUEPRINT §7 と README のルール表 = レジストリのルール ID (テストで強制)                                                                    |
| サンプルデータ | `pnpm demo` の出力と `data/sample/` の一致 (ゴールデンテスト)、fork:verify で契約 v2 を検証                                                 |
| セキュリティ   | secret-scan、gitleaks、`pnpm audit --audit-level=high`、PII マスクのテスト                                                                  |
| 必須ゲート     | `pnpm fork:verify && pnpm typecheck && pnpm test && pnpm secret-scan && pnpm build` + `pnpm lint` + `pnpm format:check` + `pnpm audit:deps` |

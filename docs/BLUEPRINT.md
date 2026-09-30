# Claude Enterprise Audit Dashboard — Blueprint

> **Version:** 0.2.0  
> **Date:** 2026-09-30  
> **Author:** @sun-flat-yamada (Youhei Yamada)  
> **Status:** Draft — Spec-Driven Development Ready (Review v2)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Fork-Safe Design & Data Isolation](#4-fork-safe-design--data-isolation)
5. [Data Sources & API Integration](#5-data-sources--api-integration)
6. [Data Model & Long-Term Retention](#6-data-model--long-term-retention)
7. [Compliance Audit Rules](#7-compliance-audit-rules)
8. [Plugin Architecture](#8-plugin-architecture)
9. [Dashboard Design](#9-dashboard-design)
10. [Notification System](#10-notification-system)
11. [Monthly Billing Report & Model Analysis](#11-monthly-billing-report--model-analysis)
12. [GitHub Actions Automation](#12-github-actions-automation)
13. [Private/Internal Repository & Deployment](#13-privateinternal-repository--deployment)
14. [Security Considerations](#14-security-considerations)
15. [Project Structure](#15-project-structure)
16. [Technology Stack](#16-technology-stack)
17. [Development Roadmap](#17-development-roadmap)
18. [Spec-Driven Development Plan](#18-spec-driven-development-plan)

---

## 1. Executive Summary

**Claude Enterprise Audit Dashboard** は、Anthropic Claude Enterprise の Organization レベルの監査データを自動収集し、コンプライアンスチェックを実行し、結果を GitHub Pages 上のダッシュボードで可視化するツールです。

**Fork されることを前提**に設計されており、各組織が Fork してPrivate/Internal リポジトリとして自組織の監査基盤を即座に構築できます。

### コアバリュー

- **自動監査** — Compliance API / Admin API からデータを定期自動収集
- **コンプライアンスチェック** — 10+ の組み込みルールで継続的にセキュリティ監査
- **可視化** — GitHub Pages でホストされる静的ダッシュボード
- **アラート通知** — Slack / Discord / Email で異常検知・定期レポート配信
- **月次請求レポート** — Workspace別のコスト配分・モデル使用分析・改善提案
- **ゼロインフラ** — GitHub Actions のみで動作、サーバー不要
- **Fork-Safe** — Orphan ブランチによるデータ分離、コードと監査データの完全分離
- **プラグイン拡張** — Alert・ルール・通知チャネルをコード変更なしに追加可能

---

## 2. Goals & Non-Goals

### Goals

| #   | Goal                                                                        | Priority |
| --- | --------------------------------------------------------------------------- | -------- |
| G1  | Compliance API からの監査アクティビティ自動収集                             | **P0**   |
| G2  | Admin API からの組織メンバー・ワークスペース・API キー情報の収集            | **P0**   |
| G3  | 組み込みコンプライアンスルールによる自動監査チェック                        | **P0**   |
| G4  | GitHub Pages での静的ダッシュボード表示                                     | **P0**   |
| G5  | Slack / Discord / Email によるアラート通知                                  | **P0**   |
| G6  | GitHub Actions による定期実行（6時間ごと）                                  | **P0**   |
| G7  | **Fork-Safe 設計** — Orphan ブランチによるデータ分離                        | **P0**   |
| G8  | **Private/Internal リポジトリ前提** の GitHub Pages デプロイ対応            | **P0**   |
| G9  | 週次サマリーレポートの自動生成・配信                                        | **P1**   |
| G10 | **月次請求レポート** — Workspace 別コスト配分・モデル別内訳・Raw データ付き | **P1**   |
| G11 | **AIモデル使用分析** — モデル偏り検出・コスト最適化提案の自動生成           | **P1**   |
| G12 | 使用量異常検知（スパイク検出、予算超過）                                    | **P1**   |
| G13 | **プラグインアーキテクチャ** — ルール・トリガー・通知チャネルの拡張         | **P1**   |
| G14 | **長期データ保持** — Anthropic の保証期間を超えた独立した監査データ保存     | **P1**   |
| G15 | カスタムコンプライアンスルールの追加サポート                                | **P2**   |
| G16 | 多言語対応（日本語 / 英語）                                                 | **P2**   |

### Non-Goals

- リアルタイムストリーミング監視（バッチ処理のみ）
- プロンプト/レスポンスの内容監査（Compliance API のスコープ外）
- 複数組織の一元管理
- **Public リポジトリでの本番運用**（監査データ漏洩リスクのため）
- 有料 SaaS サービスへの依存

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Actions                        │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Collector │→│ Compliance   │→│ Notification       │  │
│  │ (6h cron) │  │ Checker      │  │ Dispatcher         │  │
│  └─────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│        │               │                    │             │
│        ▼               ▼                    ▼             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ data/    │  │ data/        │  │ Slack / Discord /  │  │
│  │ snapshots│  │ reports      │  │ Email              │  │
│  └─────┬─────┘  └──────┬───────┘  └───────────────────┘  │
│        │               │                                  │
│        └───────┬───────┘                                  │
│                ▼                                          │
│  ┌──────────────────────┐                                │
│  │ Dashboard Build      │                                │
│  │ (Vite + React)       │                                │
│  └──────────┬───────────┘                                │
│             ▼                                            │
│  ┌──────────────────────┐                                │
│  │ GitHub Pages Deploy  │                                │
│  └──────────────────────┘                                │
└─────────────────────────────────────────────────────────┘

External APIs:
  ┌────────────────────────┐  ┌───────────────────────────┐
  │ Anthropic Compliance   │  │ Anthropic Admin API       │
  │ API                    │  │                           │
  │ GET /v1/compliance/    │  │ GET /v1/organizations/    │
  │     activities         │  │     users                 │
  │                        │  │     workspaces            │
  │                        │  │     api_keys              │
  │                        │  │     usage                 │
  └────────────────────────┘  └───────────────────────────┘
```

### データフロー

1. **Collect** — GitHub Actions の cron (6h) で Collector が起動
2. **Fetch** — Compliance API / Admin API からデータを取得
3. **Restore** — `data/audit` orphan ブランチから前回データを復元
4. **Store** — スナップショットとして保存
5. **Check** — コンプライアンスルールに基づいて監査チェック実行
6. **Report** — チェック結果をレポートとして保存
7. **Commit** — `data/audit` orphan ブランチにデータをコミット（main には触れない）
8. **Archive** — 古いスナップショットを圧縮してアーカイブ
9. **Notify** — 異常検知時に Slack / Discord / Email で通知
10. **Build** — Dashboard をビルド（`data/audit` からデータを取得）
11. **Deploy** — GitHub Pages にデプロイ

---

## 4. Fork-Safe Design & Data Isolation

> **Reference:** [github-copilot-dashboard](https://github.com/sun-flat-yamada/github-copilot-dashboard/) のデータ分離パターンを参考に設計

### 4.1 ブランチ戦略

```
main              ← コードのみ。監査データなし。Fork-Safe
gh-pages          ← Dashboard 静的アセット（CI 自動生成）
data/audit        ← Orphan ブランチ。監査スナップショット・レポート（Fork 個別）
```

### 4.2 データ保存場所

| データ種別                 | 保存場所                | ブランチ              | main にコミット? |
| -------------------------- | ----------------------- | --------------------- | ---------------- |
| ソースコード               | `packages/`             | `main`                | ✅ Yes           |
| サンプル/DEMOデータ        | `data/sample/`          | `main`                | ✅ Yes           |
| ライブ監査スナップショット | `data/snapshots/`       | `data/audit` (orphan) | ❌ Never         |
| コンプライアンスレポート   | `data/reports/`         | `data/audit` (orphan) | ❌ Never         |
| ダッシュボード JSON        | `data/dashboard.json`   | `data/audit` (orphan) | ❌ Never         |
| コレクター状態             | `data/state.json`       | `data/audit` (orphan) | ❌ Never         |
| 月次レポート               | `data/reports/monthly/` | `data/audit` (orphan) | ❌ Never         |
| アーカイブデータ           | `data/archive/`         | `data/audit` (orphan) | ❌ Never         |

### 4.3 Orphan ブランチを選択した理由

1. **Fork 分離** — `Sync Fork` で `main` のコードだけが同期され、監査データはローカルに留まる
2. **履歴分離** — 監査データのコミットがコード履歴を汚さず、リポジトリサイズも抑制
3. **アクセス制御** — ブランチ保護ルールでデータブランチへの書き込みを制限可能
4. **Clean Upstream** — upstream の `main` は常にクリーンで `Sync Fork` のコンフリクトゼロ
5. **長期保持** — コードリリースとは独立してデータを永続保持可能

### 4.4 DEMOデータ vs 本番データの分離

|                        | DEMO データ                         | 本番データ                           |
| ---------------------- | ----------------------------------- | ------------------------------------ |
| **保存場所**           | `data/sample/` (main ブランチ)      | `data/` (data/audit orphan ブランチ) |
| **目的**               | 開発・テスト・ショーケース          | 実際の組織監査                       |
| **内容**               | 合成データ（架空の名前・ID）        | API から収集した実データ             |
| **Git 追跡**           | ✅ 追跡対象                         | ❌ main では追跡しない               |
| **Dashboard での利用** | data/audit 未作成時のフォールバック | 通常運用時のデータソース             |

### 4.5 fork:verify スクリプト

`npm run fork:verify` で以下を検証:

1. `main` ブランチにライブデータファイルが存在しないこと
2. `data/sample/` に有効な DEMO データが存在すること
3. 追跡ファイルにシークレットが含まれていないこと
4. `.gitignore` がライブデータパスを正しく除外していること

---

## 5. Data Sources & API Integration

### 5.1 Compliance API

| Endpoint                    | Method | Description                      |
| --------------------------- | ------ | -------------------------------- |
| `/v1/compliance/activities` | GET    | 監査アクティビティフィードの取得 |

**認証:** `x-api-key` ヘッダーに Compliance Access Key  
**バージョン:** `anthropic-version: 2023-06-01`  
**ページネーション:** カーソルベース（`has_more`, `first_id`, `last_id`）

**取得可能なアクティビティカテゴリ:**

| Category      | Events                           |
| ------------- | -------------------------------- |
| Admin         | ユーザー管理、ロール変更         |
| Identity      | SSO/SCIM プロビジョニング        |
| Configuration | 設定変更、ワークスペース管理     |
| Resource      | ファイル作成・ダウンロード・削除 |
| Access        | API キー作成・無効化             |
| Security      | セキュリティ関連イベント         |

### 5.2 Admin API

| Endpoint                                  | Method | Description                                            |
| ----------------------------------------- | ------ | ------------------------------------------------------ |
| `/v1/organizations/users`                 | GET    | 組織メンバー一覧の取得                                 |
| `/v1/organizations/workspaces`            | GET    | ワークスペース一覧の取得                               |
| `/v1/organizations/api_keys`              | GET    | API キー一覧の取得                                     |
| `/v1/organizations/invites`               | GET    | 招待一覧の取得                                         |
| `/v1/organizations/usage_report/messages` | GET    | 使用量レポート (group_by: workspace, model)            |
| `/v1/organizations/cost_report`           | GET    | コストレポート (USD cents, group_by: workspace, model) |

**認証:** `x-api-key` ヘッダーに Admin API Key (`sk-ant-admin...`)  
**バージョン:** `anthropic-version: 2023-06-01`

### 5.3 API Client Design

```typescript
// Retry with exponential backoff
// Rate limit: respect 429 with Retry-After header
// Pagination: auto-paginate all list endpoints
// Error handling: structured ApiError type
// Timeout: 30s per request, 5min per collection cycle
```

---

## 6. Data Model & Long-Term Retention

### 6.1 Storage Strategy (Orphan Branch)

```
data/                              # data/audit orphan branch
├── snapshots/                     # Raw audit snapshots
│   ├── 2026-09-29T00-00.json
│   ├── 2026-09-29T06-00.json
│   └── ...
├── reports/                       # Compliance check reports
│   ├── 2026-09-29T00-00.json
│   ├── monthly/                   # Monthly billing reports
│   │   ├── 2026-09/
│   │   │   ├── billing-summary.json
│   │   │   ├── usage-report.json
│   │   │   ├── cost-report.json
│   │   │   └── analysis.json
│   │   └── ...
│   └── ...
├── archive/                       # Compressed old snapshots
│   ├── 2025/
│   │   ├── snapshot-2025-01-01.json.gz
│   │   └── ...
│   └── ...
├── dashboard.json                 # Aggregated dashboard data
└── state.json                     # Collector state (last cursor, etc.)

data/sample/                       # main branch (DEMO data)
├── dashboard.json                 # Sample dashboard data
├── snapshot.json                  # Sample snapshot
└── report.json                    # Sample compliance report
```

### 6.2 Core Types

| Type                        | Package | Description                             |
| --------------------------- | ------- | --------------------------------------- |
| `AuditActivity`             | shared  | Compliance API のアクティビティイベント |
| `OrganizationMember`        | shared  | 組織メンバー情報                        |
| `Workspace`                 | shared  | ワークスペース情報                      |
| `ApiKeyInfo`                | shared  | API キー情報                            |
| `UsageReport`               | shared  | 使用量レポート                          |
| `AuditSnapshot`             | shared  | 収集したデータのスナップショット        |
| `ComplianceRule`            | shared  | コンプライアンスルール定義              |
| `ComplianceCheckResult`     | shared  | チェック結果                            |
| `ComplianceReport`          | shared  | コンプライアンスレポート                |
| `DashboardData`             | shared  | ダッシュボード表示用データ              |
| `Notification`              | shared  | 通知メッセージ                          |
| `AlertRule`                 | shared  | アラートルール定義                      |
| `MonthlyBillingReport`      | shared  | 月次請求レポート                        |
| `ModelUsageAnalysis`        | shared  | AIモデル使用分析結果                    |
| `ComplianceRulePlugin`      | shared  | プラグイン: コンプライアンスルール      |
| `AlertTriggerPlugin`        | shared  | プラグイン: アラートトリガー            |
| `NotificationChannelPlugin` | shared  | プラグイン: 通知チャネル                |

### 6.3 Long-Term Data Retention

> Anthropic Compliance API は **6年間** の監査ログ保持を保証。
> 本システムはそれに加え、**独立した永続保持**を実現する。

| データ                   | デフォルト保持期間 | 保持場所                | アーカイブ                            |
| ------------------------ | ------------------ | ----------------------- | ------------------------------------- |
| Raw スナップショット     | 365 日             | `data/snapshots/`       | 期限後に `data/archive/` へ gzip 圧縮 |
| コンプライアンスレポート | 無期限             | `data/reports/`         | 圧縮なし                              |
| 月次請求レポート         | 無期限             | `data/reports/monthly/` | 圧縮なし                              |
| アーカイブデータ         | 無期限             | `data/archive/`         | gzip 圧縮済み                         |
| Dashboard JSON           | 最新のみ           | `data/dashboard.json`   | N/A                                   |
| Collector 状態           | 最新のみ           | `data/state.json`       | N/A                                   |

**アーカイブプロセス:**

```bash
# collect-audit.yml の Archive ステップで自動実行
find data/snapshots/ -name "*.json" -mtime +365 | while read file; do
  gzip -c "$file" > "data/archive/$(date -r "$file" +%Y)/$(basename "$file").gz"
  rm "$file"
done
```

これにより:

- Anthropic の 6 年保証とは独立してデータを永続保持
- 古いスナップショットは圧縮してストレージを節約
- 月次レポートは無期限保持で監査証跡を確保

---

## 7. Compliance Audit Rules

### 7.1 組み込みルール一覧

| ID     | Name                  | Category           | Severity | Description                            |
| ------ | --------------------- | ------------------ | -------- | -------------------------------------- |
| AC-001 | Inactive Members      | access-control     | Medium   | 90日以上非アクティブなメンバーを検出   |
| AC-002 | Excessive Admin Roles | access-control     | High     | 管理者ロール比率が20%超を警告          |
| AC-003 | Single Primary Owner  | access-control     | Critical | Primary Owner の一意性確認             |
| AK-001 | Unused API Keys       | api-key-management | Medium   | 30日以上未使用の API キーを検出        |
| AK-002 | Unscoped API Keys     | api-key-management | High     | ワークスペース非限定の API キーを検出  |
| AK-003 | API Key Age           | api-key-management | Medium   | 180日超の API キーのローテーション推奨 |
| UA-001 | Usage Spike Detection | usage-anomaly      | High     | 7日平均の3倍超のトークン使用を検出     |
| UA-002 | Cost Budget Threshold | usage-anomaly      | Critical | 月次コスト予算超過アラート             |
| DG-001 | Empty Workspaces      | data-governance    | Low      | メンバーのいないワークスペースを検出   |
| OP-001 | Collection Freshness  | operational        | High     | 24時間以上データ収集がない場合に警告   |

### 7.2 コンプライアンススコア計算

```
Score = max(0, 100 - Σ(failed_check_severity_weight))

Severity Weights:
  Critical = 10 points
  High     = 5 points
  Medium   = 3 points
  Low      = 1 point
  Info     = 0 points
```

### 7.3 カスタムルール拡張

ユーザーは `config/custom-rules.json` にカスタムルールを定義可能：

```json
{
  "rules": [
    {
      "id": "CUSTOM-001",
      "name": "Max Members",
      "description": "Warn if organization exceeds 100 members",
      "category": "access-control",
      "severity": "medium",
      "checker": "checkMaxMembers",
      "params": { "maxMembers": 100 }
    }
  ]
}
```

---

## 8. Plugin Architecture

> **詳細仕様:** [PLUGIN-ARCHITECTURE.md](PLUGIN-ARCHITECTURE.md)

### 8.1 設計原則

1. **Registry Pattern** — 全プラグインはレジストリ経由で登録。コアコードは実装をハードコードしない
2. **Interface-First** — 全プラグインタイプに TypeScript インターフェースを定義
3. **Zero Core Modification** — プラグイン追加時にコア処理コードの変更不要
4. **Convention over Configuration** — 規約に基づいたファイルパスから自動検出
5. **Isolated Side Effects** — 各プラグインが自身のリソース（API クライアント等）を管理

### 8.2 プラグインタイプ

| Type                     | Interface                   | 用途               | 追加の複雑度                   |
| ------------------------ | --------------------------- | ------------------ | ------------------------------ |
| **Compliance Rule**      | `ComplianceRulePlugin`      | 監査ルールの追加   | **O(1)** — 1ファイル、自己登録 |
| **Alert Trigger**        | `AlertTriggerPlugin`        | アラート条件の追加 | **O(1)** — 1ファイル、自己登録 |
| **Notification Channel** | `NotificationChannelPlugin` | 通知先の追加       | **O(1)** — 1ファイル、自己登録 |

### 8.3 ファイル配置

```
packages/collector/src/
├── plugins/
│   ├── registry.ts              # Central registry (PluginRegistry class)
│   ├── loader.ts                # Auto-discovery & loading
│   └── index.ts
├── rules/                       # Built-in compliance rules
│   ├── ac-001-inactive-members.ts
│   ├── ac-002-excessive-admins.ts
│   └── ...                      # 各ルール: 1ファイル = 1プラグイン
├── triggers/                    # Built-in alert triggers
│   ├── compliance-failure.ts
│   ├── usage-spike.ts
│   └── ...
├── channels/                    # Built-in notification channels
│   ├── slack.ts
│   ├── discord.ts
│   └── email.ts
└── custom/                      # User custom plugins (gitignored)
    └── README.md
```

### 8.4 拡張性保証

```
switch 文なし、if/else チェーンなし、既存ファイルの変更なし
→ Registry Pattern + 自己登録で「追加のみ」の拡張
```

---

## 9. Dashboard Design

> **機能要求仕様:** [DASHBOARD-FEATURES.md](DASHBOARD-FEATURES.md)

### 9.1 ページ構成

```
/                          → Overview (メインダッシュボード)
/compliance                → コンプライアンスレポート詳細
/compliance/:reportId      → 個別レポート
/usage                     → 使用量分析
/activities                → アクティビティログ
/members                   → メンバー管理
/api-keys                  → API キー管理
/settings                  → ダッシュボード設定
```

### 9.2 Overview ページ構成

```
┌──────────────────────────────────────────────────────┐
│  Claude Enterprise Audit Dashboard                    │
│  Last Updated: 2026-09-29 12:00 UTC                  │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │ Score  │ │Members │ │API Keys│ │ Cost   │        │
│  │  92    │ │  47    │ │  12    │ │ $4,230 │        │
│  │ /100   │ │ active │ │ active │ │ /month │        │
│  └────────┘ └────────┘ └────────┘ └────────┘        │
│                                                       │
│  ┌─────────────────────┐ ┌─────────────────────────┐ │
│  │ Compliance Trend    │ │ Active Alerts           │ │
│  │ [Line Chart]        │ │ 🔴 Critical: 0         │ │
│  │                     │ │ 🟠 High: 2             │ │
│  │                     │ │ 🟡 Medium: 3            │ │
│  └─────────────────────┘ └─────────────────────────┘ │
│                                                       │
│  ┌─────────────────────┐ ┌─────────────────────────┐ │
│  │ Usage Trend         │ │ Recent Activities       │ │
│  │ [Area Chart]        │ │ • User added to ws...   │ │
│  │                     │ │ • API key created...    │ │
│  │                     │ │ • Config changed...     │ │
│  └─────────────────────┘ └─────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 9.3 技術要件

- **React 19** + **TypeScript 5.8** — コンポーネントベース UI
- **Vite 7** — 高速ビルド＆HMR
- **Tailwind CSS v4** — ユーティリティファースト CSS
- **Recharts** — SVG チャートライブラリ
- **React Router v7** — クライアントサイドルーティング
- **Lucide React** — アイコン
- **Static JSON** — `data/dashboard.json` を fetch して表示
- **レスポンシブ** — モバイル/タブレット/デスクトップ対応
- **ダークモード** — Tailwind dark variant 対応

---

## 10. Notification System

### 10.1 通知チャネル

| Channel     | Protocol          | Use Case                       |
| ----------- | ----------------- | ------------------------------ |
| **Slack**   | Incoming Webhook  | チーム向けリアルタイムアラート |
| **Discord** | Webhook           | 開発チーム向け通知             |
| **Email**   | SMTP (Nodemailer) | 管理者向け公式レポート         |

### 10.2 通知トリガー

| Trigger                    | Priority | Channels       | Description                        |
| -------------------------- | -------- | -------------- | ---------------------------------- |
| Critical Finding           | Urgent   | All            | コンプライアンスの Critical 検出時 |
| High Finding               | High     | Slack, Discord | High severity の検出時             |
| Collection Failure         | High     | All            | データ収集の失敗時                 |
| Weekly Report              | Normal   | Email, Slack   | 週次サマリーレポート               |
| **Monthly Billing Report** | Normal   | Email, Slack   | 月次請求レポート                   |
| Budget Alert               | Urgent   | All            | 予算超過検知時                     |
| Usage Spike                | High     | Slack, Discord | 異常使用量検知時                   |

### 10.3 Slack メッセージフォーマット

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🔴 Critical: API Key Security Alert" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Rule:* AK-002 Unscoped API Keys" },
        { "type": "mrkdwn", "text": "*Score:* 72/100" },
        { "type": "mrkdwn", "text": "*Found:* 3 unscoped keys" },
        { "type": "mrkdwn", "text": "*Dashboard:* <https://...|View>" }
      ]
    }
  ]
}
```

### 10.4 Discord Embed フォーマット

```json
{
  "embeds": [
    {
      "title": "🔴 Critical: API Key Security Alert",
      "color": 14495300,
      "fields": [
        { "name": "Rule", "value": "AK-002 Unscoped API Keys", "inline": true },
        { "name": "Score", "value": "72/100", "inline": true }
      ],
      "timestamp": "2026-09-29T12:00:00Z"
    }
  ]
}
```

---

## 11. Monthly Billing Report & Model Analysis

> **Agent Skill 仕様:** [billing-report SKILL.md](../.agents/skills/billing-report/SKILL.md)  
> **Agent Skill 仕様:** [model-usage-analysis SKILL.md](../.agents/skills/model-usage-analysis/SKILL.md)

### 11.1 月次請求レポート

**Workflow:** `monthly-report.yml` — 毎月1日 3:00 UTC に自動実行

**Admin API エンドポイント:**

| Endpoint                                      | Purpose                                   |
| --------------------------------------------- | ----------------------------------------- |
| `GET /v1/organizations/usage_report/messages` | Workspace × モデル × 日次のトークン使用量 |
| `GET /v1/organizations/cost_report`           | Workspace × モデル × 日次のコスト (USD)   |

**レポート内容:**

| セクション            | 内容                                                          |
| --------------------- | ------------------------------------------------------------- |
| サマリー              | 総コスト、総トークン数、日平均、年間予測、前月比              |
| Workspace 別集計      | Workspace ごとのコスト・トークン内訳 (Group 分類での請求配分) |
| モデル別集計          | モデルごとのコスト・トークン内訳                              |
| 日次明細              | 日別のコスト・トークン推移                                    |
| **全 Raw 内訳データ** | 全レコードの完全な生データ (CSV/JSON エクスポート対応)        |

### 11.2 AIモデル使用分析

**目的:** モデルの使われ方の偏りを検出し、コスト最適化の改善提案を自動生成

**検出パターン:**

| パターン         | 基準                 | 推奨アクション                     |
| ---------------- | -------------------- | ---------------------------------- |
| 高額モデル偏重   | Opus 使用率 >60%     | Sonnet への切り替え検討            |
| キャッシュ未活用 | Cache hit rate <30%  | System prompt のキャッシュ化       |
| Haiku 未活用     | Haiku 使用率 <5%     | 分類・抽出タスクへの Haiku 適用    |
| Workspace 不均衡 | 1 WS が総予算の >80% | 使用量の見直し・チーム配分の最適化 |

**出力:**

```json
{
  "month": "2026-09",
  "total_cost_usd": 4230.5,
  "recommendations": [
    {
      "id": "REC-001",
      "type": "model-optimization",
      "title": "Engineering workspace: Opus → Sonnet 切り替え提案",
      "impact_estimate_usd": 850.0,
      "priority": "high"
    }
  ]
}
```

### 11.3 Claude 組み込みコマンド活用

| コマンド/ツール         | 用途                                         |
| ----------------------- | -------------------------------------------- |
| `/plan`                 | 複雑な使用パターン分析の多段階推論           |
| `/boost`                | コスト最適化分析の深掘り・多角的検証         |
| Sequential Thinking MCP | モデル使用トレンドのステップバイステップ分析 |

---

## 12. GitHub Actions Automation

### 12.1 ワークフロー一覧

| Workflow             | Trigger                          | Description                                                    |
| -------------------- | -------------------------------- | -------------------------------------------------------------- |
| `ci.yml`             | Push / PR to main                | Lint, TypeCheck, Test, Build                                   |
| `deploy-pages.yml`   | Push to main + workflow_run      | Dashboard の GitHub Pages デプロイ (data/audit からデータ取得) |
| `collect-audit.yml`  | Cron (6h) / Manual               | 監査データ収集 → orphan ブランチにコミット → 通知              |
| `weekly-report.yml`  | Cron (月曜 9:00 UTC) / Manual    | 週次レポート生成・配信                                         |
| `monthly-report.yml` | Cron (毎月1日 3:00 UTC) / Manual | **月次請求レポート生成・モデル分析・配信**                     |
| `secret-scan.yml`    | Push / PR                        | シークレットスキャン                                           |

### 12.2 必要な GitHub Secrets

| Secret                         | Required | Description                        |
| ------------------------------ | -------- | ---------------------------------- |
| `ANTHROPIC_ADMIN_API_KEY`      | ✅       | Admin API キー (`sk-ant-admin...`) |
| `ANTHROPIC_COMPLIANCE_API_KEY` | ✅       | Compliance Access Key              |
| `SLACK_WEBHOOK_URL`            | ⬜       | Slack Incoming Webhook URL         |
| `DISCORD_WEBHOOK_URL`          | ⬜       | Discord Webhook URL                |
| `SMTP_HOST`                    | ⬜       | SMTP サーバーホスト                |
| `SMTP_PORT`                    | ⬜       | SMTP ポート (587)                  |
| `SMTP_USER`                    | ⬜       | SMTP ユーザー名                    |
| `SMTP_PASS`                    | ⬜       | SMTP パスワード                    |
| `ALERT_EMAIL_TO`               | ⬜       | アラート送信先メールアドレス       |

### 12.3 GitHub Pages 設定

- **Source:** GitHub Actions
- **URL:** `https://{username}.github.io/claude-audit-dashboard/`
- **Custom Domain:** オプション対応

---

## 13. Private/Internal Repository & Deployment

> **詳細ガイド:** [DEPLOYMENT.md](DEPLOYMENT.md)

### 13.1 リポジトリ可視性の前提

| 可視性       | GitHub Pages アクセス                  | 推奨用途              |
| ------------ | -------------------------------------- | --------------------- |
| **Private**  | ⚠️ Pages はデフォルトで公開 (下記参照) | 単一組織利用          |
| **Internal** | Enterprise Cloud のみ、Pages 制限可能  | エンタープライズ利用  |
| **Public**   | Pages は公開                           | ❌ 本番運用には非推奨 |

### 13.2 デプロイオプション

| シナリオ              | リポジトリ | Pages                                | データ             |
| --------------------- | ---------- | ------------------------------------ | ------------------ |
| Enterprise (フル機能) | Internal   | Private Pages (Enterprise Cloud)     | Orphan ブランチ    |
| Team (セキュア)       | Private    | DEMO データのみ Pages + ローカル dev | Orphan ブランチ    |
| 個人/デモ             | Private    | サンプルデータ Pages                 | サンプルデータのみ |
| 最大セキュリティ      | Private    | Pages なし (Artifact ダウンロード)   | Orphan ブランチ    |

### 13.3 Private リポジトリでの GitHub Pages 注意点

- Private リポジトリでも、GitHub Pages サイトは**デフォルトで公開**
- **GitHub Enterprise Cloud** のみ Pages の Private 設定が可能
- Enterprise Cloud 以外の場合は、**DEMO データのみ** を Pages で配信し、本番データは Pages に含めない
- 代替案: Vercel / Netlify / Cloudflare Pages での認証付きデプロイ

---

## 14. Security Considerations

### 14.1 シークレット管理

- API キーは **GitHub Secrets** にのみ保存
- `.env` ファイルは `.gitignore` に追加済み
- 収集データ (`data/*.json`) は `.gitignore` で除外（サンプルデータのみコミット）
- Compliance Access Key は Primary Owner のみ作成可能

### 14.2 データ保護

- ダッシュボードに表示するデータは集約済みのサマリーのみ
- 個人を特定できる情報（メールアドレス等）は表示時にマスキング可能
- GitHub Pages は公開リポジトリの場合、ダッシュボードも公開になる点に注意
- プライベートリポジトリでの運用を推奨

### 14.3 API セキュリティ

- Admin API Key は最小権限のスコープで発行
- API キーのローテーション推奨（180日以内）
- Rate Limit 遵守（429 レスポンスで Retry-After を尊重）

---

## 15. Project Structure

```
claude-audit-dashboard/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # CI (lint, test, build)
│   │   ├── deploy-pages.yml          # GitHub Pages deploy
│   │   ├── collect-audit.yml         # Scheduled audit collection
│   │   └── weekly-report.yml         # Weekly report generation
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   └── feature_request.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── packages/
│   ├── shared/                       # Shared types & utilities
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── api.ts            # API common types
│   │   │   │   ├── audit.ts          # Audit data types
│   │   │   │   ├── compliance.ts     # Compliance check types
│   │   │   │   ├── notification.ts   # Notification types
│   │   │   │   └── dashboard.ts      # Dashboard data types
│   │   │   ├── constants/
│   │   │   │   ├── audit-rules.ts    # Default audit rules
│   │   │   │   └── api-endpoints.ts  # API endpoint constants
│   │   │   ├── utils/
│   │   │   │   ├── date.ts           # Date utilities
│   │   │   │   └── severity.ts       # Severity utilities
│   │   │   └── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   ├── collector/                    # Data collector & checker
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── client.ts         # Base HTTP client
│   │   │   │   ├── compliance.ts     # Compliance API client
│   │   │   │   └── admin.ts          # Admin API client
│   │   │   ├── collectors/
│   │   │   │   ├── audit-collector.ts
│   │   │   │   ├── usage-collector.ts
│   │   │   │   └── org-collector.ts
│   │   │   ├── checkers/
│   │   │   │   ├── access-control.ts
│   │   │   │   ├── api-key-management.ts
│   │   │   │   ├── usage-anomaly.ts
│   │   │   │   ├── data-governance.ts
│   │   │   │   └── operational.ts
│   │   │   ├── notifiers/
│   │   │   │   ├── slack.ts
│   │   │   │   ├── discord.ts
│   │   │   │   ├── email.ts
│   │   │   │   └── dispatcher.ts
│   │   │   ├── reports/
│   │   │   │   ├── compliance-reporter.ts
│   │   │   │   ├── weekly-reporter.ts
│   │   │   │   └── dashboard-builder.ts
│   │   │   ├── storage/
│   │   │   │   ├── file-store.ts
│   │   │   │   └── state-manager.ts
│   │   │   ├── commands/
│   │   │   │   ├── collect-audit.ts
│   │   │   │   ├── collect-usage.ts
│   │   │   │   ├── compliance-check.ts
│   │   │   │   ├── send-notifications.ts
│   │   │   │   └── weekly-report.ts
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   └── dashboard/                    # React dashboard
│       ├── src/
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── Header.tsx
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   ├── Footer.tsx
│       │   │   │   └── Layout.tsx
│       │   │   ├── charts/
│       │   │   │   ├── ComplianceTrendChart.tsx
│       │   │   │   ├── UsageTrendChart.tsx
│       │   │   │   ├── CostBreakdownChart.tsx
│       │   │   │   └── ActivityTimelineChart.tsx
│       │   │   ├── cards/
│       │   │   │   ├── ScoreCard.tsx
│       │   │   │   ├── StatCard.tsx
│       │   │   │   └── AlertCard.tsx
│       │   │   ├── tables/
│       │   │   │   ├── MembersTable.tsx
│       │   │   │   ├── ApiKeysTable.tsx
│       │   │   │   ├── ActivityTable.tsx
│       │   │   │   └── ComplianceResultsTable.tsx
│       │   │   └── ui/
│       │   │       ├── Badge.tsx
│       │   │       ├── Button.tsx
│       │   │       ├── Card.tsx
│       │   │       ├── Skeleton.tsx
│       │   │       └── Tooltip.tsx
│       │   ├── pages/
│       │   │   ├── OverviewPage.tsx
│       │   │   ├── CompliancePage.tsx
│       │   │   ├── UsagePage.tsx
│       │   │   ├── ActivitiesPage.tsx
│       │   │   ├── MembersPage.tsx
│       │   │   ├── ApiKeysPage.tsx
│       │   │   └── SettingsPage.tsx
│       │   ├── hooks/
│       │   │   ├── useDashboardData.ts
│       │   │   ├── useTheme.ts
│       │   │   └── useLocalStorage.ts
│       │   ├── lib/
│       │   │   ├── data-loader.ts
│       │   │   └── cn.ts
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── index.css
│       ├── public/
│       │   └── favicon.svg
│       ├── index.html
│       ├── vite.config.ts
│       ├── postcss.config.js
│       ├── package.json
│       └── tsconfig.json
├── data/
│   ├── .gitkeep
│   └── sample/
│       ├── snapshot.json
│       ├── report.json
│       └── dashboard.json
├── config/
│   ├── default.json                  # Default configuration
│   └── custom-rules.json            # Custom compliance rules
├── docs/
│   ├── BLUEPRINT.md                  # This file
│   ├── SETUP.md                      # Setup guide
│   ├── API.md                        # API reference
│   └── CONTRIBUTING.md               # Contribution guide
├── .github/
├── .editorconfig
├── .gitignore
├── .nvmrc
├── .prettierrc
├── .prettierignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── LICENSE
├── README.md
└── CHANGELOG.md
```

---

## 16. Technology Stack

### Core

| Layer               | Technology      | Version | Rationale                |
| ------------------- | --------------- | ------- | ------------------------ |
| **Language**        | TypeScript      | 5.8     | 型安全性、DX             |
| **Runtime**         | Node.js         | 22 LTS  | 最新 LTS                 |
| **Package Manager** | pnpm            | 9.x     | 高速、ディスク効率       |
| **Monorepo**        | pnpm workspaces | —       | シンプル、追加ツール不要 |

### Dashboard (Frontend)

| Library               | Version | Purpose                |
| --------------------- | ------- | ---------------------- |
| React                 | 19      | UI フレームワーク      |
| Vite                  | 7       | ビルドツール           |
| Tailwind CSS          | 4       | スタイリング           |
| Recharts              | 2.15    | チャート               |
| React Router          | 7       | ルーティング           |
| Lucide React          | 0.470   | アイコン               |
| clsx + tailwind-merge | —       | クラス名ユーティリティ |
| date-fns              | 4       | 日付処理               |

### Collector (Backend)

| Library    | Version | Purpose                  |
| ---------- | ------- | ------------------------ |
| Zod        | 3.24    | ランタイムバリデーション |
| Nodemailer | 7       | Email 送信               |

### DevOps / Quality

| Tool           | Purpose                    |
| -------------- | -------------------------- |
| GitHub Actions | CI/CD、定期実行            |
| GitHub Pages   | ダッシュボードホスティング |
| Vitest         | テスト                     |
| ESLint         | Linting                    |
| Prettier       | フォーマッティング         |
| Husky          | Git hooks                  |
| Dependabot     | 依存関係の自動更新         |

---

## 17. Development Roadmap

### Phase 1: Foundation (Week 1-2) — ✅ 完了

- [x] Blueprint ドキュメント作成
- [x] プロジェクト構造の初期化
- [x] 共有型定義（shared パッケージ）
- [x] GitHub Actions ワークフロー設定
- [x] CI/CD パイプライン構築
- [x] サンプル DEMO データの生成
- [x] README / SETUP / CONTRIBUTING ドキュメント
- [x] Fork-Safe 設計（Orphan ブランチ、fork:verify スクリプト）
- [x] Plugin Architecture 仕様策定
- [x] Dashboard 機能要求仕様書 (DASHBOARD-FEATURES.md)
- [x] Private/Internal リポジトリデプロイガイド (DEPLOYMENT.md)
- [x] 月次請求レポート仕様策定
- [x] AIモデル分析 Agent Skill 定義

### Phase 2: Collector (Week 3-4)

- [x] Anthropic API クライアント実装
- [ ] Compliance API データ収集
- [ ] Admin API データ収集 (usage_report/messages, cost_report 含む)
- [x] ファイルストレージ (FileStore) ※状態管理 (state-manager) は未実装
- [x] Plugin Registry 実装
- [x] コンプライアンスチェッカー実装 (10 ルール)
- [ ] 月次請求レポート生成コマンド
- [ ] ユニットテスト (API client / storage / registry / checkers 実装済み。collectors・報告系は未)

### Phase 3: Dashboard (Week 5-6)

- [ ] Dashboard UI コンポーネント (F-001 ~ F-005)
- [ ] Overview ページ
- [ ] Compliance ページ
- [ ] Usage & Cost ページ
- [ ] Activity Log ページ
- [ ] Monthly Billing Report ページ (F-009)
- [ ] レスポンシブ対応
- [ ] ダークモード対応

### Phase 4: Notifications & Alerts (Week 7)

- [ ] Slack 通知実装
- [ ] Discord 通知実装
- [ ] Email 通知実装
- [ ] 通知ディスパッチャー（Plugin ベース）
- [ ] アラートルールエンジン（Plugin ベース）
- [ ] 月次レポート配信

### Phase 5: Model Analysis & Polish (Week 8)

- [ ] AIモデル使用分析の実装
- [ ] コスト最適化提案の自動生成
- [ ] E2E テスト
- [ ] パフォーマンス最適化
- [ ] ドキュメント完成
- [ ] v1.0.0 リリース

---

## 18. Spec-Driven Development Plan

### 18.1 開発プロセス

```
Spec → Types → Tests → Implementation → Review → Deploy
```

1. **Spec First** — 各機能の仕様を先に定義（この Blueprint が基準）
2. **Types First** — TypeScript の型定義を先に作成 → 完了済み
3. **Tests First** — テストケースを先に作成（TDD）
4. **Implementation** — テストを通す実装を作成
5. **Review** — コードレビュー + CI チェック
6. **Deploy** — main ブランチへのマージで自動デプロイ

### 18.2 Spec ファイル構成

各機能モジュールごとに `__specs__` ディレクトリに仕様書を配置：

```
packages/collector/src/api/__specs__/
  compliance-api.spec.md        # Compliance API client specification
  admin-api.spec.md             # Admin API client specification

packages/collector/src/checkers/__specs__/
  access-control.spec.md        # Access control rules specification
  api-key-management.spec.md    # API key rules specification

packages/collector/src/notifiers/__specs__/
  slack.spec.md                 # Slack notifier specification
  discord.spec.md               # Discord notifier specification
  email.spec.md                 # Email notifier specification
```

### 18.3 テスト戦略

| Level       | Tool       | Scope                | Coverage Target |
| ----------- | ---------- | -------------------- | --------------- |
| Unit        | Vitest     | 個別関数・クラス     | 80%+            |
| Integration | Vitest     | API Client + Storage | 70%+            |
| E2E         | Playwright | Dashboard UI         | Key flows       |

### 18.4 ブランチ戦略

```
main              ← production (auto-deploy)
├── develop       ← integration branch
│   ├── feat/*    ← feature branches
│   ├── fix/*     ← bug fix branches
│   └── docs/*    ← documentation branches
```

### 18.5 コミットメッセージ規約

[Conventional Commits](https://www.conventionalcommits.org/) に準拠：

```
feat(collector): implement compliance API client
fix(dashboard): correct chart rendering on mobile
docs: update setup guide
chore(ci): add weekly report workflow
test(checker): add access control rule tests
```

---

## Appendix A: Configuration Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "organization": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "id": { "type": "string" }
      }
    },
    "collection": {
      "type": "object",
      "properties": {
        "interval_hours": { "type": "number", "default": 6 },
        "retention_days": { "type": "number", "default": 90 },
        "full_sync_on_first_run": { "type": "boolean", "default": true }
      }
    },
    "compliance": {
      "type": "object",
      "properties": {
        "enabled_rules": { "type": "array", "items": { "type": "string" } },
        "custom_rules_path": { "type": "string" },
        "score_threshold_warning": { "type": "number", "default": 80 },
        "score_threshold_critical": { "type": "number", "default": 60 }
      }
    },
    "notifications": {
      "type": "object",
      "properties": {
        "channels": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": { "enum": ["slack", "discord", "email"] },
              "enabled": { "type": "boolean" },
              "config": { "type": "object" }
            }
          }
        },
        "cooldown_minutes": { "type": "number", "default": 60 }
      }
    },
    "dashboard": {
      "type": "object",
      "properties": {
        "base_url": { "type": "string" },
        "title": { "type": "string", "default": "Claude Enterprise Audit Dashboard" },
        "theme": { "enum": ["light", "dark", "system"], "default": "system" }
      }
    }
  }
}
```

---

## Appendix B: Glossary

| Term                      | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| **Compliance API**        | Anthropic の監査ログ API（アクティビティフィード）     |
| **Admin API**             | Anthropic の組織管理 API                               |
| **Primary Owner**         | Organization の最高権限を持つユーザー                  |
| **Compliance Access Key** | Compliance API にアクセスするためのキー                |
| **Admin API Key**         | Admin API にアクセスするためのキー (`sk-ant-admin...`) |
| **Snapshot**              | ある時点での監査データの完全なスナップショット         |
| **Compliance Score**      | 0-100 のコンプライアンス準拠スコア                     |
| **Alert Rule**            | 通知をトリガーする条件定義                             |

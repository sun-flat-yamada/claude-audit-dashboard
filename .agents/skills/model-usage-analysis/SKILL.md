---
name: model-usage-analysis
description: >
  Analyze Claude Enterprise AI model usage patterns, identify cost optimization
  opportunities, and generate improvement recommendations. Uses monthly billing
  data from the Anthropic Admin API to create actionable reports.
---

# Model Usage Analysis Skill

## Purpose

This skill analyzes Claude Enterprise Organization usage data to:

1. Identify AI model usage patterns and biases across workspaces
2. Detect cost optimization opportunities (model mix optimization)
3. Generate monthly improvement recommendations
4. Compare usage trends month-over-month

## When to Activate

- User asks to analyze model usage or spending patterns
- Monthly report generation triggers this skill
- User asks for cost optimization recommendations
- User asks about model selection best practices for their organization

## Data Sources

The skill reads from the following data files:

```
data/reports/monthly/YYYY-MM/
├── usage-report.json        # Token usage by workspace, model, day
├── cost-report.json         # Cost data by workspace, model
├── billing-summary.json     # Aggregated billing summary
└── analysis.json            # Generated analysis output
```

## Analysis Steps

### Step 1: Load Data

Read the monthly usage and cost reports from `data/reports/monthly/<target-month>/`.
If the target month is not specified, use the most recent available month.

```bash
# List available monthly reports
ls data/reports/monthly/
```

### Step 2: Workspace Usage Analysis

For each workspace, calculate:

- Total tokens (input + output)
- Total cost (USD)
- Cost per 1M tokens
- Model mix ratio (percentage of each model)
- Cache utilization rate

### Step 3: Model Bias Detection

Identify model usage biases:

| Pattern                               | Description                                       | Recommendation                                               |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| **Over-reliance on expensive models** | >60% of tokens use Opus when Sonnet would suffice | Consider model routing: use Sonnet for straightforward tasks |
| **Under-utilization of caching**      | Cache hit rate <30%                               | Implement prompt caching for repeated system prompts         |
| **Haiku underuse**                    | Haiku usage <5% despite suitable use cases        | Use Haiku for classification, extraction, and simple Q&A     |
| **Workspace imbalance**               | One workspace uses >80% of total budget           | Review if usage is proportional to team size/needs           |

### Step 4: Generate Recommendations

Produce structured recommendations:

```json
{
  "month": "2026-09",
  "total_cost_usd": 4230.5,
  "recommendations": [
    {
      "id": "REC-001",
      "type": "model-optimization",
      "title": "Shift Engineering workspace from Opus to Sonnet",
      "impact_estimate_usd": 850.0,
      "details": "Engineering workspace uses Claude Opus for 45% of requests. Analysis of token patterns suggests 70% of these could use Sonnet with equivalent quality.",
      "priority": "high"
    },
    {
      "id": "REC-002",
      "type": "caching",
      "title": "Enable prompt caching for Research workspace",
      "impact_estimate_usd": 200.0,
      "details": "Research workspace has 15% cache hit rate. System prompts are repeated 85% of the time.",
      "priority": "medium"
    }
  ]
}
```

### Step 5: Output Report

Write the analysis to `data/reports/monthly/<month>/analysis.json` and generate
a human-readable summary for notification channels.

## Claude Built-in Commands Integration

This skill leverages Claude's built-in capabilities:

- **`/plan`** — Use when the analysis requires multi-step reasoning about complex usage patterns
- **`/boost`** — Use for deep cost optimization analysis requiring multiple perspectives
- **Sequential Thinking MCP** — Use for step-by-step analysis of model usage trends

## Example Invocation

```
Analyze the model usage for September 2026 and suggest cost optimizations.
Focus on whether the Engineering team is using the right model mix.
```

## Output Format

The skill produces:

1. **JSON analysis file** — Machine-readable recommendations
2. **Markdown summary** — Human-readable report for notifications
3. **Notification payload** — Formatted for Slack/Discord/Email distribution

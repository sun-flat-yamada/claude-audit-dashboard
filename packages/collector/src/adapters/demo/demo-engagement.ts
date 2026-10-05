import type { MemberEngagement, ToolDecisions } from '@claude-audit/core';

/**
 * Synthetic 90-day engagement for one demo member, shaped like the Analytics users roll-up (every
 * block reported, zeros where the product was not used). Personas follow the member's surname:
 * engineers live in Claude Code, analysts in Chat and Office, counsel in Chat and Cowork,
 * designers in Claude Design.
 */
type Persona = 'Engineer' | 'Analyst' | 'Counsel' | 'Designer';

interface Uses {
  code: boolean;
  cowork: boolean;
  design: boolean;
  office: boolean;
  science: boolean;
}

/** Which products a member uses; deterministic per persona and index. */
function usesFor(persona: Persona, i: number): Uses {
  return {
    code: persona === 'Engineer' || (persona === 'Analyst' && i % 3 === 0),
    cowork: (persona === 'Counsel' && i % 2 === 0) || i % 7 === 1,
    design: (persona === 'Designer' && i % 4 !== 3) || i % 13 === 4,
    office: persona === 'Analyst' && i % 2 === 1,
    science: persona === 'Analyst' && i % 4 === 2,
  };
}

const scaled = (base: number, weight: number) => Math.round(base * weight);

function chat(weight: number, used: boolean): NonNullable<MemberEngagement['chat']> {
  const w = used ? weight : 0;
  return {
    messages: scaled(420, w),
    conversations: scaled(64, w),
    projectsCreated: scaled(3, w),
    artifactsCreated: scaled(18, w),
    filesUploaded: scaled(22, w),
    connectorCalls: scaled(35, w),
    thinkingMessages: scaled(60, w),
  };
}

const decisions = (proposals: number, acceptShare: number): ToolDecisions => {
  const accepted = Math.round(proposals * acceptShare);
  return { accepted, rejected: proposals - accepted };
};

function claudeCode(weight: number, used: boolean, i: number) {
  const w = used ? weight : 0;
  const share = 0.82 + (i % 5) * 0.03;
  return {
    sessions: scaled(140, w),
    commits: scaled(95, w),
    pullRequests: scaled(28, w),
    addedLines: scaled(18_500, w),
    removedLines: scaled(6_200, w),
    artifactsCreated: scaled(4, w),
    tools: {
      edit: decisions(scaled(1_900, w), share),
      multiEdit: decisions(scaled(420, w), share - 0.04),
      write: decisions(scaled(380, w), share + 0.05),
      notebookEdit: decisions(scaled(i % 4 === 0 ? 40 : 0, w), share - 0.1),
    },
  };
}

function others(weight: number, uses: Uses) {
  const w = (on: boolean) => (on ? weight : 0);
  return {
    cowork: {
      messages: scaled(160, w(uses.cowork)),
      sessions: scaled(24, w(uses.cowork)),
      actions: scaled(610, w(uses.cowork)),
      dispatchTurns: scaled(30, w(uses.cowork)),
      skillCalls: scaled(45, w(uses.cowork)),
      artifactsCreated: scaled(9, w(uses.cowork)),
    },
    design: {
      messages: scaled(140, w(uses.design)),
      sessions: scaled(20, w(uses.design)),
      projectsCreated: scaled(6, w(uses.design)),
    },
    office: {
      messages: scaled(90, w(uses.office)),
      sessions: scaled(26, w(uses.office)),
      skillCalls: scaled(14, w(uses.office)),
      connectorCalls: scaled(8, w(uses.office)),
    },
    science: {
      messages: scaled(70, w(uses.science)),
      sessions: scaled(9, w(uses.science)),
      delegations: scaled(12, w(uses.science)),
      computeJobs: scaled(5, w(uses.science)),
    },
  };
}

export function demoEngagement(persona: string, i: number, rnd: () => number): MemberEngagement {
  const uses = usesFor(persona as Persona, i);
  const weight = 0.35 + rnd() * 1.3;
  return {
    chat: chat(weight, i % 19 !== 7),
    claudeCode: claudeCode(weight, uses.code, i),
    ...others(weight, uses),
    webSearches: scaled(48, weight),
  };
}

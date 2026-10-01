import type { Clock, Logger } from '@claude-audit/core';

export const systemClock: Clock = { now: () => new Date() };

export const fixedClock = (date: Date): Clock => ({ now: () => new Date(date.getTime()) });

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
  error: (message) => console.error(`error: ${message}`),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

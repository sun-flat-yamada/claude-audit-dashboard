import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { loadDetailFile, useDetailFile, type Parser } from '../detail-data';

const asNumber: Parser<{ n: number }> = {
  parse(value) {
    const n = (value as { n?: unknown }).n;
    if (typeof n !== 'number') throw new Error('n must be a number');
    return { n };
  },
};

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('loadDetailFile', () => {
  it('builds the URL from the base path and returns parsed data', async () => {
    const fetchImpl = respond(200, { n: 3 });
    await expect(
      loadDetailFile('/sub/', 'detail/members.json', asNumber, fetchImpl),
    ).resolves.toEqual({
      status: 'ready',
      data: { n: 3 },
    });
    expect(fetchImpl).toHaveBeenCalledWith('/sub/data/detail/members.json');
  });

  it('treats 404 as missing, not as an error', async () => {
    await expect(loadDetailFile('/', 'x.json', asNumber, respond(404))).resolves.toEqual({
      status: 'missing',
    });
  });

  it('reports HTTP failures, schema failures and network failures as errors', async () => {
    const http = await loadDetailFile('/', 'x.json', asNumber, respond(500));
    expect(http).toEqual({ status: 'error', message: 'HTTP 500 for x.json' });
    const schema = await loadDetailFile('/', 'x.json', asNumber, respond(200, { n: 'a' }));
    expect(schema).toEqual({
      status: 'error',
      message:
        'x.json is not in the supported format (schemaVersion undefined). Re-run `pnpm build:detail` (or `pnpm demo` for the sample data) to regenerate it.',
    });
    const outdated = await loadDetailFile(
      '/',
      'x.json',
      asNumber,
      respond(200, { schemaVersion: 0 }),
    );
    expect(outdated).toMatchObject({ message: expect.stringContaining('schemaVersion 0') });
    const network = await loadDetailFile('/', 'x.json', asNumber, (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    expect(network).toEqual({ status: 'error', message: 'offline' });
  });
});

function Probe({ fetchImpl }: { fetchImpl: typeof fetch }) {
  const state = useDetailFile('x.json', asNumber, { baseUrl: '/', fetchImpl });
  if (state.status === 'ready') return <p>value {state.data.n}</p>;
  if (state.status === 'missing') return <p>not collected</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  return <p role="status">loading</p>;
}

describe('useDetailFile', () => {
  it('moves from loading to ready', async () => {
    render(<Probe fetchImpl={respond(200, { n: 7 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('loading');
    expect(await screen.findByText('value 7')).toBeInTheDocument();
  });

  it('renders the missing state', async () => {
    render(<Probe fetchImpl={respond(404)} />);
    expect(await screen.findByText('not collected')).toBeInTheDocument();
  });

  it('renders the error state as an alert', async () => {
    render(<Probe fetchImpl={respond(503)} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
  });
});

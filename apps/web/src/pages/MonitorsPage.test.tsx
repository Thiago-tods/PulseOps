import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';

const session = {
  accessToken: 'token',
  expiresIn: 900,
  user: { id: '1', email: 'ana@example.com', name: 'Ana' },
  organization: { id: 'o1', name: 'Acme', slug: 'acme-abc123' },
  role: 'OWNER',
};

const monitor = {
  id: 'm1',
  name: 'API principal',
  url: 'https://api.exemplo.com/saude',
  method: 'GET',
  intervalSec: 300,
  timeoutMs: 10000,
  expectedStatus: 200,
  failureThreshold: 2,
  enabled: true,
  lastCheck: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/monitores']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('MonitorsPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('lista os monitores da organização', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh') ? json(200, session) : json(200, [monitor]),
    );
    renderPage();
    expect(await screen.findByText('API principal')).toBeInTheDocument();
    expect(screen.getByText(/a cada 5 min/)).toBeInTheDocument();
  });

  it('mostra estado vazio e exibe o erro da API ao cadastrar URL bloqueada', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return json(200, session);
      if (init?.method === 'POST') {
        return json(400, { statusCode: 400, message: 'Endereço IP não permitido' });
      }
      return json(200, []);
    });
    renderPage();
    expect(await screen.findByText('Nenhum monitor cadastrado ainda.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nome'), 'Interno');
    await user.type(screen.getByLabelText(/URL/), 'http://127.0.0.1/');
    await user.click(screen.getByRole('button', { name: 'Adicionar monitor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Endereço IP não permitido');
  });

  it('VIEWER não vê o formulário nem os botões de ação', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh')
        ? json(200, { ...session, role: 'VIEWER' })
        : json(200, [monitor]),
    );
    renderPage();
    expect(await screen.findByText('API principal')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Novo monitor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
  });

  it('mostra o status e a latência da última verificação e abre o histórico', async () => {
    const lastCheck = {
      status: 'DOWN',
      httpStatus: 503,
      latencyMs: 120,
      error: 'Status HTTP 503 (esperado 200)',
      checkedAt: '2026-01-01T12:00:00.000Z',
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh')) return json(200, session);
      if (url.includes('/checks')) return json(200, [lastCheck]);
      return json(200, [{ ...monitor, lastCheck }]);
    });
    renderPage();
    expect(await screen.findByText('Fora do ar')).toBeInTheDocument();
    expect(screen.getByText(/120 ms/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Histórico' }));
    expect(
      await screen.findByRole('list', { name: 'Histórico de verificações' }),
    ).toHaveTextContent('Status HTTP 503');
  });

  it('mostra aviso quando o monitor ainda não foi verificado', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh') ? json(200, session) : json(200, [monitor]),
    );
    renderPage();
    expect(await screen.findByText('Aguardando 1ª verificação')).toBeInTheDocument();
  });
});

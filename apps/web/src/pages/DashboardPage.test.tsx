import { render, screen } from '@testing-library/react';
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

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/painel']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('lista incidentes e indica quantos estão em aberto', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh')
        ? json(200, session)
        : json(200, [
            {
              id: 'i1',
              title: 'API principal indisponível',
              status: 'INVESTIGATING',
              severity: 'MAJOR',
              monitorId: 'm1',
              monitorName: 'API principal',
              startedAt: '2026-01-01T12:00:00.000Z',
              resolvedAt: null,
            },
          ]),
    );
    renderPage();
    expect(await screen.findByText('API principal indisponível')).toBeInTheDocument();
    expect(screen.getByText('1 incidente(s) em aberto.')).toBeInTheDocument();
    expect(screen.getByText('Em aberto')).toBeInTheDocument();
  });

  it('mostra estado vazio sem incidentes', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh') ? json(200, session) : json(200, []),
    );
    renderPage();
    expect(await screen.findByText('Nenhum incidente registrado.')).toBeInTheDocument();
  });

  it('mostra o erro quando a API falha', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh')
        ? json(200, session)
        : json(500, { statusCode: 500, message: 'Erro interno do servidor' }),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro interno do servidor');
  });
});

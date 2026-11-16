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

const rule = {
  id: 'r1',
  name: 'Slack time',
  channel: 'WEBHOOK',
  targetPreview: 'https://hooks.exemplo.com/…',
  monitorId: null,
  monitorName: null,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const notification = {
  id: 'n1',
  event: 'INCIDENT_OPENED',
  status: 'FAILED',
  attempts: 5,
  lastError: 'Resposta HTTP 500',
  ruleName: 'Slack time',
  incidentTitle: 'API indisponível',
  createdAt: '2026-01-01T12:00:00.000Z',
  sentAt: null,
};

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('páginas de alertas e status', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  describe('AlertsPage', () => {
    it('lista regras (destino mascarado) e notificações com seu resultado', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('/auth/refresh')) return json(200, session);
        if (url.endsWith('/alert-rules')) return json(200, [rule]);
        if (url.endsWith('/notifications')) return json(200, [notification]);
        return json(200, []);
      });
      renderAt('/alertas');
      expect(await screen.findByText('Slack time', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.getByText(/https:\/\/hooks\.exemplo\.com\/…/)).toBeInTheDocument();
      expect(screen.getByText('Falhou')).toBeInTheDocument();
      expect(screen.getByText(/Resposta HTTP 500/)).toBeInTheDocument();
    });

    it('mostra o erro da API ao tentar cadastrar destino interno', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('/auth/refresh')) return json(200, session);
        if (init?.method === 'POST') {
          return json(400, { statusCode: 400, message: 'Endereço IP não permitido' });
        }
        return json(200, []);
      });
      renderAt('/alertas');
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Nome'), 'Interna');
      await user.type(screen.getByLabelText(/URL do webhook/), 'http://127.0.0.1/hook');
      await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Endereço IP não permitido');
    });

    it('MEMBER vê as regras, mas sem formulário nem botões de ação', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('/auth/refresh')) return json(200, { ...session, role: 'MEMBER' });
        if (url.endsWith('/alert-rules')) return json(200, [rule]);
        return json(200, []);
      });
      renderAt('/alertas');
      expect(await screen.findByText('Slack time', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Nova regra de alerta' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Enviar teste' })).not.toBeInTheDocument();
    });
  });

  describe('PublicStatusPage', () => {
    const publicBody = {
      title: 'Status Acme',
      description: 'Nossos serviços',
      overall: 'PARTIAL_OUTAGE',
      updatedAt: '2026-01-01T12:00:00.000Z',
      monitors: [
        { name: 'API', state: 'UP', uptime30d: 99.95, lastCheckedAt: '2026-01-01T11:59:00.000Z' },
        { name: 'Pagamentos', state: 'DOWN', uptime30d: 80, lastCheckedAt: null },
      ],
      incidents: [
        {
          title: 'Pagamentos indisponível',
          status: 'INVESTIGATING',
          startedAt: '2026-01-01T11:00:00.000Z',
          resolvedAt: null,
        },
      ],
    };

    it('exibe estado geral, serviços e incidentes sem exigir login', async () => {
      fetchMock.mockImplementation((url: string) =>
        url.includes('/public/status/acme') ? json(200, publicBody) : json(401, {}),
      );
      renderAt('/status/acme');
      expect(await screen.findByRole('heading', { name: 'Status Acme' })).toBeInTheDocument();
      expect(screen.getByText('Instabilidade parcial')).toBeInTheDocument();
      expect(screen.getByText(/99\.95% de disponibilidade/)).toBeInTheDocument();
      expect(screen.getByText('Fora do ar')).toBeInTheDocument();
      expect(screen.getByText('Em andamento')).toBeInTheDocument();
      // não deve ter tentado renovar sessão para uma página pública
      expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('/auth/me'))).toBe(true);
    });

    it('mostra "não encontrada" para 404 (privada ou inexistente)', async () => {
      fetchMock.mockImplementation(() =>
        json(404, { statusCode: 404, message: 'Página não encontrada' }),
      );
      renderAt('/status/nada');
      expect(
        await screen.findByRole('heading', { name: 'Página não encontrada' }),
      ).toBeInTheDocument();
    });

    it('mostra mensagem de erro quando a API falha', async () => {
      fetchMock.mockImplementation(() => json(500, { statusCode: 500, message: 'Erro interno' }));
      renderAt('/status/acme');
      expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
    });
  });

  describe('StatusSettingsPage', () => {
    const monitor = {
      id: '018f3c1e-6a2b-7c3d-8e4f-5a6b7c8d9e0f',
      name: 'API principal',
      url: 'https://api.exemplo.com',
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

    it('carrega a página existente e salva as alterações', async () => {
      const page = {
        slug: 'acme',
        title: 'Status Acme',
        description: null,
        isPublic: true,
        monitors: [{ monitorId: '018f3c1e-6a2b-7c3d-8e4f-5a6b7c8d9e0f', displayName: 'API' }],
      };
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('/auth/refresh')) return json(200, session);
        if (url.endsWith('/monitors')) return json(200, [monitor]);
        if (url.endsWith('/status-page') && init?.method === 'PUT') {
          return json(200, { ...page, title: JSON.parse(String(init.body)).title });
        }
        return json(200, page);
      });
      renderAt('/pagina-de-status');
      const title = await screen.findByLabelText('Título');
      expect(title).toHaveValue('Status Acme');
      expect(screen.getByRole('link', { name: '/status/acme' })).toBeInTheDocument();

      const user = userEvent.setup();
      await user.clear(title);
      await user.type(title, 'Novo título');
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(await screen.findByText('Página salva.')).toBeInTheDocument();
      const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT');
      expect(JSON.parse(String(put?.[1].body))).toMatchObject({
        slug: 'acme',
        isPublic: true,
        monitors: [{ monitorId: '018f3c1e-6a2b-7c3d-8e4f-5a6b7c8d9e0f', displayName: 'API' }],
      });
    });

    it('valida o endereço antes de enviar', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('/auth/refresh')) return json(200, session);
        if (url.endsWith('/monitors')) return json(200, [monitor]);
        return json(200, null);
      });
      renderAt('/pagina-de-status');
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/Endereço/), 'ADMIN');
      await user.type(screen.getByLabelText('Título'), 'Meu status');
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/reservado/i);
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
    });
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

const sessionBody = {
  accessToken: 'token',
  expiresIn: 900,
  user: { id: '1', email: 'ana@example.com', name: 'Ana' },
  organization: { id: 'o1', name: 'Acme', slug: 'acme-abc123' },
  role: 'OWNER',
};

function json(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('App', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    // Por padrão não há sessão: o refresh responde 401.
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/refresh') ? json(401, { message: 'Sessão inválida' }) : json(404, {}),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('exibe a página inicial', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      /Monitore suas APIs/,
    );
  });

  it('exibe 404 em rota desconhecida', async () => {
    renderAt('/nada');
    expect(
      await screen.findByRole('heading', { name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });

  it('redireciona visitante de /painel para o login', async () => {
    renderAt('/painel');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('exibe erro de validação no login sem chamar a API', async () => {
    renderAt('/entrar');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'invalido');
    await user.type(screen.getByLabelText('Senha'), 'x');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/login'))).toBe(false);
  });

  it('mostra o erro retornado pela API quando o login falha', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/login')
        ? json(401, { statusCode: 401, message: 'E-mail ou senha inválidos' })
        : json(401, { message: 'Sessão inválida' }),
    );
    renderAt('/entrar');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-errada');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos');
  });

  it('entra no painel após login válido', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/login')
        ? json(200, sessionBody)
        : json(401, { message: 'Sessão inválida' }),
    );
    renderAt('/entrar');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('E-mail'), 'ana@example.com');
    await user.type(screen.getByLabelText('Senha'), 'senha-valida-123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Olá, Ana' })).toBeInTheDocument();
  });
});

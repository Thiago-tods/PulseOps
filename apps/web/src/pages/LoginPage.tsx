import { Link, useNavigate } from 'react-router-dom';
import { loginSchema } from '@pulseops/shared';
import { useAuth } from '../auth/AuthContext';
import { AuthForm } from '../components/AuthForm';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthForm
      title="Entrar"
      schema={loginSchema}
      submitLabel="Entrar"
      onSubmit={async (values) => {
        await login(values);
        void navigate('/painel');
      }}
      fields={[
        { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Senha', type: 'password', autoComplete: 'current-password' },
      ]}
      footer={
        <>
          Não tem conta? <Link to="/cadastro">Cadastre-se</Link>
        </>
      }
    />
  );
}

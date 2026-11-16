import { Link, useNavigate } from 'react-router-dom';
import { registerSchema } from '@pulseops/shared';
import { useAuth } from '../auth/AuthContext';
import { AuthForm } from '../components/AuthForm';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthForm
      title="Criar conta"
      schema={registerSchema}
      submitLabel="Criar conta"
      onSubmit={async (values) => {
        await register(values);
        void navigate('/painel');
      }}
      fields={[
        { name: 'name', label: 'Nome', autoComplete: 'name' },
        { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
        { name: 'organizationName', label: 'Nome da organização', autoComplete: 'organization' },
        {
          name: 'password',
          label: 'Senha (mín. 10 caracteres)',
          type: 'password',
          autoComplete: 'new-password',
        },
      ]}
      footer={
        <>
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </>
      }
    />
  );
}

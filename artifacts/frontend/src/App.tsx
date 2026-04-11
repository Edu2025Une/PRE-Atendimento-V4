import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Contatos from "@/pages/Contatos";
import Perfil from "@/pages/Perfil";
import MinhaEvolution from "@/pages/MinhaEvolution";
import Configuracoes from "@/pages/admin/Configuracoes";
import Usuarios from "@/pages/admin/Usuarios";
import UsuarioEvolution from "@/pages/admin/UsuarioEvolution";
import Auditoria from "@/pages/admin/Auditoria";
import EvolutionConnections from "@/pages/admin/EvolutionConnections";

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <BrowserRouter basename={base}>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/contatos" element={<Contatos />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/minha-evolucao" element={<MinhaEvolution />} />
        <Route path="/admin/configuracoes" element={<Configuracoes />} />
        <Route path="/admin/users" element={<Usuarios />} />
        <Route path="/admin/users/:id/evolution" element={<UsuarioEvolution />} />
        <Route path="/admin/audit" element={<Auditoria />} />
        <Route path="/admin/evolution-connections" element={<EvolutionConnections />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", color: "#dc2626", background: "#fef2f2", minHeight: "100vh" }}>
          <h2 style={{ marginBottom: "1rem" }}>Erro ao carregar o aplicativo</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.75rem", marginTop: "1rem", color: "#6b7280" }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML = '<div style="padding:2rem;color:red">Erro: elemento #root não encontrado</div>';
} else {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

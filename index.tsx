// Author: forsearch | Updated: 2026-04-30
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AuthPage from './components/AuthPage';
import MigrationWizard from './components/MigrationWizard';
import { fetchMe, SessionUser } from './services/authClient';
import { AlertProvider } from './components/GlobalAlert';

// 登录门：未登录展示完整登录页，登录后进入应用。
function AuthGate() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  if (user === undefined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#07111f]">
        <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-300 rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) {
    return <AuthPage onAuthed={(u) => setUser(u)} />;
  }
  return (
    <>
      <App />
      <MigrationWizard user={user} />
    </>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AlertProvider>
      <AuthGate />
    </AlertProvider>
  </React.StrictMode>
);

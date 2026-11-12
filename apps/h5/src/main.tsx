import '@fontsource/noto-sans-sc/700.css';
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd-mobile';
import zhCN from 'antd-mobile/es/locales/zh-CN';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getToken } from './api';
import { ConfirmPage } from './pages/ConfirmPage';
import { HomePage } from './pages/HomePage';
import { JobPage } from './pages/JobPage';
import { LoginPage } from './pages/LoginPage';
import { ProductPage } from './pages/ProductPage';
import { SharePage } from './pages/SharePage';
import { StoryboardPage } from './pages/StoryboardPage';
import { StorylinesPage } from './pages/StorylinesPage';
import { WorkPage } from './pages/WorkPage';
// 设计系统放在最后加载：与 antd-mobile 的样式同等优先级时以这里为准
import './ui/ui.css';
import './ui/theme.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

function RequireAuth({ children }: { children: ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

const authed = (node: ReactNode) => <RequireAuth>{node}</RequireAuth>;

/** 切换页面时回到顶部（单页应用默认保留上一页的滚动位置） */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/s/:token" element={<SharePage />} />
            <Route path="/" element={authed(<HomePage />)} />
            <Route path="/p/:projectId/product" element={authed(<ProductPage />)} />
            <Route path="/p/:projectId/storylines" element={authed(<StorylinesPage />)} />
            <Route path="/p/:projectId/storyboard" element={authed(<StoryboardPage />)} />
            <Route path="/p/:projectId/confirm" element={authed(<ConfirmPage />)} />
            <Route path="/p/:projectId/job/:jobId" element={authed(<JobPage />)} />
            <Route path="/p/:projectId/work" element={authed(<WorkPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  </StrictMode>,
);

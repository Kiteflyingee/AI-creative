import { Button, Form, Input } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession, showError } from '../api';

export function LoginPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: { id: string; name: string } }>('/app/v1/auth/dev-login', { name: name.trim() });
      setSession(res.token, res.user);
      navigate('/', { replace: true });
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <h1>AI 带货视频</h1>
      <p className="muted">上传商品图，选一个创意，生成可用的带货视频</p>
      <Form layout="vertical">
        <Form.Item label="昵称（开发用简易登录）">
          <Input placeholder="输入昵称" value={name} onChange={setName} maxLength={30} data-testid="login-name" />
        </Form.Item>
      </Form>
      <Button block color="primary" size="large" loading={busy} disabled={!name.trim()} onClick={() => void submit()} data-testid="login-submit">
        进入
      </Button>
    </div>
  );
}

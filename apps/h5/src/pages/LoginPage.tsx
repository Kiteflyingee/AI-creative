import { Input } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession, showError } from '../api';
import { IconPlay, IconSparkle } from '../ui/icons';
import { Btn } from '../ui/kit';

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
    <div className="ui-login">
      <div className="ui-login__brand">
        <IconSparkle size={22} />
        AI 带货视频
      </div>

      {/* 示意图：只用几何图形和真实的产品能力，不放示例作品 */}
      <div className="ui-login__hero" aria-hidden="true">
        <div className="ui-fan">
          <div className="ui-fan__card ui-fan__card--l" />
          <div className="ui-fan__card ui-fan__card--r" />
          <div className="ui-fan__card ui-fan__card--front">
            <span className="ui-glass-pill">逐镜头生成</span>
            <span className="ui-play">
              <IconPlay size={20} />
            </span>
            <div className="ui-fan__caption">
              4 条故事线
              <span>选一条，定分镜，再生成</span>
            </div>
          </div>
        </div>
      </div>

      <div className="ui-login__copy">
        <h1 className="ui-login__title">
          一张商品图
          <br />
          做出带货短视频
        </h1>
        <p className="ui-login__sub">上传商品图，选一个创意，生成可用的带货视频</p>
      </div>

      <div className="ui-login__form">
        <Input
          className="ui-input"
          placeholder="输入昵称"
          value={name}
          onChange={setName}
          onEnterPress={() => void submit()}
          maxLength={30}
          data-testid="login-name"
        />
        <Btn block size="lg" variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()} data-testid="login-submit">
          进入
        </Btn>
        <div className="ui-login__note">开发用简易登录</div>
      </div>
    </div>
  );
}

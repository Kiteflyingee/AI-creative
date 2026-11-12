import { useQueryClient } from '@tanstack/react-query';
import { TextArea } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, showError } from '../api';
import { BottomBar, FlowPage, PageHeader, Section, uploadFiles, UploadHero } from '../components';
import { Btn, Pill } from '../ui/kit';

/**
 * 发布表单（D-54、D-56）：只有商品图（必填）和一句话介绍（选填）。
 * 选好商品图时才创建项目（不留空草稿）；一句话介绍存为商品描述，随后进入确认卖点页并自动做素材理解。
 */
export function PublishPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [intro, setIntro] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async (files: File[]) => {
    setBusy(true);
    try {
      const { projectId } = await api.post<{ projectId: string }>('/app/v1/projects', {});
      if (intro.trim()) await api.patch(`/app/v1/projects/${projectId}/product`, { description: intro.trim() });
      const uploaded = await uploadFiles(projectId, 'PRODUCT', files);
      await client.invalidateQueries({ queryKey: ['projects'] });
      // 项目已经建好：即使图片都没传成功也进入下一页，在那里继续添加
      navigate(`/p/${projectId}/product${uploaded.length ? '?analyze=1' : ''}`, { replace: true });
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  return (
    <FlowPage bar>
      <PageHeader title="发布商品视频" step={0} back="/" />

      <Section title="商品图">
        <UploadHero busy={busy} onFiles={(files) => void start(files)} testId="upload-PRODUCT" />
      </Section>

      <Section title="一句话介绍" extra={<Pill className="on-bg">选填</Pill>}>
        <TextArea
          className="ui-input"
          placeholder="例如：外罩能拆下来机洗，尺寸 50×40 厘米"
          value={intro}
          onChange={setIntro}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={200}
          disabled={busy}
          data-testid="publish-intro"
        />
        <p className="ui-field__hint ui-mt-sm">写一句最想让顾客知道的，AI 提炼卖点会更准</p>
      </Section>

      <BottomBar>
        <Btn block size="lg" variant="primary" disabled loading={busy}>
          {busy ? '正在上传商品图' : '先添加商品图'}
        </Btn>
      </BottomBar>
    </FlowPage>
  );
}

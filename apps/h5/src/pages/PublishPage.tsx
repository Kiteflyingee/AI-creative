import { useQueryClient } from '@tanstack/react-query';
import { Input, TextArea } from 'antd-mobile';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, showError } from '../api';
import { BottomBar, FlowPage, PageHeader, Section, uploadFiles, UploadHero } from '../components';
import { Btn, Field, Pill } from '../ui/kit';

/**
 * 发布表单（D-54）：点“发布”直接进入，不先填商品名称。
 * 选好第一批商品图时才创建项目（避免只打开不上传就留下空草稿），随后进入商品素材页并自动做素材理解。
 */
export function PublishPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async (files: File[]) => {
    setBusy(true);
    try {
      const { projectId } = await api.post<{ projectId: string }>('/app/v1/projects', { name: name.trim() });
      if (description.trim()) await api.patch(`/app/v1/projects/${projectId}/product`, { description: description.trim() });
      const uploaded = await uploadFiles(projectId, 'PRODUCT', files);
      await client.invalidateQueries({ queryKey: ['projects'] });
      // 项目已经建好：即使图片都没传成功也进入商品素材页，在那里继续添加
      navigate(`/p/${projectId}/product${uploaded.length ? '?analyze=1' : ''}`, { replace: true });
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  const optional = (label: string) => (
    <span className="ui-field__label-row">
      {label}
      <Pill className="on-bg">选填</Pill>
    </span>
  );

  return (
    <FlowPage bar>
      <PageHeader title="发布商品视频" step={0} back="/" />

      <Section title="商品图">
        <UploadHero busy={busy} onFiles={(files) => void start(files)} testId="upload-PRODUCT" />
      </Section>

      <Section title="商品信息">
        <Field label={optional('商品名称')} hint="不填也可以，AI 看过商品图后会帮你填写，你可以再改">
          <Input
            className="ui-input"
            placeholder="例如：灰色可拆洗猫窝"
            value={name}
            onChange={setName}
            maxLength={60}
            disabled={busy}
            data-testid="publish-name"
          />
        </Field>
        <Field label={optional('商品描述')}>
          <TextArea
            className="ui-input"
            placeholder="使用场景、具体参数、体感，例如“适合夏天的网面跑鞋，重量 180g”"
            value={description}
            onChange={setDescription}
            autoSize={{ minRows: 2 }}
            maxLength={1000}
            disabled={busy}
            data-testid="publish-desc"
          />
        </Field>
      </Section>

      <BottomBar>
        <Btn block size="lg" variant="primary" disabled loading={busy}>
          {busy ? '正在上传商品图' : '先添加商品图'}
        </Btn>
      </BottomBar>
    </FlowPage>
  );
}

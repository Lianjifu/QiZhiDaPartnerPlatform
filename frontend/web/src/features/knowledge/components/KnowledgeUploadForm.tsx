import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Input } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { Field, KB_TYPE_OPTIONS } from './KnowledgeShared';

const TEXT_UPLOAD_EXT = /\.(md|markdown|txt|json|ya?ml|csv|log)$/i;

export async function readUploadFileContent(file: File): Promise<string> {
  const isText = TEXT_UPLOAD_EXT.test(file.name) || file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/markdown';
  if (isText) {
    const content = (await file.text()).replace(/^\uFEFF/, '');
    if (!content.trim()) throw new Error('文件内容为空，请选择有效的 Markdown / 文本文件');
    return content;
  }
  const base = file.name.replace(/\.[^.]+$/, '') || file.name;
  return `# ${base}\n\n> 已接收文件「${file.name}」。PDF / Word 将进入解析队列。\n`;
}

export function KnowledgeUploadForm({
  canWrite,
  submitting,
  submitLabel = '上传到本包',
  onSubmit,
}: {
  canWrite: boolean;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (payload: { title: string; source: string; tags: string; content: string; fileName: string }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(KB_TYPE_OPTIONS[0]);
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = reading || Boolean(submitting);
  const valid = Boolean(title.trim() && file && canWrite);

  const pick = (next: File | null) => {
    setFile(next);
    if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!valid || !file) return;
    setReading(true);
    setError(null);
    try {
      const content = await readUploadFileContent(file);
      await onSubmit({ title: title.trim(), source, tags: tags.trim(), content, fileName: file.name });
      setFile(null);
      setTitle('');
      setTags('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        accept=".pdf,.doc,.docx,.md,.txt,.markdown,.zip"
        onChange={(event) => { pick(event.target.files?.[0] ?? null); event.target.value = ''; }}
      />
      <button
        type="button"
        className={cn('knowledge-upload-dropzone', dragging && 'is-dragging', file && 'has-file')}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); pick(event.dataTransfer.files?.[0] ?? null); }}
      >
        <span className="knowledge-upload-dropzone__icon"><Upload className="h-5 w-5" /></span>
        <span className="mt-3 text-xs font-semibold">{file ? file.name : '拖拽文件到此处，或点击选择'}</span>
        <span className="mt-1 text-[10px] text-[var(--text-muted)]">Markdown / 文本会读入正文。PDF / Word 目前仅登记占位，完整解析尚未接通。</span>
      </button>
      <Field label="文档标题" required>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Redis 故障 Runbook v3.3" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="文档分类">
          <select value={source} onChange={(event) => setSource(event.target.value)} className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] px-2.5 text-xs">
            {KB_TYPE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </Field>
        <Field label="标签">
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="redis, oom" />
        </Field>
      </div>
      {error && <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[11px] text-[var(--danger)]">{error}</div>}
      <div className="flex justify-end">
        <Button disabled={!valid || busy} onClick={() => void submit()}>{busy ? '上传中…' : submitLabel}</Button>
      </div>
    </div>
  );
}

import { Input } from '@qzda/web-ui';

interface MfaCodeFieldProps {
  value: string;
  onChange: (v: string) => void;
}

/**
 * 6 位多因素验证码输入。
 * 标签包含演示环境提示文案，调用方只负责值与变更。
 */
export function MfaCodeField({ value, onChange }: MfaCodeFieldProps) {
  return (
    <>
      <label className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">多因素验证码 <span className="text-[var(--text-muted)] font-normal">（演示环境可不填）</span></label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="请输入 6 位验证码" className="mb-4" />
    </>
  );
}

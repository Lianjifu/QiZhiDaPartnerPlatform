/**
 * ExpertContextPanel — ContractSection.
 * 岗位契约 section: identity, responsibility, knowledge/cap chips, escalation owner.
 */
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import type { DigitalPartner } from '@qzda/web-types';
import type { ExpertJobContract } from '../lib/expert-context';
import { CapChips, MetaRow } from './ExpertContextPanel.helpers';

export function ContractSection({
  contract,
  assembled,
  onPickExpert,
}: {
  contract: ExpertJobContract | null;
  assembled: string[];
  onPickExpert?: () => void;
}) {
  if (!contract) {
    return (
      <div className="copilot-ecx-empty">
        <p>当前会话尚未绑定在岗数字伙伴。</p>
        {onPickExpert ? <Button size="sm" onClick={onPickExpert}>选择专家</Button> : null}
      </div>
    );
  }
  return (
    <div className="copilot-ecx-contract">
      <div className="copilot-ecx-identity">
        <div className="copilot-ecx-identity__role">{contract.role}</div>
        <div className="copilot-ecx-identity__meta">
          <span>{contract.name}</span>
          <span>·</span>
          <span>{contract.department}</span>
          <span>·</span>
          <span className="font-mono">v{contract.version}</span>
        </div>
        {contract.description ? <p className="copilot-ecx-identity__desc">{contract.description}</p> : null}
      </div>

      <dl className="copilot-ecx-meta">
        <MetaRow label="服务对象" value={contract.serviceObject} />
        <MetaRow label="环境" value={<span className="font-mono">{contract.environment}</span>} />
        <MetaRow label="模型" value={<span className="font-mono">{contract.model}</span>} />
        {contract.evaluationScore != null ? (
          <MetaRow label="评测" value={<span className="font-mono">{contract.evaluationScore}</span>} />
        ) : null}
      </dl>

      <div className="copilot-ecx-split">
        <div>
          <div className="copilot-ecx-kicker">职责</div>
          {contract.responsibilities.length ? (
            <ul className="copilot-ecx-bullets">
              {contract.responsibilities.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : <p className="copilot-ecx-empty-inline">未配置</p>}
        </div>
        <div>
          <div className="copilot-ecx-kicker">禁止项</div>
          {contract.prohibitedActions.length ? (
            <ul className="copilot-ecx-bullets is-warn">
              {contract.prohibitedActions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : <p className="copilot-ecx-empty-inline">未配置</p>}
        </div>
      </div>

      <div>
        <div className="copilot-ecx-kicker">知识包</div>
        <CapChips items={contract.knowledge} empty="尚未装配知识包" />
      </div>
      <div>
        <div className="copilot-ecx-kicker">技能 / 工具 / 流程</div>
        <CapChips items={assembled} empty="尚未装配" />
      </div>

      <div className="copilot-ecx-contract__foot">
        <span>负责人 {contract.owner} · 升级 {contract.escalationOwner}</span>
        <Link to="/partners" className="copilot-ecx-link">
          岗位配置 <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
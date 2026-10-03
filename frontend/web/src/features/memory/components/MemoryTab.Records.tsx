/**
 * MemoryTab.Records — 三层记忆共用列表 + 分页 + 筛选 + 行操作。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ChevronLeft, ChevronRight, Clock3, ExternalLink, FileUp, Search, Trash2 } from 'lucide-react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import type { DigitalPartner, MemoryLayer, MemoryRecord } from '@qzda/web-types';
import {
  MEMORY_PAGE_SIZE_KEY,
  MEMORY_PAGE_SIZE_OPTIONS,
  clampMemoryPage,
  memoryContentPreview,
  memoryPageCount,
  paginateItems,
  readMemoryPageSize,
  sortMemoryRecordsByRecency,
} from '@/features/memory/record-list';
import {
  MEMORY_CLASSIFICATION_LABEL,
  MEMORY_LAYER,
  MEMORY_SCOPE_LABEL,
  MEMORY_SOURCE_LABEL,
  MEMORY_STATUS_LABEL,
  MemoryStatusFilter,
  memoryFormatFullTime,
  memoryFormatTime,
  memorySourcePath,
} from './MemoryShared';

type Props = {
  records: MemoryRecord[];
  layer: MemoryLayer;
  query: string;
  statusFilter: MemoryStatusFilter;
  employeeFilter: string;
  employees: DigitalPartner[];
  employeeMap: Map<string, DigitalPartner>;
  onQuery: (value: string) => void;
  onStatusFilter: (value: MemoryStatusFilter) => void;
  onEmployeeFilter: (value: string) => void;
  onOpenDetail: (id: string) => void;
  onExpire?: (id: string, title: string) => void;
  onDelete?: (id: string, title: string) => void;
  onCandidate?: (id: string) => void;
  canMutate?: boolean;
};

export function MemoryTabRecords({
  records,
  layer,
  query,
  statusFilter,
  employeeFilter,
  employees,
  employeeMap,
  onQuery,
  onStatusFilter,
  onEmployeeFilter,
  onOpenDetail,
  onExpire,
  onDelete,
  onCandidate,
  canMutate = false,
}: Props) {
  const meta = MEMORY_LAYER[layer];
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readMemoryPageSize(typeof window !== 'undefined' ? window.localStorage : null));
  const sorted = useMemo(() => sortMemoryRecordsByRecency(records), [records]);
  const pageCount = memoryPageCount(sorted.length, pageSize);
  const pageSafe = clampMemoryPage(page, pageCount);
  const pageItems = useMemo(() => paginateItems(sorted, pageSafe, pageSize), [sorted, pageSafe, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, employeeFilter, layer, pageSize]);

  useEffect(() => {
    if (page !== pageSafe) setPage(pageSafe);
  }, [page, pageSafe]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MEMORY_PAGE_SIZE_KEY, String(pageSize));
    } catch {
      /* ignore */
    }
  }, [pageSize]);

  return (
    <div className="memory-list">
      <div className="memory-section-head">
        <div>
          <h2>{meta.label}记忆 · {records.length} 条</h2>
          <p>按工作区隔离；默认仅展示生效中记录，可按数字伙伴与状态筛选。</p>
        </div>
        <div className="memory-toolbar">
          <select value={employeeFilter} onChange={(event) => onEmployeeFilter(event.target.value)} className="memory-select" aria-label="数字伙伴">
            <option value="all">全部数字伙伴</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as MemoryStatusFilter)} className="memory-select" aria-label="状态">
            <option value="active">生效中</option>
            <option value="pending_review">待审</option>
            <option value="expired">已失效</option>
            <option value="revoked">已撤销</option>
            <option value="promoted">已晋升</option>
            <option value="all">全部状态</option>
          </select>
          <label className="memory-select memory-select--inline">
            <span>每页</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="每页条数">
              {MEMORY_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size} 条</option>
              ))}
            </select>
          </label>
          <label className="memory-search">
            <Search className="h-3.5 w-3.5" />
            <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="检索标题、内容或关联 ID" className="h-9 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0" />
          </label>
        </div>
      </div>

      {records.length ? (
        <>
          <div className="memory-record-list">
            {pageItems.map((record) => {
              const employee = record.digitalPartnerId ? employeeMap.get(record.digitalPartnerId) : undefined;
              const href = memorySourcePath(record);
              const preview = memoryContentPreview(record.content);
              return (
                <article key={record.id} className={cn('memory-record', `is-${meta.tone}`)}>
                  <div className="memory-record__main">
                    <button type="button" className="memory-record__body" onClick={() => onOpenDetail(record.id)}>
                      <div className="memory-record__title">
                        <strong>{record.title}</strong>
                        <div className="memory-record__badges">
                          <Badge tone={meta.tone}>{Math.round(record.confidence * 100)}% 置信</Badge>
                          <Badge tone={record.classification === 'restricted' ? 'warn' : 'neutral'}>{MEMORY_CLASSIFICATION_LABEL[record.classification]}</Badge>
                          <Badge tone={record.status === 'active' ? 'success' : record.status === 'pending_review' ? 'warn' : 'neutral'}>{MEMORY_STATUS_LABEL[record.status]}</Badge>
                        </div>
                      </div>
                      {preview.kind === 'dialog' ? (
                        <div className="memory-record__preview">
                          {preview.lines.map((line) => (
                            <p key={`${record.id}-${line.role}`}>
                              <span className="memory-record__role">{line.role}</span>
                              {line.text}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="memory-record__snippet">{preview.text}</p>
                      )}
                      <span className="memory-record__more">查看全部</span>
                    </button>
                    <div className="memory-record__actions">
                      {href && (
                        <button type="button" className="memory-action" onClick={() => navigate(href)}>
                          <ExternalLink className="h-3.5 w-3.5" />回溯
                        </button>
                      )}
                      {canMutate && layer === 'long_term' && record.status === 'active' && onCandidate && (
                        <button type="button" className="memory-action memory-action--primary" onClick={() => onCandidate(record.id)}>
                          <FileUp className="h-3.5 w-3.5" />提炼
                        </button>
                      )}
                      {canMutate && record.status === 'active' && onExpire && (
                        <button type="button" className="memory-action" onClick={() => onExpire(record.id, record.title)}>
                          <Clock3 className="h-3.5 w-3.5" />失效
                        </button>
                      )}
                      {canMutate && onDelete && (
                        <button type="button" className="memory-action memory-action--danger" onClick={() => onDelete(record.id, record.title)}>
                          <Trash2 className="h-3.5 w-3.5" />删除
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="memory-record__meta">
                    <span>{employee ? `${employee.name} · ${employee.role}` : '未绑定数字伙伴'}</span>
                    <span>范围 {MEMORY_SCOPE_LABEL[record.scope]}</span>
                    <span title={memoryFormatFullTime(record.updatedAt || record.createdAt)}>{memoryFormatTime(record.updatedAt || record.createdAt)}</span>
                    {record.expiresAt && <span title={memoryFormatFullTime(record.expiresAt)}>过期 {memoryFormatTime(record.expiresAt)}</span>}
                    <span className="font-mono" title={`${MEMORY_SOURCE_LABEL[record.sourceType]}:${record.sourceId}`}>
                      {MEMORY_SOURCE_LABEL[record.sourceType]}:{record.sourceId}
                    </span>
                    <span className="font-mono memory-record__corr" title={record.correlationId}>{record.correlationId}</span>
                  </div>
                </article>
              );
            })}
          </div>
          <MemoryPagination
            page={pageSafe}
            pageCount={pageCount}
            pageSize={pageSize}
            total={sorted.length}
            onPrev={() => setPage((value) => Math.max(1, value - 1))}
            onNext={() => setPage((value) => Math.min(pageCount, value + 1))}
          />
        </>
      ) : (
        <div className="memory-empty">
          <EmptyState icon={Archive} title="没有匹配的记忆" description="记录将在会话、任务或工作流的受控执行中形成；可切换状态或数字伙伴筛选。" />
        </div>
      )}
    </div>
  );
}

function MemoryPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="memory-pagination" role="navigation" aria-label="记忆列表分页">
      <span className="memory-pagination__meta">
        第 {page} / {pageCount} 页 · 显示 {from}-{to} / 共 {total} 条
      </span>
      <div className="memory-pagination__actions">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={onPrev}>
          <ChevronLeft className="h-3.5 w-3.5" />上一页
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={onNext}>
          下一页<ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * DocumentPreview — XLSX preview components (XlsxGridTable + XlsxPreviewView).
 * Extracted from DocumentPreview.tsx to satisfy file-size gates.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Table } from 'lucide-react';
import {
  buildXlsxGrid,
  type XlsxGrid,
  type XlsxPreviewPayload,
} from './DocumentPreview';

function XlsxGridTable({ grid, sheetName }: { grid: XlsxGrid; sheetName: string }) {
  if (grid.rows === 0 || grid.cols === 0) {
    return (
      <div className="copilot-doc-preview__state">
        <Table className="h-4 w-4" />
        <span>{sheetName} 工作表为空</span>
      </div>
    );
  }
  const headerCells: ReactElement[] = [];
  headerCells.push(
    <th key="row-h" className="copilot-doc-preview__xlsx-corner" scope="col">
      &nbsp;
    </th>,
  );
  for (let c = 1; c <= grid.cols; c += 1) {
    headerCells.push(
      <th key={`col-${c}`} className="copilot-doc-preview__xlsx-colhdr" scope="col">
        {String.fromCharCode(64 + c)}
      </th>,
    );
  }
  const bodyRows: ReactElement[] = [];
  for (let r = 1; r <= grid.rows; r += 1) {
    const rowCells: ReactElement[] = [];
    rowCells.push(
      <th key={`row-${r}`} className="copilot-doc-preview__xlsx-rowhdr" scope="row">
        {r}
      </th>,
    );
    for (let c = 1; c <= grid.cols; c += 1) {
      const text = grid.data.get(`${r}:${c}`) ?? '';
      rowCells.push(
        <td key={`cell-${r}-${c}`} className={r === 1 ? 'copilot-doc-preview__xlsx-cell is-header' : 'copilot-doc-preview__xlsx-cell'}>
          {text}
        </td>,
      );
    }
    bodyRows.push(<tr key={`row-tr-${r}`}>{rowCells}</tr>);
  }
  return (
    <div className="copilot-doc-preview__xlsx-wrap">
      <table className="copilot-doc-preview__xlsx-table" aria-label={`${sheetName} 工作表`}>
        <thead>
          <tr>{headerCells}</tr>
        </thead>
        <tbody>{bodyRows}</tbody>
      </table>
    </div>
  );
}

export function XlsxPreviewView({ payload }: { payload: XlsxPreviewPayload }) {
  const worksheets = payload.workbook?.worksheets || [];
  const initialSheet = payload.selection?.sheet || worksheets[0]?.name || 'Sheet1';
  const [activeSheet, setActiveSheet] = useState(initialSheet);
  const grid = useMemo(() => buildXlsxGrid(payload.selection?.cells, 20, 30), [payload.selection?.cells]);

  const showSheetTabs = worksheets.length > 1;
  const meta = [
    payload.workbook?.creator ? `作者：${payload.workbook.creator}` : null,
    payload.workbook?.modified ? `更新：${payload.workbook.modified}` : null,
    typeof payload.workbook?.worksheetCount === 'number' ? `${payload.workbook.worksheetCount} 个工作表` : null,
    payload.selection?.range ? `范围：${payload.selection.range}` : null,
    payload.selection?.truncated ? '（已截断，仅显示前 20×30 单元格）' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="copilot-doc-preview__xlsx">
      {meta.length > 0 ? (
        <div className="copilot-doc-preview__xlsx-meta">{meta.join(' · ')}</div>
      ) : null}
      {showSheetTabs ? (
        <div className="copilot-doc-preview__xlsx-tabs" role="tablist" aria-label="工作表">
          {worksheets.map((ws) => (
            <button
              key={`tab-${ws.name}`}
              type="button"
              role="tab"
              aria-selected={ws.name === activeSheet}
              className={`copilot-doc-preview__xlsx-tab${ws.name === activeSheet ? ' is-active' : ''}`}
              onClick={() => setActiveSheet(ws.name)}
              title={ws.actualRowCount ? `${ws.actualRowCount} 行 × ${ws.actualColumnCount || ws.columnCount || 0} 列` : undefined}
            >
              {ws.name}
            </button>
          ))}
        </div>
      ) : null}
      <XlsxGridTable grid={grid} sheetName={activeSheet} />
    </div>
  );
}
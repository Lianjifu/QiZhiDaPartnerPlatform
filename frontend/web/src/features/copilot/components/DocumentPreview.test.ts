import { describe, expect, it } from 'vitest';
import {
  buildXlsxGrid,
  columnIndex,
  parseCellAddress,
  xlsxCellToText,
  type XlsxPreviewCell,
} from './DocumentPreview';

describe('columnIndex / parseCellAddress', () => {
  it('maps A, Z, AA, AB to base-26 column numbers', () => {
    expect(columnIndex('A')).toBe(1);
    expect(columnIndex('Z')).toBe(26);
    expect(columnIndex('AA')).toBe(27);
    expect(columnIndex('AB')).toBe(28);
  });

  it('parses cell addresses with optional absolute markers', () => {
    expect(parseCellAddress('A1')).toEqual({ row: 1, col: 1 });
    expect(parseCellAddress('$B$12')).toEqual({ row: 12, col: 2 });
    expect(parseCellAddress('AC1048576')).toEqual({ row: 1048576, col: 29 });
  });

  it('returns null for malformed addresses', () => {
    expect(parseCellAddress('')).toBeNull();
    expect(parseCellAddress('1A')).toBeNull();
    expect(parseCellAddress('A')).toBeNull();
  });
});

describe('xlsxCellToText', () => {
  it('handles primitives', () => {
    expect(xlsxCellToText('张三')).toBe('张三');
    expect(xlsxCellToText(1000000)).toBe('1000000');
    expect(xlsxCellToText(true)).toBe('true');
    expect(xlsxCellToText(null)).toBe('');
    expect(xlsxCellToText(undefined)).toBe('');
  });

  it('flattens ExcelJS richText and formula shapes', () => {
    expect(xlsxCellToText({ richText: [{ text: '财务' }, { text: '部' }] })).toBe('财务部');
    expect(xlsxCellToText({ text: '=SUM(A1:A5)' })).toBe('=SUM(A1:A5)');
    expect(xlsxCellToText({ result: 12345 })).toBe('12345');
    expect(xlsxCellToText({ formula: 'B1*2', result: 200 })).toBe('200');
  });
});

describe('buildXlsxGrid', () => {
  it('positions cells and computes bounding box', () => {
    const cells: XlsxPreviewCell[] = [
      { address: 'A1', value: '项目' },
      { address: 'B1', value: '金额' },
      { address: 'A2', value: '收入' },
      { address: 'B2', value: 1000000 },
    ];
    const grid = buildXlsxGrid(cells, 20, 30);
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.data.get('1:1')).toBe('项目');
    expect(grid.data.get('1:2')).toBe('金额');
    expect(grid.data.get('2:1')).toBe('收入');
    expect(grid.data.get('2:2')).toBe('1000000');
  });

  it('clamps cells beyond maxCols/maxRows', () => {
    const cells: XlsxPreviewCell[] = [
      { address: 'A1', value: 'ok' },
      { address: 'T1', value: 'edge' },
      { address: 'U1', value: 'over-col' },
      { address: 'A50', value: 'over-row' },
    ];
    const grid = buildXlsxGrid(cells, 20, 30);
    expect(grid.data.get('1:1')).toBe('ok');
    expect(grid.data.get('1:20')).toBe('edge');
    expect(grid.data.get('1:21')).toBeUndefined();
    expect(grid.data.get('50:1')).toBeUndefined();
  });

  it('skips malformed addresses without throwing', () => {
    const cells = [
      { address: 'A1', value: 'good' },
      { address: 'nope', value: 'bad' },
    ] as unknown as XlsxPreviewCell[];
    const grid = buildXlsxGrid(cells, 20, 30);
    expect(grid.data.get('1:1')).toBe('good');
    expect(grid.data.size).toBe(1);
  });
});

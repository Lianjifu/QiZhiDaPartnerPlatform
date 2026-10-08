import { describe, expect, it } from 'vitest';
import { builtinToolNamesFromCatalog, capabilityAssemblyCompleteness } from './partners';

const employee = {
  capabilities: { model: 'deepseek-flash', skills: [], tools: ['knowledge.retrieve', 'crm.lookup'], workflows: [] },
  boundaryPolicy: { capabilityModes: [] },
} as never;

describe('capability assembly with built-in tools', () => {
  it('still requires an execution mode for non built-in tools without a catalog', () => {
    const result = capabilityAssemblyCompleteness(employee);
    expect(result.ready).toBe(false);
    expect(result.missing.join(' ')).toContain('执行授权模式');
  });

  it('exempts catalog built-in tools from execution mode validation', () => {
    const builtin = builtinToolNamesFromCatalog({
      platformTools: [{ name: 'knowledge.retrieve' }],
      runtimeTools: [{ name: 'memory.recall' }],
    });
    const result = capabilityAssemblyCompleteness(employee, builtin);
    expect(result.ready).toBe(false);
    expect(result.missing.join(' ')).toContain('crm.lookup');
    expect(result.missing.join(' ')).not.toContain('knowledge.retrieve');
  });

  it('is ready when every bound tool is built-in', () => {
    const builtin = builtinToolNamesFromCatalog({ platformTools: [{ name: 'knowledge.retrieve' }, { name: 'crm.lookup' }] });
    expect(capabilityAssemblyCompleteness(employee, builtin).ready).toBe(true);
  });
});

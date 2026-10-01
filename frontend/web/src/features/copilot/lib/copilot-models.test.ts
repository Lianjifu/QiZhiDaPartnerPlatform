import { describe, expect, it } from 'vitest';
import { buildCopilotModelOptions, defaultCopilotModelKey, resolveCopilotModelId, resolveSendModelId } from './copilot-models';

describe('buildCopilotModelOptions', () => {
  it('builds from active providers and published routes', () => {
    const options = buildCopilotModelOptions(
      [
        {
          id: 'mp-1',
          name: 'Azure',
          status: 'active',
          models: [
            { id: 'mdl-gpt4', name: 'gpt-4o', status: 'available', capabilities: ['chat'], contextWindow: 128000 },
            { id: 'mdl-emb', name: 'bge-m3', status: 'available', capabilities: ['embedding'] },
          ],
        },
      ],
      [{ id: 'rp-p0', level: 'P0', status: 'published', primaryModelId: 'mdl-gpt4' }],
    );
    expect(options).toHaveLength(1);
    expect(options[0].modelId).toBe('mdl-gpt4');
    expect(options[0].label).toBe('gpt-4o');
    expect(options[0].apiModel).toBe('gpt-4o');
    expect(options[0].desc).toBe('azure · 128k ctx');
    expect(options[0].tier).toBe('P0');
    expect(defaultCopilotModelKey(options)).toBe('mdl-gpt4');
  });

  it('shows deepseek-style label and offline providers for run config', () => {
    const options = buildCopilotModelOptions(
      [
        {
          id: 'mp-ds',
          name: 'deepseek',
          status: 'offline',
          models: [
            { id: 'mdl-ds', name: 'deepseek-v4-flash', status: 'available', capabilities: ['chat'], contextWindow: 32000 },
          ],
        },
      ],
      [],
    );
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('deepseek-v4-flash');
    expect(options[0].desc).toBe('deepseek · 32k ctx');
    expect(resolveCopilotModelId(options[0], 'x')).toBe('mdl-ds');
  });

  it('returns empty list when no providers (no demo aliases)', () => {
    const options = buildCopilotModelOptions([], []);
    expect(options).toEqual([]);
    expect(defaultCopilotModelKey(options)).toBe('');
  });

  it('resolveSendModelId prefers employee bound model over demo alias', () => {
    const options = buildCopilotModelOptions(
      [
        {
          id: 'mp-1',
          name: 'Azure',
          status: 'active',
          models: [
            { id: 'mdl-gpt4', name: 'gpt-4o', status: 'available', capabilities: ['chat'], contextWindow: 128000 },
          ],
        },
      ],
      [],
    );
    expect(
      resolveSendModelId({
        runModelId: 'sonnet-4',
        runKey: 'sonnet-4',
        employeeBoundModel: 'gpt-4o',
        options,
      }),
    ).toBe('mdl-gpt4');
  });
});

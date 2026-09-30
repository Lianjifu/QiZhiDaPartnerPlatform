/**
 * 当前工作区状态 — 多工作区切换
 */
import { create } from 'zustand';
import type { Workspace } from '@qzda/web-types';

interface WorkspaceState {
  current: Workspace | null;
  currentWorkspaceId: string | null;
  list: Workspace[];
  setCurrent: (w: Workspace) => void;
  setList: (list: Workspace[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  current: null,
  list: [],
  currentWorkspaceId: null,
  setCurrent: (w) => set({ current: w, currentWorkspaceId: w.id }),
  setList: (list) => set({ list }),
}));

/** markdown-it 第三方插件没有官方类型声明，这里按实际用法补最小声明。 */
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  interface TaskListsOptions {
    /** 用 <label> 包住 checkbox（默认 true）。 */
    label?: boolean;
    /** <label> 放在 checkbox 之后（默认 false）。 */
    labelAfter?: boolean;
  }
  const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

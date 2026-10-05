import { Navigate, useSearchParams } from 'react-router-dom';

/** 兼容旧入口：接入数据源发生在知识包成员文档。 */
export default function KnowledgeSourcePage() {
  const [params] = useSearchParams();
  const packageId = params.get('package');
  if (packageId) {
    return <Navigate to={`/knowledge/packages/${encodeURIComponent(packageId)}?step=members&ingest=source`} replace />;
  }
  return <Navigate to="/knowledge/packages/new" replace />;
}

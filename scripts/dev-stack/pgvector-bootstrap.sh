#!/bin/sh
# Bootstrap pgvector 0.7.4 into the running qzda-postgres container.
#
# Use when Docker Hub 不可达,无法直接 docker pull pgvector/pgvector:pg16-alpine。
# 现有 docker 容器跑的是 postgres:16-alpine(无 vector 扩展),本脚本:
#   1. 在容器内装 build 工具链(git / make / gcc / postgresql16-dev)
#   2. 从 GitHub 拉 pgvector 0.7.4 源码
#   3. 用容器里真正的 PG16 pg_config 编译 vector.so(64-dim 哈希版)
#   4. 把 .so + .control + sql 装到 /usr/local/{lib,share}/postgresql/
#   5. 启用扩展 + 创建 memory_vectors 表
#
# 用法:
#   bash scripts/dev-stack/pgvector-bootstrap.sh             # 自动找 qzda-postgres
#   CONTAINER=mypg bash scripts/dev-stack/pgvector-bootstrap.sh  # 自定义容器名
#
# 验证 (不需重启容器,直接生效):
#   docker exec qzda-postgres psql -U de -d digital_employee -c "SELECT extversion FROM pg_extension WHERE extname='vector';"

set -eu
CONTAINER="${CONTAINER:-qzda-postgres}"
PGVECTOR_VERSION="${PGVECTOR_VERSION:-0.7.4}"
PG_INSTALL_DIR="/usr/local"

echo ">>> target container: $CONTAINER (pgvector v$PGVECTOR_VERSION)"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: container '$CONTAINER' not running. Start stack first:"
  echo "  cd backend && make compose-up"
  exit 1
fi

# 1. 装构建工具链(已装会跳过)
echo ">>> [1/4] installing build toolchain in container"
docker exec "$CONTAINER" sh -c '
apk add --no-cache git make gcc musl-dev postgresql16-dev 2>&1 | tail -1
'

# 2. 拉源码
echo ">>> [2/4] fetching pgvector v$PGVECTOR_VERSION source"
docker exec "$CONTAINER" sh -c "
set -e
cd /tmp
rm -rf pgvector
# GitHub 经常被墙,试 gh-proxy.com / ghproxy.net 镜像,最后回退到 github.com
for mirror in 'https://gh-proxy.com/https://github.com' 'https://mirror.ghproxy.com/https://github.com' 'https://github.com'; do
  url=\"\${mirror}/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz\"
  echo \"  trying \$url\"
  if curl -sLf --max-time 30 -o /tmp/pgvector.tar.gz \"\$url\" 2>/dev/null && [ -s /tmp/pgvector.tar.gz ]; then
    echo \"  download ok\"
    break
  fi
done
[ -s /tmp/pgvector.tar.gz ] || { echo \"FATAL: all mirrors failed\"; exit 1; }
rm -rf pgvector-src
mkdir pgvector-src
tar xzf pgvector.tar.gz -C pgvector-src --strip-components=1
cd pgvector-src
ls -d src sql >/dev/null  # sanity
echo \"source ready: \$(ls -1 | head -3)\"
"

# 3. 编译(容器里真正的 PG16 pg_config)
echo ">>> [3/4] building vector.so (PG_CONFIG=/usr/local/bin/pg_config)"
docker exec "$CONTAINER" sh -c "
set -e
cd /tmp/pgvector-src
PG_CONFIG=/usr/local/bin/pg_config make -j4 2>&1 | tail -1
ls -la vector.so
"

# 4. 装(绕开 pgxs bitcode 步骤:手动 cp)
echo ">>> [4/4] installing (skipping bitcode build step)"
docker exec "$CONTAINER" sh -c "
set -e
cd /tmp/pgvector-src
cp vector.so $PG_INSTALL_DIR/lib/postgresql/vector.so
cp sql/vector--$PGVECTOR_VERSION.sql $PG_INSTALL_DIR/share/postgresql/extension/
cp vector.control $PG_INSTALL_DIR/share/postgresql/extension/vector.control
ls -la $PG_INSTALL_DIR/lib/postgresql/vector.so $PG_INSTALL_DIR/share/postgresql/extension/vector*
"

# 5. 启用 + 跑迁移
echo ">>> applying 0004_pgvector.sql (CREATE EXTENSION + memory_vectors 表)"
PGPASSWORD=de docker exec -i "$CONTAINER" psql -U de -d digital_employee < "$(dirname "$0")/../../backend/deploy/migrations/0004_pgvector.sql" 2>&1 | tail -5

# 6. 验证
echo ">>> verify"
docker exec "$CONTAINER" psql -U de -d digital_employee -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
docker exec "$CONTAINER" psql -U de -d digital_employee -c "SELECT count(*) AS memory_vectors_count FROM memory_vectors;"

echo ""
echo "✓ pgvector v$PGVECTOR_VERSION ready in $CONTAINER"
echo "  (when Docker Hub 可达,把 compose.yml postgres image 改回 pgvector/pgvector:pg16-alpine 即可去掉本脚本)"

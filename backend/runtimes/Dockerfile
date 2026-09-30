# Legacy unified Dockerfile — build from backend/ root:
#   docker build -f runtimes/Dockerfile --build-arg SERVICE=qzda-rag -t qzda-rag .
#
# Prefer per-service Dockerfiles under services/qzda-*/ (see each SERVICE.md).
ARG SERVICE=qzda-agent-runtime
FROM python:3.12-slim
WORKDIR /app
COPY services/${SERVICE}/requirements.txt ./
COPY services/${SERVICE}/requirements-milvus.txt* ./
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ -f requirements-milvus.txt ]; then pip install --no-cache-dir -r requirements-milvus.txt; fi
COPY services/${SERVICE}/app ./app/
ENV PYTHONUNBUFFERED=1
ENV DE_BIND_HOST=0.0.0.0
ARG PORT=8091
ENV DE_BIND_PORT=${PORT}
EXPOSE ${PORT}
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}

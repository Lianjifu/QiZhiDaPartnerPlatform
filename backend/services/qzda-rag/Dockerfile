FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-milvus.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -r requirements-milvus.txt
COPY app/ ./app/
ENV PYTHONUNBUFFERED=1
ENV DE_BIND_HOST=0.0.0.0
ENV DE_BIND_PORT=8092
EXPOSE 8092
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8092"]

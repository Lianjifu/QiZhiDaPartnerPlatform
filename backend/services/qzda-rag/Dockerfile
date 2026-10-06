FROM python:3.12-slim
WORKDIR /app
COPY backend/services/qzda-rag/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/services/qzda-rag/app/ ./app/
ENV PYTHONUNBUFFERED=1
ENV QZDA_BIND_HOST=0.0.0.0
ENV QZDA_BIND_PORT=8092
EXPOSE 8092
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8092"]

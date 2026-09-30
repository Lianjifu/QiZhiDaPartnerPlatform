FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
ENV PYTHONUNBUFFERED=1
ENV DE_BIND_HOST=0.0.0.0
ENV DE_BIND_PORT=8093
ENV DE_SKILL_REQUIRE_ISOLATION=1
EXPOSE 8093
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8093"]

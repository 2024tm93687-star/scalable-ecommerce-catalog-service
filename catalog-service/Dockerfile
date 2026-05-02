FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY common /app/common
COPY data /app/data
COPY catalog-service /app/catalog-service

RUN mkdir -p /tmp/eci/catalog
EXPOSE 8000
CMD ["uvicorn", "main:app", "--app-dir", "/app/catalog-service/app", "--host", "0.0.0.0", "--port", "8000"]

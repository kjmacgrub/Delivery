FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies for PDF processing (pdfplumber/pymupdf)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies directly (faster and more reliable than pip install .)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    "fastapi>=0.111.0" \
    "uvicorn>=0.30.0" \
    "pdfplumber>=0.11.0" \
    "pymupdf>=1.24.0" \
    "firebase-admin>=6.0.0" \
    "pydantic>=2.5.0" \
    "python-multipart>=0.0.6"

# Copy application code
COPY delivery/ delivery/

# Create temp directory for PDF processing
RUN mkdir -p data/temp

# Cloud Run sets PORT env var (default 8080)
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "uvicorn delivery.api.app:app --host 0.0.0.0 --port $PORT"]
